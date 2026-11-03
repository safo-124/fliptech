/**
 * Paid courses, from the browser: what this viewer may watch, buying, and a
 * trainer's price and payout. Signed-in calls, through trainerFetch for its
 * session cookie and CSRF header. See backend courses/views.py.
 */

import {API_URL, trainerFetch} from "./trainer-fetch";
import type {
  Certificate,
  CourseAccess,
  CourseReview,
  LessonQuestion,
  MyCourse,
  PayoutBank,
  ProgressReply,
  RatingSummary,
  StudioCode,
  StudioDetails,
  StudioLesson,
  StudioQuestion,
  StudioStats,
  TrainerCourse,
} from "./types";

export function getCourseAccess(area: string, slug: string) {
  return trainerFetch<CourseAccess>(`/api/courses/${area}/${slug}/access/`);
}

/** Starts a Paystack payment; send the browser to the URL it returns. */
export function buyCourse(area: string, slug: string, code?: string) {
  return trainerFetch<{authorization_url: string; reference: string}>(
    `/api/courses/${area}/${slug}/buy/`,
    {method: "POST", body: JSON.stringify(code ? {code} : {})},
  );
}

/** What a promo code makes the course cost. */
export function checkCourseCode(area: string, slug: string, code: string) {
  return trainerFetch<{code: string; percent_off: number; price: string; was: string}>(
    `/api/courses/${area}/${slug}/code/`,
    {method: "POST", body: JSON.stringify({code})},
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

// --------------------------------------------------------------------------
// Learning

export function saveProgress(videoId: number, position: number, completed = false) {
  return trainerFetch<ProgressReply>(`/api/learn/lessons/${videoId}/progress/`, {
    method: "POST",
    body: JSON.stringify({position: Math.floor(position), completed}),
  });
}

/** Count a lesson being started. Fire and forget, with no cookies. */
export function countPlay(videoId: number) {
  try {
    void fetch(`${API_URL}/api/learn/lessons/${videoId}/play/`, {
      method: "POST",
      credentials: "omit",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Counting must never get in the way of watching.
  }
}

export function getMyCourses() {
  return trainerFetch<{results: MyCourse[]; signed_in: boolean}>("/api/learn/mine/");
}

export function requestCertificate(area: string, slug: string, name?: string) {
  return trainerFetch<Certificate>(`/api/courses/${area}/${slug}/certificate/`, {
    method: "POST",
    body: JSON.stringify(name ? {name} : {}),
  });
}

export function getCourseReviews(area: string, slug: string) {
  return trainerFetch<{summary: RatingSummary; results: CourseReview[]}>(
    `/api/courses/${area}/${slug}/reviews/`,
  );
}

export function sendCourseReview(area: string, slug: string, rating: number, body: string) {
  return trainerFetch<{review: CourseReview; summary: RatingSummary}>(
    `/api/courses/${area}/${slug}/reviews/`,
    {method: "POST", body: JSON.stringify({rating, body})},
  );
}

export function getLessonQuestions(videoId: number) {
  return trainerFetch<{results: LessonQuestion[]; mine: number[]}>(
    `/api/learn/lessons/${videoId}/questions/`,
  );
}

export function askLessonQuestion(videoId: number, body: string, atSeconds?: number) {
  return trainerFetch<LessonQuestion>(`/api/learn/lessons/${videoId}/questions/`, {
    method: "POST",
    body: JSON.stringify({body, at_seconds: atSeconds}),
  });
}

// --------------------------------------------------------------------------
// The trainer's course studio

export function getStudioDetails() {
  return trainerFetch<StudioDetails>("/api/trainer/course/details/");
}

/** Link marketplace products to the course's "Tools you need". */
export function saveToolProducts(ids: number[]) {
  return trainerFetch<StudioDetails>("/api/trainer/course/details/", {
    method: "PATCH",
    body: JSON.stringify({ tool_products: ids }),
  });
}

export function saveStudioDetails(details: Partial<Record<keyof StudioDetails, string | null>>) {
  return trainerFetch<StudioDetails>("/api/trainer/course/details/", {
    method: "PATCH",
    body: JSON.stringify(details),
  });
}

type StudioLessons = {lessons: StudioLesson[]; languages: {value: string; label: string}[]};

export function getStudioLessons() {
  return trainerFetch<StudioLessons>("/api/trainer/course/lessons/");
}

export function saveLessonOrder(lessons: {id: number; section: string}[]) {
  return trainerFetch<StudioLessons>("/api/trainer/course/lessons/", {
    method: "PUT",
    body: JSON.stringify({lessons}),
  });
}

export function saveLesson(id: number, changes: {section?: string; description?: string}) {
  return trainerFetch<StudioLesson>(`/api/trainer/course/lessons/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function saveCaptions(id: number, language: string, text: string) {
  return trainerFetch<StudioLesson>(`/api/trainer/course/lessons/${id}/captions/${language}/`, {
    method: "PUT",
    body: JSON.stringify({text}),
  });
}

export function deleteCaptions(id: number, language: string) {
  return trainerFetch<StudioLesson>(`/api/trainer/course/lessons/${id}/captions/${language}/`, {
    method: "DELETE",
  });
}

export function getStudioCodes() {
  return trainerFetch<{codes: StudioCode[]}>("/api/trainer/course/codes/");
}

export function createStudioCode(code: {
  code: string;
  percent_off: number;
  max_uses?: number | null;
  expires_at?: string | null;
}) {
  return trainerFetch<StudioCode>("/api/trainer/course/codes/", {
    method: "POST",
    body: JSON.stringify(code),
  });
}

export function setStudioCodeActive(id: number, isActive: boolean) {
  return trainerFetch<StudioCode>(`/api/trainer/course/codes/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({is_active: isActive}),
  });
}

export function deleteStudioCode(id: number) {
  return trainerFetch<void>(`/api/trainer/course/codes/${id}/`, {method: "DELETE"});
}

export function getStudioStats() {
  return trainerFetch<StudioStats>("/api/trainer/course/stats/");
}

export function getStudioQuestions() {
  return trainerFetch<{questions: StudioQuestion[]}>("/api/trainer/course/questions/");
}

export function answerQuestion(id: number, answer: string) {
  return trainerFetch<StudioQuestion>(`/api/trainer/course/questions/${id}/answer/`, {
    method: "POST",
    body: JSON.stringify({answer}),
  });
}

export function getStudioReviews() {
  return trainerFetch<{summary: RatingSummary; reviews: CourseReview[]}>(
    "/api/trainer/course/reviews/",
  );
}

export function replyToReview(id: number, reply: string) {
  return trainerFetch<CourseReview>(`/api/trainer/course/reviews/${id}/reply/`, {
    method: "POST",
    body: JSON.stringify({reply}),
  });
}

export function getStudioBoost() {
  return trainerFetch<{
    options: {days: number; price: string}[];
    payments_enabled: boolean;
    featured_until: string | null;
  }>("/api/trainer/course/boost/");
}

export function buyStudioBoost(days: number) {
  return trainerFetch<{authorization_url: string; reference: string}>("/api/trainer/course/boost/", {
    method: "POST",
    body: JSON.stringify({days}),
  });
}

export function verifyStudioBoost(reference: string) {
  return trainerFetch<{status: string; ends_at: string | null}>(
    `/api/trainer/course/boost/${encodeURIComponent(reference)}/verify/`,
    {method: "POST"},
  );
}
