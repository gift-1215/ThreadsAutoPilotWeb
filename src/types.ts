export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  SESSION_COOKIE_NAME?: string;
  DEFAULT_TIMEZONE?: string;
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
  created_at: string;
  updated_at: string;
}

export interface StoredSettings {
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

export interface RunResult {
  runId: string;
  status: "success" | "failed" | "skipped";
  message: string;
  threadId?: string;
  runType: string;
  runDate: string;
  draft?: string;
}
