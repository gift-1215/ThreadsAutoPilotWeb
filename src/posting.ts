import { Env, RunResult, StoredSettings } from "./types";
import { generatePostDraft, generatePostDraftFromContext } from "./gemini";
import { generateDraftImageAsset } from "./images";
import { resolveStageLlmSettings } from "./llm-stage-settings";
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
  const draftLlmSettings = resolveStageLlmSettings(settings, "draft");

  if (!draftLlmSettings.geminiApiKey) {
    const runId = await insertRun(env, userId, mode, runDate, "failed", "缺少文字草稿 LLM API Key");
    return {
      runId,
      status: "failed",
      message: "缺少文字草稿 LLM API Key",
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
        draft = await generatePostDraftFromContext(
          draftLlmSettings,
          runDate,
          snapshotContext,
          recentDrafts
        );
        usedNewsSnapshot = true;
      } else {
        draft = await generatePostDraft(draftLlmSettings, runDate, recentDrafts);
      }
    } catch (error) {
      if (!isMissingNewsSnapshotTable(error)) {
        throw error;
      }
      draft = await generatePostDraft(draftLlmSettings, runDate, recentDrafts);
    }

    await upsertPendingDraft(env, userId, draft, draftLlmSettings, {
      imageUrl: "",
      imagePrompt: ""
    });
    const message = usedNewsSnapshot
      ? "草稿已產生（已結合最近抓取新聞）"
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
  imageUrl = "",
  now = new Date()
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);

  if (!settings.threadsToken) {
    const runId = await insertRun(
      env,
      userId,
      runType,
      runDate,
      "failed",
      "缺少 Threads token"
    );
    return {
      runId,
      status: "failed",
      message: "缺少 Threads token",
      runType,
      runDate
    };
  }

  try {
    const published = await publishToThreads(settings.threadsToken, draft, imageUrl);
    const hasImage = Boolean(String(imageUrl || "").trim());
    const successMessage = published.username
      ? `發佈成功 @${published.username}${hasImage ? "（含圖片）" : ""}`
      : hasImage
        ? "發佈成功（含圖片）"
        : "發佈成功";
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
  let imageUrl = String(pending?.image_url || "").trim();
  const draftLlmSettings = resolveStageLlmSettings(settings, "draft");
  const imageLlmSettings = resolveStageLlmSettings(settings, "image");

  if (!draft) {
    try {
      if (!draftLlmSettings.geminiApiKey) {
        throw new Error("缺少文字草稿 LLM API Key");
      }
      const recentDrafts = await listRecentSuccessfulDrafts(env, userId, 12);
      draft = await generatePostDraft(draftLlmSettings, localNow.dateKey, recentDrafts);
      if (settings.imageEnabled && !imageUrl && imageLlmSettings.geminiApiKey) {
        try {
          const image = await generateDraftImageAsset(imageLlmSettings, draft, localNow.dateKey);
          imageUrl = image.imageUrl;
        } catch {
          // 若排程臨時生成圖片失敗，仍繼續發佈文字草稿
        }
      }
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

  const result = await publishDraftRun(env, userId, settings, "scheduled", draft, imageUrl, now);
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

  try {
    const draftLlmSettings = resolveStageLlmSettings(settings, "draft");
    const imageLlmSettings = resolveStageLlmSettings(settings, "image");
    if (!draftLlmSettings.geminiApiKey) {
      await insertRun(
        env,
        userId,
        "scheduled_prefill",
        runDate,
        "failed",
        "缺少文字草稿 LLM API Key，無法自動補下一篇草稿"
      );
      return;
    }
    const recentDrafts = await listRecentSuccessfulDrafts(env, userId, 12);
    const draft = await generatePostDraft(draftLlmSettings, runDate, recentDrafts);
    let imageUrl = "";
    let imagePrompt = "";
    let imageError = "";
    if (settings.imageEnabled && imageLlmSettings.geminiApiKey) {
      try {
        const image = await generateDraftImageAsset(imageLlmSettings, draft, runDate);
        imageUrl = image.imageUrl;
        imagePrompt = image.imagePrompt;
      } catch (error) {
        imageError = safeErrorMessage(error);
      }
    }
    await upsertPendingDraft(env, userId, draft, draftLlmSettings, {
      imageUrl,
      imagePrompt
    });
    await insertRun(
      env,
      userId,
      "scheduled_prefill",
      runDate,
      "success",
      imageUrl ? "已自動補齊下一篇草稿（含配圖）" : `已自動補齊下一篇草稿${imageError ? `（配圖失敗：${imageError}）` : ""}`,
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

export async function generatePendingDraftImage(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now = new Date()
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);
  const pending = await getPendingDraft(env, userId);
  const draft = String(pending?.draft || "").trim();
  if (!draft) {
    const message = "目前沒有可生成配圖的草稿，請先產生文字草稿。";
    const runId = await insertRun(env, userId, "manual_generate_image", runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType: "manual_generate_image",
      runDate
    };
  }

  const imageLlmSettings = resolveStageLlmSettings(settings, "image");
  if (!imageLlmSettings.geminiApiKey) {
    const message = "缺少圖片 LLM API Key，無法生成新聞圖片。";
    const runId = await insertRun(env, userId, "manual_generate_image", runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType: "manual_generate_image",
      runDate
    };
  }

  try {
    const image = await generateDraftImageAsset(imageLlmSettings, draft, runDate);
    const draftLlmSettings = resolveStageLlmSettings(settings, "draft");
    await upsertPendingDraft(env, userId, draft, draftLlmSettings, {
      imageUrl: image.imageUrl,
      imagePrompt: image.imagePrompt
    });
    const message = "已生成新聞圖片，可直接隨草稿發佈。";
    const runId = await insertRun(
      env,
      userId,
      "manual_generate_image",
      runDate,
      "success",
      message,
      draft
    );
    return {
      runId,
      status: "success",
      message,
      runType: "manual_generate_image",
      runDate,
      draft
    };
  } catch (error) {
    const message = `生成新聞圖片失敗：${safeErrorMessage(error)}`;
    const runId = await insertRun(env, userId, "manual_generate_image", runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType: "manual_generate_image",
      runDate
    };
  }
}
