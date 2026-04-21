import type { StoredSettings } from "./types";
import {
  DEFAULT_LLM_PROVIDER,
  MAX_THREAD_CHARS,
  normalizeDraft,
  sanitizeLlmModel,
  sanitizeLlmProvider,
  validateDraft,
  waitMs
} from "./utils";
import type { LlmProvider } from "./utils";

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  gemini: "Gemini",
  chatgpt: "ChatGPT",
  anthropic: "Anthropic",
  felo: "Felo"
};
const MAX_HISTORY_DRAFTS = 8;
const MAX_HISTORY_QUOTES = 10;
const MAX_HISTORY_OPENINGS = 6;

interface PostGenerationOptions {
  recentDrafts?: string[];
}

function resolveProvider(settings: StoredSettings): LlmProvider {
  return sanitizeLlmProvider(settings.llmProvider || DEFAULT_LLM_PROVIDER);
}

function providerLabel(provider: LlmProvider) {
  return PROVIDER_LABEL[provider] || "LLM";
}

function normalizeCompareText(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(
      /[\s`~!@#$%^&*()_\-+=|\\[\]{}:;"'<>,.?/「」『』（）【】《》〈〉、，。！？：；…“”‘’]/g,
      ""
    );
}

function clipText(input: string, maxLength: number) {
  const text = String(input || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function extractOpeningLine(text: string) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return "";
  }
  return clipText(lines[0], 80);
}

function extractQuotedSentences(text: string, maxItems = 8) {
  const patterns = [
    /「([^「」\n]{8,220})」/g,
    /『([^『』\n]{8,220})』/g,
    /“([^“”\n]{8,220})”/g,
    /"([^"\n]{8,220})"/g
  ];
  const unique = new Map<string, string>();
  for (const pattern of patterns) {
    for (const match of String(text || "").matchAll(pattern)) {
      const sentence = String(match[1] || "").trim().replace(/\s+/g, " ");
      if (!sentence) {
        continue;
      }
      const normalized = normalizeCompareText(sentence);
      if (!normalized || unique.has(normalized)) {
        continue;
      }
      unique.set(normalized, sentence);
      if (unique.size >= maxItems) {
        return [...unique.values()];
      }
    }
  }
  return [...unique.values()];
}

function prepareHistoryHints(recentDraftsInput: string[]) {
  const recentDrafts = recentDraftsInput
    .map((draft) => String(draft || "").trim())
    .filter(Boolean)
    .slice(0, MAX_HISTORY_DRAFTS);
  const quoteSet = new Map<string, string>();
  const openings: string[] = [];

  for (const draft of recentDrafts) {
    const opening = extractOpeningLine(draft);
    if (opening) {
      openings.push(opening);
    }
    const quotes = extractQuotedSentences(draft, 6);
    for (const quote of quotes) {
      const key = normalizeCompareText(quote);
      if (!key || quoteSet.has(key)) {
        continue;
      }
      quoteSet.set(key, quote);
      if (quoteSet.size >= MAX_HISTORY_QUOTES) {
        break;
      }
    }
    if (quoteSet.size >= MAX_HISTORY_QUOTES) {
      break;
    }
  }

  return {
    recentDrafts,
    recentQuotes: [...quoteSet.values()],
    recentOpenings: openings.slice(0, MAX_HISTORY_OPENINGS)
  };
}

function buildAntiRepeatPrompt(recentDrafts: string[]) {
  const hints = prepareHistoryHints(recentDrafts);
  if (!hints.recentDrafts.length) {
    return "";
  }

  const lines = [
    "避免重複規則（務必遵守）：",
    "- 可以引用同一本書，但不可重複使用近期已出現過的同一句引文。",
    "- 若要談同一本書，請改用不同段落、不同觀點，或改成你自己的轉述。",
    "- 開頭句與核心觀點需和近期貼文有明顯差異。"
  ];

  if (hints.recentQuotes.length) {
    lines.push(
      "近期已使用引文（以下句子禁止再次逐字使用）：",
      ...hints.recentQuotes.map((quote, index) => `${index + 1}. 「${clipText(quote, 88)}」`)
    );
  }

  if (hints.recentOpenings.length) {
    lines.push(
      "近期貼文開頭參考（請避免相同開場句型）：",
      ...hints.recentOpenings.map((opening, index) => `${index + 1}. ${opening}`)
    );
  }

  return lines.join("\n");
}

function findRepeatIssue(draft: string, recentDrafts: string[]) {
  const hints = prepareHistoryHints(recentDrafts);
  if (!hints.recentDrafts.length) {
    return "";
  }

  const bannedQuoteMap = new Map(
    hints.recentQuotes.map((quote) => [normalizeCompareText(quote), quote] as const)
  );
  const currentQuotes = extractQuotedSentences(draft, 8);
  for (const quote of currentQuotes) {
    const key = normalizeCompareText(quote);
    const matched = bannedQuoteMap.get(key);
    if (matched) {
      return `引用句與近期貼文重複：${clipText(matched, 42)}`;
    }
  }

  const opening = extractOpeningLine(draft);
  const openingKey = normalizeCompareText(opening);
  if (openingKey) {
    const duplicatedOpening = hints.recentOpenings.some(
      (existing) => normalizeCompareText(existing) === openingKey
    );
    if (duplicatedOpening) {
      return "開頭句與近期貼文重複，請換一個新的切入點。";
    }
  }

  const draftKey = normalizeCompareText(draft);
  if (draftKey) {
    const duplicatedContent = hints.recentDrafts.some(
      (existing) => normalizeCompareText(existing) === draftKey
    );
    if (duplicatedContent) {
      return "整篇內容與近期貼文幾乎相同，請改用不同觀點重寫。";
    }
  }

  return "";
}

function buildPostPrompt(
  settings: StoredSettings,
  runDate: string,
  context = "",
  options: PostGenerationOptions = {}
) {
  const instruction =
    settings.postInstruction || "請產生一篇適合 Threads 的貼文，內容清楚且有可讀性。";
  const style = settings.postStyle || "自然、真誠、繁體中文。";
  const groundingHint = settings.enableGrounding
    ? "若可行請結合近期可查證資訊，並確保敘述具體、可讀。"
    : "本次不需要主動結合外部時事資訊。";

  const contextBlock = String(context || "").trim();
  const contextPrompt = contextBlock
    ? [
        "你會收到一份近期新聞摘要，請優先根據摘要重整觀點再撰文。",
        "若摘要資訊不足，請保守描述，不要虛構未提供的新聞細節。",
        `近期新聞摘要：\n${contextBlock}`
      ]
    : [];
  const antiRepeatPrompt = buildAntiRepeatPrompt(options.recentDrafts || []);

  return [
    "你是社群貼文助理，請以繁體中文撰寫一篇可直接發佈到 Threads 的貼文。",
    "請嚴格遵守使用者給的指令與風格，不要加入額外固定模板。",
    "限制：",
    "- 全文長度必須小於 500 字（含空白與換行）",
    "- 只輸出最終貼文內容",
    "- 不要輸出 JSON、不要輸出 Markdown code block",
    "- 不要輸出簡體中文",
    groundingHint,
    antiRepeatPrompt,
    `使用者指令：${instruction}`,
    `使用者風格：${style}`,
    `今天日期（使用者時區）：${runDate}`,
    ...contextPrompt
  ].join("\n");
}

function buildCommentReplyPrompt(settings: StoredSettings, postText: string, commentText: string) {
  const style = settings.postStyle || "自然、真誠、繁體中文。";
  const instruction =
    settings.postInstruction || "請根據留言內容，回覆簡潔、友善且有價值的內容。";
  return [
    "你是社群留言回覆助理，請以繁體中文撰寫一則可直接貼到 Threads 的回覆。",
    "請針對留言內容給出具體回應，避免空泛客套。",
    "限制：",
    "- 回覆長度必須小於 300 字",
    "- 只輸出最終回覆內容",
    "- 不要輸出 JSON、不要輸出 Markdown code block",
    "- 不要輸出簡體中文",
    `使用者風格：${style}`,
    `使用者補充要求：${instruction}`,
    `原貼文：${postText || "(無法取得原文，請根據留言回覆)"}`,
    `留言內容：${commentText || "(留言內容空白)"}`
  ].join("\n");
}

function isGroundingPaidPlanError(message: string) {
  const text = String(message || "").toLowerCase();
  return (
    (text.includes("grounding") && text.includes("free tier")) ||
    text.includes("google search is not supported") ||
    text.includes("upgrade your plan")
  );
}

function isProviderBusyMessage(message: string) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("high demand") ||
    text.includes("try again later") ||
    text.includes("temporarily unavailable") ||
    text.includes("resource exhausted") ||
    text.includes("server is overloaded") ||
    text.includes("rate limit") ||
    text.includes("too many requests")
  );
}

function shouldRetry(status: number, message: string) {
  return [429, 500, 502, 503, 504].includes(Number(status)) || isProviderBusyMessage(message);
}

function asObject(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function extractErrorMessage(payload: unknown, fallback: string) {
  const body = asObject(payload);
  const error = asObject(body.error);
  const message = String(error.message || "").trim();
  return message || fallback;
}

function trimGeneratedText(text: string) {
  if (text.length > MAX_THREAD_CHARS + 300) {
    return text.slice(0, MAX_THREAD_CHARS + 300);
  }
  return text;
}

function readGeminiText(payload: unknown) {
  const body = asObject(payload);
  const candidates = Array.isArray(body.candidates)
    ? (body.candidates as Array<Record<string, unknown>>)
    : [];
  const first = candidates[0] || {};
  const content = asObject(first.content);
  const parts = Array.isArray(content.parts)
    ? (content.parts as Array<Record<string, unknown>>)
    : [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function readOpenAiText(payload: unknown) {
  const body = asObject(payload);
  const directText = String(body.output_text || "").trim();
  if (directText) {
    return directText;
  }

  const output = Array.isArray(body.output) ? (body.output as Array<Record<string, unknown>>) : [];
  const chunks: string[] = [];

  for (const item of output) {
    const content = Array.isArray(item.content)
      ? (item.content as Array<Record<string, unknown>>)
      : [];

    for (const part of content) {
      const text = String(part.text || "").trim();
      if (text) {
        chunks.push(text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function readAnthropicText(payload: unknown) {
  const body = asObject(payload);
  const content = Array.isArray(body.content) ? (body.content as Array<Record<string, unknown>>) : [];
  const chunks = content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean);
  return chunks.join("\n").trim();
}

function readFeloText(payload: unknown) {
  const body = asObject(payload);
  const data = asObject(body.data);
  const candidates = [data.answer, data.output, data.content, body.answer];
  for (const item of candidates) {
    const text = String(item || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function sourceNameFromUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "").trim();
    return hostname || "Felo";
  } catch {
    return "Felo";
  }
}

function readFeloResources(payload: unknown) {
  const body = asObject(payload);
  const data = asObject(body.data);
  const resources = Array.isArray(data.resources)
    ? (data.resources as Array<Record<string, unknown>>)
    : [];

  return resources.map((resource) => {
    const url = String(resource.link || resource.url || "").trim();
    const title = String(resource.title || "").trim();
    const summary = String(resource.snippet || resource.summary || resource.description || "").trim();
    const sourceRaw = resource.source;
    const source =
      typeof sourceRaw === "string"
        ? sourceRaw.trim()
        : String(asObject(sourceRaw).name || asObject(sourceRaw).title || "").trim();
    const publishedAt = String(
      resource.publishedAt || resource.published_at || resource.publish_time || resource.date || ""
    ).trim();

    return {
      title,
      url,
      summary,
      source: source || sourceNameFromUrl(url),
      publishedAt
    };
  });
}

function buildFeloModeHint(llmModel: string) {
  const model = sanitizeLlmModel(llmModel, "felo");
  return model === "felo-pro"
    ? "偏好模式：請提供較完整、較深入的分析。"
    : "偏好模式：請提供重點清楚、較精簡的回答。";
}

function buildFeloQuery(prompt: string, llmModel: string, maxChars = 1900) {
  return `${String(prompt || "").trim()}\n\n${buildFeloModeHint(llmModel)}`
    .slice(0, maxChars)
    .trim();
}

function isFeloSuccessPayload(payload: unknown) {
  const body = asObject(payload);
  const statusRaw = body.status;
  const codeRaw = String(body.code || "").trim().toLowerCase();

  if (typeof statusRaw === "number") {
    if (statusRaw >= 200 && statusRaw < 300) {
      return true;
    }
  }

  const statusText = String(statusRaw || "").trim().toLowerCase();
  if (statusText === "ok" || statusText === "success" || statusText === "200") {
    return true;
  }

  if (codeRaw === "ok" || codeRaw === "success") {
    return true;
  }

  return false;
}

function extractFeloErrorMessage(payload: unknown, fallback: string) {
  const body = asObject(payload);
  const code = String(body.code || "").trim();
  const requestId = String(body.request_id || body.requestId || "").trim();
  const message = String(body.message || "").trim();
  const nested = extractErrorMessage(payload, "").trim();
  const normalized = message || nested || String(body.error_description || "").trim();
  const parts: string[] = [normalized || fallback];

  if (code) {
    parts.push(`code=${code}`);
  }
  if (requestId) {
    parts.push(`request_id=${requestId}`);
  }

  if (!normalized) {
    const raw = JSON.stringify(body);
    if (raw && raw !== "{}") {
      parts.push(`payload=${raw.slice(0, 220)}`);
    }
  }

  return parts.join(" | ");
}

async function callFeloChatPayload(apiKey: string, query: string) {
  const endpoint = "https://openapi.felo.ai/v2/chat";
  const body = {
    query: String(query || "").trim().slice(0, 2000)
  };
  const maxAttempts = 5;
  let lastError = "Felo request failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = extractFeloErrorMessage(
        payload,
        `Felo request failed: HTTP ${response.status}`
      );
      lastError = message;
      if (attempt < maxAttempts && shouldRetry(response.status, message)) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(message);
    }

    if (!isFeloSuccessPayload(payload)) {
      const status = String(asObject(payload).status || "").trim().toLowerCase();
      const message = extractFeloErrorMessage(payload, `Felo request failed: status=${status}`);
      lastError = message;
      if (attempt < maxAttempts && shouldRetry(response.status, message)) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(message);
    }

    return payload;
  }

  throw new Error(lastError);
}

async function callGeminiGenerateText(
  apiKey: string,
  prompt: string,
  llmModel: string,
  enableGrounding: boolean
) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    sanitizeLlmModel(llmModel, "gemini")
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

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = extractErrorMessage(payload, `Gemini request failed: ${response.status}`);
      lastError = message;

      if (enableGrounding && isGroundingPaidPlanError(message)) {
        throw new Error(
          "Grounding 目前可能需要付費方案才能使用。請先關閉 Grounding 或升級 Gemini 計畫。"
        );
      }

      if (attempt < maxAttempts && shouldRetry(response.status, message)) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }

      throw new Error(message);
    }

    const text = readGeminiText(payload);
    if (!text) {
      lastError = "Gemini 回傳空內容";
      if (attempt < maxAttempts) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(lastError);
    }

    return trimGeneratedText(text);
  }

  throw new Error(lastError);
}

async function callOpenAiGenerateText(apiKey: string, prompt: string, llmModel: string) {
  const endpoint = "https://api.openai.com/v1/responses";
  const body = {
    model: sanitizeLlmModel(llmModel, "chatgpt"),
    input: prompt,
    temperature: 0.8,
    max_output_tokens: 700
  };

  const maxAttempts = 5;
  let lastError = "OpenAI request failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = extractErrorMessage(payload, `OpenAI request failed: ${response.status}`);
      lastError = message;
      if (attempt < maxAttempts && shouldRetry(response.status, message)) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(message);
    }

    const text = readOpenAiText(payload);
    if (!text) {
      lastError = "OpenAI 回傳空內容";
      if (attempt < maxAttempts) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(lastError);
    }

    return trimGeneratedText(text);
  }

  throw new Error(lastError);
}

async function callAnthropicGenerateText(apiKey: string, prompt: string, llmModel: string) {
  const endpoint = "https://api.anthropic.com/v1/messages";
  const body = {
    model: sanitizeLlmModel(llmModel, "anthropic"),
    max_tokens: 700,
    temperature: 0.8,
    messages: [{ role: "user", content: prompt }]
  };

  const maxAttempts = 5;
  let lastError = "Anthropic request failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = extractErrorMessage(payload, `Anthropic request failed: ${response.status}`);
      lastError = message;
      if (attempt < maxAttempts && shouldRetry(response.status, message)) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(message);
    }

    const text = readAnthropicText(payload);
    if (!text) {
      lastError = "Anthropic 回傳空內容";
      if (attempt < maxAttempts) {
        await waitMs(Math.min(12000, 1500 * attempt));
        continue;
      }
      throw new Error(lastError);
    }

    return trimGeneratedText(text);
  }

  throw new Error(lastError);
}

async function callFeloGenerateText(apiKey: string, prompt: string, llmModel: string) {
  const query = buildFeloQuery(prompt, llmModel, 1900);
  const payload = await callFeloChatPayload(apiKey, query);
  const text = readFeloText(payload);
  if (!text) {
    throw new Error("Felo 回傳空內容");
  }
  return trimGeneratedText(text);
}

async function callProviderGenerateText(settings: StoredSettings, prompt: string) {
  const provider = resolveProvider(settings);
  if (!settings.geminiApiKey) {
    throw new Error(`缺少 ${providerLabel(provider)} API Key`);
  }

  if (provider === "chatgpt") {
    return callOpenAiGenerateText(settings.geminiApiKey, prompt, settings.llmModel);
  }

  if (provider === "anthropic") {
    return callAnthropicGenerateText(settings.geminiApiKey, prompt, settings.llmModel);
  }

  if (provider === "felo") {
    return callFeloGenerateText(settings.geminiApiKey, prompt, settings.llmModel);
  }

  return callGeminiGenerateText(
    settings.geminiApiKey,
    prompt,
    settings.llmModel,
    settings.enableGrounding
  );
}

async function generatePostDraftWithOptionalContext(
  settings: StoredSettings,
  runDate: string,
  context: string,
  options: PostGenerationOptions = {}
) {
  const provider = resolveProvider(settings);
  let feedback = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = [
      buildPostPrompt(settings, runDate, context, options),
      feedback ? `修正要求：${feedback}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await callProviderGenerateText(settings, prompt);
    const draft = normalizeDraft(text);
    const invalidReason = validateDraft(draft);
    const repeatReason = findRepeatIssue(draft, options.recentDrafts || []);

    if (!invalidReason && !repeatReason) {
      return draft;
    }

    feedback = invalidReason || repeatReason;
  }

  throw new Error(`${providerLabel(provider)} 連續產生不符合格式的內容，請調整發文偏好後重試。`);
}

export async function generatePostDraft(
  settings: StoredSettings,
  runDate: string,
  recentDrafts: string[] = []
) {
  return generatePostDraftWithOptionalContext(settings, runDate, "", { recentDrafts });
}

export async function generatePostDraftFromContext(
  settings: StoredSettings,
  runDate: string,
  context: string,
  recentDrafts: string[] = []
) {
  const safeContext = String(context || "").trim().slice(0, 6000);
  return generatePostDraftWithOptionalContext(settings, runDate, safeContext, { recentDrafts });
}

export interface LlmNewsArticle {
  title: string;
  source: string;
  publishedAt: string;
  summary: string;
  url: string;
}

function extractJsonBlock(text: string) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }

  const unwrapped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const arrayStart = unwrapped.indexOf("[");
  const arrayEnd = unwrapped.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return unwrapped.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = unwrapped.indexOf("{");
  const objectEnd = unwrapped.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return unwrapped.slice(objectStart, objectEnd + 1);
  }

  return "";
}

