import {browserApiUrl} from "./api-origin";
import type {
  Paginated,
  Trade,
  TrainerArea,
  TrainerProfile,
  TrainerSession,
} from "./types";

const API_URL =
  typeof window === "undefined"
    ? (process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000")
    : browserApiUrl();

const MAX_REFERENCE_PAGES = 100;

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

export function getTrainerSession() {
  return trainerFetch<TrainerSession>("/api/trainer/session/me/");
}

export function requestTrainerCode(phone: string) {
  return trainerFetch<{challenge_id: string; expires_in_seconds: number}>(
    "/api/trainer/auth/request-code/",
    {method: "POST", body: JSON.stringify({phone})},
  );
}

export function verifyTrainerCode(challengeId: string, phone: string, code: string) {
  return trainerFetch<TrainerSession>("/api/trainer/auth/verify-code/", {
    method: "POST",
    body: JSON.stringify({challenge_id: challengeId, phone, code}),
  });
}

export async function getTrainerProfile() {
  const response = await trainerFetch<{profile: TrainerProfile}>("/api/trainer/profile/");
  return response.profile;
}

export async function saveTrainerProfile(body: unknown) {
  const response = await trainerFetch<{profile: TrainerProfile}>("/api/trainer/profile/", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return response.profile;
}

export async function submitTrainerProfile() {
  const response = await trainerFetch<{profile: TrainerProfile}>(
    "/api/trainer/profile/submit/",
    {method: "POST", body: JSON.stringify({})},
  );
  return response.profile;
}

export function logoutTrainer() {
  return trainerFetch<TrainerSession>("/api/trainer/logout/", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function completeCollection<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  const visited = new Set<string>();
  let next: string | null = path;

  while (next) {
    if (visited.has(next) || visited.size >= MAX_REFERENCE_PAGES) {
      throw new TrainerApiError("Reference data did not load safely.", 502);
    }
    visited.add(next);
    const page: Paginated<T> = await trainerFetch<Paginated<T>>(next);
    items.push(...page.results);
    if (!page.next) {
      next = null;
    } else {
      const url = new URL(page.next, API_URL);
      next = `${url.pathname}${url.search}`;
    }
  }
  return items;
}

export async function getTrainerReferenceData() {
  const [areas, trades] = await Promise.all([
    completeCollection<TrainerArea>("/api/areas/"),
    completeCollection<Trade>("/api/trades/"),
  ]);
  return {areas, trades};
}
