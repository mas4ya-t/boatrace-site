/* ボートレース予想 — 共通処理と3画面 (index / race / stats)。ビルドなしの素の JS。
   データは data/ 以下の JSON (本体 boatrace-ai の web/ が書き出す。スキーマは schema/)。 */
"use strict";

// ─── 文言 ───────────────────────────────────────────────────────────────────

const GROUPS = [
  { id: "fun", title: "AIの買い目", note: "確率と展開で選ぶ買い方" },
];
const ruleId = (r) => r;
const MAIN_RULE = "picks";        // 一覧の「買」・ホームの「今日の picks の的中」に使うルール (predict/picks.py の MAIN_RULE)

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
  const TOKUSEN = "tokusen";
  const tokRaces = races.filter((r) => (r.picks_by_rule?.[TOKUSEN]?.count || 0) > 0);
  const tokDetails = await Promise.all(tokRaces.map((r) => getJSON(`data/${r.detail}`).catch(() => null)));
  const tokRows = tokRaces.map((r, i) => {
    const ps = (tokDetails[i]?.race?.picks || []).filter((p) => p.rule === TOKUSEN);
    const v = r.picks_by_rule[TOKUSEN];
    const settled = r.status === "finished" && v.hits != null;
    const combos = ps.map((p) => `<span class="mark${p.hit ? " hit" : ""}"><b class="num">${esc(p.combo)}</b> ${yen(p.stake)}${isNum(p.odds) ? ` <span class="muted">${odds(p.odds)}倍</span>` : ""}</span>`).join(" ");
    const result = settled ? (v.hits ? ` <span class="mark hit">◎ 払戻 ${yen(v.payout)}</span>` : ' <span class="mark miss">×</span>') : "";
    return raceRow(r, false, `<div class="l3 pick-won">${combos || `<span class="muted">${v.count}点・${yen(v.stake)}</span>`}${result}</div>`);
  }).join("");
  // 当たった買い方と払戻 (一覧の picks_by_rule)。picks = MAIN_RULE (一覧の「買」)、いろいろな的中 = 予想の3連単1位 + ほかの買い方
  const rules = day?.pick_rules || [];
  const label = Object.fromEntries(rules.map((x) => [x.id, x.label]));
  const hitsOf = (r, keep) => Object.entries(r.picks_by_rule || {}).filter(([id, v]) => v.hits && keep(id))
    .map(([id, v]) => ({ name: label[id] || id, payout: v.payout || 0 }));
  const collect = (fn) => races.map((r) => ({ r, won: fn(r) })).filter((x) => x.won.length)
    .map((x) => ({ ...x, payout: x.won.reduce((a, w) => a + w.payout, 0) })).sort((a, b) => b.payout - a.payout);
  const pickHits = collect((r) => hitsOf(r, (id) => id === MAIN_RULE));
  const allHits = collect((r) => [
    ...(r.top_trifecta?.hit && r.result ? [{ name: `予想1位 ${r.top_trifecta.combo}`, payout: r.result.payout || 0 }] : []),
    ...hitsOf(r, (id) => id !== MAIN_RULE)]);
  const wonRows = (list) => list.slice(0, 5).map(({ r, won }) => raceRow(r, false,
    `<div class="l3 pick-won">${won.map((w) => `<span class="mark hit">◎ ${esc(w.name)} ${yen(w.payout)}</span>`).join("")}</div>`)).join("");

  const section = (title, sub, body, link = "") =>
    `<section class="home-sec"><h2>${title}${sub ? ` <span class="muted small">${sub}</span>` : ""}</h2>${body}${link}</section>`;
  const HOME_RULES = ["特選", "picks", "本線"];       // ホームの「AIの成績」に出す買い方 (stats/fun.json の rule = 表示名)
  const homeRows = (fun?.rows || []).filter((r) => HOME_RULES.includes(r.rule));
  const funCardsMini = homeRows.length ? `<div class="mini-grid">${homeRows.map((r) => `
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
      <p class="muted">全場・全レースの展開と3連単の確率を、予想しています。</p>
    </section>
    <section class="home-sec today">
      <h2>${isToday ? "今日" : "最新"} <span class="muted small">${fmtDate(date)}</span></h2>
      ${races.length ? daySummary(races, isToday, isOpen) : '<div class="muted">データがありません</div>'}
    </section>
    ${races.length ? section("会場", isToday ? "残りレース数・次の締切" : "", venueGrid(races, date, isToday, isOpen)) : ""}
    ${soon.length ? section("もうすぐ締切", "", soon.map((r) => raceRow(r)).join(""),
      `<a class="more" href="races.html?date=${date}&view=next">締切前のレースをすべて見る</a>`) : ""}
    ${section("特選", "",
      tokRows || `<div class="empty">${isToday ? "今日" : "この日"}は特選のレースはありません</div>`)}
    ${section(isToday ? "今日の picks の的中" : "この日の picks の的中", pickHits.length ? `オッズ10倍以下・期待値1.0超・${pickHits.length}レース` : "オッズ10倍以下・期待値1.0超",
      pickHits.length ? wonRows(pickHits) : '<div class="empty">まだありません</div>',
      pickHits.length > 5 ? `<a class="more" href="races.html?date=${date}&view=hits">的中したレースをすべて見る</a>` : "")}
    ${section(isToday ? "今日の的中" : "この日の的中", allHits.length ? `予想1位・ほかの買い方・${allHits.length}レース・払戻の多い順` : "予想1位・ほかの買い方",
      allHits.length ? wonRows(allHits) : '<div class="empty">まだありません</div>',
      allHits.length > 5 ? `<a class="more" href="races.html?date=${date}&view=results">結果の出たレースをすべて見る</a>` : "")}
    ${section("AIの成績", fun?.period ? esc(fun.period) : "", funCardsMini, '<a class="more" href="stats.html">成績を見る</a>')}`;
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
  if (view === "picks") view = "hits";                   // 以前の「picks」の表示 (共有リンク) は「的中」に読み替える
  if (!VIEWS[view]) view = anyOpen ? "next" : "all";
  const more = q.get("more") === "1";
  const venues = [...new Map(races.map((r) => [String(r.venue_id), r.venue_name])).entries()];
  const inVenue = venue ? races.filter((r) => String(r.venue_id) === venue) : races;
  // 買い方で絞る (URL の rule)。買い目 = その買い方が見送らずに買ったレース、的中 = 当たったレース (rule が無ければどれか)
  const rules = day.pick_rules || [];
  const label = Object.fromEntries(rules.map((x) => [x.id, x.label]));
  let rule = q.get("rule") || "";
  if (rule && !label[rule]) rule = "";
  if (view === "buy" && !rule) rule = "honsen";
  const pbr = (r, id) => r.picks_by_rule?.[id] || {};
  const pick = {
    next: (r) => isOpen(r),
    all: () => true,
    buy: (r) => (pbr(r, rule).count || 0) > 0,
    hits: (r) => (rule ? !!pbr(r, rule).hits : Object.values(r.picks_by_rule || {}).some((v) => v.hits)),
    results: (r) => r.status === "finished",
  }[view];
  const shown = inVenue.filter(pick);
  const LIMIT = 10;

  let list;
  if (!shown.length) {
    list = `<div class="empty">${view === "next" ? "締切前のレースはありません" : "該当するレースがありません"}</div>`;
  } else if (view === "hits") {
    // 的中: AIの買い目が当たったレースを、払戻の合計の多い順に (会場ごとにまとめない)。買い方を選んでいればその買い方だけ
    const won = shown.map((r) => {
      const ws = Object.entries(r.picks_by_rule || {}).filter(([id, v]) => v.hits && (!rule || id === rule))
        .map(([id, v]) => ({ name: label[id] || id, payout: v.payout || 0 }));
      return { r, ws, payout: ws.reduce((a, w) => a + w.payout, 0) };
    }).sort((a, b) => b.payout - a.payout);
    list = won.map(({ r, ws }) => raceRow(r, !!venue,
      `<div class="l3 pick-won">${ws.map((w) => `<span class="mark hit">◎ ${esc(w.name)} ${yen(w.payout)}</span>`).join("")}</div>`)).join("");
  } else if (view === "buy") {
    // 買い目: 選んだ買い方が買ったレース。全会場なら会場ごとに折りたたみ、見出しにその買い方のレース数と的中数
    const buyRow = (r, inGroup) => {
      const v = pbr(r, rule);
      const done = r.status === "finished" && v.hits != null;
      const res = done ? (v.hits ? ` <span class="mark hit">◎ ${yen(v.payout)}</span>` : ' <span class="mark miss">×</span>') : "";
      const hitCombo = r.result?.trifecta;
      const combos = (v.combos || []).map((c) => (c === hitCombo ? `<b class="combo-hit">${esc(c)}</b>` : esc(c))).join(" ");
      return raceRow(r, inGroup, `<div class="l3 pick-won"><span>${esc(label[rule])} ${v.count}点・${yen(v.stake)}</span>${res}</div>`
        + (combos ? `<div class="l3 combos num">${combos}</div>` : ""));
    };
    if (venue) {
      list = shown.map((r) => buyRow(r, true)).join("");
    } else {
      const color = { tokusen: " gold", picks: "", honsen: " blue" }[rule];
      const nextOpen = shown.filter(isOpen)[0];
      list = venues.map(([id, name]) => {
        const rs = shown.filter((r) => String(r.venue_id) === id);
        if (!rs.length) return "";
        const hitN = rs.filter((r) => pbr(r, rule).hits).length;
        const open = rs.filter(isOpen);
        return `<details class="venue-group"${nextOpen && String(nextOpen.venue_id) === id ? " open" : ""}>
          <summary>
            <span class="vname">${esc(name)}</span>
            <span class="vmeta muted small">${open.length ? `次 <b class="num">${hhmm(open[0].close_at)}</b>` : ""}</span>
            <span class="vbadges"><span class="badge ${color === undefined ? "plain" : `pick${color}`}">${esc(label[rule])} ${rs.length}R</span>${hitN ? `<span class="mark hit">◎${hitN}</span>` : ""}</span>
          </summary>
          ${rs.map((r) => buyRow(r, true)).join("")}
        </details>`;
      }).join("");
    }
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
      // 会場の見出しのマーク: 特選 (金)・本線 (青) はレース数、picks (ピンク) は点数
      const nRaces = (rid) => all.filter((r) => (pbr(r, rid).count || 0) > 0).length;
      const nTk = nRaces("tokusen"), nHs = nRaces("honsen");
      const nPicks = all.reduce((a, r) => a + (r.picks?.count || 0), 0);
      return `<details class="venue-group"${nextOpen && String(nextOpen.venue_id) === id ? " open" : ""}>
        <summary>
          <span class="vname">${esc(name)}</span>
          <span class="vmeta muted small">${rs.length}R${isToday ? `・締切前 ${open.length}` : ""}${open.length ? `・次 <b class="num">${hhmm(open[0].close_at)}</b>` : ""}</span>
          <span class="vbadges">${nTk ? `<span class="badge pick gold" title="特選のレース">特選 ${nTk}</span>` : ""}${nPicks ? `<span class="badge pick" title="picks の点数">picks ${nPicks}</span>` : ""}${nHs ? `<span class="badge pick blue" title="本線のレース">本線 ${nHs}</span>` : ""}</span>
        </summary>
        ${rs.map((r) => raceRow(r, true)).join("")}
      </details>`;
    }).join("");
  } else {
    list = shown.map((r) => raceRow(r, true)).join("");
  }

  const viewSeg = Object.entries(VIEWS).map(([k, lab]) =>
    `<a class="seg${k === view ? " on" : ""}" href="?${qs({ date, venue, view: k, rule: ["buy", "hits"].includes(k) && rule ? rule : "" })}" aria-pressed="${k === view}">${lab}</a>`).join("");
  // 買い目・的中のときだけ、買い方を選ぶ行 (的中は「すべて」も)
  const ruleChoices = (view === "hits" ? [["", "すべて"]] : []).concat(rules.map((x) => [x.id, x.label]));
  const ruleSeg = ["buy", "hits"].includes(view) ? `<nav class="segs rule-segs" aria-label="買い方">${ruleChoices.map(([id, lab]) =>
    `<a class="seg${id === rule ? " on" : ""}" href="?${qs({ date, venue, view, rule: id })}" aria-pressed="${id === rule}">${esc(lab)}</a>`).join("")}</nav>` : "";
  const venueSel = `<select id="venue-select" aria-label="会場">
      <option value="">全会場</option>
      ${venues.map(([id, name]) => `<option value="${id}"${venue === id ? " selected" : ""}>${esc(name)}</option>`).join("")}
    </select>`;

  main.innerHTML = `
    <div class="day-title"><h1>${fmtDate(date)}</h1><span class="muted small">${races.length} レース</span></div>
    ${daySummary(races, isToday, isOpen)}
    <div class="ctrl">${venueSel}<nav class="segs" aria-label="表示">${viewSeg}</nav></div>
    ${ruleSeg}
    <div id="races">${list}</div>`;
  $("#venue-select").onchange = (e) => (location.search = qs({ date, venue: e.target.value, view: q.get("view") || "", rule: q.get("rule") || "" }));
}

const VIEWS = { next: "締切前", all: "全部", buy: "買い目", hits: "的中", results: "結果" };
const VENUE_NAMES = ["桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国", "びわこ", "住之江",
  "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松", "芦屋", "福岡", "唐津", "大村"];   // 場コード 01〜24 の順
const byClose = (a, b) => (a.close_at < b.close_at ? -1 : a.close_at > b.close_at ? 1 : a.race_id < b.race_id ? -1 : 1);
/** 空の値を落として URL パラメータに */
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

/** 24場のグリッド (4列×6行)。開催していない場は灰色で押せない。押すとその会場のレース一覧へ */
function venueGrid(races, date, isToday, isOpen) {
  const held = new Set(races.map((r) => String(r.venue_id).padStart(2, "0")));
  const cell = (id) => {
    const name = VENUE_NAMES[Number(id) - 1];
    if (!held.has(id)) return `<span class="vcell off" aria-disabled="true">${name}</span>`;
    const rs = races.filter((r) => String(r.venue_id).padStart(2, "0") === id);
    const left = rs.filter(isOpen);
    const meta = isToday ? (left.length ? `残${left.length}・${hhmm(left[0].close_at)}` : "終了") : `${rs.length}R`;
    return `<a class="vcell" href="races.html?${qs({ date, venue: String(Number(id)) })}">${name}<small class="num">${meta}</small></a>`;
  };
  return `<div class="vgrid" role="group" aria-label="会場">${VENUE_NAMES.map((_, i) => cell(String(i + 1).padStart(2, "0"))).join("")}</div>
    <a class="btn vgrid-btn" href="races.html?${qs({ date })}">全会場のレース一覧を見る</a>`;
}

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
  // 特選・本線: レース単位。結果が出たレースの的中数と回収率
  const byRace = (id) => races.reduce((a, r) => {
    const t = r.picks_by_rule?.[id];
    if (!t?.count) return a;
    a.count += 1;
    if (r.status === "finished" && t.hits != null) {
      a.done += 1; a.hits += t.hits ? 1 : 0; a.stake += t.stake || 0; a.payout += t.payout || 0;
    }
    return a;
  }, { count: 0, done: 0, hits: 0, stake: 0, payout: 0 });
  const roiOf = (x) => (x.stake ? ` ・回収率 <b class="num">${pct(x.payout / x.stake)}</b>` : "");
  const raceLine = (cls, label, x) => `<div class="ds-line"><span class="badge pick ${cls}">${label}</span> <b class="num">${x.count}</b>レース${
    x.done ? `（結果 ${x.done}レース・的中 <b class="num">${x.hits}</b>${roiOf(x)}）` : ""}</div>`;
  const next = isToday ? races.filter(isOpen)[0] : null;
  return `<div class="day-sum">
    <div><span class="muted">予想済み</span> <b class="num">${predicted}</b> / ${races.length}</div>
    ${next ? `<div><span class="muted">次の締切</span> <a href="race.html?id=${encodeURIComponent(next.race_id)}&date=${dateFromRaceId(next.race_id)}">${esc(next.venue_name)} ${next.race_no}R <b class="num">${hhmm(next.close_at)}</b></a></div>` : ""}
    ${raceLine("gold", "特選", byRace("tokusen"))}
    <div class="ds-line"><span class="badge pick">picks</span> <b class="num">${pk.count}</b>点${pk.done ? `（結果 ${pk.done}点・的中 <b class="num">${pk.hits}</b>${roiOf(pk)}）` : ""}</div>
    ${raceLine("blue", "本線", byRace("honsen"))}
  </div>`;
}

/** 一覧の1レース (軽い版)。6艇は出さず、本命 (1着確率が最も高い艇) だけ。会場ごとにまとめた中では会場名を省く */
function raceRow(r, inGroup = false, extra = "") {
  const finished = r.status === "finished";
  const pk = r.picks || { count: 0 };
  const mark = (v) => (finished && v.hits != null ? (v.hits ? "◎" : "×") : "");
  const tk = r.picks_by_rule?.tokusen;                    // 特選は金色の「買」
  const hs = r.picks_by_rule?.honsen;                     // 本線は青い「買」
  const pickBadge = (tk?.count ? `<span class="badge pick gold" title="特選">特選${mark(tk)}</span>` : "")
    + (hs?.count ? `<span class="badge pick blue" title="本線">本線${mark(hs)}</span>` : "")
    + (pk.count ? `<span class="badge pick" title="picks">picks${mark(pk)}</span>` : "");
  const tf = r.top_flag, tt = r.top_trifecta;
  const fav = (r.entries || []).filter((e) => isNum(e.p_win)).sort((a, b) => b.p_win - a.p_win)[0];
  const line2 = tf || tt || fav ? `<div class="l2">
      ${tf ? `<span><b>${esc(tf.name)}</b> <span class="num">${pct(tf.prob, 0)}</span></span>` : ""}
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
    ${line2}${res}${extra}
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
    [d, BASE] = await Promise.all([getJSON(`data/races/${date}/${encodeURIComponent(id)}.json`), getJSON("baselines.json").catch(() => null)]);
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
  if (!r.flags) return `<h2>展開</h2><div class="empty">まだ予想していません</div>`;
  const rows = r.flags.slice(0, 5).map((f) => `
    <div class="prob-row"><span>${esc(f.name)}</span>${bar(f.prob)}<span class="pct num">${pct(f.prob)}</span></div>`).join("");
  return `<h2>展開の確率</h2><div class="prob-list">${rows}</div>`;
}

