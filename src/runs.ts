import { Env, PendingDraftRow, RunRow, StoredSettings } from "./types";
import { randomId, sanitizeLlmModel } from "./utils";

const MAX_RUN_HISTORY = 30;
const MISSING_PENDING_IMAGE_URL_COLUMN = "no such column: image_url";
const MISSING_PENDING_IMAGE_PROMPT_COLUMN = "no such column: image_prompt";

function isMissingPendingImageColumn(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return (
    message.includes(MISSING_PENDING_IMAGE_URL_COLUMN) ||
    message.includes(MISSING_PENDING_IMAGE_PROMPT_COLUMN)
  );
}

async function enforceRunRetention(env: Env, userId: number) {
  await env.DB.prepare(
    `DELETE FROM post_runs
     WHERE user_id = ?
       AND id NOT IN (
         SELECT id
         FROM post_runs
         WHERE user_id = ?
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT ?
       )`
  )
    .bind(userId, userId, MAX_RUN_HISTORY)
    .run();
}

export async function listRuns(env: Env, userId: number, limit = 20) {
  await enforceRunRetention(env, userId);
  const safeLimit = Math.min(MAX_RUN_HISTORY, Math.max(1, Number(limit) || 20));
  const query = await env.DB.prepare(
    `SELECT id, run_type, run_date, status, message, thread_id, created_at
     FROM post_runs
     WHERE user_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
  )
    .bind(userId, safeLimit)
    .all<RunRow>();

  return query.results || [];
}

export async function listRecentSuccessfulDrafts(env: Env, userId: number, limit = 12) {
  const safeLimit = Math.min(MAX_RUN_HISTORY, Math.max(1, Number(limit) || 12));
  const query = await env.DB.prepare(
    `SELECT draft
     FROM post_runs
     WHERE user_id = ?
       AND status = 'success'
       AND draft IS NOT NULL
       AND trim(draft) <> ''
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ?`
  )
    .bind(userId, safeLimit)
    .all<{ draft: string | null }>();

  return (query.results || [])
    .map((row) => String(row.draft || "").trim())
    .filter(Boolean);
}

export async function deleteRuns(env: Env, userId: number) {
  const result = await env.DB.prepare("DELETE FROM post_runs WHERE user_id = ?").bind(userId).run();
  return Number(result.meta?.changes || 0);
}

export async function getPendingDraft(env: Env, userId: number) {
  try {
    return await env.DB.prepare(
      `SELECT user_id, draft, llm_model, enable_grounding, image_url, image_prompt, created_at, updated_at
       FROM pending_drafts
       WHERE user_id = ?
       LIMIT 1`
    )
      .bind(userId)
      .first<PendingDraftRow>();
  } catch (error) {
    if (!isMissingPendingImageColumn(error)) {
      throw error;
    }
    const legacy = await env.DB.prepare(
      `SELECT user_id, draft, llm_model, enable_grounding, created_at, updated_at
       FROM pending_drafts
       WHERE user_id = ?
       LIMIT 1`
    )
      .bind(userId)
      .first<Omit<PendingDraftRow, "image_url" | "image_prompt">>();
    if (!legacy) {
      return null;
    }
    return {
      ...legacy,
      image_url: null,
      image_prompt: null
    };
  }
}

export async function upsertPendingDraft(
  env: Env,
  userId: number,
  draft: string,
  settings: StoredSettings,
  options: { imageUrl?: string | null; imagePrompt?: string | null } = {}
) {
  const safeImageUrl = String(options.imageUrl || "").trim();
  const safeImagePrompt = String(options.imagePrompt || "").trim();

  try {
    await env.DB.prepare(
      `INSERT INTO pending_drafts (
        user_id,
        draft,
        llm_model,
        enable_grounding,
        image_url,
        image_prompt,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        draft = excluded.draft,
        llm_model = excluded.llm_model,
        enable_grounding = excluded.enable_grounding,
        image_url = excluded.image_url,
        image_prompt = excluded.image_prompt,
        updated_at = CURRENT_TIMESTAMP`
    )
      .bind(
        userId,
        draft,
        sanitizeLlmModel(settings.llmModel, settings.llmProvider),
        settings.enableGrounding ? 1 : 0,
        safeImageUrl || null,
        safeImagePrompt || null
      )
      .run();
  } catch (error) {
    if (!isMissingPendingImageColumn(error)) {
      throw error;
    }
    await env.DB.prepare(
      `INSERT INTO pending_drafts (
        user_id,
        draft,
        llm_model,
        enable_grounding,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        draft = excluded.draft,
        llm_model = excluded.llm_model,
        enable_grounding = excluded.enable_grounding,
        updated_at = CURRENT_TIMESTAMP`
    )
      .bind(
        userId,
        draft,
        sanitizeLlmModel(settings.llmModel, settings.llmProvider),
        settings.enableGrounding ? 1 : 0
      )
      .run();
  }
}

export async function deletePendingDraft(env: Env, userId: number) {
  await env.DB.prepare("DELETE FROM pending_drafts WHERE user_id = ?").bind(userId).run();
}

export async function insertRun(
  env: Env,
  userId: number,
  runType: string,
  runDate: string,
  status: "success" | "failed" | "skipped",
  message: string,
  draft = "",
  threadId = ""
) {
  const runId = randomId(18);
  await env.DB.prepare(
    `INSERT INTO post_runs (id, user_id, run_type, run_date, status, message, thread_id, draft)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      runId,
      userId,
      runType,
      runDate,
      status,
      message.slice(0, 1200),
      threadId || null,
      draft || null
    )
    .run();
  await enforceRunRetention(env, userId);
  return runId;
}

export async function alreadyPostedToday(env: Env, userId: number, runDate: string) {
  const row = await env.DB.prepare(
    `SELECT id
     FROM post_runs
     WHERE user_id = ?
       AND run_type = 'scheduled'
       AND run_date = ?
       AND status = 'success'
     LIMIT 1`
  )
    .bind(userId, runDate)
    .first<{ id: string }>();

  return Boolean(row?.id);
}
