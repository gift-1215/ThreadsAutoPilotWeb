import { Env, StoredSettings, UserSettingsRow } from "./types";
import {
  DEFAULT_NEWS_PROVIDER,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  defaultTimezone,
  parseBoolean,
  safeErrorMessage,
  sanitizeLlmModel,
  sanitizeLlmProvider,
  sanitizeNewsKeywords,
  sanitizeNewsMaxItems,
  sanitizeNewsProvider,
  sanitizePostTime,
  sanitizeReplyTimes,
  sanitizeText,
  sanitizeTimezone
} from "./utils";

const SETTINGS_TEXT_LIMIT = 1000;
const DEFAULT_NEWS_FETCH_TIME = "08:00";
const DEFAULT_NEWS_MAX_ITEMS = 5;
const MISSING_PROVIDER_COLUMN = "no such column: llm_provider";
const MISSING_NEWS_PROVIDER_COLUMN = "no such column: news_provider";

function isMissingProviderColumnError(error: unknown) {
  return safeErrorMessage(error).toLowerCase().includes(MISSING_PROVIDER_COLUMN);
}

function isMissingNewsProviderColumnError(error: unknown) {
  return safeErrorMessage(error).toLowerCase().includes(MISSING_NEWS_PROVIDER_COLUMN);
}

function isMissingNewsColumnError(error: unknown) {
  const message = safeErrorMessage(error).toLowerCase();
  return (
    message.includes("no such column: news_enabled") ||
    message.includes("no such column: news_keywords") ||
    message.includes("no such column: news_fetch_time") ||
    message.includes("no such column: news_max_items")
  );
}

function withDefaultNewsFields(
  row: Omit<
    UserSettingsRow,
    "news_enabled" | "news_keywords" | "news_fetch_time" | "news_max_items" | "news_provider"
  >
): UserSettingsRow {
  return {
    ...row,
    news_enabled: 0,
    news_keywords: "",
    news_fetch_time: DEFAULT_NEWS_FETCH_TIME,
    news_max_items: DEFAULT_NEWS_MAX_ITEMS,
    news_provider: null
  };
}

function withDefaultProviderAndNewsFields(
  row: Omit<
    UserSettingsRow,
    | "llm_provider"
    | "news_enabled"
    | "news_keywords"
    | "news_fetch_time"
    | "news_max_items"
    | "news_provider"
  >
): UserSettingsRow {
  return {
    ...row,
    llm_provider: null,
    news_enabled: 0,
    news_keywords: "",
    news_fetch_time: DEFAULT_NEWS_FETCH_TIME,
    news_max_items: DEFAULT_NEWS_MAX_ITEMS,
    news_provider: null
  };
}

export function defaultSettings(env: Env): StoredSettings {
  return {
    threadsToken: "",
    geminiApiKey: "",
    llmProvider: DEFAULT_LLM_PROVIDER,
    llmModel: DEFAULT_LLM_MODEL,
    enableGrounding: false,
    postInstruction: "請產生一篇適合 Threads 的貼文，內容要清楚、有觀點、可讀性高。",
    postStyle: "自然、真誠、繁體中文。",
    postTime: "09:00",
    replyTimes: [],
    newsEnabled: false,
    newsKeywords: [],
    newsFetchTime: DEFAULT_NEWS_FETCH_TIME,
    newsMaxItems: DEFAULT_NEWS_MAX_ITEMS,
    newsProvider: DEFAULT_NEWS_PROVIDER,
    timezone: defaultTimezone(env),
    enabled: false
  };
}

