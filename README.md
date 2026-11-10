# boatrace-site

ボートレース予想の公開用リポジトリ。`public/` を静的サイト (Cloudflare Pages / GitHub Pages) として公開する。

- `public/data/` — 予想・結果・集計の JSON。本体 (boatrace-ai) の daily_runner と analysis が書き出す。スキーマは `public/schema/`
- 画面はまだ無い

データは本体の data/ と processed_data/ から作り直せる。古い日付は `uv run python -m boatrace_ai.web prune --keep-days 365` (本体で実行) で消してよい。
