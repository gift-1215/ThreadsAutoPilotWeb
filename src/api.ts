import { createSession, getSessionContext, upsertUserFromGoogle, verifyGoogleToken } from "./auth";
import { createPreviewDraft, publishDraftRun } from "./posting";
import { deletePendingDraft, deleteRuns, getPendingDraft, listRuns, upsertPendingDraft } from "./runs";
import { getSettings, normalizeIncomingSettings, saveSettings } from "./settings";
import { Env } from "./types";
import {
  SESSION_TTL_SECONDS,
  buildClearCookie,
  buildSetCookie,
  cookieName,
  getCookie,
  jsonResponse,
  normalizeDraft,
  parseJsonBody,
  parseOptionalJsonBody,
  sanitizeText,
  validateDraft
} from "./utils";

export async function handleApiRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const secureCookie = url.protocol === "https:";

  if (url.pathname === "/api/health" && method === "GET") {
    return jsonResponse({ ok: true, now: new Date().toISOString() });
  }

  if (url.pathname === "/api/public-config" && method === "GET") {
    return jsonResponse({
      googleClientId: env.GOOGLE_CLIENT_ID || ""
    });
  }

  if (url.pathname === "/api/auth/google" && method === "POST") {
    const body = await parseJsonBody<{ idToken?: string }>(request);
    const idToken = sanitizeText(body.idToken, 4096);
    if (!idToken) {
      return jsonResponse({ error: "缺少 idToken" }, 400);
    }

    const tokenInfo = await verifyGoogleToken(idToken, env.GOOGLE_CLIENT_ID);
    const user = await upsertUserFromGoogle(env, tokenInfo);
    const session = await createSession(env, user.id);

    return jsonResponse(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          pictureUrl: user.picture_url
        }
      },
      200,
      {
        "set-cookie": buildSetCookie(
          cookieName(env),
          session.sessionId,
          SESSION_TTL_SECONDS,
          secureCookie
        )
      }
    );
  }

  if (url.pathname === "/api/auth/logout" && method === "POST") {
    const sid = getCookie(request, cookieName(env));
    if (sid) {
      await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    }
    return jsonResponse(
      { ok: true },
      200,
      {
        "set-cookie": buildClearCookie(cookieName(env), secureCookie)
      }
    );
  }

  const session = await getSessionContext(env, request);
  if (!session) {
    return jsonResponse(
      { error: "未登入或 session 已過期" },
      401,
      {
        "set-cookie": buildClearCookie(cookieName(env), secureCookie)
      }
    );
  }

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
    await upsertPendingDraft(env, session.user_id, draft, settings);
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

  if (url.pathname === "/api/pending-draft/publish" && method === "POST") {
    const payload = await parseOptionalJsonBody<{ draft?: unknown }>(request, {});
    const draftOverride = normalizeDraft(sanitizeText(payload.draft, 2000));
    const pending = await getPendingDraft(env, session.user_id);
    const draft = draftOverride || pending?.draft || "";
    if (!draft) {
      return jsonResponse({ error: "目前沒有可發送的草稿，請先產生草稿。" }, 400);
    }

    const invalidReason = validateDraft(draft);
    if (invalidReason) {
      return jsonResponse({ error: `草稿格式不正確：${invalidReason}` }, 400);
    }

    const settings = await getSettings(env, session.user_id);
    if (draftOverride && draftOverride !== pending?.draft) {
      await upsertPendingDraft(env, session.user_id, draftOverride, settings);
    }
    const result = await publishDraftRun(
      env,
      session.user_id,
      settings,
      "manual_publish",
      draft,
      new Date()
    );
    if (result.status === "success") {
      await deletePendingDraft(env, session.user_id);
    }
    return jsonResponse({ result });
  }

  return jsonResponse({ error: "API route not found" }, 404);
}