export function settingsFromRow(env: Env, row: UserSettingsRow): StoredSettings {
  const defaults = defaultSettings(env);
  const llmProvider = sanitizeLlmProvider(row.llm_provider);
  return {
    threadsToken: row.threads_token || "",
    geminiApiKey: row.gemini_api_key || "",
    llmProvider,
    llmModel: sanitizeLlmModel(row.llm_model, llmProvider),
    enableGrounding: Number(row.enable_grounding) === 1,
    postInstruction: sanitizeText(row.post_instruction || defaults.postInstruction, SETTINGS_TEXT_LIMIT),
    postStyle: sanitizeText(row.post_style || defaults.postStyle, SETTINGS_TEXT_LIMIT),
    postTime: sanitizePostTime(row.post_time),
    replyTimes: sanitizeReplyTimes(row.reply_times),
    newsEnabled: Number(row.news_enabled) === 1,
    newsKeywords: sanitizeNewsKeywords(row.news_keywords),
    newsFetchTime: sanitizePostTime(row.news_fetch_time),
    newsMaxItems: sanitizeNewsMaxItems(row.news_max_items),
    newsProvider: sanitizeNewsProvider(row.news_provider),
    timezone: sanitizeTimezone(row.timezone, defaultTimezone(env)),
    enabled: Number(row.enabled) === 1
  };
}

async function getSettingsLatestRow(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT user_id, threads_token, gemini_api_key, llm_provider, llm_model, enable_grounding, post_instruction, post_style, post_preference, reply_preference, post_time, reply_times, news_enabled, news_keywords, news_fetch_time, news_max_items, news_provider, timezone, enabled
     FROM user_settings
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<UserSettingsRow>();
}

