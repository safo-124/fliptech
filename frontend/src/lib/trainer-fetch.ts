/**
 * The signed-in request every trainer and account call goes through: session
 * cookie, CSRF header, and errors flattened into words for a form.
 *
 * Its own module, apart from trainer-api.ts, because the header's account link
 * (session-api.ts) needs it on every page — the search page included. When it
 * lived in trainer-api.ts, importing it brought every trainer endpoint helper
 * into the search page's JavaScript, which has a 200 KB budget.
 */

import {SSR_HEADERS} from "./api";
import {browserApiUrl} from "./api-origin";

export const API_URL =
  typeof window === "undefined"
    ? (process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000")
    : browserApiUrl();

type ErrorMap = Record<string, string>;

export class TrainerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: ErrorMap = {},
  ) {
    super(message);
  }
}

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function flattenErrors(value: unknown, prefix = "", output: ErrorMap = {}): ErrorMap {
  if (typeof value === "string") {
    output[prefix || "detail"] = value;
    return output;
  }
  if (Array.isArray(value)) {
    const messages = value.filter((item): item is string => typeof item === "string");
    if (messages.length) output[prefix || "detail"] = messages.join(" ");
    value
      .filter((item) => typeof item === "object" && item !== null)
      .forEach((item) => flattenErrors(item, prefix, output));
    return output;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      flattenErrors(nested, prefix ? `${prefix}.${key}` : key, output);
    }
  }
  return output;
}

export async function trainerFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  // Empty in the browser, which is where this module actually runs today. It
  // matters only if one of these calls is ever moved to the server, where the
  // loopback hop to gunicorn needs it — see SSR_HEADERS.
  for (const [name, value] of Object.entries(SSR_HEADERS)) headers.set(name, value);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("X-CSRFToken", token);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new TrainerApiError("Could not reach Skills Hub. Check your connection and try again.", 0);
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const fields = flattenErrors(data);
    throw new TrainerApiError(
      fields.detail ?? Object.values(fields)[0] ?? "Something went wrong. Try again.",
      response.status,
      fields,
    );
  }
  return data as T;
}