/** 6艇 (列) の中で一番良い → "cbest" (緑)、一番悪い → "cworst" (赤)。null は比べない。全員同じなら色なし。
    higher = 大きいほど良い。key があれば、その値 (コースの平均との差など) で比べる */
function rankClasses(vals, higher, keys = vals) {
  const ok = keys.filter(isNum);
  if (ok.length < 2) return vals.map(() => "");
  const mx = Math.max(...ok), mn = Math.min(...ok);
  if (mx === mn) return vals.map(() => "");
  const good = higher ? mx : mn, bad = higher ? mn : mx;
  // 2番目に良い値 (3艇以上を比べるときだけ。一番悪い値と同じなら塗らない)
  const distinct = [...new Set(ok)].sort((a, b) => (higher ? b - a : a - b));
  const second = ok.length >= 3 && distinct.length >= 3 ? distinct[1] : null;
  // 大きいほど良い数字で値が 0 (一度も無い) の艇は、コースの平均との差で比べても緑にしない
  const zero = (i) => higher && vals[i] === 0;
  return keys.map((k, i) => (!isNum(k) ? "" : k === good && !zero(i) ? " cbest" : k === second && !zero(i) ? " cgood"
    : k === bad ? " cworst" : ""));
}

/** 列ごとの値の並び → 色のクラスの並び。spec = [[値の並び, 大きいほど良いか, 比べる値の並び (省略時は値)], ...] */
const rankCols = (spec) => spec.map(([vals, higher, keys]) => rankClasses(vals, higher, keys || vals));

