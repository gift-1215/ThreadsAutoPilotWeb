import { Env, NewsRunPreview } from "./types";

interface NewsSnapshotRow {
  user_id: number;
  provider: string;
  context_text: string;
  preview_json: string;
  captured_at: string;
}

export interface NewsSnapshot {
  provider: string;
  contextText: string;
  preview: NewsRunPreview | null;
  capturedAt: string;
}

function safeParsePreview(input: string): NewsRunPreview | null {
  try {
    const parsed = JSON.parse(String(input || ""));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as NewsRunPreview;
  } catch {
    return null;
  }
}

export async function saveNewsSnapshot(
  env: Env,
  userId: number,
  payload: { provider: string; contextText: string; preview: NewsRunPreview; capturedAt?: Date }
) {
  const capturedAtIso = (payload.capturedAt || new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO news_snapshots (
      user_id,
      provider,
      context_text,
      preview_json,
      captured_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      context_text = excluded.context_text,
      preview_json = excluded.preview_json,
      captured_at = excluded.captured_at,
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      userId,
      String(payload.provider || "google_rss").slice(0, 40),
      String(payload.contextText || "").slice(0, 6000),
      JSON.stringify(payload.preview || {}),
      capturedAtIso
    )
    .run();
}

export async function getNewsSnapshot(env: Env, userId: number): Promise<NewsSnapshot | null> {
  const row = await env.DB.prepare(
    `SELECT user_id, provider, context_text, preview_json, captured_at
     FROM news_snapshots
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first<NewsSnapshotRow>();

  if (!row) {
    return null;
  }

  return {
    provider: row.provider || "google_rss",
    contextText: row.context_text || "",
    preview: safeParsePreview(row.preview_json),
    capturedAt: row.captured_at || ""
  };
}
