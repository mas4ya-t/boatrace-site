# boatrace-site

ボートレース予想の公開用リポジトリ。

- `public/` — 画面（index.html = ホーム / races.html / race.html / stats.html / app.js / app.css）、`schema/`
- `worker/` — Cloudflare Workers の Worker（データの読み書き API）と D1 のテーブル定義
- `wrangler.jsonc` — Worker の設定

`public/data/` は本体（boatrace-ai）の daily_runner と analysis が書き出す。データは本体の data/ と processed_data/ から作り直せる。

## 配信のしかた（2026-11-12 から Cloudflare Workers + D1）

https://boatrace-site.mas4ya.workers.dev

| | |
|---|---|
| 画面 | `public/` を Workers Assets で公開（`data/` は `.assetsignore` で除く）。画面を変えたら `npx wrangler deploy` |
| データ | 本体が HTTP POST で Worker に送り、D1 に入る（予想・オッズ・結果のたびに、すぐ反映）。Worker が `/data/...json` として返す |

画面のコードは `/data/...json` を読む（静的ファイルだったころと同じパス・同じ形）。
`public/data/` は本体の手元の書き出し先で、git では管理しない（2026-11-12 まで GitHub Pages で公開していたときの履歴にだけ残っている）。
GitHub Pages は 2026-11-12 に止めた（`.github/workflows/pages.yml` を削除）。

### Worker の API

| | 認証 | |
|---|---|---|
| `GET /data/<key>.json` | なし | `index` / `races/YYYY-MM-DD` / `races/YYYY-MM-DD/<race_id>` / `stats/<id>`。`Cache-Control: public, max-age=15` |
| `POST /api/<key>` | `Authorization: Bearer <API_SECRET>` | 1件書く |
| `POST /api/batch` | 同上 | `{"docs": [{"key", "body"}, ...]}`（50件まで）。形の合わないものは `errors` で返す（207） |
| `POST /api/prune` | 同上 | `{"before": "YYYY-MM-DD", "drop_lists": false}` で古い日付の詳細を消す |

ロジックの確認: `worker/test.html` をローカルの HTTP サーバーで開く（D1 は模造品。headless Chrome の `--dump-dom` でも可）。

## Cloudflare Workers での配信（初回の手順）

無料プランで足りる（2026-11 時点の公式の値で見積もり）:

| 項目 | 無料枠 | 見込み |
|---|---|---|
| Workers リクエスト | 10万/日 | 書き込み 約900/日 + 閲覧（1ページ 2〜10 回） |
| 静的アセット（画面） | 無料・無制限 | — |
| D1 書き込み | 10万行/日 | 約2,700行/日（1回の保存で 詳細・一覧・index の3行） |
| D1 読み取り | 500万行/日 | 1回の取得で1行 |
| D1 容量 | 1データベース 500MB | 詳細が1日 約3〜4MB → 詳細は100日ほどで消す（`prune --keep-days 100`、一覧は残る） |

KV は無料だと書き込みが1日1,000回までで足りないので、D1 を使う（書き込みはすぐ読める）。

1. Cloudflare のアカウントを作る（無料）。ダッシュボードの Workers & Pages を一度開き、workers.dev のサブドメインを決める
2. Node.js を入れる: `winget install OpenJS.NodeJS.LTS`（入れたらターミナルを開き直す）
3. このリポジトリで:
   ```bash
   npx wrangler login                                   # ブラウザで許可
   npx wrangler d1 create boatrace-site                 # 出てきた database_id を wrangler.jsonc に書く
   npx wrangler d1 migrations apply boatrace-site --remote
   npx wrangler deploy                                  # https://boatrace-site.<サブドメイン>.workers.dev
   npx wrangler secret put API_SECRET                   # 長いランダムな文字列 (下の .env と同じ値)
   ```
   シークレットは例えば `python -c "import secrets; print(secrets.token_urlsafe(32))"` で作る。**このリポジトリ（公開）には書かない。**
4. 本体の `.env` に足す:
   ```env
   SITE_REMOTE=1
   CF_API_URL=https://boatrace-site.<サブドメイン>.workers.dev
   CF_API_SECRET=<上と同じ値>
   ```
5. 今のデータを全部送る（本体で）: `uv run python -m boatrace_ai.web upload`
6. `https://boatrace-site.<サブドメイン>.workers.dev/` を開いて確かめる

切り替えたら本体の `.env` を `SITE_PUSH=0` にする（git での push をやめる）。
