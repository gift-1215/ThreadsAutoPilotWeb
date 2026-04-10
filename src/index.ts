interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  SESSION_COOKIE_NAME?: string;
  DEFAULT_TIMEZONE?: string;
}

interface GoogleTokenInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  aud?: string;
  exp?: string;
}

interface SessionRow {
  session_id: string;
  user_id: number;
  expires_at: string;
  email: string | null;
  name: string | null;
  picture_url: string | null;
}

interface UserSettingsRow {
  user_id: number;
  threads_token: string | null;
  gemini_api_key: string | null;
  llm_model: string | null;
  enable_grounding: number;
  post_instruction: string | null;
  post_style: string | null;
  post_preference: string | null;
  reply_preference: string | null;
  post_time: string;
  reply_times: string | null;
  timezone: string;
  enabled: number;
}

interface RunRow {
  id: string;
  run_type: string;
  run_date: string;
  status: string;
  message: string | null;
  thread_id: string | null;
  created_at: string;
}

interface PendingDraftRow {
  user_id: number;
  draft: string;
  llm_model: string;
  enable_grounding: number;
  created_at: string;
  updated_at: string;
}

interface StoredSettings {
  threadsToken: string;
  geminiApiKey: string;
  llmModel: string;
  enableGrounding: boolean;
  postInstruction: string;
  postStyle: string;
  postTime: string;
  replyTimes: string[];
  timezone: string;
  enabled: boolean;
}

interface RunResult {
  runId: string;
  status: "success" | "failed" | "skipped";
  message: string;
  threadId?: string;
  runType: string;
  runDate: string;
  draft?: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SUPPORTED_LLM_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"] as const;
const DEFAULT_LLM_MODEL: (typeof SUPPORTED_LLM_MODELS)[number] = "gemini-2.5-flash";
const MAX_THREAD_CHARS = 499;

function jsonResponse(payload: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers });
}

