/**
 * ボートレース予想サイトの Worker。
 *
 *   画面 (index.html / race.html / stats.html / app.js / app.css / schema/)  … Workers Assets (public/) がそのまま返す
 *   GET  /data/<key>.json   … D1 の docs テーブルから返す (認証なし)。<key> は index / races/YYYY-MM-DD / races/YYYY-MM-DD/<race_id> / stats/<id>
 *   POST /api/<key>         … 1件を書き込む (Authorization: Bearer <API_SECRET>)
 *   POST /api/batch         … まとめて書き込む。body = {"docs": [{"key": ..., "body": {...}}, ...]}
 *   POST /api/prune         … 古い日付を消す。body = {"before": "YYYY-MM-DD", "drop_lists": false}。詳細 (races/日付/…) を消し、
 *                             drop_lists なら一覧 (races/日付) も消す。D1 の無料枠は1データベース 500MB (詳細は1日 約3〜4MB)
 *
 * データは今の静的ファイル (public/data/) と同じ形の JSON で、パスも同じ。画面のコードは変えずに済む。
 * 書き込みの中身は PC (boatrace-ai の web/remote.py) が作る。ここでは形だけ軽く確かめる。
 */

const KEY_RE = /^(index|races\/\d{4}-\d{2}-\d{2}|races\/\d{4}-\d{2}-\d{2}\/\d{6}_\d{2}_\d{2}|stats\/[a-z0-9_]{1,40})$/;
const MAX_BATCH = 50;               // 1回のバッチの件数 (D1 の1文あたりの大きさ・Worker の CPU 時間に余裕を持たせる)
const DATA_CACHE = "public, max-age=15";

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-robots-tag": "noindex", ...extra },
  });
}

/** 中身の形を軽く確かめる。問題があれば理由の文字列、なければ null */
function check(key, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body が JSON のオブジェクトではない";
  if (typeof body.schema_version !== "number") return "schema_version が無い";
  if (key === "index") return Array.isArray(body.dates) ? null : "index に dates が無い";
  const m = key.match(/^races\/(\d{4}-\d{2}-\d{2})(?:\/(.+))?$/);
  if (m && !m[2]) return body.date === m[1] && Array.isArray(body.races) ? null : "一覧の date / races が合わない";
  if (m && m[2]) return body.date === m[1] && body.race && body.race.race_id === m[2] ? null : "詳細の date / race_id が合わない";
  if (key.startsWith("stats/")) {
    return body.id === key.slice(6) && Array.isArray(body.columns) && Array.isArray(body.rows) ? null : "集計の id / columns / rows が合わない";
  }
  return "知らないキー";
}

function authorized(request, env) {
  const want = env.API_SECRET;
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  let diff = 0;                                     // 長さが同じときだけ、時間が一定の比較
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function put(env, docs) {
  const now = new Date().toISOString();
  const errors = [];
  const stmts = [];
  for (const d of docs) {
    const reason = !KEY_RE.test(d.key || "") ? "キーの形が違う" : check(d.key, d.body);
    if (reason) {
      errors.push({ key: d.key, error: reason });
      continue;
    }
    stmts.push(env.DB.prepare(
      "INSERT INTO docs (key, body, updated_at) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
    ).bind(d.key, JSON.stringify(d.body), now));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { written: stmts.length, errors };
}

async function handleApi(request, env, key) {
  if (request.method !== "POST") return json({ error: "POST だけ" }, 405, { allow: "POST" });
  if (!authorized(request, env)) return json({ error: "認証できない" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON として読めない" }, 400);
  }
  if (key === "prune") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.before || "")) return json({ error: "before は YYYY-MM-DD" }, 400);
    const d = await env.DB.prepare("DELETE FROM docs WHERE key LIKE 'races/____-__-__/%' AND substr(key, 7, 10) < ?1").bind(body.before).run();
    let lists = 0;
    if (body.drop_lists) {
      const l = await env.DB.prepare("DELETE FROM docs WHERE key GLOB 'races/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(key, 7, 10) < ?1")
        .bind(body.before).run();
      lists = l.meta?.changes ?? 0;
    }
    return json({ deleted_details: d.meta?.changes ?? 0, deleted_lists: lists });
  }
  if (key === "batch") {
    const docs = Array.isArray(body.docs) ? body.docs : null;
    if (!docs || docs.length > MAX_BATCH) return json({ error: `docs は 1〜${MAX_BATCH} 件の配列` }, 400);
    const r = await put(env, docs);
    return json(r, r.errors.length ? 207 : 200);
  }
  const r = await put(env, [{ key, body }]);
  return json(r, r.errors.length ? 400 : 200);
}

async function handleData(request, env, key) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "GET だけ" }, 405, { allow: "GET, HEAD" });
  if (!KEY_RE.test(key)) return json({ error: "見つからない" }, 404);
  const row = await env.DB.prepare("SELECT body, updated_at FROM docs WHERE key = ?1").bind(key).first();
  if (!row) return json({ error: "見つからない" }, 404, { "cache-control": "no-store" });
  return new Response(request.method === "HEAD" ? null : row.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": DATA_CACHE,
      "last-modified": new Date(row.updated_at).toUTCString(),
      "x-robots-tag": "noindex",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/")) return await handleApi(request, env, decodeURIComponent(path.slice(5)));
      if (path.startsWith("/data/") && path.endsWith(".json")) return await handleData(request, env, decodeURIComponent(path.slice(6, -5)));
      return env.ASSETS.fetch(request);                   // 画面のファイル (run_worker_first の外なので、ふつうはここに来ない)
    } catch (e) {
      console.error(e);
      return json({ error: "サーバーのエラー" }, 500);
    }
  },
};
