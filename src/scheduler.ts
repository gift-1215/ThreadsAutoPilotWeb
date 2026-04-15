import { executeScheduledPosting, ensureNextDraftForScheduledWindow } from "./posting";
import { executeScheduledNewsPrefill } from "./news";
import { executeScheduledReplySweep } from "./replies";
import { settingsFromRow } from "./settings";
import { Env, UserSettingsRow } from "./types";
import { getLocalDateTime, safeErrorMessage, shouldTriggerNow } from "./utils";

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

type SchedulerUserRow = UserSettingsRow & { user_id: number };

function withDefaultNewsFields(
  row: Omit<
    SchedulerUserRow,
    "news_enabled" | "news_keywords" | "news_fetch_time" | "news_max_items" | "news_provider"
  >
): SchedulerUserRow {
  return {
    ...row,
    news_enabled: 0,
    news_keywords: "",
    news_fetch_time: "08:00",
    news_max_items: 5,
    news_provider: null
  };
}

function withDefaultProviderAndNewsFields(
  row: Omit<
    SchedulerUserRow,
    | "llm_provider"
    | "news_enabled"
    | "news_keywords"
    | "news_fetch_time"
    | "news_max_items"
    | "news_provider"
  >
): SchedulerUserRow {
  return {
    ...row,
    llm_provider: null,
    news_enabled: 0,
    news_keywords: "",
    news_fetch_time: "08:00",
    news_max_items: 5,
    news_provider: null
  };
}

async function loadSchedulerUsers(env: Env): Promise<SchedulerUserRow[]> {
  try {
    const query = await env.DB.prepare(
      `SELECT
        u.id AS user_id,
        s.threads_token AS threads_token,
        s.gemini_api_key AS gemini_api_key,
        s.llm_provider AS llm_provider,
        s.llm_model AS llm_model,
        s.enable_grounding AS enable_grounding,
        s.post_instruction AS post_instruction,
        s.post_style AS post_style,
        s.post_preference AS post_preference,
        s.reply_preference AS reply_preference,
        s.post_time AS post_time,
        s.reply_times AS reply_times,
        s.news_enabled AS news_enabled,
        s.news_keywords AS news_keywords,
        s.news_fetch_time AS news_fetch_time,
        s.news_max_items AS news_max_items,
        s.news_provider AS news_provider,
        s.timezone AS timezone,
        s.enabled AS enabled
      FROM users u
      JOIN user_settings s ON s.user_id = u.id
      WHERE s.enabled = 1`
    ).all<SchedulerUserRow>();

    return query.results || [];
  } catch (error) {
    if (isMissingNewsProviderColumnError(error)) {
      try {
        const queryWithoutNewsProvider = await env.DB.prepare(
          `SELECT
            u.id AS user_id,
            s.threads_token AS threads_token,
            s.gemini_api_key AS gemini_api_key,
            s.llm_provider AS llm_provider,
            s.llm_model AS llm_model,
            s.enable_grounding AS enable_grounding,
            s.post_instruction AS post_instruction,
            s.post_style AS post_style,
            s.post_preference AS post_preference,
            s.reply_preference AS reply_preference,
            s.post_time AS post_time,
            s.reply_times AS reply_times,
            s.news_enabled AS news_enabled,
            s.news_keywords AS news_keywords,
            s.news_fetch_time AS news_fetch_time,
            s.news_max_items AS news_max_items,
            s.timezone AS timezone,
            s.enabled AS enabled
          FROM users u
          JOIN user_settings s ON s.user_id = u.id
          WHERE s.enabled = 1`
        ).all<Omit<SchedulerUserRow, "news_provider">>();

        return (queryWithoutNewsProvider.results || []).map((row) => ({
          ...row,
          news_provider: null
        }));
      } catch (errorWithoutNewsProvider) {
        if (isMissingNewsColumnError(errorWithoutNewsProvider)) {
          const queryWithoutNews = await env.DB.prepare(
            `SELECT
              u.id AS user_id,
              s.threads_token AS threads_token,
              s.gemini_api_key AS gemini_api_key,
              s.llm_provider AS llm_provider,
              s.llm_model AS llm_model,
              s.enable_grounding AS enable_grounding,
              s.post_instruction AS post_instruction,
              s.post_style AS post_style,
              s.post_preference AS post_preference,
              s.reply_preference AS reply_preference,
              s.post_time AS post_time,
              s.reply_times AS reply_times,
              s.timezone AS timezone,
              s.enabled AS enabled
            FROM users u
            JOIN user_settings s ON s.user_id = u.id
            WHERE s.enabled = 1`
          ).all<
            Omit<SchedulerUserRow, "news_enabled" | "news_keywords" | "news_fetch_time" | "news_max_items" | "news_provider">
          >();

          return (queryWithoutNews.results || []).map(withDefaultNewsFields);
        }

        if (!isMissingProviderColumnError(errorWithoutNewsProvider)) {
          throw errorWithoutNewsProvider;
        }

        const legacyQuery = await env.DB.prepare(
          `SELECT
            u.id AS user_id,
            s.threads_token AS threads_token,
            s.gemini_api_key AS gemini_api_key,
            s.llm_model AS llm_model,
            s.enable_grounding AS enable_grounding,
            s.post_instruction AS post_instruction,
            s.post_style AS post_style,
            s.post_preference AS post_preference,
            s.reply_preference AS reply_preference,
            s.post_time AS post_time,
            s.reply_times AS reply_times,
            s.timezone AS timezone,
            s.enabled AS enabled
          FROM users u
          JOIN user_settings s ON s.user_id = u.id
          WHERE s.enabled = 1`
        ).all<
          Omit<
            SchedulerUserRow,
            "llm_provider" | "news_enabled" | "news_keywords" | "news_fetch_time" | "news_max_items" | "news_provider"
          >
        >();

        return (legacyQuery.results || []).map(withDefaultProviderAndNewsFields);
      }
    }

    if (isMissingNewsColumnError(error)) {
      try {
        const queryWithoutNews = await env.DB.prepare(
          `SELECT
            u.id AS user_id,
            s.threads_token AS threads_token,
            s.gemini_api_key AS gemini_api_key,
            s.llm_provider AS llm_provider,
            s.llm_model AS llm_model,
            s.enable_grounding AS enable_grounding,
            s.post_instruction AS post_instruction,
            s.post_style AS post_style,
            s.post_preference AS post_preference,
            s.reply_preference AS reply_preference,
            s.post_time AS post_time,
            s.reply_times AS reply_times,
            s.timezone AS timezone,
            s.enabled AS enabled
          FROM users u
          JOIN user_settings s ON s.user_id = u.id
          WHERE s.enabled = 1`
        ).all<
          Omit<
            SchedulerUserRow,
            "news_enabled" | "news_keywords" | "news_fetch_time" | "news_max_items" | "news_provider"
          >
        >();

        return (queryWithoutNews.results || []).map(withDefaultNewsFields);
      } catch (errorWithoutNews) {
        if (!isMissingProviderColumnError(errorWithoutNews)) {
          throw errorWithoutNews;
        }

        const legacyQuery = await env.DB.prepare(
          `SELECT
            u.id AS user_id,
            s.threads_token AS threads_token,
            s.gemini_api_key AS gemini_api_key,
            s.llm_model AS llm_model,
            s.enable_grounding AS enable_grounding,
            s.post_instruction AS post_instruction,
            s.post_style AS post_style,
            s.post_preference AS post_preference,
            s.reply_preference AS reply_preference,
            s.post_time AS post_time,
            s.reply_times AS reply_times,
            s.timezone AS timezone,
            s.enabled AS enabled
          FROM users u
          JOIN user_settings s ON s.user_id = u.id
          WHERE s.enabled = 1`
        ).all<
          Omit<
            SchedulerUserRow,
            | "llm_provider"
            | "news_enabled"
            | "news_keywords"
            | "news_fetch_time"
            | "news_max_items"
            | "news_provider"
          >
        >();

        return (legacyQuery.results || []).map(withDefaultProviderAndNewsFields);
      }
    }

    if (isMissingProviderColumnError(error)) {
      const legacyQuery = await env.DB.prepare(
        `SELECT
          u.id AS user_id,
          s.threads_token AS threads_token,
          s.gemini_api_key AS gemini_api_key,
          s.llm_model AS llm_model,
          s.enable_grounding AS enable_grounding,
          s.post_instruction AS post_instruction,
          s.post_style AS post_style,
          s.post_preference AS post_preference,
          s.reply_preference AS reply_preference,
          s.post_time AS post_time,
          s.reply_times AS reply_times,
          s.timezone AS timezone,
          s.enabled AS enabled
        FROM users u
        JOIN user_settings s ON s.user_id = u.id
        WHERE s.enabled = 1`
      ).all<
        Omit<
          SchedulerUserRow,
          | "llm_provider"
          | "news_enabled"
          | "news_keywords"
          | "news_fetch_time"
          | "news_max_items"
          | "news_provider"
        >
      >();

      return (legacyQuery.results || []).map(withDefaultProviderAndNewsFields);
    }

    throw error;
  }
}