let BASE = null;   // baselines.json (レース詳細で読む。コースの平均との差で比べるのに使う)
const SHOW_OWN_STATS = true;    // 独自集計 (コースと節の成績・決まり手・展開別の相手) を出すか。出すときも、押すまで閉じておく
const RANK_NOTE = `<span class="cbest legend-chip">緑</span> = 6艇の中で一番良い、<span class="cgood legend-chip">薄い緑</span> = 2番目、<span class="cworst legend-chip">赤</span> = 一番悪い`;

function entriesSection(r) {
  const es = r.entries || [];
  const pred = r.entry?.predicted;                                   // 予測した進入 (例 "132456")
  const courseOf = (b) => (pred ? pred.indexOf(String(b)) + 1 : null);
  const finished = r.status === "finished";
  const pctOfficial = (x) => (isNum(x) ? `${x.toFixed(1)}` : "—");     // 公式の 2連対率は 0〜100 の値
  const nz = (x) => (isNum(x) && x !== 0 ? x : null);                  // 0 は「データなし」
  const col = (f) => es.map(f);
  const [cWin, cTop3, cExh, cNat, cLoc, cMot] = rankCols([
    [col((e) => e.p_win), true],
    [col((e) => e.p_top3), true],
    [col((e) => e.exhibition?.time), false],
    [col((e) => nz(e.official?.national_win_rate)), true],
    [col((e) => nz(e.official?.local_win_rate)), true],
    [col((e) => nz(e.official?.motor_2rate)), true],
  ]);
  const rows = es.map((e, i) => {
    const o = e.official || {}, ex = e.exhibition || {};
    const c = courseOf(e.course);
    return `<tr>
      <th class="sticky"><div class="who">${boat(e.course)}<span class="pname">${esc(e.player_name)}</span></div>
        <div class="faint small">${esc(e.class || "")}${isNum(e.age) ? ` ${e.age}歳` : ""}${isNum(e.weight) ? ` ${e.weight.toFixed(1)}kg` : ""}</div></th>
      ${finished ? `<td class="r num"><b>${arrivalText(e)}</b></td>` : ""}
      <td class="r num${cWin[i]}">${pct(e.p_win)}</td>
      <td class="r num${cTop3[i]}">${pct(e.p_top3)}</td>
      <td class="r num">${c ? `${c}${c !== e.course ? '<span class="moved" title="艇番と違うコース">*</span>' : ""}` : "—"}</td>
      <td class="r num${cExh[i]}">${isNum(ex.time) ? ex.time.toFixed(2) : "—"}</td>
      <td class="r num${cNat[i]}">${fix(o.national_win_rate, 2)}</td>
      <td class="r num${cLoc[i]}">${fix(o.local_win_rate, 2)}</td>
      <td class="r num${cMot[i]}">${pctOfficial(o.motor_2rate)}</td>
    </tr>`;
  }).join("");
  const entryLine = r.entry ? `<div class="muted small">進入: 展示 <b class="num">${esc(r.entry.exhibition || "なし")}</b> → 予測 <b class="num">${esc(r.entry.predicted)}</b></div>` : "";
  const table = `<div class="table-wrap entry-table"><table>
      <thead><tr><th class="sticky">艇・選手</th>${finished ? '<th class="r">着</th>' : ""}<th class="r">1着</th><th class="r">3着内</th>
        <th class="r">予測<br>コース</th><th class="r">展示<br>タイム</th><th class="r">全国<br>勝率</th><th class="r">当地<br>勝率</th>
        <th class="r">モーター<br>2連%</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="faint small">${RANK_NOTE}。1着・3着内はモデルの確率。</div>`;
  return `<h2>出走表</h2>${entryLine}${table}${SHOW_OWN_STATS ? ownTables(es, courseOf) : ""}`;
}

