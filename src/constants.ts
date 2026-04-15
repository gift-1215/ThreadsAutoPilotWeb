export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SUPPORTED_LLM_PROVIDERS = ["gemini", "chatgpt", "anthropic"] as const;
export type LlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

export const DEFAULT_LLM_PROVIDER: LlmProvider = "gemini";

export const SUPPORTED_LLM_MODELS_BY_PROVIDER = {
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  chatgpt: ["gpt-4.1-mini", "gpt-4.1"],
  anthropic: ["claude-3-5-haiku-latest", "claude-3-7-sonnet-latest"]
} as const satisfies Record<LlmProvider, readonly string[]>;

export const DEFAULT_LLM_MODEL_BY_PROVIDER = {
  gemini: "gemini-2.5-flash",
  chatgpt: "gpt-4.1-mini",
  anthropic: "claude-3-5-haiku-latest"
} as const satisfies Record<LlmProvider, string>;

export const DEFAULT_LLM_MODEL = DEFAULT_LLM_MODEL_BY_PROVIDER[DEFAULT_LLM_PROVIDER];
export const MAX_THREAD_CHARS = 499;

export const SUPPORTED_NEWS_PROVIDERS = ["google_rss", "gnews", "auto"] as const;
export type NewsProvider = (typeof SUPPORTED_NEWS_PROVIDERS)[number];
export const DEFAULT_NEWS_PROVIDER: NewsProvider = "google_rss";
