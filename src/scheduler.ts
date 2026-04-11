import { Env, UserSettingsRow } from "./types";
import { executeScheduledPosting, ensureNextDraftForScheduledWindow } from "./posting";
import { collectScheduleTimes } from "./runs";
import { settingsFromRow } from "./settings";
import { getLocalDateTime, shouldTriggerNow } from "./utils";

export async function runScheduledJob(env: Env) {
  const query = await env.DB.prepare(
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
  ).all<UserSettingsRow & { user_id: number }>();

  const users = query.results || [];
  const now = new Date();

  for (const row of users) {
    const settings = settingsFromRow(env, row);

    if (!settings.enabled) {
      continue;
    }

    const localNow = getLocalDateTime(now, settings.timezone);
    const scheduleTimes = collectScheduleTimes(settings);
    const shouldRunAtCurrentMinute = scheduleTimes.some((time) =>
      shouldTriggerNow(localNow.minuteOfDay, time)
    );

    if (!shouldRunAtCurrentMinute) {
      continue;
    }

    await executeScheduledPosting(env, row.user_id, settings, now);
    await ensureNextDraftForScheduledWindow(env, row.user_id, settings, localNow.dateKey);
  }
}
