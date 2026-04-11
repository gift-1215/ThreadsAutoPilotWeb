import { Env } from "./types";

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

export function waitMs(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