/** 独自集計 (直近365日・当日を含まない) を表に。コースの成績・節 / 決まり手 / 展開別に勝ったときの相手 (艇ごと) */
const PATTERN_COLS = [
  ["nige_vs_nigashi", "逃げ率", "逃し率", "逃げ／逃し"],
  ["sasare_vs_sashi", "差され率", "差し率", "差し"],
  ["makurare_vs_makuri", "まくられ率", "まくり率", "まくり"],
  ["makurizasare_vs_makurizashi", "まくり差され率", "まくり差し率", "まくり差し"],
  ["nige_vs_chase_2nd", null, "1コースが逃げたときの2着率", "逃げ時2着"],
  ["nige_vs_chase_3rd", null, "1コースが逃げたときの3着率", "逃げ時3着"],
];
const OLD_LABELS = { "1号艇が逃げたときの2着率": "1コースが逃げたときの2着率", "1号艇が逃げたときの3着率": "1コースが逃げたときの3着率" };

function ownTables(es, courseOf) {
  const withStats = es.filter((e) => e.stats);
  if (!withStats.length) return "";
  const B = BASE || {};
  const who = (e) => `<th class="sticky"><div class="who">${boat(e.course)}<span class="pname">${esc(e.player_name)}</span></div></th>`;
  const isLow = (n) => isNum(n) && n < LOW_RUNS;
  const lowCls = (n) => (isLow(n) ? " low" : "");
  const cOf = (e) => String(courseOf(e.course) || e.course);
  // コースで水準が違う数字は、そのコースの平均との差で比べる (平均が無ければ値そのもの)。出走が少ないものは比べない
  const vsCourse = (e, v, key, n) => {
    if (!isNum(v) || isLow(n) || !n) return null;
    const m = B.by_course?.[key]?.[cOf(e)]?.mean;
    return isNum(m) ? v - m : v;
  };

  const mcs = withStats.map((e) => e.stats.my_course || {}), ses = withStats.map((e) => e.stats.series || {});
  const [cR1, cR3, cSt, cRank, cSst, cSig] = rankCols([
    [mcs.map((m) => m["1st_rate"]), true, withStats.map((e, i) => vsCourse(e, mcs[i]["1st_rate"], "my_course_1st_rate", mcs[i].run_cnt))],
    [mcs.map((m) => m["3ren_rate"]), true, withStats.map((e, i) => vsCourse(e, mcs[i]["3ren_rate"], "my_course_3ren_rate", mcs[i].run_cnt))],
    [mcs.map((m) => m.st_avg), false, withStats.map((e, i) => vsCourse(e, mcs[i].st_avg, "my_course_st_avg", mcs[i].run_cnt))],
    [ses.map((x) => ((x.run_cnt || 0) > 0 ? x.avg_rank : null)), false],
    [ses.map((x) => ((x.run_cnt || 0) > 0 ? x.avg_st : null)), false],
    [withStats.map((e) => (e.stats.sigma_imputed ? null : e.stats.sigma)), false],
  ]);
  const rowsA = withStats.map((e, i) => {
    const s = e.stats, mc = mcs[i], se = ses[i];
    const hasSe = (se.run_cnt || 0) > 0;
    return `<tr>${who(e)}<td class="r num">${cOf(e)}</td>
      <td class="r num${cR1[i]}${lowCls(mc.run_cnt)}">${pct(mc["1st_rate"])}</td>
      <td class="r num${cR3[i]}${lowCls(mc.run_cnt)}">${pct(mc["3ren_rate"])}</td>
      <td class="r num${cSt[i]}${lowCls(mc.run_cnt)}">${fix(mc.st_avg, 2)}</td>
      <td class="r num${lowCls(mc.run_cnt)}">${int(mc.run_cnt)}</td>
      <td class="r num${cSig[i]}${s.sigma_imputed ? " low" : ""}">${fix(s.sigma, 3)}</td>
      <td class="r num${cRank[i]}">${hasSe ? fix(se.avg_rank, 2) : "—"}</td>
      <td class="r num${cSst[i]}">${hasSe ? fix(se.avg_st, 2) : "—"}</td>
      <td class="r num">${int(se.run_cnt || 0)}</td></tr>`;
  }).join("");
  const tableA = `<h3>コースと節の成績</h3>
    <div class="table-wrap entry-table"><table>
      <thead><tr><th class="sticky">艇・選手</th><th class="r">予測<br>コース</th><th class="r">そのコースの<br>1着率</th><th class="r">3連対率</th>
        <th class="r">平均ST</th><th class="r">出走</th><th class="r">ST の<br>ばらつき σ</th><th class="r">節の<br>平均着順</th><th class="r">節の<br>平均ST</th><th class="r">節の<br>出走</th></tr></thead>
      <tbody>${rowsA}</tbody></table></div>
    <div class="faint small">${RANK_NOTE}。直近1年。そのコースの成績は、そのコースの全選手の平均との差で比べる。
      σ は本番の ST のばらつきで、小さいほどスタートが安定。ST・σ・平均着順は小さいほど良い。出走 ${LOW_RUNS} 未満・平均値で補った σ は薄く表示し、比べない。節は前日まで。</div>`;

  // 決まり手: 1コースの艇は「やられる側」の率で意味が違うので、2〜6コースの艇だけで比べる
  const pats = withStats.map((e) => Object.fromEntries((e.stats.pattern || []).map((p) => [OLD_LABELS[p.label] || p.label, p])));
  const patVal = (i, col) => {
    const [, l1, lOut] = PATTERN_COLS.find((x) => x[0] === col);
    const c = cOf(withStats[i]);
    return pats[i][c === "1" ? l1 : lOut] || null;
  };
  const patCls = PATTERN_COLS.map(([col]) => {
    const higher = col !== "nige_vs_nigashi";                                // 逃し率だけは低いほど良い
    const keys = withStats.map((e, i) => {
      const p = patVal(i, col);
      if (!p || cOf(e) === "1" || isLow(p.run_cnt)) return null;
      const m = B.patterns?.[col]?.[cOf(e)]?.mean;
      return isNum(m) ? p.value - m : p.value;
    });
    const raw = withStats.map((e, i) => patVal(i, col)?.value ?? null);
    return rankClasses(raw, higher, keys);
  });
  const rowsB = withStats.map((e, i) => {
    const c = cOf(e);
    const cells = PATTERN_COLS.map(([col, l1], j) => {
      const p = patVal(i, col);
      if (!p || (c === "1" && !l1)) return `<td class="r faint">—</td>`;
      return `<td class="r num${patCls[j][i]}${lowCls(p.run_cnt)}">${pct(p.value)}</td>`;
    }).join("");
    return `<tr>${who(e)}<td class="r num">${c}</td>${cells}</tr>`;
  }).join("");
  const tableB = `<h3>決まり手</h3>
    <div class="table-wrap entry-table"><table>
      <thead><tr><th class="sticky">艇・選手</th><th class="r">予測<br>コース</th>${PATTERN_COLS.map(([, , , h]) => `<th class="r">${h}</th>`).join("")}</tr></thead>
      <tbody>${rowsB}</tbody></table></div>
    <div class="faint small">${RANK_NOTE}。1コースの艇は逃げ率と、差され・まくられ・まくり差されの率。
      2〜6コースの艇は逃し率と、差し・まくり・まくり差しで勝った率、1コースが逃げたときに2着・3着に来た率。</div>`;

  const partners = withStats.map((e) => {
    const html = partnersHtml(e.stats);
    return html ? `<details class="own"><summary>${boat(e.course)} ${esc(e.player_name)} <span class="faint small">${cOf(e)}コース</span></summary>${html}</details>` : "";
  }).join("");
  return `<details class="own-all"><summary>独自集計</summary>
    ${tableA}${tableB}${partners ? `<h3>展開別に勝ったときの相手</h3>${partners}` : ""}</details>`;
}

