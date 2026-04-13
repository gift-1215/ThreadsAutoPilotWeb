import { createSession, upsertUserFromGoogle, verifyGoogleToken } from "../auth";
import { Env } from "../types";
import {
  SESSION_TTL_SECONDS,
  buildClearCookie,
  buildSetCookie,
  cookieName,
  getCookie,
  jsonResponse,
  parseJsonBody,
  sanitizeText
} from "../utils";

export async function handleAuthApiRoutes(
  request: Request,
  env: Env,
  url: URL,
  method: string,
  secureCookie: boolean
): Promise<Response | null> {
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

  return null;
}
