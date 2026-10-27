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
  "TrainerAccount",
  "TrainerAccountNotice",
  "TrainerNav",
  "LocationPicker",
  "DashboardNav",
  "DashboardFigures",
  "ListingStatus",
  "Validation",
  "Format",
] as const satisfies readonly ClientNamespace[];
