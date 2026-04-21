export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  SESSION_COOKIE_NAME?: string;
  DEFAULT_TIMEZONE?: string;
  GNEWS_API_KEY?: string;
}

export interface GoogleTokenInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  aud?: string;
  exp?: string;
}

export interface SessionRow {
  session_id: string;
  user_id: number;
  expires_at: string;
  email: string | null;
  name: string | null;
  picture_url: string | null;
}

export interface UserSettingsRow {
  user_id: number;
  threads_token: string | null;
  gemini_api_key: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  news_llm_provider?: string | null;
  news_llm_model?: string | null;
  news_llm_api_key?: string | null;
  draft_llm_provider?: string | null;
  draft_llm_model?: string | null;
  draft_llm_api_key?: string | null;
  image_llm_provider?: string | null;
  image_llm_model?: string | null;
  image_llm_api_key?: string | null;
  enable_grounding: number;
  post_instruction: string | null;
  post_style: string | null;
  post_preference: string | null;
  reply_preference: string | null;
  post_time: string;
  reply_times: string | null;
  news_enabled: number;
  news_keywords: string | null;
  news_fetch_time: string;
  news_max_items: number;
  news_provider: string | null;
  image_enabled: number | null;
  timezone: string;
  enabled: number;
}

export interface RunRow {
  id: string;
  run_type: string;
  run_date: string;
  status: string;
  message: string | null;
  thread_id: string | null;
  created_at: string;
}

export interface PendingDraftRow {
  user_id: number;
  draft: string;
  llm_model: string;
  enable_grounding: number;
  image_url: string | null;
  image_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredSettings {
  threadsToken: string;
  geminiApiKey: string;
  llmProvider: string;
  llmModel: string;
  newsLlmProvider: string;
  newsLlmModel: string;
  newsLlmApiKey: string;
  draftLlmProvider: string;
  draftLlmModel: string;
  draftLlmApiKey: string;
  imageLlmProvider: string;
  imageLlmModel: string;
  imageLlmApiKey: string;
  enableGrounding: boolean;
  postInstruction: string;
  postStyle: string;
  postTime: string;
  replyTimes: string[];
  newsEnabled: boolean;
  newsKeywords: string[];
  newsFetchTime: string;
  newsMaxItems: number;
  newsProvider: string;
  imageEnabled: boolean;
  timezone: string;
  enabled: boolean;
}

export interface RunResult {
  runId: string;
  status: "success" | "failed" | "skipped";
  message: string;
  threadId?: string;
  runType: string;
  runDate: string;
  draft?: string;
  newsPreview?: NewsRunPreview;
}

export interface NewsPreviewArticle {
  title: string;
  source: string;
  publishedAt: string;
  snippet: string;
  url: string;
}

export interface NewsQueryAttemptResult {
  label: string;
  query: string;
  lang: string | null;
  country: string | null;
  matched: number;
  status: "success" | "error";
  error?: string;
}

export interface NewsRunPreview {
  lookbackDays: number;
  keywords: string[];
  provider: string;
  attempts: NewsQueryAttemptResult[];
  articles: NewsPreviewArticle[];
}
