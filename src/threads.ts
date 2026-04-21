export interface ThreadsProfile {
  id: string;
  username: string;
}

export interface ThreadsPost {
  id: string;
  text: string;
  timestamp: string;
  replyToId: string;
}

export interface ThreadsReply {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  replyToId: string;
}

export interface ThreadsTokenRefreshResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export async function fetchThreadsMe(accessToken: string): Promise<ThreadsProfile> {
  const url = new URL("https://graph.threads.net/v1.0/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errorObject = payload.error as { message?: string } | undefined;
    throw new Error(errorObject?.message || "Threads /me 取得失敗");
  }

  const id = String(payload.id || "");
  const username = String(payload.username || "");

  if (!id) {
    throw new Error("Threads token 無法取得使用者 ID");
  }

  return { id, username };
}

export async function refreshLongLivedThreadsToken(
  accessToken: string
): Promise<ThreadsTokenRefreshResult> {
  const safeToken = String(accessToken || "").trim();
  if (!safeToken) {
    throw new Error("缺少 Threads token");
  }

  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", safeToken);

  const response = await fetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errorObject = payload.error as { message?: string } | undefined;
    throw new Error(errorObject?.message || `Threads token 刷新失敗 (${response.status})`);
  }

  const refreshedToken = asString(payload.access_token);
  if (!refreshedToken) {
    throw new Error("Threads token 刷新失敗（缺少 access_token）");
  }

  const expiresInRaw = Number(payload.expires_in);
  const expiresIn =
    Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.floor(expiresInRaw) : 0;

  return {
    accessToken: refreshedToken,
    tokenType: asString(payload.token_type) || "bearer",
    expiresIn
  };
}

async function threadsGet(url: string) {
  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errorObject = payload.error as { message?: string } | undefined;
    throw new Error(errorObject?.message || `Threads API failed: ${response.status}`);
  }

  return payload;
}

async function threadsPostForm(url: string, body: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value) {
      form.set(key, value);
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errorObject = payload.error as { message?: string } | undefined;
    throw new Error(errorObject?.message || `Threads API failed: ${response.status}`);
  }

  return payload;
}

function parseThreadsArray(payload: Record<string, unknown>) {
  return Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function extractReplyToId(item: Record<string, unknown>) {
  const direct = asString(item.reply_to_id);
  if (direct) {
    return direct;
  }

  const nested = item.replied_to as { id?: unknown } | undefined;
  const nestedId = asString(nested?.id);
  if (nestedId) {
    return nestedId;
  }

  return "";
}

export async function fetchRecentThreads(accessToken: string, limit = 3): Promise<ThreadsPost[]> {
  if (!accessToken) {
    throw new Error("缺少 Threads token");
  }

  const me = await fetchThreadsMe(accessToken);
  const url = new URL(`https://graph.threads.net/v1.0/${me.id}/threads`);
  url.searchParams.set("fields", "id,text,timestamp,reply_to_id,replied_to");
  url.searchParams.set("limit", String(Math.max(1, Math.min(10, Number(limit) || 3))));
  url.searchParams.set("access_token", accessToken);

  const payload = await threadsGet(url.toString());
  const items = parseThreadsArray(payload);

  return items
    .map((item) => ({
      id: asString(item.id),
      text: asString(item.text),
      timestamp: asString(item.timestamp),
      replyToId: extractReplyToId(item)
    }))
    .filter((item) => item.id)
    .filter((item) => !item.replyToId)
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)));
}

export async function fetchThreadReplies(
  accessToken: string,
  threadId: string,
  limit = 100
): Promise<ThreadsReply[]> {
  if (!accessToken) {
    throw new Error("缺少 Threads token");
  }
  if (!threadId) {
    return [];
  }

  const url = new URL(`https://graph.threads.net/v1.0/${threadId}/replies`);
  url.searchParams.set("fields", "id,text,username,timestamp,reply_to_id,replied_to");
  url.searchParams.set("limit", String(Math.max(1, Math.min(100, Number(limit) || 100))));
  url.searchParams.set("access_token", accessToken);

  const payload = await threadsGet(url.toString());
  const items = parseThreadsArray(payload);

  return items
    .map((item) => ({
      id: asString(item.id),
      text: asString(item.text),
      username: asString(item.username),
      timestamp: asString(item.timestamp),
      replyToId: extractReplyToId(item)
    }))
    .filter((item) => item.id);
}

export async function publishReplyToThread(
  accessToken: string,
  replyToId: string,
  replyText: string
): Promise<{ threadId: string; username: string }> {
  if (!accessToken) {
    throw new Error("缺少 Threads token");
  }
  if (!replyToId) {
    throw new Error("缺少 reply_to_id");
  }

  const me = await fetchThreadsMe(accessToken);
  const createUrl = `https://graph.threads.net/v1.0/${me.id}/threads`;
  const created = await threadsPostForm(createUrl, {
    access_token: accessToken,
    media_type: "TEXT",
    text: replyText,
    reply_to_id: replyToId
  });

  const creationId = String(created.id || "");
  if (!creationId) {
    throw new Error("Threads 建立回覆 container 失敗");
  }

  const publishUrl = `https://graph.threads.net/v1.0/${me.id}/threads_publish`;
  const published = await threadsPostForm(publishUrl, {
    access_token: accessToken,
    creation_id: creationId
  });

  const threadId = String(published.id || "");
  if (!threadId) {
    throw new Error("Threads 發佈回覆失敗（缺少 thread id）");
  }

  return {
    threadId,
    username: me.username
  };
}

export async function publishToThreads(accessToken: string, draft: string, imageUrl = "") {
  if (!accessToken) {
    throw new Error("缺少 Threads token");
  }

  const me = await fetchThreadsMe(accessToken);
  const safeImageUrl = String(imageUrl || "").trim();
  const createUrl = `https://graph.threads.net/v1.0/${me.id}/threads`;
  const created = await threadsPostForm(createUrl, {
    access_token: accessToken,
    media_type: safeImageUrl ? "IMAGE" : "TEXT",
    text: draft,
    image_url: safeImageUrl
  });

  const creationId = String(created.id || "");
  if (!creationId) {
    throw new Error("Threads 建立 container 失敗");
  }

  const publishUrl = `https://graph.threads.net/v1.0/${me.id}/threads_publish`;
  const published = await threadsPostForm(publishUrl, {
    access_token: accessToken,
    creation_id: creationId
  });

  const threadId = String(published.id || "");
  if (!threadId) {
    throw new Error("Threads 發佈失敗（缺少 thread id）");
  }

  return {
    threadId,
    username: me.username
  };
}
