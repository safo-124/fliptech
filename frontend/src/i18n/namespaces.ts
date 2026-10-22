/**
 * Which message namespaces each client subtree needs. See ClientMessages.
 *
 * Kept in one file so that when a client component starts using a new
 * namespace, the place to add it is obvious — and so a reviewer can see at a
 * glance what each kind of page ships.
 */

import type messages from "../../messages/en.json";

export type ClientNamespace = keyof typeof messages;

/** The account link in the site header, on every page. */
export const HEADER_CLIENT_NAMESPACES = ["AccountNav"] as const satisfies readonly ClientNamespace[];

/** The map on the search page and the /map page. */
export const MAP_CLIENT_NAMESPACES = [
  "MapView",
  "MapLoader",
  "SearchMapPanel",
  "Format",
] as const satisfies readonly ClientNamespace[];

/** The provider profile's save button. */
export const PROFILE_CLIENT_NAMESPACES = [
  "SaveProviderButton",
] as const satisfies readonly ClientNamespace[];

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
  "TrainerDashboard",
  "TrainerEnquiries",
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
