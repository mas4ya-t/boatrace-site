-- サイトの JSON を1件1行で持つ。key は今の public/data/ のパスから .json を取ったもの
-- (index / races/YYYY-MM-DD / races/YYYY-MM-DD/<race_id> / stats/<id>)
CREATE TABLE IF NOT EXISTS docs (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