/** 展開別に勝ったとき、2着・3着に来たコース (艇ごと)。率が高いほど濃い緑、展開ごとに一番多い相手は太字。
    win_partners が無い古いデータは nige_partners (1逃げだけ) で出す */
function partnersHtml(s) {
  const wp = (s.win_partners && s.win_partners.length) ? s.win_partners
    : s.nige_partners ? [{ development: "1逃げ", ...s.nige_partners }] : [];
  if (!wp.length) return "";
  const heat = (r, top) => `<td class="r num heat${r === top && r > 0 ? " top" : ""}" style="--a:${isNum(r) ? Math.min(1, r / 0.6).toFixed(2) : 0}">${pct(r, 0)}</td>`;
  const won = wp.filter((p) => p.wins);
  if (!won.length) return `<p class="muted small">直近1年、このコースで勝ったことがない。</p>`;
  const partnerTable = (p) => {
    const low = p.wins < LOW_WINS;
    const top2 = Math.max(...p.second.map((x) => x.rate || 0)), top3 = Math.max(...p.third.map((x) => x.rate || 0));
    return `<div class="partner-head"><b>${esc(p.development)}</b>で勝ったとき <span class="faint num">（${int(p.wins)}回${low ? "・少ないので参考" : ""}）</span></div>
      <div class="table-wrap partners${low ? " low" : ""}"><table>
        <thead><tr><th></th>${p.second.map((x) => `<th class="r" title="${x.course}コース">${boat(x.course)}</th>`).join("")}</tr></thead>
        <tbody>
          <tr><td class="muted">2着</td>${p.second.map((x) => heat(x.rate, top2)).join("")}</tr>
          <tr><td class="muted">3着</td>${p.third.map((x) => heat(x.rate, top3)).join("")}</tr>
        </tbody></table></div>`;
  };
  return `${won.map(partnerTable).join("")}
    <div class="faint small">この選手がその展開で勝ったとき、2着・3着がそのコースだった割合。見出しの数字はコース。${LOW_WINS}回未満は薄く表示。</div>`;
}

