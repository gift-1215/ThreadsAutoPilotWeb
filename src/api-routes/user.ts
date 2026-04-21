import { createPreviewDraft, generatePendingDraftImage, publishDraftRun } from "../posting";
import { executeManualNewsPrefill } from "../news";
import { executeManualReplySweep } from "../replies";
import { deletePendingDraft, deleteRuns, getPendingDraft, listRuns, upsertPendingDraft } from "../runs";
import { getSettings, normalizeIncomingSettings, saveSettings } from "../settings";
import { Env, SessionRow } from "../types";
import {
  jsonResponse,
  normalizeDraft,
  parseJsonBody,
  parseOptionalJsonBody,
  sanitizeText,
  validateDraft
} from "../utils";

export async function handleUserApiRoutes(
  request: Request,
  env: Env,
  url: URL,
  method: string,
  session: SessionRow
): Promise<Response | null> {
  if (url.pathname === "/api/me" && method === "GET") {
    return jsonResponse({
      user: {
        id: session.user_id,
        email: session.email,
        name: session.name,
        pictureUrl: session.picture_url
      }
    });
  }

  if (url.pathname === "/api/settings" && method === "GET") {
    const settings = await getSettings(env, session.user_id);
    return jsonResponse({ settings });
  }

  if (url.pathname === "/api/settings" && method === "PUT") {
    const payload = await parseJsonBody<Record<string, unknown>>(request);
    const normalized = normalizeIncomingSettings(env, payload);
    await saveSettings(env, session.user_id, normalized);
    return jsonResponse({ ok: true, settings: normalized });
  }

  if (url.pathname === "/api/runs" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") || "20");
    const runs = await listRuns(env, session.user_id, limit);
    return jsonResponse({ runs });
  }

  if (url.pathname === "/api/runs" && method === "DELETE") {
    const deletedCount = await deleteRuns(env, session.user_id);
    return jsonResponse({ ok: true, deletedCount });
  }

  if (url.pathname === "/api/pending-draft" && method === "GET") {
    const pendingDraft = await getPendingDraft(env, session.user_id);
    return jsonResponse({ pendingDraft });
  }

  if (url.pathname === "/api/pending-draft" && method === "PUT") {
    const payload = await parseJsonBody<{ draft?: unknown }>(request);
    const draft = normalizeDraft(sanitizeText(payload.draft, 2000));
    const invalidReason = validateDraft(draft);
    if (invalidReason) {
      return jsonResponse({ error: `草稿格式不正確：${invalidReason}` }, 400);
    }

    const settings = await getSettings(env, session.user_id);
    const existingPending = await getPendingDraft(env, session.user_id);
    await upsertPendingDraft(env, session.user_id, draft, settings, {
      imageUrl: existingPending?.image_url || "",
      imagePrompt: existingPending?.image_prompt || ""
    });
    const pendingDraft = await getPendingDraft(env, session.user_id);
    return jsonResponse({ ok: true, pendingDraft });
  }

  if (url.pathname === "/api/pending-draft" && method === "DELETE") {
    await deletePendingDraft(env, session.user_id);
    return jsonResponse({ ok: true });
  }

  if (url.pathname === "/api/run-now" && method === "POST") {
    const settings = await getSettings(env, session.user_id);
    const result = await createPreviewDraft(
      env,
      session.user_id,
      settings,
      "manual_generate",
      new Date()
    );
    return jsonResponse({ result });
  }

  if (url.pathname === "/api/pending-draft/regenerate" && method === "POST") {
    const settings = await getSettings(env, session.user_id);
    const result = await createPreviewDraft(
      env,
      session.user_id,
      settings,
      "manual_regenerate",
      new Date()
    );
    return jsonResponse({ result });
  }

  if (url.pathname === "/api/pending-draft/generate-image" && method === "POST") {
    const settings = await getSettings(env, session.user_id);
    const result = await generatePendingDraftImage(env, session.user_id, settings, new Date());
    return jsonResponse({ result });
  }

  if (url.pathname === "/api/pending-draft/publish" && method === "POST") {
    const payload = await parseOptionalJsonBody<{ draft?: unknown }>(request, {});
    const draftOverride = normalizeDraft(sanitizeText(payload.draft, 2000));
    const pending = await getPendingDraft(env, session.user_id);
    const draft = draftOverride || pending?.draft || "";
    const pendingImageUrl = String(pending?.image_url || "").trim();
    if (!draft) {
      return jsonResponse({ error: "目前沒有可發送的草稿，請先產生草稿。" }, 400);
    }

    const invalidReason = validateDraft(draft);
    if (invalidReason) {
      return jsonResponse({ error: `草稿格式不正確：${invalidReason}` }, 400);
    }

    const settings = await getSettings(env, session.user_id);
    if (draftOverride && draftOverride !== pending?.draft) {
      await upsertPendingDraft(env, session.user_id, draftOverride, settings, {
        imageUrl: pending?.image_url || "",
        imagePrompt: pending?.image_prompt || ""
      });
    }
    const result = await publishDraftRun(
      env,
      session.user_id,
      settings,
      "manual_publish",
      draft,
      pendingImageUrl,
      new Date()
    );
    if (result.status === "success") {
      await deletePendingDraft(env, session.user_id);
    }
    return jsonResponse({ result });
  }

  if (url.pathname === "/api/replies/scan-now" && method === "POST") {
    const settings = await getSettings(env, session.user_id);
    const result = await executeManualReplySweep(env, session.user_id, settings, new Date());
    return jsonResponse({ result });
  }

  if (url.pathname === "/api/news/run-now" && method === "POST") {
    const settings = await getSettings(env, session.user_id);
    const result = await executeManualNewsPrefill(env, session.user_id, settings, new Date());
    return jsonResponse({ result });
  }

  return null;
}
