import { Env, StoredSettings, UserSettingsRow } from "./types";
import {
  DEFAULT_LLM_MODEL,
  defaultTimezone,
  parseBoolean,
  sanitizeLlmModel,
  sanitizePostTime,
  sanitizeReplyTimes,
  sanitizeText,
  sanitizeTimezone
} from "./utils";

const SETTINGS_TEXT_LIMIT = 1000;

export function defaultSettings(env: Env): StoredSettings {
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

export function settingsFromRow(env: Env, row: UserSettingsRow): StoredSettings {
  const defaults = defaultSettings(env);
  return {
    threadsToken: row.threads_token || "",
    geminiApiKey: row.gemini_api_key || "",
    llmModel: sanitizeLlmModel(row.llm_model),
    enableGrounding: Number(row.enable_grounding) === 1,
    postInstruction: sanitizeText(row.post_instruction || defaults.postInstruction, SETTINGS_TEXT_LIMIT),
    postStyle: sanitizeText(row.post_style || defaults.postStyle, SETTINGS_TEXT_LIMIT),
    postTime: sanitizePostTime(row.post_time),
    replyTimes: sanitizeReplyTimes(row.reply_times),
    timezone: sanitizeTimezone(row.timezone, defaultTimezone(env)),
    enabled: Number(row.enabled) === 1
  };
}

export async function getSettings(env: Env, userId: number): Promise<StoredSettings> {
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

  return settingsFromRow(env, row);
}

export function normalizeIncomingSettings(env: Env, payload: Record<string, unknown>): StoredSettings {
  return {
    threadsToken: sanitizeText(payload.threadsToken, 4000),
    geminiApiKey: sanitizeText(payload.geminiApiKey, 4000),
    llmModel: sanitizeLlmModel(payload.llmModel),
    enableGrounding: parseBoolean(payload.enableGrounding),
    postInstruction: sanitizeText(
      payload.postInstruction ?? payload.postPreference,
      SETTINGS_TEXT_LIMIT
    ),
    postStyle: sanitizeText(payload.postStyle ?? payload.replyPreference, SETTINGS_TEXT_LIMIT),
    postTime: sanitizePostTime(payload.postTime),
    replyTimes: sanitizeReplyTimes(payload.replyTimes),
    timezone: sanitizeTimezone(payload.timezone, defaultTimezone(env)),
    enabled: parseBoolean(payload.enabled)
  };
}

export async function saveSettings(env: Env, userId: number, settings: StoredSettings) {
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
