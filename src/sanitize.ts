import {
  DEFAULT_NEWS_PROVIDER,
  DEFAULT_LLM_MODEL_BY_PROVIDER,
  DEFAULT_LLM_PROVIDER,
  NewsProvider,
  LlmProvider,
  SUPPORTED_NEWS_PROVIDERS,
  SUPPORTED_LLM_MODELS_BY_PROVIDER,
  SUPPORTED_LLM_PROVIDERS
} from "./constants";

export function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

export function sanitizeLlmProvider(input: unknown): LlmProvider {
  const candidate = String(input || "").trim().toLowerCase();
  if (SUPPORTED_LLM_PROVIDERS.includes(candidate as LlmProvider)) {
    return candidate as LlmProvider;
  }
  return DEFAULT_LLM_PROVIDER;
}

export function sanitizeLlmModel(input: unknown, providerInput: unknown = DEFAULT_LLM_PROVIDER) {
  const provider = sanitizeLlmProvider(providerInput);
  const candidate = String(input || "").trim().toLowerCase();
  const supportedModels = SUPPORTED_LLM_MODELS_BY_PROVIDER[provider] as readonly string[];
  if (supportedModels.includes(candidate)) {
    return candidate;
  }
  return DEFAULT_LLM_MODEL_BY_PROVIDER[provider];
}

export function sanitizeText(input: unknown, maxLength = 4000) {
  const value = String(input || "").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

export function sanitizePostTime(input: unknown) {
  const value = String(input || "").trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return value;
  }
  return "09:00";
}

export function sanitizeReplyTimes(input: unknown, maxItems = 12) {
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

export function sanitizeNewsKeywords(input: unknown, maxItems = 8) {
  const tokens = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[,，;\n\r\t]+/g)
        .map((value) => value.trim())
        .filter(Boolean);

  const unique = new Set<string>();
  for (const token of tokens) {
    const cleaned = String(token || "").trim();
    if (!cleaned) {
      continue;
    }
    unique.add(cleaned.slice(0, 80));
    if (unique.size >= maxItems) {
      break;
    }
  }

  return [...unique];
}

export function sanitizeNewsMaxItems(input: unknown, min = 1, max = 10) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function sanitizeNewsProvider(input: unknown): NewsProvider {
  const candidate = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (SUPPORTED_NEWS_PROVIDERS.includes(candidate as NewsProvider)) {
    return candidate as NewsProvider;
  }
  return DEFAULT_NEWS_PROVIDER;
}

export function normalizeDraft(rawText: string) {
  return String(rawText || "")
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function validateDraft(draft: string) {
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
  if (/\{[\s\S]*\}/.test(draft) && draft.includes('"')) {
    return "請只輸出貼文內容，不要輸出 JSON";
  }
  return "";
}
