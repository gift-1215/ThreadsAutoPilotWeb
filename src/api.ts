import { getSessionContext } from "./auth";
import { handleAuthApiRoutes } from "./api-routes/auth";
import { handlePublicApiRoutes } from "./api-routes/public";
import { handleUserApiRoutes } from "./api-routes/user";
import { Env } from "./types";
import { buildClearCookie, cookieName, jsonResponse } from "./utils";

export async function handleApiRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const secureCookie = url.protocol === "https:";

  const publicRoute = handlePublicApiRoutes(url, method, env);
  if (publicRoute) {
    return publicRoute;
  }

  const authRoute = await handleAuthApiRoutes(request, env, url, method, secureCookie);
  if (authRoute) {
    return authRoute;
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

  const userRoute = await handleUserApiRoutes(request, env, url, method, session);
  if (userRoute) {
    return userRoute;
  }

  return jsonResponse({ error: "API route not found" }, 404);
}
