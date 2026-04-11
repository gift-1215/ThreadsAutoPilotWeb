export function jsonResponse(payload: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers });
}

export function textResponse(payload: string, status = 200) {
  return new Response(payload, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

export function getCookie(request: Request, name: string): string {
  const rawCookie = request.headers.get("cookie") || "";
  const cookieParts = rawCookie.split(";");
  for (const part of cookieParts) {
    const [rawKey, ...valueParts] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return "";
}

export function buildSetCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function buildClearCookie(name: string, secure: boolean) {
  const attrs = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Request body 必須是 JSON");
  }
}

export async function parseOptionalJsonBody<T>(request: Request, fallback: T): Promise<T> {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return fallback;
  }

  const raw = await request.text();
  if (!raw.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Request body 必須是 JSON");
  }
}
