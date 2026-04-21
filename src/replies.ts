import { Env, RunResult, StoredSettings } from "./types";
import { generateCommentReply } from "./gemini";
import { resolveStageLlmSettings } from "./llm-stage-settings";
import { insertRun } from "./runs";
import {
  fetchRecentThreads,
  fetchThreadReplies,
  fetchThreadsMe,
  publishReplyToThread
} from "./threads";
import { defaultTimezone, getLocalDateTime, safeErrorMessage, sanitizeTimezone } from "./utils";

const RECENT_POST_SCAN_LIMIT = 3;
const MAX_REPLIES_PER_SWEEP = 6;
type ReplySweepRunType = "scheduled_reply_scan" | "manual_reply_scan";

interface PendingComment {
  postId: string;
  postText: string;
  commentId: string;
  commentText: string;
}

function normalizeUsername(value: string) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function resolveRunDate(settings: StoredSettings, env: Env, now = new Date()) {
  const timezone = sanitizeTimezone(settings.timezone, defaultTimezone(env));
  const localNow = getLocalDateTime(now, timezone);
  return localNow.dateKey;
}

async function collectPendingComments(settings: StoredSettings) {
  const me = await fetchThreadsMe(settings.threadsToken);
  const myUsername = normalizeUsername(me.username);
  const posts = await fetchRecentThreads(settings.threadsToken, RECENT_POST_SCAN_LIMIT);

  const pending: PendingComment[] = [];
  let scannedCommentCount = 0;

  for (const post of posts) {
    const replies = await fetchThreadReplies(settings.threadsToken, post.id, 100);
    const ownerReplyTargets = new Set(
      replies
        .filter((reply) => normalizeUsername(reply.username) === myUsername)
        .map((reply) => reply.replyToId)
        .filter(Boolean)
    );

    const topLevelComments = replies.filter((reply) => {
      const isFromMe = normalizeUsername(reply.username) === myUsername;
      const isTopLevel = !reply.replyToId || reply.replyToId === post.id;
      return !isFromMe && isTopLevel;
    });

    scannedCommentCount += topLevelComments.length;

    for (const comment of topLevelComments) {
      if (ownerReplyTargets.has(comment.id)) {
        continue;
      }

      const nestedReplies = await fetchThreadReplies(settings.threadsToken, comment.id, 50).catch(() => []);
      const hasOwnerNestedReply = nestedReplies.some(
        (reply) => normalizeUsername(reply.username) === myUsername
      );

      if (!hasOwnerNestedReply) {
        pending.push({
          postId: post.id,
          postText: post.text,
          commentId: comment.id,
          commentText: comment.text
        });
      }
    }
  }

  return {
    posts,
    pending,
    scannedCommentCount
  };
}

async function executeReplySweep(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now: Date,
  runType: ReplySweepRunType
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);

  if (!settings.threadsToken) {
    const runId = await insertRun(
      env,
      userId,
      runType,
      runDate,
      "failed",
      "缺少 Threads token，無法掃描近期貼文留言"
    );
    return {
      runId,
      status: "failed",
      message: "缺少 Threads token，無法掃描近期貼文留言",
      runType,
      runDate
    };
  }

  try {
    const { posts, pending, scannedCommentCount } = await collectPendingComments(settings);
    const draftLlmSettings = resolveStageLlmSettings(settings, "draft");

    if (posts.length === 0) {
      const runId = await insertRun(
        env,
        userId,
        runType,
        runDate,
        "skipped",
        "掃描最近 3 篇貼文：找不到可檢查的貼文"
      );
      return {
        runId,
        status: "skipped",
        message: "掃描最近 3 篇貼文：找不到可檢查的貼文",
        runType,
        runDate
      };
    }

    if (pending.length === 0) {
      const runId = await insertRun(
        env,
        userId,
        runType,
        runDate,
        "skipped",
        `已用 Threads token 掃描最近 ${Math.min(posts.length, RECENT_POST_SCAN_LIMIT)} 篇貼文，共 ${scannedCommentCount} 則留言，皆已回覆`
      );
      return {
        runId,
        status: "skipped",
        message: `已用 Threads token 掃描最近 ${Math.min(posts.length, RECENT_POST_SCAN_LIMIT)} 篇貼文，共 ${scannedCommentCount} 則留言，皆已回覆`,
        runType,
        runDate
      };
    }

    if (!draftLlmSettings.geminiApiKey) {
      const message = `已用 Threads token 掃描最近 ${Math.min(posts.length, RECENT_POST_SCAN_LIMIT)} 篇貼文，發現 ${pending.length} 則未回覆留言，但缺少 LLM API Key 無法自動回覆`;
      const runId = await insertRun(
        env,
        userId,
        runType,
        runDate,
        "failed",
        message
      );
      return {
        runId,
        status: "failed",
        message,
        runType,
        runDate
      };
    }

    const replyTargets = pending.slice(0, MAX_REPLIES_PER_SWEEP);
    let repliedCount = 0;
    let failedCount = 0;
    let firstFailureReason = "";

    for (const target of replyTargets) {
      try {
        const replyText = await generateCommentReply(
          draftLlmSettings,
          target.postText,
          target.commentText
        );
        await publishReplyToThread(settings.threadsToken, target.commentId, replyText);
        repliedCount += 1;
      } catch (error) {
        failedCount += 1;
        if (!firstFailureReason) {
          firstFailureReason = safeErrorMessage(error);
        }
      }
    }

    const queuedCount = Math.max(0, pending.length - replyTargets.length);
    const baseMessage = [
      `已用 Threads token 掃描最近 ${Math.min(posts.length, RECENT_POST_SCAN_LIMIT)} 篇貼文`,
      `留言 ${scannedCommentCount} 則`,
      `待回覆 ${pending.length} 則`,
      `本輪成功回覆 ${repliedCount} 則`,
      failedCount > 0 ? `失敗 ${failedCount} 則` : "",
      queuedCount > 0 ? `其餘 ${queuedCount} 則留待下輪` : "",
      firstFailureReason ? `首個錯誤：${firstFailureReason.slice(0, 180)}` : ""
    ]
      .filter(Boolean)
      .join("，");

    const status: "success" | "failed" = failedCount > 0 ? "failed" : "success";
    const runId = await insertRun(env, userId, runType, runDate, status, baseMessage);
    return {
      runId,
      status,
      message: baseMessage,
      runType,
      runDate
    };
  } catch (error) {
    const message = `留言掃描失敗：${safeErrorMessage(error)}`;
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

export async function executeScheduledReplySweep(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now = new Date()
): Promise<RunResult> {
  return executeReplySweep(env, userId, settings, now, "scheduled_reply_scan");
}

export async function executeManualReplySweep(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now = new Date()
): Promise<RunResult> {
  return executeReplySweep(env, userId, settings, now, "manual_reply_scan");
}