function trifectaSection(r) {
  if (!r.trifecta) return "";
  const picks = new Set((r.picks || []).filter((p) => ruleId(p.rule) === MAIN_RULE).map((p) => p.combo));
  const tokusen = new Set((r.picks || []).filter((p) => p.rule === "tokusen").map((p) => p.combo));
  const honsen = new Set((r.picks || []).filter((p) => p.rule === "honsen").map((p) => p.combo));
  const rows = r.trifecta.slice().sort((a, b) => a.rank - b.rank).slice(0, 10).map((t) => `
    <tr class="${t.hit ? "is-hit" : ""}">
      <td class="r num">${t.rank}</td>
      <td class="num">${esc(t.combo)}${tokusen.has(t.combo) ? ' <span class="badge pick gold" title="特選">特選</span>' : ""}${honsen.has(t.combo) ? ' <span class="badge pick blue" title="本線">本線</span>' : ""}${picks.has(t.combo) ? ' <span class="badge pick" title="picks">picks</span>' : ""}</td>
      <td class="r num">${pct(t.prob)}</td><td class="r num">${odds(t.odds)}</td><td class="r num">${ev(t.ev)}</td>
      <td>${r.status === "finished" ? markShort(t.hit) : ""}</td>
    </tr>`).join("");
  return `<h2>3連単の上位10</h2>
    <div class="table-wrap"><table>
      <thead><tr><th class="r">順位</th><th>組み合わせ</th><th class="r">確率</th><th class="r">オッズ</th><th class="r">期待値</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="faint small">オッズは締切前に最後に取ったもの。期待値 = 確率 × オッズ。組み合わせの横の印はAIの買い目、◎ は的中、× は外れ。</div>`;
}