function parseLlmNewsArticles(rawText: string, maxItems: number): LlmNewsArticle[] {
  const jsonBlock = extractJsonBlock(rawText);
  if (!jsonBlock) {
    return [];
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return [];
  }

  const payload = Array.isArray(parsed)
    ? parsed
    : Array.isArray(asObject(parsed).articles)
      ? (asObject(parsed).articles as unknown[])
      : [];
  const uniqueByUrl = new Map<string, LlmNewsArticle>();

  for (const item of payload) {
    const row = asObject(item);
    const title = String(row.title || "").trim();
    const url = String(row.url || "").trim();
    if (!title || !url) {
      continue;
    }
    const source = String(row.source || "LLM").trim() || "LLM";
    const publishedAt = String(row.publishedAt || row.published_at || row.date || "").trim();
    const summary = String(row.summary || row.snippet || row.description || "").trim();

    if (!uniqueByUrl.has(url)) {
      uniqueByUrl.set(url, {
        title,
        source,
        publishedAt,
        summary,
        url
      });
    }
    if (uniqueByUrl.size >= maxItems) {
      break;
    }
  }

  return [...uniqueByUrl.values()].slice(0, maxItems);
}

function normalizeFeloNewsArticles(payload: unknown, maxItems: number) {
  const resources = readFeloResources(payload);
  const uniqueByUrl = new Map<string, LlmNewsArticle>();

  for (const resource of resources) {
    const url = String(resource.url || "").trim();
    const title = String(resource.title || "").trim();
    if (!url || !title) {
      continue;
    }

    if (!uniqueByUrl.has(url)) {
      uniqueByUrl.set(url, {
        title,
        source: String(resource.source || "Felo").trim() || "Felo",
        publishedAt: String(resource.publishedAt || "").trim(),
        summary: String(resource.summary || "").trim(),
        url
      });
    }
    if (uniqueByUrl.size >= maxItems) {
      break;
    }
  }

  return [...uniqueByUrl.values()].slice(0, maxItems);
}

