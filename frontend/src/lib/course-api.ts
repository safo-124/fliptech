/**
 * Paid courses, from the browser: what this viewer may watch, buying, and a
 * trainer's price and payout. Signed-in calls, through trainerFetch for its
 * session cookie and CSRF header. See backend courses/views.py.
 */

import {trainerFetch} from "./trainer-fetch";
import type {CourseAccess, PayoutBank, TrainerCourse} from "./types";

export function getCourseAccess(area: string, slug: string) {
  return trainerFetch<CourseAccess>(`/api/courses/${area}/${slug}/access/`);
}

/** Starts a Paystack payment; send the browser to the URL it returns. */
export function buyCourse(area: string, slug: string) {
  return trainerFetch<{authorization_url: string; reference: string}>(
    `/api/courses/${area}/${slug}/buy/`,
    {method: "POST"},
  );
}

export function verifyPurchase(reference: string) {
  return trainerFetch<{status: string; owned: boolean}>(
    `/api/payments/${encodeURIComponent(reference)}/verify/`,
    {method: "POST"},
  );
}

export function getTrainerCourse() {
  return trainerFetch<TrainerCourse>("/api/trainer/course/");
}

/** An empty price makes the course free. */
export function setCoursePrice(price: string) {
  return trainerFetch<TrainerCourse>("/api/trainer/course/", {
    method: "PATCH",
    body: JSON.stringify({price}),
  });
}

export function getPayoutBanks() {
  return trainerFetch<{banks: PayoutBank[]}>("/api/trainer/course/banks/");
}

export function savePayout(details: {bank_code: string; account_number: string; account_name: string}) {
  return trainerFetch<TrainerCourse>("/api/trainer/course/payout/", {
    method: "PUT",
    body: JSON.stringify(details),
  });
}