async function getSettingsRowWithoutNewsProvider(env: Env, userId: number) {
  const row = await env.DB.prepare(
    `SELECT user_id, threads_token, gemini_api_key, llm_provider, llm_model, enable_grounding, post_instruction, post_style, post_preference, reply_preference, post_time, reply_times, news_enabled, news_keywords, news_fetch_time, news_max_items, timezone, enabled
     FROM user_settings
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<Omit<UserSettingsRow, "news_provider">>();

  return row ? { ...row, news_provider: null } : null;
}

async function getSettingsRowWithoutNews(env: Env, userId: number) {
  const row = await env.DB.prepare(
    `SELECT user_id, threads_token, gemini_api_key, llm_provider, llm_model, enable_grounding, post_instruction, post_style, post_preference, reply_preference, post_time, reply_times, timezone, enabled
     FROM user_settings
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<
      Omit<
        UserSettingsRow,
        "news_enabled" | "news_keywords" | "news_fetch_time" | "news_max_items" | "news_provider"
      >
    >();

  return row ? withDefaultNewsFields(row) : null;
}

async function getSettingsLegacyRow(env: Env, userId: number) {
  const row = await env.DB.prepare(
    `SELECT user_id, threads_token, gemini_api_key, llm_model, enable_grounding, post_instruction, post_style, post_preference, reply_preference, post_time, reply_times, timezone, enabled
     FROM user_settings
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<
      Omit<
        UserSettingsRow,
        | "llm_provider"
        | "news_enabled"
        | "news_keywords"
        | "news_fetch_time"
        | "news_max_items"
        | "news_provider"
      >
    >();

  return row ? withDefaultProviderAndNewsFields(row) : null;
}

export async function getSettings(env: Env, userId: number): Promise<StoredSettings> {
  let row: UserSettingsRow | null = null;

  try {
    row = await getSettingsLatestRow(env, userId);
  } catch (error) {
    if (isMissingNewsProviderColumnError(error)) {
      try {
        row = await getSettingsRowWithoutNewsProvider(env, userId);
      } catch (errorWithoutNewsProvider) {
        if (isMissingNewsColumnError(errorWithoutNewsProvider)) {
          try {
            row = await getSettingsRowWithoutNews(env, userId);
          } catch (errorWithoutNews) {
            if (!isMissingProviderColumnError(errorWithoutNews)) {
              throw errorWithoutNews;
            }
            row = await getSettingsLegacyRow(env, userId);
          }
        } else if (isMissingProviderColumnError(errorWithoutNewsProvider)) {
          row = await getSettingsLegacyRow(env, userId);
        } else {
          throw errorWithoutNewsProvider;
        }
      }
    } else if (isMissingNewsColumnError(error)) {
      try {
        row = await getSettingsRowWithoutNews(env, userId);
      } catch (errorWithoutNews) {
        if (!isMissingProviderColumnError(errorWithoutNews)) {
          throw errorWithoutNews;
        }
        row = await getSettingsLegacyRow(env, userId);
      }
    } else if (isMissingProviderColumnError(error)) {
      row = await getSettingsLegacyRow(env, userId);
    } else {
      throw error;
    }
  }

  if (!row) {
    return defaultSettings(env);
  }

  return settingsFromRow(env, row);
}

export function normalizeIncomingSettings(env: Env, payload: Record<string, unknown>): StoredSettings {
  const llmProvider = sanitizeLlmProvider(payload.llmProvider);
  return {
    threadsToken: sanitizeText(payload.threadsToken, 4000),
    geminiApiKey: sanitizeText(payload.geminiApiKey ?? payload.llmApiKey, 4000),
    llmProvider,
    llmModel: sanitizeLlmModel(payload.llmModel, llmProvider),
    enableGrounding: parseBoolean(payload.enableGrounding),
    postInstruction: sanitizeText(
      payload.postInstruction ?? payload.postPreference,
      SETTINGS_TEXT_LIMIT
    ),
    postStyle: sanitizeText(payload.postStyle ?? payload.replyPreference, SETTINGS_TEXT_LIMIT),
    postTime: sanitizePostTime(payload.postTime),
    replyTimes: sanitizeReplyTimes(payload.replyTimes),
    newsEnabled: parseBoolean(payload.newsEnabled),
    newsKeywords: sanitizeNewsKeywords(payload.newsKeywords),
    newsFetchTime: sanitizePostTime(payload.newsFetchTime),
    newsMaxItems: sanitizeNewsMaxItems(payload.newsMaxItems),
    newsProvider: sanitizeNewsProvider(payload.newsProvider),
    timezone: sanitizeTimezone(payload.timezone, defaultTimezone(env)),
    enabled: parseBoolean(payload.enabled)
  };
}

async function saveSettingsWithAllColumns(env: Env, userId: number, settings: StoredSettings) {
  await env.DB.prepare(
    `INSERT INTO user_settings (
      user_id,
      threads_token,
      gemini_api_key,
      llm_provider,
      llm_model,
      enable_grounding,
      post_instruction,
      post_style,
      post_preference,
      reply_preference,
      post_time,
      reply_times,
      news_enabled,
      news_keywords,
      news_fetch_time,
      news_max_items,
      news_provider,
      timezone,
      enabled,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      threads_token = excluded.threads_token,
      gemini_api_key = excluded.gemini_api_key,
      llm_provider = excluded.llm_provider,
      llm_model = excluded.llm_model,
      enable_grounding = excluded.enable_grounding,
      post_instruction = excluded.post_instruction,
      post_style = excluded.post_style,
      post_preference = excluded.post_preference,
      reply_preference = excluded.reply_preference,
      post_time = excluded.post_time,
      reply_times = excluded.reply_times,
      news_enabled = excluded.news_enabled,
      news_keywords = excluded.news_keywords,
      news_fetch_time = excluded.news_fetch_time,
      news_max_items = excluded.news_max_items,
      news_provider = excluded.news_provider,
      timezone = excluded.timezone,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      userId,
      settings.threadsToken,
      settings.geminiApiKey,
      settings.llmProvider,
      settings.llmModel,
      settings.enableGrounding ? 1 : 0,
      settings.postInstruction,
      settings.postStyle,
      settings.postInstruction,
      settings.postStyle,
      settings.postTime,
      settings.replyTimes.join(","),
      settings.newsEnabled ? 1 : 0,
      settings.newsKeywords.join(","),
      settings.newsFetchTime,
      settings.newsMaxItems,
      settings.newsProvider,
      settings.timezone,
      settings.enabled ? 1 : 0
    )
    .run();
}

async function saveSettingsWithoutNewsProvider(env: Env, userId: number, settings: StoredSettings) {
  await env.DB.prepare(
    `INSERT INTO user_settings (
      user_id,
      threads_token,
      gemini_api_key,
      llm_provider,
      llm_model,
      enable_grounding,
      post_instruction,
      post_style,
      post_preference,
      reply_preference,
      post_time,
      reply_times,
      news_enabled,
      news_keywords,
      news_fetch_time,
      news_max_items,
      timezone,
      enabled,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      threads_token = excluded.threads_token,
      gemini_api_key = excluded.gemini_api_key,
      llm_provider = excluded.llm_provider,
      llm_model = excluded.llm_model,
      enable_grounding = excluded.enable_grounding,
      post_instruction = excluded.post_instruction,
      post_style = excluded.post_style,
      post_preference = excluded.post_preference,
      reply_preference = excluded.reply_preference,
      post_time = excluded.post_time,
      reply_times = excluded.reply_times,
      news_enabled = excluded.news_enabled,
      news_keywords = excluded.news_keywords,
      news_fetch_time = excluded.news_fetch_time,
      news_max_items = excluded.news_max_items,
      timezone = excluded.timezone,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      userId,
      settings.threadsToken,
      settings.geminiApiKey,
      settings.llmProvider,
      settings.llmModel,
      settings.enableGrounding ? 1 : 0,
      settings.postInstruction,
      settings.postStyle,
      settings.postInstruction,
      settings.postStyle,
      settings.postTime,
      settings.replyTimes.join(","),
      settings.newsEnabled ? 1 : 0,
      settings.newsKeywords.join(","),
      settings.newsFetchTime,
      settings.newsMaxItems,
      settings.timezone,
      settings.enabled ? 1 : 0
    )
    .run();
}

async function saveSettingsWithoutNewsColumns(env: Env, userId: number, settings: StoredSettings) {
  await env.DB.prepare(
    `INSERT INTO user_settings (
      user_id,
      threads_token,
      gemini_api_key,
      llm_provider,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      threads_token = excluded.threads_token,
      gemini_api_key = excluded.gemini_api_key,
      llm_provider = excluded.llm_provider,
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
      settings.llmProvider,
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

async function saveSettingsLegacyColumns(env: Env, userId: number, settings: StoredSettings) {
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

export async function saveSettings(env: Env, userId: number, settings: StoredSettings) {
  try {
    await saveSettingsWithAllColumns(env, userId, settings);
    return;
  } catch (error) {
    if (isMissingNewsProviderColumnError(error)) {
      try {
        await saveSettingsWithoutNewsProvider(env, userId, settings);
        return;
      } catch (errorWithoutNewsProvider) {
        if (isMissingNewsColumnError(errorWithoutNewsProvider)) {
          try {
            await saveSettingsWithoutNewsColumns(env, userId, settings);
            return;
          } catch (errorWithoutNews) {
            if (!isMissingProviderColumnError(errorWithoutNews)) {
              throw errorWithoutNews;
            }
            await saveSettingsLegacyColumns(env, userId, settings);
            return;
          }
        }

        if (!isMissingProviderColumnError(errorWithoutNewsProvider)) {
          throw errorWithoutNewsProvider;
        }
        await saveSettingsLegacyColumns(env, userId, settings);
        return;
      }
    }

    if (isMissingNewsColumnError(error)) {
      try {
        await saveSettingsWithoutNewsColumns(env, userId, settings);
        return;
      } catch (errorWithoutNews) {
        if (!isMissingProviderColumnError(errorWithoutNews)) {
          throw errorWithoutNews;
        }
        await saveSettingsLegacyColumns(env, userId, settings);
        return;
      }
    }

    if (!isMissingProviderColumnError(error)) {
      throw error;
    }
  }

  await saveSettingsLegacyColumns(env, userId, settings);
}
