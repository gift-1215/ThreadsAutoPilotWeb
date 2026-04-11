import { handleApiRequest } from "./api";
import { runScheduledJob } from "./scheduler";
import { Env } from "./types";
import { jsonResponse, safeErrorMessage, textResponse } from "./utils";

const worker: ExportedHandler<Env> = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApiRequest(request, env);
      } catch (error) {
        const message = safeErrorMessage(error);
        console.error("[api:error]", message);
        return jsonResponse({ error: message }, 500);
      }
    }

    if (!env.ASSETS) {
      return textResponse("ASSETS binding is not configured", 500);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runScheduledJob(env).catch((error) => {
        console.error("[cron:error]", safeErrorMessage(error));
      })
    );
  }
};

export default worker;
