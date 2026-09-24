import {SSR_HEADERS} from "./api";
import {browserApiUrl} from "./api-origin";
import type {
  Paginated,
  ProviderPhotoKind,
  Trade,
  TrainerArea,
  TrainerDashboard,
  TrainerEnquiry,
  TrainerPhoto,
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

/**
 * Email is a second door into an existing trainer account.
 *
 * Section 03 names being asked to log in as what makes a workshop owner give
 * up, so the phone route stays the default. This is the way back in for an
 * owner whose SMS is not arriving.
 */
export function requestTrainerEmailCode(email: string) {
  return trainerFetch<{challenge_id: string; expires_in_seconds: number}>(
    "/api/trainer/auth/email/request-code/",
    {method: "POST", body: JSON.stringify({email})},
  );
}

export function verifyTrainerEmailCode(challengeId: string, email: string, code: string) {
  return trainerFetch<TrainerSession>("/api/trainer/auth/email/verify-code/", {
    method: "POST",
    body: JSON.stringify({challenge_id: challengeId, email, code}),
  });
}

export function requestTrainerAddEmailCode(email: string) {
  return trainerFetch<{challenge_id: string; expires_in_seconds: number}>(
    "/api/trainer/account/email/request-code/",
    {method: "POST", body: JSON.stringify({email})},
  );
}

export function confirmTrainerAddEmail(challengeId: string, email: string, code: string) {
  return trainerFetch<TrainerSession>("/api/trainer/account/email/confirm/", {
    method: "POST",
    body: JSON.stringify({challenge_id: challengeId, email, code}),
  });
}

/**
 * Screen 5 for the signed-in trainer.
 *
 * The same figures the tokenised WhatsApp link shows — both call one function
 * on the server, so an owner cannot see one number in a link and a different
 * one here.
 */
export function getTrainerDashboard() {
  return trainerFetch<TrainerDashboard>("/api/trainer/dashboard/");
}

export function getTrainerOwnEnquiries() {
  return trainerFetch<TrainerEnquiry[]>("/api/trainer/dashboard/enquiries/");
}

/**
 * The owner saying they have answered someone.
 *
 * Self-reported, like every field on the outcome it writes to: the
 * conversation happens on WhatsApp and the platform cannot observe any of it.
 * Reversible, because a mis-tap that permanently mislabelled an enquiry would
 * make the list worth less than no list.
 */
export function setTrainerEnquiryReplied(referenceCode: string, replied: boolean) {
  return trainerFetch<{reference_code: string; replied: boolean}>(
    `/api/trainer/dashboard/enquiries/${encodeURIComponent(referenceCode)}/replied/`,
    {method: "POST", body: JSON.stringify({replied})},
  );
}

/** "The fees and dates on this listing are still right." */
export async function confirmListingIsCurrent() {
  const response = await trainerFetch<{profile: TrainerProfile}>(
    "/api/trainer/profile/confirm/",
    {method: "POST", body: JSON.stringify({})},
  );
  return response.profile;
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

/** Everything still missing before the listing can go for review. */
export async function getTrainerProfileBlockers() {
  const response = await trainerFetch<{profile: TrainerProfile | null; blockers: string[] | null}>(
    "/api/trainer/profile/",
  );
  return {profile: response.profile, blockers: response.blockers ?? []};
}

/**
 * One workshop photograph.
 *
 * FormData rather than JSON, and trainerFetch already leaves Content-Type
 * alone for a FormData body — the browser has to set it itself so the
 * multipart boundary matches.
 */
export async function uploadTrainerPhoto(
  file: File,
  kind: ProviderPhotoKind = "workshop",
  caption = "",
) {
  const form = new FormData();
  form.append("image", file);
  form.append("kind", kind);
  if (caption) form.append("caption", caption);
  return trainerFetch<TrainerPhoto>("/api/trainer/profile/photos/", {
    method: "POST",
    body: form,
  });
}

/** The workshop's logo. Replace-only: a provider has one. */
export async function uploadTrainerLogo(file: File) {
  const form = new FormData();
  form.append("logo", file);
  return trainerFetch<{url: string}>("/api/trainer/profile/logo/", {
    method: "POST",
    body: form,
  });
}

export function deleteTrainerLogo() {
  return trainerFetch<null>("/api/trainer/profile/logo/", {method: "DELETE"});
}

export function deleteTrainerPhoto(photoId: number) {
  return trainerFetch<null>(`/api/trainer/profile/photos/${photoId}/`, {method: "DELETE"});
}

/**
 * The owner's identity document.
 *
 * Returns only whether it stored. There is deliberately no URL in the
 * response: Section 10 requires identity documents are never publicly served,
 * so the only place one can be opened is the back office.
 */
export async function uploadTrainerIdentityDocument(file: File) {
  const form = new FormData();
  form.append("document", file);
  return trainerFetch<{stored: boolean}>("/api/trainer/profile/identity/", {
    method: "POST",
    body: form,
  });
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