function picksSection(r, rules) {
  if (!rules || !rules.length) return "";
  const byRule = {};
  for (const p of r.picks || []) (byRule[ruleId(p.rule)] = byRule[ruleId(p.rule)] || []).push(p);
  const done = r.status === "finished";
  const ruleParts = (rule) => {
    const ps = byRule[rule.id] || [];
    const isVerify = rule.group === "verify";
    let body, head;
    if (!r.flags) {
      body = `<p class="muted small">予想の後に判定します。</p>`;
      head = `<span class="muted">予想前</span>`;
    } else if (!ps.length) {
      const noOdds = !(r.odds_snapshots || []).length;
      const why = {
        tokusen: ["見送り", "とても堅いレースではないので見送り"],
        honsen: ["見送り", "堅いレースではないので見送り"],
        taiko: ["対象外", "このレースは対象外"],
        taiko_suji: ["対象外", "このレースは対象外"],
        picks: noOdds ? ["オッズ待ち", "締切前のオッズを取ってから判定します。"] : ["なし", "オッズ10倍以下・期待値1.0超の組み合わせはありません。"],
        ana: ["オッズ待ち", "締切前のオッズを取ってから判定します。"],
      }[rule.id] || ["なし", "この条件に合う買い目はありません。"];
      body = `<p class="muted small">${why[1]}</p>`;
      head = `<span class="muted">${why[0]}</span>`;
    } else {
      const stake = ps.reduce((a, p) => a + p.stake, 0);
      const pay = ps.reduce((a, p) => a + (p.payout || 0), 0);
      const hits = ps.filter((p) => p.hit).length;
      const settled = done && ps.every((p) => p.hit != null);
      const prop = ps.some((p) => p.proportional);
      const propNote = prop ? `<div class="faint small">オッズが低いので確率に比例して配分しています。</div>` : "";
      head = `<span class="num">${ps.length}点・${yen(stake)}</span>`
        + (settled ? (hits ? ` <span class="mark hit">◎ ${yen(pay)}</span>` : ' <span class="mark miss">×</span>') : "");
      const sum = settled
        ? `<div class="pick-sum ${hits ? "is-hit" : ""}">${ps.length}点・${yen(stake)} → 払戻 <b>${yen(pay)}</b>（${yenSigned(pay - stake)}）</div>`
        : `<div class="pick-sum">${ps.length}点・${yen(stake)}</div>`;
      body = `${sum}${propNote}<div class="table-wrap"><table>
        <thead><tr><th>組み合わせ</th><th class="r">確率</th><th class="r">オッズ</th>${isVerify ? '<th class="r">期待値</th>' : ""}<th class="r">金額</th><th class="r">判定</th><th></th><th class="r">払戻</th></tr></thead>
        <tbody>${ps.map((p) => `<tr class="${p.hit ? "is-hit" : ""}">
          <td class="num">${esc(p.combo)}</td><td class="r num">${pct(p.prob, 2)}</td><td class="r num">${odds(p.odds)}</td>
          ${isVerify ? `<td class="r num">${ev(p.ev)}</td>` : ""}
          <td class="r num">${yen(p.stake)}</td>
          <td class="r num">${isNum(p.judged_at_min) ? `${p.judged_at_min}分前` : "予想時"}</td>
          <td>${p.refunded ? '<span class="mark miss">返還</span>' : markShort(p.hit)}</td>
          <td class="r num">${p.payout == null ? "—" : yen(p.payout)}</td></tr>`).join("")}</tbody></table></div>`;
    }
    return { head, body };
  };
  // 買い方ごとに折りたたむ (押すまで閉じておく)。閉じていても点数・金額・結果は見出しで分かる
  const details = (label, head, inner) => `<details class="pick-rule"><summary><span class="pr-name">${esc(label)}</span>
      <span class="pr-head">${head}</span></summary>${inner}</details>`;
  const ruleBlock = (rule) => {
    const { head, body } = ruleParts(rule);
    return details(rule.label, head, `<div class="muted small">${esc(rule.description)}</div>${body}`);
  };
  // 対抗は1つにまとめ、開くと「確率順」(taiko) と「筋」(taiko_suji) の2つが並ぶ
  const SUBS = { taiko: "確率順", taiko_suji: "筋" };
  const taikoBlock = (rs) => {
    const parts = rs.map((rule) => ({ rule, ...ruleParts(rule) }));
    const head = parts.map((x) => `<span class="muted small">${SUBS[x.rule.id]}</span> ${x.head}`).join(" ");
    const inner = parts.map((x) => `<div class="pick-sub"><h3>${SUBS[x.rule.id]}</h3>
      <div class="muted small">${esc(x.rule.description)}</div>${x.body}</div>`).join("");
    return details("対抗", head, inner);
  };
  const groups = GROUPS.map((g) => {
    const rs = rules.filter((x) => x.group === g.id);
    if (!rs.length) return "";
    const taiko = rs.filter((x) => x.id in SUBS);
    const blocks = rs.filter((x) => !(x.id in SUBS) || x.id === "taiko")
      .map((x) => (x.id === "taiko" && taiko.length ? taikoBlock(taiko) : ruleBlock(x)));
    return `<h2>${g.title}</h2><div class="muted small">${g.note}</div>
      ${blocks.join("")}`;
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
  const FUN_IDS = new Set(["fun", "fun_monthly", "rules"]);
  let html = `<h1>成績</h1>`, lastGroup = null;
  files.forEach((f, i) => {
    if (!f) return;
    const g = FUN_IDS.has(ids[i]) ? "fun" : "verify";
    if (g !== lastGroup) {
      html += g === "fun"
        ? `<h2>AIの成績</h2><p class="muted small">回収率より「どんな当たり方をするか」を見るための記録と、過去のレースでの試算です。</p>`
        : `<h2>分析</h2><p class="muted small">モデルと市場についての過去の分析です。</p>`;
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
      : `<div class="big faint">記録中</div><div class="muted small">結果が出た買い目がまだありません</div>`;
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
