/* ボートレース予想 — 共通処理と3画面 (index / race / stats)。ビルドなしの素の JS。
   データは data/ 以下の JSON (本体 boatrace-ai の web/ が書き出す。スキーマは schema/)。 */
"use strict";

// ─── 文言 ───────────────────────────────────────────────────────────────────

const GROUPS = [
  { id: "fun", title: "鑑賞用の買い方", note: "確率と展開の性格で選ぶ、見て楽しむための買い方。成績の判定には使いません。" },
  { id: "verify", title: "検証用の買い方", note: "期待値（確率 × オッズ）で選ぶ買い方。成績の判定に使います。" },
];
// 2026-11-11 までの picks は rule が条件の文字列。ルールの一覧 (pick_rules) が無いファイルも steady だけとして読む
const LEGACY_RULES = { "odds<=10 & ev>1": "steady", "odds<=10 & ev>1.0": "steady" };
const ruleId = (r) => LEGACY_RULES[r] || r;
const STEADY_ONLY = [{ id: "steady", group: "verify", label: "堅実", description: "オッズ10倍以下・期待値1.0超", stake: 100, control: false }];

const STATUS = {
  scheduled: "予想前", predicted: "予想済", closed: "締切・結果待ち", finished: "確定", cancelled: "中止・結果なし",
};

