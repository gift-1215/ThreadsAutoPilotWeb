import { generateImagePromptFromDraft } from "./gemini";
import { waitMs } from "./runtime";
import type { StoredSettings } from "./types";

const IMAGE_VARIANTS = [
  { model: "flux", width: 1024, height: 1024 },
  { model: "flux", width: 896, height: 896 },
  { model: "flux", width: 768, height: 768 }
] as const;

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_VERIFY_ATTEMPTS_PER_VARIANT = 3;
const VERIFY_TIMEOUT_MS = 35000;
const MAX_RETRY_AFTER_MS = 15000;
const MAX_BACKOFF_MS = 12000;

interface ImageVerificationError extends Error {
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
}

function hashSeed(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash || 1;
}

function buildImageUrl(
  imagePrompt: string,
  runDate: string,
  options: { model: string; width: number; height: number }
) {
  const seed = hashSeed(`${runDate}|${imagePrompt}`);
  const encodedPrompt = encodeURIComponent(imagePrompt);
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?model=${encodeURIComponent(options.model)}&width=${options.width}&height=${options.height}&seed=${seed}&nologo=true&referrer=threads-autopilot-web`;
}

function parseRetryAfterMs(raw: string | null) {
  const value = String(raw || "").trim();
  if (!value) {
    return 0;
  }

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.floor(asSeconds * 1000));
  }

  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    if (delta > 0) {
      return Math.min(MAX_RETRY_AFTER_MS, delta);
    }
  }

  return 0;
}

function toVerificationError(
  message: string,
  options: { status?: number; retryAfterMs?: number } = {}
) {
  const error = new Error(message) as ImageVerificationError;
  if (typeof options.status === "number") {
    error.status = options.status;
  }
  error.retryable = RETRYABLE_STATUS_CODES.has(Number(options.status || 0));
  if (typeof options.retryAfterMs === "number" && options.retryAfterMs > 0) {
    error.retryAfterMs = options.retryAfterMs;
  }
  return error;
}

async function verifyImageUrlOnce(imageUrl: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), VERIFY_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      headers: {
        accept: "image/*"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const status = Number(response.status);
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw toVerificationError(`圖片生成服務回應失敗：${status}`, { status, retryAfterMs });
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("image/")) {
      throw toVerificationError("圖片生成服務未回傳圖片內容");
    }

    if (response.body) {
      void response.body.cancel();
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || "");
    if (rawMessage.includes("timeout") || rawMessage.toLowerCase().includes("abort")) {
      throw toVerificationError("圖片生成服務逾時，請稍後再試。", { status: 408 });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function verifyImageWithRetry(imagePrompt: string, runDate: string) {
  let lastError: ImageVerificationError | null = null;
  let lastImageUrl = "";

  for (const variant of IMAGE_VARIANTS) {
    const imageUrl = buildImageUrl(imagePrompt, runDate, variant);
    lastImageUrl = imageUrl;

    for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS_PER_VARIANT; attempt += 1) {
      try {
        await verifyImageUrlOnce(imageUrl);
        return {
          imageUrl,
          warning: ""
        };
      } catch (error) {
        const normalized = (error instanceof Error
          ? (error as ImageVerificationError)
          : toVerificationError("圖片生成服務回應失敗")) as ImageVerificationError;
        lastError = normalized;
        const retryable = Boolean(normalized.retryable);
        if (!retryable) {
          throw normalized;
        }

        if (attempt < MAX_VERIFY_ATTEMPTS_PER_VARIANT) {
          const retryAfterMs =
            normalized.retryAfterMs && normalized.retryAfterMs > 0
              ? normalized.retryAfterMs
              : Math.min(MAX_BACKOFF_MS, 1400 * attempt);
          await waitMs(retryAfterMs);
        }
      }
    }
  }

  const status = Number(lastError?.status || 0);
  if (status === 429 && lastImageUrl) {
    return {
      imageUrl: lastImageUrl,
      warning: "圖片服務目前限流（429），已先保留圖片 URL，可稍後重試預覽或直接發文。"
    };
  }

  throw lastError || new Error("圖片生成服務暫時不可用，請稍後再試。");
}

export async function generateDraftImageAsset(
  settings: StoredSettings,
  draft: string,
  runDate: string
) {
  const imagePrompt = await generateImagePromptFromDraft(settings, draft, runDate);
  if (!imagePrompt) {
    throw new Error("圖片提示詞為空白");
  }

  const verified = await verifyImageWithRetry(imagePrompt, runDate);
  const imageUrl = verified.imageUrl;
  if (!imageUrl) {
    throw new Error("圖片生成失敗：未取得有效圖片網址");
  }
  return {
    imageUrl,
    imagePrompt,
    warning: verified.warning
  };
}
