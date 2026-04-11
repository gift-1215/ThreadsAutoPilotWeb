export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SUPPORTED_LLM_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"] as const;
export const DEFAULT_LLM_MODEL: (typeof SUPPORTED_LLM_MODELS)[number] = "gemini-2.5-flash";
export const MAX_THREAD_CHARS = 499;