// ─── 小物 ───────────────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const pct = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");
const fix = (x, d) => (isNum(x) ? x.toFixed(d) : "—");
const odds = (x) => (isNum(x) ? x.toFixed(1) : "—");
const ev = (x) => (isNum(x) ? x.toFixed(2) : "—");
const yen = (x) => (isNum(x) ? `¥${Math.round(x).toLocaleString("ja-JP")}` : "—");
const yenSigned = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}¥${Math.abs(Math.round(x)).toLocaleString("ja-JP")}` : "—");
const int = (x) => (isNum(x) ? Math.round(x).toLocaleString("ja-JP") : "—");
/** ISO 8601 (+09:00) → "HH:MM" (日本時間)。書き出し側が JST で持っているので、時差の計算はしない */
const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : "—");
const params = () => new URLSearchParams(location.search);
const dateFromRaceId = (id) => (/^\d{6}_/.test(id || "") ? `20${id.slice(0, 2)}-${id.slice(2, 4)}-${id.slice(4, 6)}` : null);
const weekday = (d) => "日月火水木金土"[new Date(`${d}T00:00:00+09:00`).getDay()];
const fmtDate = (d) => (d ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日（${weekday(d)}）` : "");
const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${weekday(d)}）`;
/** 今日の日付 (日本時間) "YYYY-MM-DD" */
const todayJST = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

async function getJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

function showEmpty(el, msg = "データがありません") {
  el.innerHTML = `<div class="empty">${esc(msg)}</div>`;
}

const boat = (n) => `<span class="boat b${n}" aria-label="${n}号艇">${n}</span>`;
const boats = (list) => `<span class="boats">${(list || []).map(boat).join("")}</span>`;
const bar = (p, alt = false) => `<span class="bar${alt ? " alt" : ""}"><i style="width:${Math.max(0, Math.min(1, p || 0)) * 100}%"></i></span>`;
const badgeStatus = (st) => `<span class="badge st-${st}">${STATUS[st] || st}</span>`;

/** 的中マーク。true = 的中、false = 外れ、null = 結果待ち。pendingText を空にすると結果待ちは何も出さない */
function mark(hit, pendingText = "結果待ち") {
  if (hit === true) return `<span class="mark hit">◎ 的中</span>`;
  if (hit === false) return `<span class="mark miss">× 外れ</span>`;
  return pendingText ? `<span class="mark pending">${pendingText}</span>` : "";
}

/** 表の中で使う短い印 (◎ / × / …)。意味は title とスクリーンリーダー向けの文字で補う */
function markShort(hit) {
  if (hit === true) return `<span class="mark hit" title="的中" aria-label="的中">◎</span>`;
  if (hit === false) return `<span class="mark miss" title="外れ" aria-label="外れ">×</span>`;
  return `<span class="mark pending" title="結果待ち" aria-label="結果待ち">…</span>`;
}

function arrivalText(e) {
  if (isNum(e.arrival)) return `${e.arrival}着`;
  if (e.arrival_code) return esc(e.arrival_code);
  return "";
}

// ─── ヘッダ ─────────────────────────────────────────────────────────────────

function header(active) {
  const nav = [["home", "index.html", "ホーム"], ["races", "races.html", "レース"], ["stats", "stats.html", "成績"]]
    .map(([k, href, label]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<header class="site-header"><div class="inner"><a class="brand" href="index.html">ボートレース予想</a><nav>${nav}</nav></div></header>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 0. ホーム (index.html): 今日の様子と、もうすぐ締切・混戦・的中・鑑賞用の成績
// ═══════════════════════════════════════════════════════════════════════════

async function pageHome() {
  // 以前のトップ (index.html?date=…) の共有リンクはレース一覧へ
  if (/[?&](date|venue|view)=/.test(location.search)) return location.replace(`races.html${location.search}`);
  document.body.insertAdjacentHTML("afterbegin", header("home"));
  const main = $("main");
  let index;
  try {
    index = await getJSON("data/index.json");
  } catch {
    return showEmpty(main);
  }
  const date = index.latest_date;
  if (!date) return showEmpty(main, "まだレースのデータがありません");
  const [day, fun] = await Promise.all([getJSON(`data/races/${date}.json`).catch(() => null),
    getJSON("data/stats/fun.json").catch(() => null)]);
  const races = (day?.races || []).slice().sort(byClose);
  const now = Date.now();
  const isToday = date === todayJST();
  const isOpen = (r) => new Date(r.close_at).getTime() > now && !["finished", "cancelled"].includes(r.status);
  const open = isToday ? races.filter(isOpen) : [];

  const soon = open.slice(0, 3);
  // 混戦: 展開1位の確率が低い (展開が割れている) レース。締切前があればその中から
  const pool = (open.length ? open : races).filter((r) => r.top_flag && isNum(r.top_flag.prob));
  const close = pool.slice().sort((a, b) => a.top_flag.prob - b.top_flag.prob).slice(0, 3);
  const hits = races.filter((r) => r.top_trifecta?.hit && r.result).sort((a, b) => (b.result.payout || 0) - (a.result.payout || 0)).slice(0, 3);

  const section = (title, sub, body, link = "") =>
    `<section class="home-sec"><h2>${title}${sub ? ` <span class="muted small">${sub}</span>` : ""}</h2>${body}${link}</section>`;
  const funCardsMini = fun && fun.rows?.length ? `<div class="mini-grid">${fun.rows.map((r) => `
      <a class="mini" href="stats.html#fun">
        <div class="mini-label">${esc(r.rule)}</div>
        ${r.races ? `<div class="mini-row"><span class="muted small">的中率</span><b class="num">${pct(r.race_hit_rate, 0)}</b></div>
          <div class="mini-row"><span class="muted small">最高</span><b class="num">${r.max_payout == null ? "—" : yen(r.max_payout)}</b></div>
          <div class="mini-row"><span class="muted small">連続ハズレ</span><b class="num">${int(r.current_streak)}</b></div>`
        : `<div class="faint small">記録中</div>`}
      </a>`).join("")}</div>` : `<div class="empty">記録中</div>`;

  main.innerHTML = `
    <section class="hero">
      <h1>ボートレース予想</h1>
      <p class="muted">全場・全レースの展開と3連単の確率を、締切12分前に予想しています。</p>
    </section>
    <section class="home-sec today">
      <h2>${isToday ? "今日" : "最新"} <span class="muted small">${fmtDate(date)}</span></h2>
      ${races.length ? daySummary(races, isToday, isOpen) : '<div class="muted">データがありません</div>'}
      <a class="btn" href="races.html?date=${date}">レース一覧を見る</a>
    </section>
    ${soon.length ? section("もうすぐ締切", "", soon.map((r) => raceRow(r)).join(""),
      `<a class="more" href="races.html?date=${date}&view=next">締切前のレースをすべて見る</a>`) : ""}
    ${close.length ? section("混戦になりそうなレース", "展開1位の確率が低い順", close.map((r) => raceRow(r)).join("")) : ""}
    ${section(isToday ? "今日の的中" : "この日の的中", "3連単1位が当たったレース", hits.length ? hits.map((r) => raceRow(r)).join("")
      : '<div class="empty">まだありません</div>')}
    ${section("鑑賞用の買い方", fun?.period ? esc(fun.period) : "", funCardsMini, '<a class="more" href="stats.html">成績を見る</a>')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. レース一覧 (races.html): 日付を選んでレース一覧。一覧 JSON だけで描く
// ═══════════════════════════════════════════════════════════════════════════

async function pageRaces() {
  document.body.insertAdjacentHTML("afterbegin", header("races"));
  const main = $("main");
  let index;
  try {
    index = await getJSON("data/index.json");
  } catch {
    return showEmpty(main);
  }
  const dates = index.dates || [];
  const q = params();
  const date = dates.includes(q.get("date")) ? q.get("date") : index.latest_date;
  if (!date) return showEmpty(main, "まだレースのデータがありません");
  const venue = q.get("venue") || "";

  // 日付バー (画面下に固定)
  const i = dates.indexOf(date);
  const go = (d) => (location.search = qs({ date: d }));          // 日付を変えたら会場・表示は既定に戻す
  document.body.insertAdjacentHTML("beforeend", `
    <nav class="datebar" aria-label="日付"><div class="inner">
      <button id="prev" ${i > 0 ? "" : "disabled"}>← 前日</button>
      <select id="date-select" aria-label="日付を選ぶ">${dates.slice().reverse().map((d) => `<option value="${d}"${d === date ? " selected" : ""}>${shortDate(d)}</option>`).join("")}</select>
      <button id="next" ${i >= 0 && i < dates.length - 1 ? "" : "disabled"}>翌日 →</button>
    </div></nav>`);
  $("#prev").onclick = () => go(dates[i - 1]);
  $("#next").onclick = () => go(dates[i + 1]);
  $("#date-select").onchange = (e) => go(e.target.value);

  let day;
  try {
    day = await getJSON(`data/races/${date}.json`);
  } catch {
    return showEmpty(main, `${fmtDate(date)} のデータがありません`);
  }
  const races = (day.races || []).slice().sort(byClose);
  const now = Date.now();
  const isToday = date === todayJST();
  const isOpen = (r) => new Date(r.close_at).getTime() > now && !["finished", "cancelled"].includes(r.status);
  const anyOpen = isToday && races.some(isOpen);

  // 表示の種類と会場 (URL の view / venue)。今日でまだ締切前があれば「締切前」、それ以外は「全部」が既定
  let view = q.get("view");
  if (!VIEWS[view]) view = anyOpen ? "next" : "all";
  const more = q.get("more") === "1";
  const venues = [...new Map(races.map((r) => [String(r.venue_id), r.venue_name])).entries()];
  const inVenue = venue ? races.filter((r) => String(r.venue_id) === venue) : races;
  const pick = {
    next: (r) => isOpen(r),
    all: () => true,
    picks: (r) => (r.picks?.count || 0) > 0,
    results: (r) => r.status === "finished",
  }[view];
  const shown = inVenue.filter(pick);
  const LIMIT = 10;

  let list;
  if (!shown.length) {
    list = `<div class="empty">${view === "next" ? "締切前のレースはありません（「全部」「結果」で見られます）" : "該当するレースがありません"}</div>`;
  } else if (view === "next") {
    const head = more ? shown : shown.slice(0, LIMIT);
    const rest = shown.length - head.length;
    list = head.map((r) => raceRow(r)).join("")
      + (rest > 0 ? `<a class="more" href="?${qs({ date, venue, view, more: "1" })}">残り ${rest} レースを表示</a>` : "");
  } else if (!venue) {
    // 全会場: 会場ごとに折りたたむ。開いておくのは次の締切が一番近い会場だけ
    const nextOpen = races.filter(isOpen)[0];
    list = venues.map(([id, name]) => {
      const rs = shown.filter((r) => String(r.venue_id) === id);
      if (!rs.length) return "";
      const all = races.filter((r) => String(r.venue_id) === id);
      const open = all.filter(isOpen);
      const nPicks = all.reduce((a, r) => a + (r.picks?.count || 0), 0);
      return `<details class="venue-group"${nextOpen && String(nextOpen.venue_id) === id ? " open" : ""}>
        <summary>
          <span class="vname">${esc(name)}</span>
          <span class="vmeta muted small">${rs.length}R${isToday ? `・締切前 ${open.length}` : ""}${open.length ? `・次 <b class="num">${hhmm(open[0].close_at)}</b>` : ""}</span>
          ${nPicks ? `<span class="badge pick">買 ${nPicks}</span>` : ""}
        </summary>
        ${rs.map((r) => raceRow(r, true)).join("")}
      </details>`;
    }).join("");
  } else {
    list = shown.map((r) => raceRow(r, true)).join("");
  }

  const viewSeg = Object.entries(VIEWS).map(([k, label]) =>
    `<a class="seg${k === view ? " on" : ""}" href="?${qs({ date, venue, view: k })}" aria-pressed="${k === view}">${label}</a>`).join("");
  const venueSel = `<select id="venue-select" aria-label="会場">
      <option value="">全会場（${venues.length}場）</option>
      ${venues.map(([id, name]) => {
        const left = races.filter((r) => String(r.venue_id) === id && isOpen(r)).length;
        return `<option value="${id}"${venue === id ? " selected" : ""}>${esc(name)}${isToday ? `（残り ${left}）` : ""}</option>`;
      }).join("")}
    </select>`;

  main.innerHTML = `
    <div class="day-title"><h1>${fmtDate(date)}</h1><span class="muted small">${races.length} レース</span></div>
    ${daySummary(races, isToday, isOpen)}
    <div class="ctrl">${venueSel}<nav class="segs" aria-label="表示">${viewSeg}</nav></div>
    <div id="races">${list}</div>`;
  $("#venue-select").onchange = (e) => (location.search = qs({ date, venue: e.target.value, view: q.get("view") || "" }));
}

const VIEWS = { next: "締切前", all: "全部", picks: "picks", results: "結果" };
const byClose = (a, b) => (a.close_at < b.close_at ? -1 : a.close_at > b.close_at ? 1 : a.race_id < b.race_id ? -1 : 1);
/** 空の値を落として URL パラメータに */
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

/** その日の状況 (予想済み・picks の成績・次の締切) */
function daySummary(races, isToday, isOpen) {
  const predicted = races.filter((r) => r.top_flag).length;
  const pk = races.reduce((a, r) => {
    const p = r.picks || {};
    a.count += p.count || 0;
    if (r.status === "finished" && p.count && p.hits != null) {
      a.done += p.count; a.hits += p.hits; a.stake += p.stake || 0; a.payout += p.payout || 0;
    }
    return a;
  }, { count: 0, done: 0, hits: 0, stake: 0, payout: 0 });
  const next = isToday ? races.filter(isOpen)[0] : null;
  const roi = pk.stake ? ` ・回収率 <b class="num">${pct(pk.payout / pk.stake)}</b>` : "";
  return `<div class="day-sum">
    <div><span class="muted">予想済み</span> <b class="num">${predicted}</b> / ${races.length}</div>
    <div><span class="muted">picks</span> <b class="num">${pk.count}</b>点${pk.done ? `（結果 ${pk.done}点・的中 <b class="num">${pk.hits}</b>${roi}）` : ""}</div>
    ${next ? `<div><span class="muted">次の締切</span> <a href="race.html?id=${encodeURIComponent(next.race_id)}&date=${dateFromRaceId(next.race_id)}">${esc(next.venue_name)} ${next.race_no}R <b class="num">${hhmm(next.close_at)}</b></a></div>` : ""}
  </div>`;
}

/** 一覧の1レース (軽い版)。6艇は出さず、本命 (1着確率が最も高い艇) だけ。会場ごとにまとめた中では会場名を省く */
function raceRow(r, inGroup = false) {
  const finished = r.status === "finished";
  const pk = r.picks || { count: 0 };
  const pickBadge = pk.count
    ? `<span class="badge pick">買${pk.count}${finished && pk.hits != null ? (pk.hits ? "◎" : "×") : ""}</span>` : "";
  const tf = r.top_flag, tt = r.top_trifecta;
  const fav = (r.entries || []).filter((e) => isNum(e.p_win)).sort((a, b) => b.p_win - a.p_win)[0];
  const line2 = tf || tt || fav ? `<div class="l2">
      ${tf ? `<span><b>${esc(tf.name)}</b> <span class="num">${pct(tf.prob, 0)}</span>${finished ? markShort(tf.hit) : ""}</span>` : ""}
      ${fav ? `<span>本命 ${boat(fav.course)}<span class="num">${pct(fav.p_win, 0)}</span></span>` : ""}
      ${tt ? `<span>3連単 <b class="num">${esc(tt.combo)}</b>${finished ? markShort(tt.hit) : ""}</span>` : ""}
    </div>` : `<div class="l2 muted">予想前</div>`;
  const res = finished && r.result ? `<div class="l3">
      ${boats(r.result.arrival.slice(0, 3))} <span class="num">${yen(r.result.payout)}</span>
      ${r.result.refunded ? '<span class="badge plain">返還</span>' : ""}
    </div>` : "";
  return `<a class="race-row${r.status === "cancelled" ? " is-cancelled" : ""}" href="race.html?id=${encodeURIComponent(r.race_id)}&date=${dateFromRaceId(r.race_id)}">
    <div class="l1">
      <span class="title">${inGroup ? "" : `${esc(r.venue_name)} `}${r.race_no}R</span>
      <span class="time num">${hhmm(r.close_at)}</span>
      <span class="right">${pickBadge}${badgeStatus(r.status)}</span>
    </div>
    ${line2}${res}
  </a>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. レース詳細 (race.html?id=261110_19_09&date=2026-11-10)
// ═══════════════════════════════════════════════════════════════════════════

const LOW_RUNS = 30;   // 出走数がこれ未満の率は薄く出す
const LOW_WINS = 10;   // 展開別に勝ったときの相手: 勝った回数がこれ未満は薄く出す

async function pageRace() {
  document.body.insertAdjacentHTML("afterbegin", header(""));
  const main = $("main");
  const q = params();
  const id = q.get("id");
  const date = q.get("date") || dateFromRaceId(id);
  const back = `<a class="back" href="races.html?date=${encodeURIComponent(date || "")}">← ${date ? fmtDate(date) : ""}の一覧</a>`;
  if (!id || !date) return (main.innerHTML = back + '<div class="empty">データがありません</div>');
  let d;
  try {
    d = await getJSON(`data/races/${date}/${encodeURIComponent(id)}.json`);
  } catch {
    return (main.innerHTML = back + '<div class="empty">データがありません</div>');
  }
  const r = d.race;
  document.title = `${r.venue_name} ${r.race_no}R ${fmtDate(date)} — ボートレース予想`;
  main.innerHTML = back + [raceHead(r), flagsSection(r), entriesSection(r), trifectaSection(r), picksSection(r, d.pick_rules),
    resultSection(r), commentarySection(r)].join("");
}

function raceHead(r) {
  const w = r.weather;
  // 風向は「吹いてくる向き」(方位角)。矢印は風が吹いていく向きに向ける
  const calm = !w || !isNum(w.wind_spd) || w.wind_spd === 0 || /無風/.test(w.wind_dir_label || "");
  const wind = !w ? "" : calm
    ? `<span>風 無風</span>`
    : `<span>風 <span class="wind-arrow" style="transform:rotate(${(w.wind_dir || 0) + 180}deg)" title="${esc(w.wind_dir_label || "")}の風">↑</span>${esc(w.wind_dir_label || "")} <span class="num">${fix(w.wind_spd, 0)}m</span></span>`;
  const wave = w && isNum(w.wave) ? `<span>波 <span class="num">${fix(w.wave, 0)}cm</span></span>` : "";
  return `<section class="race-head">
    <h1>${esc(r.venue_name)} ${r.race_no}R</h1>
    <div class="meta">
      <span class="num">締切 ${hhmm(r.close_at)}</span> ${badgeStatus(r.status)}
      ${r.fixed_entry ? '<span class="badge plain">進入固定</span>' : ""}
    </div>
    ${wind || wave ? `<div class="weather">${wind}${wave}${w.fetched_at ? `<span class="faint num">${hhmm(w.fetched_at)} 時点</span>` : ""}</div>` : ""}
  </section>`;
}

function flagsSection(r) {
  if (!r.flags) return `<h2>展開</h2><div class="empty">まだ予想していません（締切12分前ごろに予想します）</div>`;
  const rows = r.flags.slice(0, 5).map((f) => `
    <div class="prob-row"><span>${esc(f.name)}</span>${bar(f.prob)}<span class="pct num">${pct(f.prob)}</span><span>${f.hit === true ? mark(true) : ""}</span></div>`).join("");
  return `<h2>展開の確率（上位5）</h2><div class="prob-list">${rows}</div>`;
}

function entriesSection(r) {
  const es = r.entries || [];
  const pred = r.entry?.predicted;                                   // 予測した進入 (例 "132456")
  const courseOf = (b) => (pred ? pred.indexOf(String(b)) + 1 : null);
  const best = Math.max(...es.map((e) => (isNum(e.p_win) ? e.p_win : -1)));
  const finished = r.status === "finished";
  const pctOfficial = (x) => (isNum(x) ? `${x.toFixed(1)}` : "—");     // 公式の 2連対率は 0〜100 の値
  const rows = es.map((e) => {
    const o = e.official || {}, ex = e.exhibition || {}, s = e.stats || {};
    const c = courseOf(e.course);
    return `<tr class="${e.hit_win ? "is-hit" : ""}">
      <th class="sticky"><div class="who">${boat(e.course)}<span class="pname">${esc(e.player_name)}</span></div>
        <div class="faint small">${esc(e.class || "")}${isNum(e.age) ? ` ${e.age}歳` : ""}${isNum(e.weight) ? ` ${e.weight.toFixed(1)}kg` : ""}</div></th>
      ${finished ? `<td class="r num"><b>${arrivalText(e)}</b></td>` : ""}
      <td class="r num${e.p_win === best && best > 0 ? " best" : ""}">${pct(e.p_win)}</td>
      <td class="r num">${pct(e.p_top3)}</td>
      <td class="r num">${c ? `${c}${c !== e.course ? '<span class="moved" title="艇番と違うコース">*</span>' : ""}` : "—"}</td>
      <td class="r num">${isNum(ex.time) ? ex.time.toFixed(2) : "—"}${isNum(ex.rank) ? `<span class="faint">(${ex.rank})</span>` : ""}</td>
      <td class="r num">${fix(o.national_win_rate, 2)}</td>
      <td class="r num">${fix(o.local_win_rate, 2)}</td>
      <td class="r num">${pctOfficial(o.motor_2rate)}</td>
      <td class="r num${s.sigma_imputed ? " low" : ""}">${fix(s.sigma, 3)}</td>
    </tr>`;
  }).join("");
  const entryLine = r.entry ? `<div class="muted small">進入: 展示 <b class="num">${esc(r.entry.exhibition || "なし")}</b> → 予測 <b class="num">${esc(r.entry.predicted)}</b>
      （コース1〜6の艇番。<span class="moved">*</span> は艇番と違うコースに入ると予測）</div>` : "";
  const table = `<div class="table-wrap entry-table"><table>
      <thead><tr><th class="sticky">艇・選手</th>${finished ? '<th class="r">着</th>' : ""}<th class="r">1着</th><th class="r">3着内</th>
        <th class="r">予測<br>コース</th><th class="r">展示<br>(順位)</th><th class="r">全国<br>勝率</th><th class="r">当地<br>勝率</th>
        <th class="r">モーター<br>2連%</th><th class="r">ST の<br>ばらつき σ</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="faint small">1着・3着内はモデルの確率（太字が最も高い艇）。横にスクロールできます。σ が大きいほどスタートが安定しない（薄い字は出走30未満で平均値）。</div>`;
  const own = es.filter((e) => e.stats).map((e) => `<details class="own"><summary>${boat(e.course)} ${esc(e.player_name)}</summary>
      ${ownStats(courseOf(e.course) || e.course, e.stats)}</details>`).join("");
  return `<h2>出走表</h2>${entryLine}${table}${own ? `<h3>独自集計（直近1年）</h3>${own}` : ""}`;
}

/** 独自集計 (直近365日・当日を含まない)。出走数が少ないものは薄くして出走数を添える */
function ownStats(course, s) {
  const runs = (n) => `<span class="faint num">(${int(n)}走)</span>`;
  const low = (n) => (isNum(n) && n < LOW_RUNS ? " low" : "");
  const mc = s.my_course, se = s.series;
  const sigma = isNum(s.sigma) ? `<span><span class="k">ST のばらつき σ</span> <span class="num${s.sigma_imputed ? " low" : ""}">${s.sigma.toFixed(3)}</span>${s.sigma_imputed ? ' <span class="faint">(出走30未満のため平均値)</span>' : ""}</span>` : "";
  const myc = mc ? `<div class="section-label">${course}コース（予測した進入コース）の成績 ${runs(mc.run_cnt)}</div>
    <div class="grid2${low(mc.run_cnt)}">
      <span><span class="k">1着率</span> <span class="num">${pct(mc["1st_rate"])}</span></span>
      <span><span class="k">3連対率</span> <span class="num">${pct(mc["3ren_rate"])}</span></span>
      <span><span class="k">平均ST</span> <span class="num">${fix(mc.st_avg, 2)}</span></span>
    </div>` : "";
  // 節の出走数はもともと少ない (数走) ので薄くはしない。出走数だけ添える
  const ser = se ? `<div class="section-label">この節（前日まで） ${runs(se.run_cnt)}</div>
    <div class="grid2">
      <span><span class="k">平均着順</span> <span class="num">${fix(se.avg_rank, 2)}</span></span>
      <span><span class="k">平均ST</span> <span class="num">${fix(se.avg_st, 2)}</span></span>
    </div>` : "";
  const pat = (s.pattern || []).length ? `<div class="section-label">${course === 1 ? "1コースでの決まり手（やられる側）" : "このコースでの決まり手（やる側）と、1コースが逃げたときの着"}</div>
    <div class="grid2">${s.pattern.map((p) => `<span class="${low(p.run_cnt).trim()}"><span class="k">${esc(p.label)}</span> <span class="num">${pct(p.value)}</span>${isNum(p.run_cnt) && p.run_cnt < LOW_RUNS ? " " + runs(p.run_cnt) : ""}</span>`).join("")}</div>` : "";
  // 展開別に勝ったときの相手。win_partners が無い古いデータは nige_partners (1号艇の逃げだけ) で出す
  const wp = (s.win_partners && s.win_partners.length) ? s.win_partners
    : s.nige_partners ? [{ development: "1逃げ", ...s.nige_partners }] : [];
  const partnerTable = (p) => `<div class="partner-head">${esc(p.development)}で勝ったとき <span class="faint num">(${int(p.wins)}回)</span></div>
    ${p.wins ? `<div class="table-wrap partners${p.wins < LOW_WINS ? " low" : ""}"><table>
      <thead><tr><th></th>${p.second.map((x) => `<th class="r">${boat(x.course)}</th>`).join("")}</tr></thead>
      <tbody>
        <tr><td class="muted">2着</td>${p.second.map((x) => `<td class="r num">${pct(x.rate, 0)}</td>`).join("")}</tr>
        <tr><td class="muted">3着</td>${p.third.map((x) => `<td class="r num">${pct(x.rate, 0)}</td>`).join("")}</tr>
      </tbody></table></div>` : ""}`;
  const partners = wp.length ? `<div class="section-label">勝ったとき、2着・3着に来たコース（展開別）</div>
    ${wp.map(partnerTable).join("")}
    <div class="faint small">この選手がその展開で勝ったレースのうち、2着・3着がそのコースだった割合。
      1〜2コース以外の展開は年に数回しか起きないので、${LOW_WINS}回未満は薄く表示しています（偶然の影響が大きい）。</div>` : "";
  return `<div class="grid2">${sigma}</div>${myc}${ser}${pat}${partners}
    <div class="faint small">出走 ${LOW_RUNS} 未満の率は当てにならないので薄く表示しています。</div>`;
}

function trifectaSection(r) {
  if (!r.trifecta) return "";
  const picks = new Set((r.picks || []).filter((p) => ruleId(p.rule) === "steady").map((p) => p.combo));
  const rows = r.trifecta.slice().sort((a, b) => a.rank - b.rank).slice(0, 10).map((t) => `
    <tr class="${t.hit ? "is-hit" : ""}">
      <td class="r num">${t.rank}</td>
      <td class="num">${esc(t.combo)}${picks.has(t.combo) ? ' <span class="badge pick" title="picks">買</span>' : ""}</td>
      <td class="r num">${pct(t.prob)}</td><td class="r num">${odds(t.odds)}</td><td class="r num">${ev(t.ev)}</td>
      <td>${r.status === "finished" ? markShort(t.hit) : ""}</td>
    </tr>`).join("");
  return `<h2>3連単（確率の上位10）</h2>
    <div class="table-wrap"><table>
      <thead><tr><th class="r">順位</th><th>組み合わせ</th><th class="r">確率</th><th class="r">オッズ</th><th class="r">期待値</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="faint small">オッズは締切前に最後に取ったもの。期待値 = 確率 × オッズ。<span class="badge pick">買</span> は検証用の堅実の picks、◎ は的中、× は外れ。</div>`;
}

function picksSection(r, rules) {
  rules = rules && rules.length ? rules : STEADY_ONLY;
  const byRule = {};
  for (const p of r.picks || []) (byRule[ruleId(p.rule)] = byRule[ruleId(p.rule)] || []).push(p);
  const done = r.status === "finished";
  const ruleBlock = (rule) => {
    const ps = byRule[rule.id] || [];
    const isVerify = rule.group === "verify";
    let body;
    if (!r.flags) body = `<p class="muted small">予想の後に判定します。</p>`;
    else if (!ps.length) body = `<p class="muted small">${rule.id === "tenkai" ? "このレースは対象外（展開の1位が1逃げ・その他）。" : "この条件に合う買い目はありません。"}</p>`;
    else {
      const stake = ps.reduce((a, p) => a + p.stake, 0);
      const pay = ps.reduce((a, p) => a + (p.payout || 0), 0);
      const hits = ps.filter((p) => p.hit).length;
      const sum = done && ps.every((p) => p.hit != null)
        ? `<div class="pick-sum ${hits ? "is-hit" : ""}">${ps.length}点・${yen(stake)} → 払戻 <b>${yen(pay)}</b>（${yenSigned(pay - stake)}）</div>`
        : `<div class="pick-sum">${ps.length}点・${yen(stake)}</div>`;
      body = `${sum}<div class="table-wrap"><table>
        <thead><tr><th>組み合わせ</th><th class="r">確率</th><th class="r">オッズ</th>${isVerify ? '<th class="r">期待値</th>' : ""}<th class="r">判定</th><th></th><th class="r">払戻</th></tr></thead>
        <tbody>${ps.map((p) => `<tr class="${p.hit ? "is-hit" : ""}">
          <td class="num">${esc(p.combo)}</td><td class="r num">${pct(p.prob, 2)}</td><td class="r num">${odds(p.odds)}</td>
          ${isVerify ? `<td class="r num">${ev(p.ev)}</td>` : ""}
          <td class="r num">${isNum(p.judged_at_min) ? `${p.judged_at_min}分前` : "予想時"}</td>
          <td>${p.refunded ? '<span class="mark miss">返還</span>' : markShort(p.hit)}</td>
          <td class="r num">${p.payout == null ? "—" : yen(p.payout)}</td></tr>`).join("")}</tbody></table></div>`;
    }
    return `<div class="pick-rule"><h3>${esc(rule.label)}${rule.control ? ' <span class="badge">対照</span>' : ""}</h3>
      <div class="muted small">${esc(rule.description)}</div>${body}</div>`;
  };
  const groups = GROUPS.map((g) => {
    const rs = rules.filter((x) => x.group === g.id);
    if (!rs.length) return "";
    return `<h2>${g.title}</h2><div class="muted small">${g.note} 判定 = 判定に使ったオッズを取った時点（締切の何分前か）。</div>
      ${rs.map(ruleBlock).join("")}`;
  }).join("");
  return groups;
}

function resultSection(r) {
  if (r.status !== "finished" || !r.result) return "";
  const x = r.result;
  return `<h2>結果</h2>
    <div class="grid2" style="gap:6px 12px">
      <span class="k">着順</span><span>${boats(x.arrival)}</span>
      <span class="k">3連単</span><span class="num">${esc(x.trifecta || "—")} ${yen(x.payout)}</span>
      <span class="k">決まり手</span><span>${esc(x.decided_by || "—")}${x.development ? ` <span class="muted">（${esc(x.development)}）</span>` : ""}</span>
      <span class="k">進入</span><span>${x.entry?.length ? boats(x.entry) : "—"}</span>
      <span class="k">モデルの予想</span><span class="num">${isNum(x.model_rank) ? `${x.model_rank}位` : "—"}（${pct(x.model_prob, 2)}）</span>
      <span class="k">市場の確率</span><span class="num">${pct(x.market_prob, 2)}</span>
      ${x.refunded ? `<span class="k">返還</span><span>${boats(x.refunded_boats)}</span>` : ""}
    </div>
    <div class="faint small">市場の確率は、締切前に最後に取ったオッズから計算。</div>`;
}

function commentarySection(r) {
  if (r.commentary == null) return "";
  return `<h2>解説</h2><div class="commentary">${esc(r.commentary)}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 成績 (stats.html): data/stats/*.json を汎用の表で描く
// ═══════════════════════════════════════════════════════════════════════════

async function pageStats() {
  document.body.insertAdjacentHTML("afterbegin", header("stats"));
  const main = $("main");
  let index;
  try {
    index = await getJSON("data/index.json");
  } catch {
    return showEmpty(main);
  }
  const ids = index.stats_files || [];
  if (!ids.length) return showEmpty(main);
  const files = await Promise.all(ids.map((id) => getJSON(`data/stats/${id}.json`).catch(() => null)));
  const FUN_IDS = new Set(["fun", "fun_monthly"]);
  let html = `<h1>成績</h1>`, lastGroup = null;
  files.forEach((f, i) => {
    if (!f) return;
    const g = FUN_IDS.has(ids[i]) ? "fun" : "verify";
    if (g !== lastGroup) {
      html += g === "fun"
        ? `<h2>鑑賞用の買い方</h2><p class="muted small">回収率より「どんな当たり方をするか」を見るための記録です。</p>`
        : `<h2>検証用の買い方・分析</h2><p class="muted small">期待値で選ぶ買い方の成績と、過去の検証です。成績の判定にはこちらを使います。</p>`;
      lastGroup = g;
    }
    html += statsBlock(f, ids[i] === "summary", ids[i] === "fun");
  });
  main.innerHTML = html;
  // stats.html#terrain のように、URL の # で開くブロックを指定できる (共有用)
  const target = decodeURIComponent(location.hash.slice(1));
  if (target && document.getElementById(target)) {
    document.getElementById(target).open = true;
    document.getElementById(target).scrollIntoView();
  }
}

function statsBlock(f, isSummary, isFun = false) {
  const meta = `<div class="stats-meta">
      ${f.description ? `<p>${esc(f.description)}</p>` : ""}
      <p class="faint">期間: ${esc(f.period)}　出典: <span class="num">${esc(f.source)}</span></p>
      ${f.note && !isSummary ? `<p>${esc(f.note)}</p>` : ""}
    </div>`;
  const kinds = isSummary ? `<ul class="row-kinds muted">
      <li><b>確定オッズでの試算</b>（2025年・2026年1〜7月）: 締切後に決まるオッズで計算した過去の検証。実際にはこのオッズでは買えないので、有利に出ている。</li>
      <li><b>締切前オッズでの実績</b>（このサイトの picks）: 締切前に最後に取ったオッズで判定した、実際に買える時点の記録。上の2行とは別の数字。</li>
    </ul>` : "";
  const table = isSummary ? summaryCards(f) : isFun ? funCards(f) : statsTable(f);
  const charts = (f.charts || []).map((c) => (c.unit === "yen" ? barChart(f, c) : lineChart(f, c))).join("");
  const findings = (f.findings || []).length ? `<h3>読み取れたこと</h3><ul class="findings">${f.findings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const sup = (f.superseded || []).map((x) => `<div class="superseded"><b>訂正</b> ${esc(x)}</div>`).join("");
  return `<details class="stats-block" id="${esc(f.id)}"${isSummary || isFun || f.id === "fun_monthly" ? " open" : ""}>
    <summary>${esc(f.title)}</summary>
    ${meta}${kinds}${table}${charts}${findings}${sup}
  </details>`;
}

function cell(col, v) {
  if (v == null) return `<td class="faint">—</td>`;
  const signed = /^diff/.test(col.key) || /差/.test(col.label);
  const sp = (x) => (signed && x > 0 ? "+" : "") + (x * 100).toFixed(1);
  switch (col.type) {
    case "percent_ci":
      return `<td class="r num ci">${sp(v.value)}% [${sp(v.lo)}, ${sp(v.hi)}]<span class="n">${int(v.n)}点・${int(v.hits)}的中</span></td>`;
    case "percent":
      return `<td class="r num">${sp(v)}%</td>`;
    case "yen":
      return `<td class="r num">${signed ? yenSigned(v) : yen(v)}</td>`;
    case "number":
      return `<td class="r num">${isNum(v) ? (Number.isInteger(v) ? int(v) : v.toLocaleString("ja-JP", { maximumFractionDigits: 3 })) : esc(v)}</td>`;
    default: {
      const long = String(v).length > 24;
      return `<td class="${long ? "wrap" : ""}">${esc(v)}</td>`;
    }
  }
}

/** percent_ci を文字に。signed は差の列 (+ を付ける) */
function ciText(v, signed = false) {
  const sp = (x) => (signed && x > 0 ? "+" : "") + (x * 100).toFixed(1);
  return `${sp(v.value)}% [${sp(v.lo)}, ${sp(v.hi)}]`;
}

/** summary は1行ずつカードにする (スマホで回収率が横に隠れないように)。列の中身は columns の定義どおり */
function summaryCards(f) {
  const col = Object.fromEntries(f.columns.map((c) => [c.key, c]));
  return f.rows.map((r) => {
    const live = /締切前/.test(r.label || "");
    const roi = r.roi
      ? `<div class="big num">${ciText(r.roi)}</div><div class="muted small num">${int(r.roi.n)}点・${int(r.roi.hits)}的中</div>`
      : `<div class="big faint">記録中</div><div class="muted small">結果が出た picks がまだありません</div>`;
    const extra = [
      r.diff ? `<span>${esc(col.diff?.label || "差")} <b class="num">${ciText(r.diff, true)}</b></span>` : "",
      isNum(r.bets_per_race) ? `<span>1レース <b class="num">${r.bets_per_race.toFixed(2)}</b>点</span>` : "",
      isNum(r.bets_per_day) ? `<span>1日 <b class="num">${r.bets_per_day.toFixed(1)}</b>点</span>` : "",
    ].join("");
    return `<div class="sum-card${live ? " live" : ""}">
      <div class="sum-label">${esc(r.label)} <span class="faint small num">${esc(r.period || "")}</span></div>
      ${roi}
      <div class="facts" style="margin-top:4px">${extra}</div>
      <div class="faint small">${esc(r.odds || "")}${r.note ? `。${esc(r.note)}` : ""}</div>
    </div>`;
  }).join("");
}

/** 鑑賞用: 買い方ごとのカード (的中率・最高払戻・連続ハズレ・収支) */
function funCards(f) {
  return `<div class="fun-grid">${f.rows.map((r) => {
    const none = !r.races;
    return `<div class="fun-card">
      <div class="sum-label">${esc(r.rule)}</div>
      <div class="faint small">${esc(r.description || "")}</div>
      ${none ? `<div class="big faint">記録中</div>` : `
      <div class="fun-facts">
        <div><span class="muted small">的中率</span><b class="num">${pct(r.race_hit_rate)}</b><span class="faint small num">${int(r.races)}レース</span></div>
        <div><span class="muted small">最高払戻</span><b class="num">${r.max_payout == null ? "—" : yen(r.max_payout)}</b><span class="faint small">${esc(r.max_payout_race || "まだ当たりなし")}</span></div>
        <div><span class="muted small">今の連続ハズレ</span><b class="num">${int(r.current_streak)}</b><span class="faint small num">最長 ${int(r.longest_streak)}</span></div>
        <div><span class="muted small">収支</span><b class="num ${r.profit > 0 ? "pos" : r.profit < 0 ? "neg" : ""}">${yenSigned(r.profit)}</b><span class="faint small num">${r.roi ? `回収率 ${ciText(r.roi)}` : ""}</span></div>
      </div>`}
    </div>`;
  }).join("")}</div>`;
}

function statsTable(f) {
  const head = f.columns.map((c) => `<th class="${c.type === "string" ? "" : "r"}">${esc(c.label)}</th>`).join("");
  const rows = f.rows.map((row) => `<tr>${f.columns.map((c) => cell(c, row[c.key])).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** 折れ線 (外部ライブラリなしの SVG)。y は percent_ci の value か数値 */
function lineChart(f, c) {
  const colors = ["#0969da", "#8250df", "#1a7f37", "#bc4c00", "#cf222e", "#6e7781"];
  const label = (k) => (f.columns.find((x) => x.key === k) || {}).label || k;
  const val = (v) => (v && typeof v === "object" ? v.value : v);
  const xs = f.rows.map((r) => String(r[c.x]));
  const series = c.y.map((k) => f.rows.map((r) => val(r[k])));
  const all = series.flat().filter(isNum);
  if (!all.length) return "";
  const W = 360, H = 220, L = 38, R = 18, T = 10, B = 24;   // スマホで等倍に近い大きさ (PC では CSS で最大幅を決める)
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 0.05;
  lo -= pad; hi += pad;
  const X = (i) => L + (xs.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (xs.length - 1));
  const Y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks)
    .map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${(v * 100).toFixed(0)}%</text>`).join("");
  const xl = xs.map((x, i) => `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(x)}</text>`).join("");
  const lines = series.map((s, j) => {
    const pts = s.map((v, i) => (isNum(v) ? `${X(i)},${Y(v)}` : null)).filter(Boolean).join(" ");
    const dots = s.map((v, i) => (isNum(v) ? `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${colors[j % colors.length]}"/>` : "")).join("");
    return `<polyline points="${pts}" fill="none" stroke="${colors[j % colors.length]}" stroke-width="2"/>${dots}`;
  }).join("");
  const legend = c.y.map((k, j) => `<span><i style="background:${colors[j % colors.length]}"></i>${esc(label(k))}</span>`).join("");
  return `<h3>${esc(c.title)}</h3>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">${grid}${xl}${lines}</svg>
    <div class="legend">${legend}</div>`;
}

/** 棒グラフ (円。0 を中心に上下)。y は系列の key (列の label を凡例に使う) */
function barChart(f, c) {
  const colors = ["#0969da", "#8250df", "#1a7f37", "#bc4c00", "#cf222e", "#6e7781"];
  const label = (k) => (f.columns.find((x) => x.key === k) || {}).label || k;
  const xs = f.rows.map((r) => String(r[c.x]));
  const all = f.rows.flatMap((r) => c.y.map((k) => r[k])).filter(isNum);
  if (!all.length) return "";
  const W = 360, H = 220, L = 52, R = 10, T = 10, B = 24;
  const hi = Math.max(0, ...all), lo = Math.min(0, ...all);
  const span = hi - lo || 1;
  const Y = (v) => T + ((hi - v) * (H - T - B)) / span;
  const gw = (W - L - R) / xs.length, bw = Math.max(2, (gw * 0.8) / c.y.length);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v).toLocaleString("ja-JP")}</text>`).join("");
  const bars = f.rows.map((r, i) => c.y.map((k, j) => {
    const v = r[k];
    if (!isNum(v)) return "";
    const x = L + i * gw + gw * 0.1 + j * bw;
    return `<rect x="${x}" y="${Math.min(Y(v), Y(0))}" width="${bw - 1}" height="${Math.max(1, Math.abs(Y(v) - Y(0)))}" fill="${colors[j % colors.length]}"><title>${esc(label(k))} ${esc(xs[i])}: ${yenSigned(v)}</title></rect>`;
  }).join("")).join("");
  const xl = xs.map((x, i) => `<text x="${L + i * gw + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(x)}</text>`).join("");
  const legend = c.y.map((k, j) => `<span><i style="background:${colors[j % colors.length]}"></i>${esc(label(k))}</span>`).join("");
  return `<h3>${esc(c.title)}</h3>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">${ticks}<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>${bars}${xl}</svg>
    <div class="legend">${legend}</div>`;
}

// ─── 起動 ───────────────────────────────────────────────────────────────────

const PAGES = { home: pageHome, races: pageRaces, race: pageRace, stats: pageStats };
document.addEventListener("DOMContentLoaded", () => {
  const page = PAGES[document.body.dataset.page];
  if (page) page().catch((e) => { console.error(e); showEmpty($("main")); });
});
