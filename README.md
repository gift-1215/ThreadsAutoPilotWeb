# Threads Autopilot Web (Cloudflare MVP)

這是你要的第一版網站骨架：

- Google 登入
- GUI 設定頁（Threads token / Gemini API key / LLM 模型 / Grounding 開關 / 發文指令 / 發文風格 / 發文時間）
- 手動測試發文
- Cloudflare Cron 每 5 分鐘巡檢，依使用者時區與時間自動發文
- D1 儲存使用者設定與執行紀錄

目前依你的要求：`先不處理資安強化`，所以 token/key 以明文存入 D1。

## 1. 先安裝

```bash
cd /Users/liwu/Documents/Project/threads-autopilot-web
npm install
```

## 2. Cloudflare 初始化

```bash
npx wrangler login
npx wrangler d1 create threads_autopilot
```

把 `create` 指令回傳的 `database_id` 填進 [wrangler.jsonc](/Users/liwu/Documents/Project/threads-autopilot-web/wrangler.jsonc) 的 `d1_databases[0].database_id`。

## 3. 套用資料庫 migration

```bash
npx wrangler d1 migrations apply threads_autopilot --local
npx wrangler d1 migrations apply threads_autopilot --remote
```

## 4. 設定 Google Client ID

你可以二選一：

1. 直接改 [wrangler.jsonc](/Users/liwu/Documents/Project/threads-autopilot-web/wrangler.jsonc) 的 `vars.GOOGLE_CLIENT_ID`
2. 或建立 `.dev.vars`（可參考 [.dev.vars.example](/Users/liwu/Documents/Project/threads-autopilot-web/.dev.vars.example)）

## 5. 本地啟動

```bash
npm run dev
```

打開 `http://127.0.0.1:8787` 進入 GUI。

## 6. 部署

```bash
npm run deploy
```

## 7. MVP API（已完成）

- `GET /api/public-config`
- `POST /api/auth/google`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/run-now`（先產生草稿，不直接發文）
- `GET /api/pending-draft`
- `PUT /api/pending-draft`（儲存手動編輯後的草稿）
- `DELETE /api/pending-draft`（草稿清空時同步清除待發草稿）
- `POST /api/pending-draft/regenerate`
- `POST /api/pending-draft/publish`
- `GET /api/runs?limit=30`
- `DELETE /api/runs`（一鍵清除執行紀錄）

## 8. Cron 行為（已完成）

`wrangler.jsonc` 設為 `*/5 * * * *`：

1. 每 5 分鐘掃描啟用中的 user
2. 判斷是否到該 user 的 `post_time` 或 `reply_times`（含 5 分鐘視窗）
3. 每個回覆時間點都會檢查：若當天尚未自動發文就補發
4. 發文成功後（或已略過）會檢查待發草稿
5. 若草稿區沒有下一篇文，會請求 LLM 自動補下一篇草稿
6. 寫入 `post_runs`（含 `scheduled_prefill` 結果）

## 9. 發文流程（新版）

1. 可直接在草稿區用鍵盤編輯；按 `Ctrl+S` / `Cmd+S` 可立即儲存
2. 草稿區若留空，系統會清除待發草稿
3. 可選擇「立即測試：先產生草稿」、「重新生產草稿」或「發出目前草稿」
4. 「下一篇即將發出的文」會顯示目前待發草稿
5. 「最近執行紀錄」可一鍵清除發文紀錄

## 10. Gemini 使用提醒

1. `gemini-2.5-pro` 是否免費，請以 Google 官方 pricing 頁為準（不同地區/時段可能調整）。
2. Grounding（Google Search）通常可能產生額外費用，建議只在需要時開啟。

## 11. 你接下來要提供的資料

1. Google OAuth Client ID
2. Google OAuth 允許來源（本地通常至少 `http://127.0.0.1:8787`）
3. 部署後正式網域（加入 Google OAuth Allowed origins）

## 12. 已建檔清單

- [src/index.ts](/Users/liwu/Documents/Project/threads-autopilot-web/src/index.ts)
- [public/index.html](/Users/liwu/Documents/Project/threads-autopilot-web/public/index.html)
- [public/app.js](/Users/liwu/Documents/Project/threads-autopilot-web/public/app.js)
- [public/styles.css](/Users/liwu/Documents/Project/threads-autopilot-web/public/styles.css)
- [migrations/0001_init.sql](/Users/liwu/Documents/Project/threads-autopilot-web/migrations/0001_init.sql)
- [migrations/0002_add_llm_model_and_grounding.sql](/Users/liwu/Documents/Project/threads-autopilot-web/migrations/0002_add_llm_model_and_grounding.sql)
- [migrations/0003_add_post_prompt_and_pending_draft.sql](/Users/liwu/Documents/Project/threads-autopilot-web/migrations/0003_add_post_prompt_and_pending_draft.sql)
- [migrations/0004_add_reply_times.sql](/Users/liwu/Documents/Project/threads-autopilot-web/migrations/0004_add_reply_times.sql)
- [wrangler.jsonc](/Users/liwu/Documents/Project/threads-autopilot-web/wrangler.jsonc)
