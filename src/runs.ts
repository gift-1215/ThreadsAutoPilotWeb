import { Env, PendingDraftRow, RunRow, StoredSettings } from "./types";
import { randomId, sanitizeLlmModel } from "./utils";

const MAX_RUN_HISTORY = 30;

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

export async function deleteRuns(env: Env, userId: number) {
  const result = await env.DB.prepare("DELETE FROM post_runs WHERE user_id = ?").bind(userId).run();
  return Number(result.meta?.changes || 0);
}

export async function getPendingDraft(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT user_id, draft, llm_model, enable_grounding, created_at, updated_at
     FROM pending_drafts
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<PendingDraftRow>();
}

export async function upsertPendingDraft(
  env: Env,
  userId: number,
  draft: string,
  settings: StoredSettings
) {
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
