import {API_URL, TrainerApiError, trainerFetch} from "./trainer-fetch";
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
  TrainerVideo,
  TrainerVideoList,
} from "./types";

// Re-exported: callers have always imported these from here. See trainer-fetch.ts.
export {TrainerApiError, trainerFetch} from "./trainer-fetch";

const MAX_REFERENCE_PAGES = 100;

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
  beforeOf?: number,
) {
  const form = new FormData();
  form.append("image", file);
  form.append("kind", kind);
  if (caption) form.append("caption", caption);
  // A "before" names the finished-work photo it pairs with.
  if (beforeOf !== undefined) form.append("before_of", String(beforeOf));
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

export function getTrainerVideos() {
  return trainerFetch<TrainerVideoList>("/api/trainer/profile/videos/");
}

/**
 * Say what is about to be sent. The server refuses it now, before any data
 * is spent, if it would not fit. The file follows with sendVideoPiece.
 */
export function startTrainerVideo(title: string, file: File) {
  return trainerFetch<TrainerVideo>("/api/trainer/profile/videos/", {
    method: "POST",
    body: JSON.stringify({title, name: file.name, size: file.size}),
  });
}

/** One piece of the file, starting at `offset`. See lib/video-upload.ts. */
export function sendVideoPiece(videoId: number, offset: number, piece: Blob) {
  return trainerFetch<TrainerVideo>(`/api/trainer/profile/videos/${videoId}/upload/`, {
    method: "PUT",
    headers: {"Content-Type": "application/octet-stream", "Upload-Offset": String(offset)},
    body: piece,
  });
}

export function deleteTrainerVideo(videoId: number) {
  return trainerFetch<null>(`/api/trainer/profile/videos/${videoId}/`, {method: "DELETE"});
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