function textResponse(payload: string, status = 200) {
  return new Response(payload, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

function getCookie(request: Request, name: string): string {
  const rawCookie = request.headers.get("cookie") || "";
  const cookieParts = rawCookie.split(";");
  for (const part of cookieParts) {
    const [rawKey, ...valueParts] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return "";
}

function buildSetCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

function buildClearCookie(name: string, secure: boolean) {
  const attrs = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

function cookieName(env: Env) {
  return env.SESSION_COOKIE_NAME || "taw_session";
}

function defaultTimezone(env: Env) {
  return env.DEFAULT_TIMEZONE || "Asia/Taipei";
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function randomId(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function sanitizeLlmModel(input: unknown) {
  const candidate = String(input || "").trim().toLowerCase();
  if (SUPPORTED_LLM_MODELS.includes(candidate as (typeof SUPPORTED_LLM_MODELS)[number])) {
    return candidate;
  }
  return DEFAULT_LLM_MODEL;
}

function sanitizeText(input: unknown, maxLength = 4000) {
  const value = String(input || "").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

function sanitizePostTime(input: unknown) {
  const value = String(input || "").trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return value;
  }
  return "09:00";
}

function sanitizeReplyTimes(input: unknown, maxItems = 12) {
  const raw = String(input || "").trim();
  if (!raw) {
    return [] as string[];
  }

  const tokens = raw
    .split(/[,，;\n\r\t ]+/g)
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  for (const token of tokens) {
    if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(token)) {
      unique.add(token);
    }
    if (unique.size >= maxItems) {
      break;
    }
  }

  return [...unique];
}

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function sanitizeTimezone(input: unknown, fallback: string) {
  const value = String(input || "").trim();
  if (!value) {
    return fallback;
  }
  return isValidTimezone(value) ? value : fallback;
}

function parseHHMM(value: string) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function getLocalDateTime(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const mapped = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  ) as Record<string, string>;

  const year = mapped.year;
  const month = mapped.month;
  const day = mapped.day;
  const hour = mapped.hour;
  const minute = mapped.minute;

  return {
    dateKey: `${year}-${month}-${day}`,
    timeKey: `${hour}:${minute}`,
    minuteOfDay: Number(hour) * 60 + Number(minute)
  };
}

function shouldTriggerNow(minuteOfDay: number, targetTime: string) {
  const target = parseHHMM(targetTime);
  if (target === null) {
    return false;
  }
  const diff = minuteOfDay - target;
  return diff >= 0 && diff < 5;
}

function normalizeDraft(rawText: string) {
  return String(rawText || "")
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function validateDraft(draft: string) {
  if (!draft) {
    return "內容是空白";
  }
  if (draft.length >= 500) {
    return `字數過長（${draft.length}）`;
  }
  const normalized = draft.toLowerCase();
  if (normalized.startsWith("```") || normalized.endsWith("```")) {
    return "請不要輸出 code block 格式";
  }
  if (/\{[\s\S]*\}/.test(draft) && draft.includes("\"")) {
    return "請只輸出貼文內容，不要輸出 JSON";
  }
  return "";
}

function defaultSettings(env: Env): StoredSettings {
  return {
    threadsToken: "",
    geminiApiKey: "",
    llmModel: DEFAULT_LLM_MODEL,
    enableGrounding: false,
    postInstruction: "請產生一篇適合 Threads 的貼文，內容要清楚、有觀點、可讀性高。",
    postStyle: "自然、真誠、繁體中文。",
    postTime: "09:00",
    replyTimes: [],
    timezone: defaultTimezone(env),
    enabled: false
  };
}

async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Request body 必須是 JSON");
  }
}

async function parseOptionalJsonBody<T>(request: Request, fallback: T): Promise<T> {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return fallback;
  }

  const raw = await request.text();
  if (!raw.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Request body 必須是 JSON");
  }
}

async function getSessionContext(env: Env, request: Request): Promise<SessionRow | null> {
  const sid = getCookie(request, cookieName(env));
  if (!sid) {
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT
       s.id AS session_id,
       s.user_id AS user_id,
       s.expires_at AS expires_at,
       u.email AS email,
       u.name AS name,
       u.picture_url AS picture_url
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?
     LIMIT 1`
  )
    .bind(sid)
    .first<SessionRow>();

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }

  return row;
}

async function verifyGoogleToken(idToken: string, expectedAudience?: string): Promise<GoogleTokenInfo> {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", idToken);

  const response = await fetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as Record<string, string>;

  if (!response.ok) {
    const reason = payload.error_description || payload.error || "Google token 驗證失敗";
    throw new Error(reason);
  }

  const info: GoogleTokenInfo = {
    sub: payload.sub || "",
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    aud: payload.aud,
    exp: payload.exp
  };

  if (!info.sub) {
    throw new Error("Google token 缺少 sub");
  }

  if (expectedAudience && info.aud && info.aud !== expectedAudience) {
    throw new Error("Google client_id 不匹配");
  }

  if (info.exp && Number(info.exp) * 1000 <= Date.now()) {
    throw new Error("Google token 已過期");
  }

  return info;
}

async function upsertUserFromGoogle(env: Env, info: GoogleTokenInfo) {
  await env.DB.prepare(
    `INSERT INTO users (google_sub, email, name, picture_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture_url = excluded.picture_url,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(info.sub, info.email || null, info.name || null, info.picture || null)
    .run();

  const user = await env.DB.prepare(
    `SELECT id, email, name, picture_url
     FROM users
     WHERE google_sub = ?
     LIMIT 1`
  )
    .bind(info.sub)
    .first<{ id: number; email: string | null; name: string | null; picture_url: string | null }>();

  if (!user) {
    throw new Error("建立使用者失敗");
  }

  return user;
}

async function createSession(env: Env, userId: number) {
  const sessionId = randomId(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, expiresAt)
    .run();

  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();

  return { sessionId };
}

async function getSettings(env: Env, userId: number): Promise<StoredSettings> {
  const row = await env.DB.prepare(
    `SELECT user_id, threads_token, gemini_api_key, llm_model, enable_grounding, post_instruction, post_style, post_preference, reply_preference, post_time, reply_times, timezone, enabled
     FROM user_settings
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<UserSettingsRow>();

  if (!row) {
    return defaultSettings(env);
  }

  return {
    threadsToken: row.threads_token || "",
    geminiApiKey: row.gemini_api_key || "",
    llmModel: sanitizeLlmModel(row.llm_model),
    enableGrounding: Number(row.enable_grounding) === 1,
    postInstruction: row.post_instruction || defaultSettings(env).postInstruction,
    postStyle: row.post_style || defaultSettings(env).postStyle,
    postTime: sanitizePostTime(row.post_time),
    replyTimes: sanitizeReplyTimes(row.reply_times),
    timezone: sanitizeTimezone(row.timezone, defaultTimezone(env)),
    enabled: Number(row.enabled) === 1
  };
}

function normalizeIncomingSettings(env: Env, payload: Record<string, unknown>): StoredSettings {
  return {
    threadsToken: sanitizeText(payload.threadsToken, 4000),
    geminiApiKey: sanitizeText(payload.geminiApiKey, 4000),
    llmModel: sanitizeLlmModel(payload.llmModel),
    enableGrounding: parseBoolean(payload.enableGrounding),
    postInstruction: sanitizeText(payload.postInstruction ?? payload.postPreference, 8000),
    postStyle: sanitizeText(payload.postStyle ?? payload.replyPreference, 8000),
    postTime: sanitizePostTime(payload.postTime),
    replyTimes: sanitizeReplyTimes(payload.replyTimes),
    timezone: sanitizeTimezone(payload.timezone, defaultTimezone(env)),
    enabled: parseBoolean(payload.enabled)
  };
}

async function saveSettings(env: Env, userId: number, settings: StoredSettings) {
  await env.DB.prepare(
    `INSERT INTO user_settings (
      user_id,
      threads_token,
      gemini_api_key,
      llm_model,
      enable_grounding,
      post_instruction,
      post_style,
      post_preference,
      reply_preference,
      post_time,
      reply_times,
      timezone,
      enabled,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      threads_token = excluded.threads_token,
      gemini_api_key = excluded.gemini_api_key,
      llm_model = excluded.llm_model,
      enable_grounding = excluded.enable_grounding,
      post_instruction = excluded.post_instruction,
      post_style = excluded.post_style,
      post_preference = excluded.post_preference,
      reply_preference = excluded.reply_preference,
      post_time = excluded.post_time,
      reply_times = excluded.reply_times,
      timezone = excluded.timezone,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      userId,
      settings.threadsToken,
      settings.geminiApiKey,
      settings.llmModel,
      settings.enableGrounding ? 1 : 0,
      settings.postInstruction,
      settings.postStyle,
      settings.postInstruction,
      settings.postStyle,
      settings.postTime,
      settings.replyTimes.join(","),
      settings.timezone,
      settings.enabled ? 1 : 0
    )
    .run();
}

async function listRuns(env: Env, userId: number, limit = 20) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const query = await env.DB.prepare(
    `SELECT id, run_type, run_date, status, message, thread_id, created_at
     FROM post_runs
     WHERE user_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
  )
    .bind(userId, safeLimit)
    .all<RunRow>();

  return query.results || [];
}

async function deleteRuns(env: Env, userId: number) {
  const result = await env.DB.prepare("DELETE FROM post_runs WHERE user_id = ?").bind(userId).run();
  return Number(result.meta?.changes || 0);
}

async function getPendingDraft(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT user_id, draft, llm_model, enable_grounding, created_at, updated_at
     FROM pending_drafts
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<PendingDraftRow>();
}

async function upsertPendingDraft(env: Env, userId: number, draft: string, settings: StoredSettings) {
  await env.DB.prepare(
    `INSERT INTO pending_drafts (
      user_id,
      draft,
      llm_model,
      enable_grounding,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      draft = excluded.draft,
      llm_model = excluded.llm_model,
      enable_grounding = excluded.enable_grounding,
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      userId,
      draft,
      sanitizeLlmModel(settings.llmModel),
      settings.enableGrounding ? 1 : 0
    )
    .run();
}

async function deletePendingDraft(env: Env, userId: number) {
  await env.DB.prepare("DELETE FROM pending_drafts WHERE user_id = ?").bind(userId).run();
}

function collectScheduleTimes(settings: StoredSettings) {
  const unique = new Set<string>();
  unique.add(sanitizePostTime(settings.postTime));
  for (const value of settings.replyTimes) {
    const normalized = sanitizePostTime(value);
    if (normalized === "09:00" && value !== "09:00") {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

async function insertRun(
  env: Env,
  userId: number,
  runType: string,
  runDate: string,
  status: "success" | "failed" | "skipped",
  message: string,
  draft = "",
  threadId = ""
) {
  const runId = randomId(18);
  await env.DB.prepare(
    `INSERT INTO post_runs (id, user_id, run_type, run_date, status, message, thread_id, draft)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      runId,
      userId,
      runType,
      runDate,
      status,
      message.slice(0, 1200),
      threadId || null,
      draft || null
    )
    .run();
  return runId;
}

async function alreadyPostedToday(env: Env, userId: number, runDate: string) {
  const row = await env.DB.prepare(
    `SELECT id
     FROM post_runs
     WHERE user_id = ?
       AND run_type = 'scheduled'
       AND run_date = ?
       AND status = 'success'
     LIMIT 1`
  )
    .bind(userId, runDate)
    .first<{ id: string }>();

  return Boolean(row?.id);
}

function buildGeminiPrompt(settings: StoredSettings, runDate: string) {
  const instruction =
    settings.postInstruction || "請產生一篇適合 Threads 的貼文，內容清楚且有可讀性。";
  const style = settings.postStyle || "自然、真誠、繁體中文。";
  const groundingHint = settings.enableGrounding
    ? "若可行請結合近期可查證資訊，並確保敘述具體、可讀。"
    : "本次不需要主動結合外部時事資訊。";
  return [
    "你是社群貼文助理，請以繁體中文撰寫一篇可直接發佈到 Threads 的貼文。",
    "請嚴格遵守使用者給的指令與風格，不要加入額外固定模板。",
    "限制：",
    "- 全文長度必須小於 500 字（含空白與換行）",
    "- 只輸出最終貼文內容",
    "- 不要輸出 JSON、不要輸出 Markdown code block",
    "- 不要輸出簡體中文",
    groundingHint,
    `使用者指令：${instruction}`,
    `使用者風格：${style}`,
    `今天日期（使用者時區）：${runDate}`
  ].join("\n");
}

async function generatePostDraft(settings: StoredSettings, runDate: string) {
  let feedback = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = [buildGeminiPrompt(settings, runDate), feedback ? `修正要求：${feedback}` : ""]
      .filter(Boolean)
      .join("\n\n");

    const text = await callGeminiGenerateText(
      settings.geminiApiKey,
      prompt,
      settings.llmModel,
      settings.enableGrounding
    );
    const draft = normalizeDraft(text);
    const invalidReason = validateDraft(draft);

    if (!invalidReason) {
      return draft;
    }

    feedback = invalidReason;
  }

  throw new Error("Gemini 連續產生不符合格式的內容，請調整發文偏好後重試。");
}

function isGroundingPaidPlanError(message: string) {
  const text = String(message || "").toLowerCase();
  return (
    (text.includes("grounding") && text.includes("free tier")) ||
    text.includes("google search is not supported") ||
    text.includes("upgrade your plan")
  );
}

function isGeminiBusyMessage(message: string) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("high demand") ||
    text.includes("try again later") ||
    text.includes("temporarily unavailable") ||
    text.includes("resource exhausted") ||
    text.includes("server is overloaded")
  );
}

function shouldRetryGemini(status: number, message: string) {
  return [429, 500, 502, 503, 504].includes(Number(status)) || isGeminiBusyMessage(message);
}

function waitMs(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callGeminiGenerateText(
  apiKey: string,
  prompt: string,
  llmModel: string,
  enableGrounding: boolean
) {
  if (!apiKey) {
    throw new Error("缺少 Gemini API Key");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    sanitizeLlmModel(llmModel)
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.8
    }
  };

  if (enableGrounding) {
    body.tools = [{ google_search: {} }];
  }

  const maxAttempts = 5;
  let lastError = "Gemini request failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const errorObject = payload.error as { message?: string } | undefined;
      const message = errorObject?.message || `Gemini request failed: ${response.status}`;
      lastError = message;

      if (enableGrounding && isGroundingPaidPlanError(message)) {
        throw new Error(
          "Grounding 目前可能需要付費方案才能使用。請先關閉 Grounding 或升級 Gemini 計畫。"
        );
      }

      if (attempt < maxAttempts && shouldRetryGemini(response.status, message)) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }

      throw new Error(message);
    }

    const candidates = Array.isArray(payload.candidates)
      ? (payload.candidates as Array<Record<string, unknown>>)
      : [];
    const first = candidates[0] || {};
    const content = (first.content || {}) as { parts?: Array<{ text?: string }> };
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();

    if (!text) {
      lastError = "Gemini 回傳空內容";
      if (attempt < maxAttempts) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(lastError);
    }

    if (text.length > MAX_THREAD_CHARS + 300) {
      return text.slice(0, MAX_THREAD_CHARS + 300);
    }

    return text;
  }

  throw new Error(lastError);
}

async function fetchThreadsMe(accessToken: string) {
  const url = new URL("https://graph.threads.net/v1.0/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errorObject = payload.error as { message?: string } | undefined;
    throw new Error(errorObject?.message || "Threads /me 取得失敗");
  }

  const id = String(payload.id || "");
  const username = String(payload.username || "");

  if (!id) {
    throw new Error("Threads token 無法取得使用者 ID");
  }

  return { id, username };
}

async function threadsPostForm(url: string, body: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value) {
      form.set(key, value);
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errorObject = payload.error as { message?: string } | undefined;
    throw new Error(errorObject?.message || `Threads API failed: ${response.status}`);
  }

  return payload;
}

async function publishToThreads(accessToken: string, draft: string) {
  if (!accessToken) {
    throw new Error("缺少 Threads token");
  }

  const me = await fetchThreadsMe(accessToken);
  const createUrl = `https://graph.threads.net/v1.0/${me.id}/threads`;
  const created = await threadsPostForm(createUrl, {
    access_token: accessToken,
    media_type: "TEXT",
    text: draft
  });

  const creationId = String(created.id || "");
  if (!creationId) {
    throw new Error("Threads 建立 container 失敗");
  }

  const publishUrl = `https://graph.threads.net/v1.0/${me.id}/threads_publish`;
  const published = await threadsPostForm(publishUrl, {
    access_token: accessToken,
    creation_id: creationId
  });

  const threadId = String(published.id || "");
  if (!threadId) {
    throw new Error("Threads 發佈失敗（缺少 thread id）");
  }

  return {
    threadId,
    username: me.username
  };
}

function resolveRunDate(settings: StoredSettings, env: Env, now = new Date()) {
  const timezone = sanitizeTimezone(settings.timezone, defaultTimezone(env));
  const localNow = getLocalDateTime(now, timezone);
  return localNow.dateKey;
}

async function createPreviewDraft(
  env: Env,
  userId: number,
  settings: StoredSettings,
  mode: "manual_generate" | "manual_regenerate",
  now = new Date()
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);

  if (!settings.geminiApiKey) {
    const runId = await insertRun(env, userId, mode, runDate, "failed", "缺少 Gemini API Key");
    return {
      runId,
      status: "failed",
      message: "缺少 Gemini API Key",
      runType: mode,
      runDate
    };
  }

  try {
    const draft = await generatePostDraft(settings, runDate);
    await upsertPendingDraft(env, userId, draft, settings);
    const message = mode === "manual_regenerate" ? "草稿已重新產生" : "草稿已產生，請確認後再發出";
    const runId = await insertRun(env, userId, mode, runDate, "success", message, draft);
    return {
      runId,
      status: "success",
      message,
      runType: mode,
      runDate,
      draft
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    const runId = await insertRun(env, userId, mode, runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType: mode,
      runDate
    };
  }
}

async function publishDraftRun(
  env: Env,
  userId: number,
  settings: StoredSettings,
  runType: string,
  draft: string,
  now = new Date()
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);

  if (!settings.threadsToken || !settings.geminiApiKey) {
    const runId = await insertRun(
      env,
      userId,
      runType,
      runDate,
      "failed",
      "缺少 Threads token 或 Gemini API Key"
    );
    return {
      runId,
      status: "failed",
      message: "缺少 Threads token 或 Gemini API Key",
      runType,
      runDate
    };
  }

  try {
    const published = await publishToThreads(settings.threadsToken, draft);
    const successMessage = published.username
      ? `發佈成功 @${published.username}`
      : "發佈成功";
    const runId = await insertRun(
      env,
      userId,
      runType,
      runDate,
      "success",
      successMessage,
      draft,
      published.threadId
    );
    return {
      runId,
      status: "success",
      message: successMessage,
      threadId: published.threadId,
      runType,
      runDate,
      draft
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    const runId = await insertRun(env, userId, runType, runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType,
      runDate
    };
  }
}

async function executeScheduledPosting(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now = new Date()
): Promise<RunResult> {
  const timezone = sanitizeTimezone(settings.timezone, defaultTimezone(env));
  const localNow = getLocalDateTime(now, timezone);

  const exists = await alreadyPostedToday(env, userId, localNow.dateKey);
  if (exists) {
    const runId = await insertRun(
      env,
      userId,
      "scheduled",
      localNow.dateKey,
      "skipped",
      "今天已經自動發文，略過"
    );
    return {
      runId,
      status: "skipped",
      message: "今天已經自動發文，略過",
      runType: "scheduled",
      runDate: localNow.dateKey
    };
  }

  const pending = await getPendingDraft(env, userId);
  let draft = pending?.draft || "";

  if (!draft) {
    try {
      draft = await generatePostDraft(settings, localNow.dateKey);
    } catch (error) {
      const message = safeErrorMessage(error);
      const runId = await insertRun(env, userId, "scheduled", localNow.dateKey, "failed", message);
      return {
        runId,
        status: "failed",
        message,
        runType: "scheduled",
        runDate: localNow.dateKey
      };
    }
  }

  const result = await publishDraftRun(env, userId, settings, "scheduled", draft, now);
  if (result.status === "success" && pending) {
    await deletePendingDraft(env, userId);
  }
  return result;
}

async function ensureNextDraftForScheduledWindow(
  env: Env,
  userId: number,
  settings: StoredSettings,
  runDate: string
) {
  const pending = await getPendingDraft(env, userId);
  if (pending?.draft?.trim()) {
    return;
  }

  if (!settings.geminiApiKey) {
    await insertRun(
      env,
      userId,
      "scheduled_prefill",
      runDate,
      "failed",
      "缺少 Gemini API Key，無法自動補下一篇草稿"
    );
    return;
  }

  try {
    const draft = await generatePostDraft(settings, runDate);
    await upsertPendingDraft(env, userId, draft, settings);
    await insertRun(
      env,
      userId,
      "scheduled_prefill",
      runDate,
      "success",
      "已自動補齊下一篇草稿",
      draft
    );
  } catch (error) {
    await insertRun(
      env,
      userId,
      "scheduled_prefill",
      runDate,
      "failed",
      `自動補草稿失敗：${safeErrorMessage(error)}`
    );
  }
}

async function runScheduledJob(env: Env) {
  const query = await env.DB.prepare(
    `SELECT
      u.id AS user_id,
      s.threads_token AS threads_token,
      s.gemini_api_key AS gemini_api_key,
      s.llm_model AS llm_model,
      s.enable_grounding AS enable_grounding,
      s.post_instruction AS post_instruction,
      s.post_style AS post_style,
      s.post_preference AS post_preference,
      s.reply_preference AS reply_preference,
      s.post_time AS post_time,
      s.reply_times AS reply_times,
      s.timezone AS timezone,
      s.enabled AS enabled
    FROM users u
    JOIN user_settings s ON s.user_id = u.id
    WHERE s.enabled = 1`
  ).all<UserSettingsRow>();

  const users = query.results || [];
  const now = new Date();

  for (const row of users) {
    const settings: StoredSettings = {
      threadsToken: row.threads_token || "",
      geminiApiKey: row.gemini_api_key || "",
      llmModel: sanitizeLlmModel(row.llm_model),
      enableGrounding: Number(row.enable_grounding) === 1,
      postInstruction: row.post_instruction || defaultSettings(env).postInstruction,
      postStyle: row.post_style || defaultSettings(env).postStyle,
      postTime: sanitizePostTime(row.post_time),
      replyTimes: sanitizeReplyTimes(row.reply_times),
      timezone: sanitizeTimezone(row.timezone, defaultTimezone(env)),
      enabled: Number(row.enabled) === 1
    };

    if (!settings.enabled) {
      continue;
    }

    const localNow = getLocalDateTime(now, settings.timezone);
    const scheduleTimes = collectScheduleTimes(settings);
    const shouldRunAtCurrentMinute = scheduleTimes.some((time) =>
      shouldTriggerNow(localNow.minuteOfDay, time)
    );

    if (!shouldRunAtCurrentMinute) {
      continue;
    }

    await executeScheduledPosting(env, row.user_id, settings, now);
    await ensureNextDraftForScheduledWindow(env, row.user_id, settings, localNow.dateKey);
  }
}

async function handleApiRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const secureCookie = url.protocol === "https:";

  if (url.pathname === "/api/health" && method === "GET") {
    return jsonResponse({ ok: true, now: new Date().toISOString() });
  }

  if (url.pathname === "/api/public-config" && method === "GET") {
    return jsonResponse({
      googleClientId: env.GOOGLE_CLIENT_ID || ""
    });
  }

  if (url.pathname === "/api/auth/google" && method === "POST") {
    const body = await parseJsonBody<{ idToken?: string }>(request);
    const idToken = sanitizeText(body.idToken, 4096);
    if (!idToken) {
      return jsonResponse({ error: "缺少 idToken" }, 400);
    }

    const tokenInfo = await verifyGoogleToken(idToken, env.GOOGLE_CLIENT_ID);
    const user = await upsertUserFromGoogle(env, tokenInfo);
    const session = await createSession(env, user.id);

    return jsonResponse(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          pictureUrl: user.picture_url
        }
      },
      200,
      {
        "set-cookie": buildSetCookie(
          cookieName(env),
          session.sessionId,
          SESSION_TTL_SECONDS,
          secureCookie
        )
      }
    );
  }

  if (url.pathname === "/api/auth/logout" && method === "POST") {
    const sid = getCookie(request, cookieName(env));
    if (sid) {
      await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    }
    return jsonResponse(
      { ok: true },
      200,
      {
        "set-cookie": buildClearCookie(cookieName(env), secureCookie)
      }
    );
  }

  const session = await getSessionContext(env, request);
  if (!session) {
    return jsonResponse(
      { error: "未登入或 session 已過期" },
      401,
      {
        "set-cookie": buildClearCookie(cookieName(env), secureCookie)
      }
    );
  }

  if (url.pathname === "/api/me" && method === "GET") {
    return jsonResponse({
      user: {
        id: session.user_id,
        email: session.email,
        name: session.name,
        pictureUrl: session.picture_url
      }
    });
  }

  if (url.pathname === "/api/settings" && method === "GET") {
    const settings = await getSettings(env, session.user_id);
    return jsonResponse({ settings });
  }

  if (url.pathname === "/api/settings" && method === "PUT") {
    const payload = await parseJsonBody<Record<string, unknown>>(request);
    const normalized = normalizeIncomingSettings(env, payload);
    await saveSettings(env, session.user_id, normalized);
    return jsonResponse({ ok: true, settings: normalized });
  }

  if (url.pathname === "/api/runs" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") || "20");
    const runs = await listRuns(env, session.user_id, limit);
    return jsonResponse({ runs });
  }

  if (url.pathname === "/api/runs" && method === "DELETE") {
    const deletedCount = await deleteRuns(env, session.user_id);
    return jsonResponse({ ok: true, deletedCount });
  }

  if (url.pathname === "/api/pending-draft" && method === "GET") {
    const pendingDraft = await getPendingDraft(env, session.user_id);
    return jsonResponse({ pendingDraft });
  }

  if (url.pathname === "/api/pending-draft" && method === "PUT") {
    const payload = await parseJsonBody<{ draft?: unknown }>(request);
    const draft = normalizeDraft(sanitizeText(payload.draft, 2000));
    const invalidReason = validateDraft(draft);
    if (invalidReason) {
      return jsonResponse({ error: `草稿格式不正確：${invalidReason}` }, 400);
    }

    const settings = await getSettings(env, session.user_id);
    await upsertPendingDraft(env, session.user_id, draft, settings);
    const pendingDraft = await getPendingDraft(env, session.user_id);
    return jsonResponse({ ok: true, pendingDraft });
  }

  if (url.pathname === "/api/pending-draft" && method === "DELETE") {
    await deletePendingDraft(env, session.user_id);
    return jsonResponse({ ok: true });
  }

  if (url.pathname === "/api/run-now" && method === "POST") {
    const settings = await getSettings(env, session.user_id);
    const result = await createPreviewDraft(
      env,
      session.user_id,
      settings,
      "manual_generate",
      new Date()
    );
    return jsonResponse({ result });
  }

  if (url.pathname === "/api/pending-draft/regenerate" && method === "POST") {
    const settings = await getSettings(env, session.user_id);
    const result = await createPreviewDraft(
      env,
      session.user_id,
      settings,
      "manual_regenerate",
      new Date()
    );
    return jsonResponse({ result });
  }

  if (url.pathname === "/api/pending-draft/publish" && method === "POST") {
    const payload = await parseOptionalJsonBody<{ draft?: unknown }>(request, {});
    const draftOverride = normalizeDraft(sanitizeText(payload.draft, 2000));
    const pending = await getPendingDraft(env, session.user_id);
    const draft = draftOverride || pending?.draft || "";
    if (!draft) {
      return jsonResponse({ error: "目前沒有可發送的草稿，請先產生草稿。" }, 400);
    }

    const invalidReason = validateDraft(draft);
    if (invalidReason) {
      return jsonResponse({ error: `草稿格式不正確：${invalidReason}` }, 400);
    }

    const settings = await getSettings(env, session.user_id);
    if (draftOverride && draftOverride !== pending?.draft) {
      await upsertPendingDraft(env, session.user_id, draftOverride, settings);
    }
    const result = await publishDraftRun(
      env,
      session.user_id,
      settings,
      "manual_publish",
      draft,
      new Date()
    );
    if (result.status === "success") {
      await deletePendingDraft(env, session.user_id);
    }
    return jsonResponse({ result });
  }

  return jsonResponse({ error: "API route not found" }, 404);
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApiRequest(request, env);
      } catch (error) {
        const message = safeErrorMessage(error);
        console.error("[api:error]", message);
        return jsonResponse({ error: message }, 500);
      }
    }

    if (!env.ASSETS) {
      return textResponse("ASSETS binding is not configured", 500);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runScheduledJob(env).catch((error) => {
        console.error("[cron:error]", safeErrorMessage(error));
      })
    );
  }
};

export default worker;
