import { Env } from "../types";
import { jsonResponse } from "../utils";

export function handlePublicApiRoutes(url: URL, method: string, env: Env): Response | null {
  if (url.pathname === "/api/health" && method === "GET") {
    return jsonResponse({ ok: true, now: new Date().toISOString() });
  }

  if (url.pathname === "/api/public-config" && method === "GET") {
    return jsonResponse({
      googleClientId: env.GOOGLE_CLIENT_ID || ""
    });
  }

  return null;
}
