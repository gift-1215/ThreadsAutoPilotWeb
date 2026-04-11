import { StoredSettings } from "./types";
import {
  MAX_THREAD_CHARS,
  normalizeDraft,
  sanitizeLlmModel,
  validateDraft,
  waitMs
} from "./utils";

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

export async function generatePostDraft(settings: StoredSettings, runDate: string) {
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
