import { Env } from "./types";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SUPPORTED_LLM_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"] as const;
export const DEFAULT_LLM_MODEL: (typeof SUPPORTED_LLM_MODELS)[number] = "gemini-2.5-flash";
export const MAX_THREAD_CHARS = 499;

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

export function cookieName(env: Env) {
  return env.SESSION_COOKIE_NAME || "taw_session";
}

export function defaultTimezone(env: Env) {
  return env.DEFAULT_TIMEZONE || "Asia/Taipei";
}

export function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export function randomId(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

export function sanitizeLlmModel(input: unknown) {
  const candidate = String(input || "").trim().toLowerCase();
  if (SUPPORTED_LLM_MODELS.includes(candidate as (typeof SUPPORTED_LLM_MODELS)[number])) {
    return candidate;
  }
  return DEFAULT_LLM_MODEL;
}

export function sanitizeText(input: unknown, maxLength = 4000) {
  const value = String(input || "").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

export function sanitizePostTime(input: unknown) {
  const value = String(input || "").trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    return value;
  }
  return "09:00";
}

export function sanitizeReplyTimes(input: unknown, maxItems = 12) {
  const raw = String(input || "").trim();
  if (!raw) {
    return [] as string[];
  }

  const tokens = raw
    .split(/[,，;\n\r\t ]+/g)
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  for (const token of tokens) {
    if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(token)) {
      unique.add(token);
    }
    if (unique.size >= maxItems) {
      break;
    }
  }

  return [...unique];
}

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function sanitizeTimezone(input: unknown, fallback: string) {
  const value = String(input || "").trim();
  if (!value) {
    return fallback;
  }
  return isValidTimezone(value) ? value : fallback;
}

export function parseHHMM(value: string) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getLocalDateTime(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const mapped = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  ) as Record<string, string>;

  const year = mapped.year;
  const month = mapped.month;
  const day = mapped.day;
  const hour = mapped.hour;
  const minute = mapped.minute;

  return {
    dateKey: `${year}-${month}-${day}`,
    timeKey: `${hour}:${minute}`,
    minuteOfDay: Number(hour) * 60 + Number(minute)
  };
}

export function shouldTriggerNow(minuteOfDay: number, targetTime: string) {
  const target = parseHHMM(targetTime);
  if (target === null) {
    return false;
  }
  const diff = minuteOfDay - target;
  return diff >= 0 && diff < 5;
}

export function normalizeDraft(rawText: string) {
  return String(rawText || "")
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function validateDraft(draft: string) {
  if (!draft) {
    return "內容是空白";
  }
  if (draft.length >= 500) {
    return `字數過長（${draft.length}）`;
  }
  const normalized = draft.toLowerCase();
  if (normalized.startsWith("```") || normalized.endsWith("```")) {
    return "請不要輸出 code block 格式";
  }
  if (/\{[\s\S]*\}/.test(draft) && draft.includes('"')) {
    return "請只輸出貼文內容，不要輸出 JSON";
  }
  return "";
}

export function waitMs(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