export async function runScheduledJob(env: Env) {
  const users = await loadSchedulerUsers(env);
  const now = new Date();

  for (const row of users) {
    const settings = settingsFromRow(env, row);

    if (!settings.enabled) {
      continue;
    }

    const localNow = getLocalDateTime(now, settings.timezone);
    const shouldRunPostingAtCurrentMinute = shouldTriggerNow(localNow.minuteOfDay, settings.postTime);
    const shouldRunReplySweepAtCurrentMinute = settings.replyTimes.some((time) =>
      shouldTriggerNow(localNow.minuteOfDay, time)
    );
    const shouldRunNewsPrefillAtCurrentMinute =
      settings.newsEnabled &&
      settings.newsKeywords.length > 0 &&
      shouldTriggerNow(localNow.minuteOfDay, settings.newsFetchTime);

    if (
      !shouldRunPostingAtCurrentMinute &&
      !shouldRunReplySweepAtCurrentMinute &&
      !shouldRunNewsPrefillAtCurrentMinute
    ) {
      continue;
    }

    if (shouldRunPostingAtCurrentMinute) {
      await executeScheduledPosting(env, row.user_id, settings, now);
      await ensureNextDraftForScheduledWindow(env, row.user_id, settings, localNow.dateKey);
    }

    if (shouldRunReplySweepAtCurrentMinute) {
      await executeScheduledReplySweep(env, row.user_id, settings, now);
    }

    if (shouldRunNewsPrefillAtCurrentMinute) {
      await executeScheduledNewsPrefill(env, row.user_id, settings, now);
    }
  }
}
