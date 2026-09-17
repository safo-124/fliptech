/**
 * Trainee account API client. Browser only.
 *
 * Uses the same session-and-CSRF fetch as the trainer portal: a phone sign-in
 * creates a Django session cookie, and every write echoes the CSRF token.
 * A member of staff in a support session reaches the same endpoints, and the
 * session payload says so, which is what drives the support banner.
 */

import {trainerFetch as sessionFetch} from "./trainer-api";
import type {
  SavedProvider,
  TraineeAccount,
  TraineeEducationLevel,
  TraineeEducationStatus,
  TraineeChannel,
  TraineeEnquiry,
  TraineeEnrolment,
  TraineeSession,
} from "./types";

export {TrainerApiError as SessionApiError} from "./trainer-api";

export function getTraineeSession() {
  return sessionFetch<TraineeSession>("/api/trainee/session/me/");
}

export function requestTraineeCode(phone: string) {
  return sessionFetch<{challenge_id: string; expires_in_seconds: number}>(
    "/api/trainee/auth/request-code/",
    {method: "POST", body: JSON.stringify({phone})},
  );
}

export function verifyTraineeCode(challengeId: string, phone: string, code: string) {
  return sessionFetch<TraineeSession>("/api/trainee/auth/verify-code/", {
    method: "POST",
    body: JSON.stringify({challenge_id: challengeId, phone, code}),
  });
}

/**
 * Email is a second door into an account that already exists.
 *
 * Requesting a code answers the same way whether or not the address is on an
 * account, so nothing here can be used to work out who is registered. An
 * address with no account is refused at the verify step.
 */
export function requestTraineeEmailCode(email: string) {
  return sessionFetch<{challenge_id: string; expires_in_seconds: number}>(
    "/api/trainee/auth/email/request-code/",
    {method: "POST", body: JSON.stringify({email})},
  );
}

export function verifyTraineeEmailCode(challengeId: string, email: string, code: string) {
  return sessionFetch<TraineeSession>("/api/trainee/auth/email/verify-code/", {
    method: "POST",
    body: JSON.stringify({challenge_id: challengeId, email, code}),
  });
}

/** Attach an address to the signed-in account. Two steps, like signing in. */
export function requestAddEmailCode(email: string) {
  return sessionFetch<{challenge_id: string; expires_in_seconds: number}>(
    "/api/trainee/account/email/request-code/",
    {method: "POST", body: JSON.stringify({email})},
  );
}

export function confirmAddEmail(challengeId: string, email: string, code: string) {
  return sessionFetch<TraineeAccount>("/api/trainee/account/email/confirm/", {
    method: "POST",
    body: JSON.stringify({challenge_id: challengeId, email, code}),
  });
}

/** Signs a trainee out, or ends a staff support session. */
export function logoutTrainee() {
  return sessionFetch<TraineeSession & {back_office_url?: string}>("/api/trainee/logout/", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getTraineeEnquiries() {
  return sessionFetch<TraineeEnquiry[]>("/api/trainee/enquiries/");
}

export function getTraineeEnrolments() {
  return sessionFetch<TraineeEnrolment[]>("/api/trainee/enrolments/");
}

export function getSavedProviders() {
  return sessionFetch<SavedProvider[]>("/api/trainee/saved/");
}

export function saveProvider(providerId: number) {
  return sessionFetch<SavedProvider>("/api/trainee/saved/", {
    method: "POST",
    body: JSON.stringify({provider_id: providerId}),
  });
}

export async function removeSavedProvider(providerId: number) {
  await sessionFetch<null>(`/api/trainee/saved/${providerId}/`, {method: "DELETE"});
}

export function updateTraineeAccount(changes: {
  display_name?: string;
  preferred_channel?: TraineeChannel;
  // PATCH is partial on the server, so sending only what changed is enough and
  // a trainee who never opens the background form is never asked about it.
  education_level?: TraineeEducationLevel | "";
  institution_name?: string;
  field_of_study?: string;
  education_status?: TraineeEducationStatus | "";
  education_year?: number | null;
}) {
  return sessionFetch<TraineeAccount>("/api/trainee/account/", {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function closeTraineeAccount() {
  return sessionFetch<{closed: boolean}>("/api/trainee/account/close/", {
    method: "POST",
    body: JSON.stringify({confirm: true}),
  });
}

/** Only same-site paths are accepted as a place to return to after sign-in. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/trainee";
  }
  return value;
}
