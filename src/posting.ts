import { Env, RunResult, StoredSettings } from "./types";
import { generatePostDraft, generatePostDraftFromContext } from "./gemini";
import { getNewsSnapshot } from "./news-snapshots";
import {
  alreadyPostedToday,
  deletePendingDraft,
  getPendingDraft,
  insertRun,
  listRecentSuccessfulDrafts,
  upsertPendingDraft
} from "./runs";
import { publishToThreads } from "./threads";
import { defaultTimezone, getLocalDateTime, safeErrorMessage, sanitizeTimezone } from "./utils";

function isMissingNewsSnapshotTable(error: unknown) {
  return safeErrorMessage(error).toLowerCase().includes("no such table: news_snapshots");
}

export function resolveRunDate(settings: StoredSettings, env: Env, now = new Date()) {
  const timezone = sanitizeTimezone(settings.timezone, defaultTimezone(env));
  const localNow = getLocalDateTime(now, timezone);
  return localNow.dateKey;
}

export async function createPreviewDraft(
  env: Env,
  userId: number,
  settings: StoredSettings,
  mode: "manual_generate" | "manual_regenerate",
  now = new Date()
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);

  if (!settings.geminiApiKey) {
    const runId = await insertRun(env, userId, mode, runDate, "failed", "缺少 LLM API Key");
    return {
      runId,
      status: "failed",
      message: "缺少 LLM API Key",
      runType: mode,
      runDate
    };
  }

  try {
    const recentDrafts = await listRecentSuccessfulDrafts(env, userId, 12);
    let draft = "";
    let usedNewsSnapshot = false;
    try {
      const snapshot = await getNewsSnapshot(env, userId);
      const snapshotContext = String(snapshot?.contextText || "").trim();
      if (snapshotContext) {
        draft = await generatePostDraftFromContext(settings, runDate, snapshotContext, recentDrafts);
        usedNewsSnapshot = true;
      } else {
        draft = await generatePostDraft(settings, runDate, recentDrafts);
      }
    } catch (error) {
      if (!isMissingNewsSnapshotTable(error)) {
        throw error;
      }
      draft = await generatePostDraft(settings, runDate, recentDrafts);
    }

    await upsertPendingDraft(env, userId, draft, settings);
    const message = usedNewsSnapshot
      ? mode === "manual_regenerate"
        ? "草稿已重新產生（已結合最近抓取新聞）"
        : "草稿已產生（已結合最近抓取新聞）"
      : mode === "manual_regenerate"
        ? "草稿已重新產生"
        : "草稿已產生，請確認後再發出";
    const runId = await insertRun(env, userId, mode, runDate, "success", message, draft);
    return {
      runId,
      status: "success",
      message,
      runType: mode,
      runDate,
      draft
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    const runId = await insertRun(env, userId, mode, runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType: mode,
      runDate
    };
  }
}

export async function publishDraftRun(
  env: Env,
  userId: number,
  settings: StoredSettings,
  runType: string,
  draft: string,
  now = new Date()
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);

  if (!settings.threadsToken || !settings.geminiApiKey) {
    const runId = await insertRun(
      env,
      userId,
      runType,
      runDate,
      "failed",
      "缺少 Threads token 或 LLM API Key"
    );
    return {
      runId,
      status: "failed",
      message: "缺少 Threads token 或 LLM API Key",
      runType,
      runDate
    };
  }

  try {
    const published = await publishToThreads(settings.threadsToken, draft);
    const successMessage = published.username ? `發佈成功 @${published.username}` : "發佈成功";
    const runId = await insertRun(
      env,
      userId,
      runType,
      runDate,
      "success",
      successMessage,
      draft,
      published.threadId
    );
    return {
      runId,
      status: "success",
      message: successMessage,
      threadId: published.threadId,
      runType,
      runDate,
      draft
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    const runId = await insertRun(env, userId, runType, runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType,
      runDate
    };
  }
}

export async function executeScheduledPosting(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now = new Date()
): Promise<RunResult> {
  const timezone = sanitizeTimezone(settings.timezone, defaultTimezone(env));
  const localNow = getLocalDateTime(now, timezone);

  const exists = await alreadyPostedToday(env, userId, localNow.dateKey);
  if (exists) {
    const runId = await insertRun(
      env,
      userId,
      "scheduled",
      localNow.dateKey,
      "skipped",
      "今天已經自動發文，略過"
    );
    return {
      runId,
      status: "skipped",
      message: "今天已經自動發文，略過",
      runType: "scheduled",
      runDate: localNow.dateKey
    };
  }

  const pending = await getPendingDraft(env, userId);
  let draft = pending?.draft || "";

  if (!draft) {
    try {
      const recentDrafts = await listRecentSuccessfulDrafts(env, userId, 12);
      draft = await generatePostDraft(settings, localNow.dateKey, recentDrafts);
    } catch (error) {
      const message = safeErrorMessage(error);
      const runId = await insertRun(env, userId, "scheduled", localNow.dateKey, "failed", message);
      return {
        runId,
        status: "failed",
        message,
        runType: "scheduled",
        runDate: localNow.dateKey
      };
    }
  }

  const result = await publishDraftRun(env, userId, settings, "scheduled", draft, now);
  if (result.status === "success" && pending) {
    await deletePendingDraft(env, userId);
  }
  return result;
}

export async function ensureNextDraftForScheduledWindow(
  env: Env,
  userId: number,
  settings: StoredSettings,
  runDate: string
) {
  const pending = await getPendingDraft(env, userId);
  if (pending?.draft?.trim()) {
    return;
  }

  if (!settings.geminiApiKey) {
    await insertRun(
      env,
      userId,
      "scheduled_prefill",
      runDate,
      "failed",
      "缺少 LLM API Key，無法自動補下一篇草稿"
    );
    return;
  }

  try {
    const recentDrafts = await listRecentSuccessfulDrafts(env, userId, 12);
    const draft = await generatePostDraft(settings, runDate, recentDrafts);
    await upsertPendingDraft(env, userId, draft, settings);
    await insertRun(
      env,
      userId,
      "scheduled_prefill",
      runDate,
      "success",
      "已自動補齊下一篇草稿",
      draft
    );
  } catch (error) {
    await insertRun(
      env,
      userId,
      "scheduled_prefill",
      runDate,
      "failed",
      `自動補草稿失敗：${safeErrorMessage(error)}`
    );
  }
}
