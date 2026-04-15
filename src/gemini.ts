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
  anthropic: "Anthropic"
};

function resolveProvider(settings: StoredSettings): LlmProvider {
  return sanitizeLlmProvider(settings.llmProvider || DEFAULT_LLM_PROVIDER);
}

function providerLabel(provider: LlmProvider) {
  return PROVIDER_LABEL[provider] || "LLM";
}

function buildPostPrompt(settings: StoredSettings, runDate: string, context = "") {
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
  context: string
) {
  const provider = resolveProvider(settings);
  let feedback = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = [
      buildPostPrompt(settings, runDate, context),
      feedback ? `修正要求：${feedback}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const text = await callProviderGenerateText(settings, prompt);
    const draft = normalizeDraft(text);
    const invalidReason = validateDraft(draft);

    if (!invalidReason) {
      return draft;
    }

    feedback = invalidReason;
  }

  throw new Error(`${providerLabel(provider)} 連續產生不符合格式的內容，請調整發文偏好後重試。`);
}

export async function generatePostDraft(settings: StoredSettings, runDate: string) {
  return generatePostDraftWithOptionalContext(settings, runDate, "");
}

export async function generatePostDraftFromContext(
  settings: StoredSettings,
  runDate: string,
  context: string
) {
  const safeContext = String(context || "").trim().slice(0, 6000);
  return generatePostDraftWithOptionalContext(settings, runDate, safeContext);
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
