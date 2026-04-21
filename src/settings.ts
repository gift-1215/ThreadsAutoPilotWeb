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
const MISSING_IMAGE_ENABLED_COLUMN = "no such column: image_enabled";
const STAGE_LLM_COLUMNS = [
  "news_llm_provider",
  "news_llm_model",
  "news_llm_api_key",
  "draft_llm_provider",
  "draft_llm_model",
  "draft_llm_api_key",
  "image_llm_provider",
  "image_llm_model",
  "image_llm_api_key"
] as const;

function isMissingProviderColumnError(error: unknown) {
  return safeErrorMessage(error).toLowerCase().includes(MISSING_PROVIDER_COLUMN);
}

function isMissingNewsProviderColumnError(error: unknown) {
  return safeErrorMessage(error).toLowerCase().includes(MISSING_NEWS_PROVIDER_COLUMN);
}

function isMissingImageEnabledColumnError(error: unknown) {
  return safeErrorMessage(error).toLowerCase().includes(MISSING_IMAGE_ENABLED_COLUMN);
}

function isMissingStageLlmColumnError(error: unknown) {
  const message = safeErrorMessage(error).toLowerCase();
  return STAGE_LLM_COLUMNS.some((column) => message.includes(`no such column: ${column}`));
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
    news_provider: null,
    image_enabled: 0
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
    news_provider: null,
    image_enabled: 0
  };
}

export function defaultSettings(env: Env): StoredSettings {
  const defaultProvider = DEFAULT_LLM_PROVIDER;
  const defaultModel = DEFAULT_LLM_MODEL;
  return {
    threadsToken: "",
    geminiApiKey: "",
    llmProvider: defaultProvider,
    llmModel: defaultModel,
    newsLlmProvider: defaultProvider,
    newsLlmModel: defaultModel,
    newsLlmApiKey: "",
    draftLlmProvider: defaultProvider,
    draftLlmModel: defaultModel,
    draftLlmApiKey: "",
    imageLlmProvider: defaultProvider,
    imageLlmModel: defaultModel,
    imageLlmApiKey: "",
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
    imageEnabled: false,
    timezone: defaultTimezone(env),
    enabled: false
  };
}

export function settingsFromRow(env: Env, row: UserSettingsRow): StoredSettings {
  const defaults = defaultSettings(env);
  const draftLlmProvider = sanitizeLlmProvider(row.draft_llm_provider ?? row.llm_provider);
  const draftLlmModel = sanitizeLlmModel(row.draft_llm_model ?? row.llm_model, draftLlmProvider);
  const draftLlmApiKey = sanitizeText(row.draft_llm_api_key ?? row.gemini_api_key ?? "", 4000);

  const newsLlmProvider = sanitizeLlmProvider(row.news_llm_provider ?? draftLlmProvider);
  const newsLlmModel = sanitizeLlmModel(row.news_llm_model ?? draftLlmModel, newsLlmProvider);
  const newsLlmApiKey = sanitizeText(row.news_llm_api_key ?? draftLlmApiKey, 4000);

  const imageLlmProvider = sanitizeLlmProvider(row.image_llm_provider ?? draftLlmProvider);
  const imageLlmModel = sanitizeLlmModel(row.image_llm_model ?? draftLlmModel, imageLlmProvider);
  const imageLlmApiKey = sanitizeText(row.image_llm_api_key ?? draftLlmApiKey, 4000);

  return {
    threadsToken: row.threads_token || "",
    geminiApiKey: draftLlmApiKey,
    llmProvider: draftLlmProvider,
    llmModel: draftLlmModel,
    newsLlmProvider,
    newsLlmModel,
    newsLlmApiKey,
    draftLlmProvider,
    draftLlmModel,
    draftLlmApiKey,
    imageLlmProvider,
    imageLlmModel,
    imageLlmApiKey,
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
    imageEnabled: Number(row.image_enabled || 0) === 1,
    timezone: sanitizeTimezone(row.timezone, defaultTimezone(env)),
    enabled: Number(row.enabled) === 1
  };
}

