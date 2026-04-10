import { Env, GoogleTokenInfo, SessionRow } from "./types";
import { SESSION_TTL_SECONDS, cookieName, getCookie, randomId } from "./utils";

export async function getSessionContext(env: Env, request: Request): Promise<SessionRow | null> {
  const sid = getCookie(request, cookieName(env));
  if (!sid) {
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT
       s.id AS session_id,
       s.user_id AS user_id,
       s.expires_at AS expires_at,
       u.email AS email,
       u.name AS name,
       u.picture_url AS picture_url
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?
     LIMIT 1`
  )
    .bind(sid)
    .first<SessionRow>();

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }

  return row;
}

export async function verifyGoogleToken(
  idToken: string,
  expectedAudience?: string
): Promise<GoogleTokenInfo> {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", idToken);

  const response = await fetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as Record<string, string>;

  if (!response.ok) {
    const reason = payload.error_description || payload.error || "Google token 驗證失敗";
    throw new Error(reason);
  }

  const info: GoogleTokenInfo = {
    sub: payload.sub || "",
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    aud: payload.aud,
    exp: payload.exp
  };

  if (!info.sub) {
    throw new Error("Google token 缺少 sub");
  }

  if (expectedAudience && info.aud && info.aud !== expectedAudience) {
    throw new Error("Google client_id 不匹配");
  }

  if (info.exp && Number(info.exp) * 1000 <= Date.now()) {
    throw new Error("Google token 已過期");
  }

  return info;
}

export async function upsertUserFromGoogle(env: Env, info: GoogleTokenInfo) {
  await env.DB.prepare(
    `INSERT INTO users (google_sub, email, name, picture_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture_url = excluded.picture_url,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(info.sub, info.email || null, info.name || null, info.picture || null)
    .run();

  const user = await env.DB.prepare(
    `SELECT id, email, name, picture_url
     FROM users
     WHERE google_sub = ?
     LIMIT 1`
  )
    .bind(info.sub)
    .first<{ id: number; email: string | null; name: string | null; picture_url: string | null }>();

  if (!user) {
    throw new Error("建立使用者失敗");
  }

  return user;
}

export async function createSession(env: Env, userId: number) {
  const sessionId = randomId(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, expiresAt)
    .run();

  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();

  return { sessionId };
}
