/**
 * Which message namespaces each client subtree needs. See ClientMessages.
 *
 * Kept in one file so that when a client component starts using a new
 * namespace, the place to add it is obvious — and so a reviewer can see at a
 * glance what each kind of page ships.
 */

import type messages from "../../messages/en.json";

export type ClientNamespace = keyof typeof messages;

/**
 * The map on the search page and the /map page.
 *
 * The header's account link and the search page's map panel are not here on
 * purpose: they take their few labels as props from the server, so the
 * message formatter is not on every page. See AccountNav.
 */
export const MAP_CLIENT_NAMESPACES = [
  "MapView",
  "MapLoader",
  "Format",
] as const satisfies readonly ClientNamespace[];

/** The provider profile's save button. */
export const PROFILE_CLIENT_NAMESPACES = [
  "SaveProviderButton",
] as const satisfies readonly ClientNamespace[];

/**
 * The Ask panel on a product page.
 *
 * Validation comes with it because the phone field is checked in the browser
 * before a code is spent, and Format for the cedi amounts the panel echoes.
 */
export const MARKETPLACE_CLIENT_NAMESPACES = [
  "Marketplace",
  "Validation",
  "Format",
] as const satisfies readonly ClientNamespace[];

/** A course's classroom, /learn/mine and /learn/saved. */
export const LEARN_CLIENT_NAMESPACES = ["Classroom", "MyLearning"] as const satisfies readonly ClientNamespace[];

/** The seller's sign-in and their own workspace. */
export const SELLER_CLIENT_NAMESPACES = [
  "SellerPages",
  "SellerDashboard",
  "SellerGrowth",
  "Chat",
  "DashboardNav",
  "Validation",
  "Format",
] as const satisfies readonly ClientNamespace[];

/** "Report a problem" with a listing. */
export const REPORT_CLIENT_NAMESPACES = ["ReportProblem"] as const satisfies readonly ClientNamespace[];

/** The enquiry page, which is a client component throughout. */
export const ENQUIRY_CLIENT_NAMESPACES = [
  "EnquiryPage",
  "EnquiryForm",
  "Validation",
] as const satisfies readonly ClientNamespace[];

/** /trainee: sign-in, overview and dashboard. */
export const TRAINEE_CLIENT_NAMESPACES = [
  "TraineeSignIn",
  "Education",
  "TraineeDashboard",
  "TraineeOverview",
  "TraineeNav",
  "TraineeProgress",
  "DashboardNav",
  "Validation",
  "Format",
] as const satisfies readonly ClientNamespace[];

/** /trainer: the join wizard, the dashboard and the account pages. */
export const TRAINER_CLIENT_NAMESPACES = [
  "TrainerJoinWizard",
  "TeachingLanguages",
  "TrainerDashboard",
  "TrainerEnquiries",
  "TrainerVideos",
  "TrainerCourse",
  "CourseStudio",
  "TrainerAccount",
  "TrainerAccountNotice",
  "TrainerNav",
  "Chat",
  "LocationPicker",
  "DashboardNav",
  "DashboardFigures",
  "ListingStatus",
  "Validation",
  "Format",
] as const satisfies readonly ClientNamespace[];

/** The one account everyone signs in to (/account). */
/** The words of a chat (components/account/ChatThread.tsx) and the business inbox. */
export const INBOX_CLIENT_NAMESPACES = ["Chat"] as const satisfies readonly ClientNamespace[];

export const ACCOUNT_CLIENT_NAMESPACES = [
  "Account",
  "Chat",
  "SignIn",
  "Validation",
] as const satisfies readonly ClientNamespace[];

/** The sign-in sheet in the root layout, which any page can open. */
export const SIGN_IN_CLIENT_NAMESPACES = ["SignIn"] as const satisfies readonly ClientNamespace[];

/** /search: the live search box and its results. */
export const SEARCH_CLIENT_NAMESPACES = ["SiteSearch"] as const satisfies readonly ClientNamespace[];