async function generateNewsArticlesByFeloSearch(
  apiKey: string,
  llmModel: string,
  keywords: string[],
  lookbackDays: number,
  maxItems: number
) {
  const query = buildFeloQuery(
    [
      "你是新聞搜尋助手，請搜尋最近幾天與關鍵字相關的新聞報導。",
      `時間範圍：近 ${lookbackDays} 天。`,
      `關鍵字：${keywords.join("、")}`,
      `最多需要 ${maxItems} 則。`,
      "優先高可信媒體來源，並盡量涵蓋不同來源。"
    ].join("\n"),
    llmModel,
    1850
  );

  const payload = await callFeloChatPayload(apiKey, query);
  return normalizeFeloNewsArticles(payload, maxItems);
}

function settingsWithNewsSearch(settings: StoredSettings) {
  const provider = resolveProvider(settings);
  if (provider === "gemini" && !settings.enableGrounding) {
    return {
      ...settings,
      enableGrounding: true
    };
  }
  return settings;
}

export async function generateNewsArticlesByLlm(
  settings: StoredSettings,
  keywords: string[],
  lookbackDays: number,
  maxItems: number
) {
  const safeKeywords = keywords.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
  if (!safeKeywords.length) {
    return [] as LlmNewsArticle[];
  }
  if (!settings.geminiApiKey) {
    throw new Error(`缺少 ${providerLabel(resolveProvider(settings))} API Key`);
  }

  const fetcherSettings = settingsWithNewsSearch(settings);
  const provider = resolveProvider(fetcherSettings);
  const maxCount = Math.max(1, Math.min(10, Number(maxItems) || 5));
  let feedback = "";
  let providerHint = "";

  if (provider === "felo") {
    try {
      const feloArticles = await generateNewsArticlesByFeloSearch(
        fetcherSettings.geminiApiKey,
        fetcherSettings.llmModel,
        safeKeywords,
        lookbackDays,
        maxCount
      );
      if (feloArticles.length > 0) {
        return feloArticles;
      }
      providerHint = "Felo 搜尋有回應，但 resources 未提供可用新聞連結。";
    } catch (error) {
      providerHint = `Felo 搜尋失敗：${
        error instanceof Error ? error.message : String(error || "未知錯誤")
      }`;
    }
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = [
      "你是新聞研究助手。請查找近幾天與關鍵字相關的新聞，回傳 JSON 陣列。",
      `時間範圍：近 ${lookbackDays} 天。`,
      `關鍵字：${safeKeywords.join("、")}`,
      `最多回傳 ${maxCount} 則。`,
      "每筆欄位：title, source, publishedAt, summary, url。",
      "限制：",
      "- 只輸出 JSON（陣列或 {\"articles\": [...]}），不要任何額外說明文字",
      "- 請使用標準 JSON 雙引號，禁止使用單引號或註解",
      "- url 必須是可點擊的完整 https 連結",
      "- summary 請簡短，不超過 80 個中文字",
      feedback ? `修正要求：${feedback}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await callProviderGenerateText(fetcherSettings, prompt);
    const articles = parseLlmNewsArticles(raw, maxCount);
    if (articles.length > 0) {
      return articles;
    }
    feedback = "回傳格式錯誤或沒有有效新聞，請改成合法 JSON 並附上可用 url。";
  }

  if (providerHint) {
    throw new Error(`LLM 新聞抓取失敗：無法取得可解析的新聞 JSON。${providerHint}`);
  }

  throw new Error("LLM 新聞抓取失敗：無法取得可解析的新聞 JSON。");
}

export async function generateImagePromptFromDraft(
  settings: StoredSettings,
  draft: string,
  runDate: string
) {
  const safeDraft = String(draft || "").trim().slice(0, 900);
  const prompt = [
    "你是視覺設計助手，請根據貼文內容產生一段可用於 AI 生成圖片的英文提示詞。",
    "限制：",
    "- 只輸出一行英文 prompt，不要任何前後綴說明",
    "- 長度 25 到 70 個英文單字",
    "- 不要品牌 logo、不要文字浮水印、不要版權角色",
    "- 畫面需有明確主體、場景、光線與風格",
    `貼文日期：${runDate}`,
    `貼文內容：${safeDraft}`
  ].join("\n");

  const raw = await callProviderGenerateText(settings, prompt);
  return raw
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

export async function generateCommentReply(
  settings: StoredSettings,
  postText: string,
  commentText: string
) {
  const provider = resolveProvider(settings);
  let feedback = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = [
      buildCommentReplyPrompt(settings, postText, commentText),
      feedback ? `修正要求：${feedback}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await callProviderGenerateText(settings, prompt);
    const reply = normalizeDraft(text);
    const invalidReason = validateDraft(reply);

    if (!invalidReason && reply.length < 300) {
      return reply;
    }

    feedback = invalidReason || "回覆過長，請縮短到 300 字以內。";
  }

  throw new Error(
    `${providerLabel(provider)} 連續產生不符合格式的留言回覆，請調整設定後重試。`
  );
}