async function getImageEnabledFlag(env: Env, userId: number) {
  try {
    const row = await env.DB.prepare(
      `SELECT image_enabled
       FROM user_settings
       WHERE user_id = ?
       LIMIT 1`
    )
      .bind(userId)
      .first<{ image_enabled: number | null }>();
    return Number(row?.image_enabled || 0) === 1;
  } catch (error) {
    if (isMissingImageEnabledColumnError(error)) {
      return false;
    }
    throw error;
  }
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

async function enrichStageLlmColumns(env: Env, userId: number, row: UserSettingsRow) {
  try {
    const stageRow = await env.DB.prepare(
      `SELECT
        news_llm_provider,
        news_llm_model,
        news_llm_api_key,
        draft_llm_provider,
        draft_llm_model,
        draft_llm_api_key,
        image_llm_provider,
        image_llm_model,
        image_llm_api_key
       FROM user_settings
       WHERE user_id = ?
       LIMIT 1`
    )
      .bind(userId)
      .first<Pick<
        UserSettingsRow,
        | "news_llm_provider"
        | "news_llm_model"
        | "news_llm_api_key"
        | "draft_llm_provider"
        | "draft_llm_model"
        | "draft_llm_api_key"
        | "image_llm_provider"
        | "image_llm_model"
        | "image_llm_api_key"
      >>();
    return stageRow ? { ...row, ...stageRow } : row;
  } catch (error) {
    if (isMissingStageLlmColumnError(error)) {
      return row;
    }
    throw error;
  }
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

  row = await enrichStageLlmColumns(env, userId, row);

  const settings = settingsFromRow(env, row);
  settings.imageEnabled = await getImageEnabledFlag(env, userId);
  return settings;
}

export function normalizeIncomingSettings(env: Env, payload: Record<string, unknown>): StoredSettings {
  const draftLlmProvider = sanitizeLlmProvider(payload.draftLlmProvider ?? payload.llmProvider);
  const draftLlmModel = sanitizeLlmModel(payload.draftLlmModel ?? payload.llmModel, draftLlmProvider);
  const draftLlmApiKey = sanitizeText(
    payload.draftLlmApiKey ?? payload.geminiApiKey ?? payload.llmApiKey,
    4000
  );

  const newsLlmProvider = sanitizeLlmProvider(payload.newsLlmProvider ?? draftLlmProvider);
  const newsLlmModel = sanitizeLlmModel(payload.newsLlmModel, newsLlmProvider);
  const newsLlmApiKey = sanitizeText(payload.newsLlmApiKey ?? draftLlmApiKey, 4000);

  const imageLlmProvider = sanitizeLlmProvider(payload.imageLlmProvider ?? draftLlmProvider);
  const imageLlmModel = sanitizeLlmModel(payload.imageLlmModel, imageLlmProvider);
  const imageLlmApiKey = sanitizeText(payload.imageLlmApiKey ?? draftLlmApiKey, 4000);

  return {
    threadsToken: sanitizeText(payload.threadsToken, 4000),
    geminiApiKey: draftLlmApiKey,
    llmProvider: draftLlmProvider,
    llmModel: draftLlmModel,
    newsLlmProvider,
    newsLlmModel,
    newsLlmApiKey,
    draftLlmProvider,
    draftLlmModel,
    draftLlmApiKey,
    imageLlmProvider,
    imageLlmModel,
    imageLlmApiKey,
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
    imageEnabled: parseBoolean(payload.imageEnabled),
    timezone: sanitizeTimezone(payload.timezone, defaultTimezone(env)),
    enabled: parseBoolean(payload.enabled)
  };
}

async function saveImageEnabledFlag(env: Env, userId: number, imageEnabled: boolean) {
  try {
    await env.DB.prepare(
      `UPDATE user_settings
       SET image_enabled = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    )
      .bind(imageEnabled ? 1 : 0, userId)
      .run();
  } catch (error) {
    if (isMissingImageEnabledColumnError(error)) {
      return;
    }
    throw error;
  }
}

async function saveStageLlmColumns(env: Env, userId: number, settings: StoredSettings) {
  try {
    await env.DB.prepare(
      `UPDATE user_settings
       SET
         news_llm_provider = ?,
         news_llm_model = ?,
         news_llm_api_key = ?,
         draft_llm_provider = ?,
         draft_llm_model = ?,
         draft_llm_api_key = ?,
         image_llm_provider = ?,
         image_llm_model = ?,
         image_llm_api_key = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    )
      .bind(
        settings.newsLlmProvider,
        settings.newsLlmModel,
        settings.newsLlmApiKey,
        settings.draftLlmProvider,
        settings.draftLlmModel,
        settings.draftLlmApiKey,
        settings.imageLlmProvider,
        settings.imageLlmModel,
        settings.imageLlmApiKey,
        userId
      )
      .run();
  } catch (error) {
    if (isMissingStageLlmColumnError(error)) {
      return;
    }
    throw error;
  }
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
    await saveImageEnabledFlag(env, userId, settings.imageEnabled);
    await saveStageLlmColumns(env, userId, settings);
    return;
  } catch (error) {
    if (isMissingNewsProviderColumnError(error)) {
      try {
        await saveSettingsWithoutNewsProvider(env, userId, settings);
        await saveImageEnabledFlag(env, userId, settings.imageEnabled);
        await saveStageLlmColumns(env, userId, settings);
        return;
      } catch (errorWithoutNewsProvider) {
        if (isMissingNewsColumnError(errorWithoutNewsProvider)) {
          try {
            await saveSettingsWithoutNewsColumns(env, userId, settings);
            await saveImageEnabledFlag(env, userId, settings.imageEnabled);
            await saveStageLlmColumns(env, userId, settings);
            return;
          } catch (errorWithoutNews) {
            if (!isMissingProviderColumnError(errorWithoutNews)) {
              throw errorWithoutNews;
            }
            await saveSettingsLegacyColumns(env, userId, settings);
            await saveImageEnabledFlag(env, userId, settings.imageEnabled);
            await saveStageLlmColumns(env, userId, settings);
            return;
          }
        }

        if (!isMissingProviderColumnError(errorWithoutNewsProvider)) {
          throw errorWithoutNewsProvider;
        }
        await saveSettingsLegacyColumns(env, userId, settings);
        await saveImageEnabledFlag(env, userId, settings.imageEnabled);
        await saveStageLlmColumns(env, userId, settings);
        return;
      }
    }

    if (isMissingNewsColumnError(error)) {
      try {
        await saveSettingsWithoutNewsColumns(env, userId, settings);
        await saveImageEnabledFlag(env, userId, settings.imageEnabled);
        await saveStageLlmColumns(env, userId, settings);
        return;
      } catch (errorWithoutNews) {
        if (!isMissingProviderColumnError(errorWithoutNews)) {
          throw errorWithoutNews;
        }
        await saveSettingsLegacyColumns(env, userId, settings);
        await saveImageEnabledFlag(env, userId, settings.imageEnabled);
        await saveStageLlmColumns(env, userId, settings);
        return;
      }
    }

    if (!isMissingProviderColumnError(error)) {
      throw error;
    }
  }

  await saveSettingsLegacyColumns(env, userId, settings);
  await saveImageEnabledFlag(env, userId, settings.imageEnabled);
  await saveStageLlmColumns(env, userId, settings);
}
