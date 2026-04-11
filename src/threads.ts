async function fetchThreadsMe(accessToken: string) {
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

export async function publishToThreads(accessToken: string, draft: string) {
  if (!accessToken) {
    throw new Error("缺少 Threads token");
  }

  const me = await fetchThreadsMe(accessToken);
  const createUrl = `https://graph.threads.net/v1.0/${me.id}/threads`;
  const created = await threadsPostForm(createUrl, {
    access_token: accessToken,
    media_type: "TEXT",
    text: draft
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
