/** Types mirroring the Django API. Regenerate expectations from /api/schema/. */

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/**
 * The two trust signals are separate types on purpose, and there is no combined
 * `verified` boolean anywhere in this codebase either. A site visit and a CTVET
 * record are different claims and are rendered as different badges.
 */
export type SiteVisit = {
  visited_on: string;
  outcome: "passed" | "passed_with_notes" | "failed";
} | null;

export type GovernmentStatusBadge = {
  registration_status:
    | "registered"
    | "not_registered"
    | "not_claimed"
    | "claimed_not_verified";
  label: string;
};

export type ProviderCard = {
  id: number;
  name: string;
  slug: string;
  area: string;
  area_slug: string;
  region: string;
  lowest_fee: string | null;
  shortest_duration_weeks: number | null;
  next_intake: string | null;
  distance_m: number | null;
  site_visit: SiteVisit;
  government_status: GovernmentStatusBadge;
  primary_photo: string | null;
  /** The workshop's own mark. Null for most: few have one. */
  logo: string | null;
  /** Screen 2 plots these. */
  lat: number;
  lng: number;
  listing_confirmed_on: string | null;
  is_stale: boolean;
};

export type Intake = {
  id: number;
  start_date: string;
  places_offered: number | null;
  places_remaining: number | null;
  is_open: boolean;
};

export type Programme = {
  id: number;
  title: string;
  trade: string;
  trade_slug: string;
  fee: string;
  instalments_allowed: boolean;
  instalment_note: string;
  duration_weeks: number;
  hours_per_week: number | null;
  weekly_schedule: string;
  capacity: number | null;
  intakes: Intake[];
};

export type Verification = {
  visited_on: string;
  checks_performed: string;
  outcome: string;
  expires_on: string | null;
  officer: string;
};

export type GovernmentStatusDetail = {
  registration_status: string;
  registration_status_display: string;
  registration_number: string;
  accreditation_status: string;
  accreditation_status_display: string;
  documented_on: string | null;
  source_note: string;
} | null;

export type ProviderDetail = ProviderCard & {
  address: string;
  owner_name: string;
  photos: { id: number; kind: ProviderPhotoKind; image: string; caption: string }[];
  programmes: Programme[];
  verifications: Verification[];
  government_status_detail: GovernmentStatusDetail;
  contact_phone: string;
};

export type Trade = {
  id: number;
  name: string;
  slug: string;
  description: string;
  provider_count: number;
};

export type Region = {
  id: number;
  name: string;
  slug: string;
  is_launched: boolean;
  areas: {
    id: number;
    name: string;
    slug: string;
    region_slug: string;
    provider_count: number;
    centroid_lat: number | null;
    centroid_lng: number | null;
  }[];
};

export type AreaSummary = {
  provider_count: number;
  lowest_fee: string | null;
  highest_fee: string | null;
  average_fee: string | null;
  shortest_weeks: number | null;
  longest_weeks: number | null;
  has_enough_inventory_to_index: boolean;
  minimum_for_indexing: number;
};

export type DashboardData = {
  provider: { name: string; slug: string };
  period_days: number;
  enquiries: number;
  profile_views: number | null;
  response_rate: number | null;
  response_rate_basis: string;
  enrolments: number;
  enrolment_fees_cedis: string | null;
  average_fee_cedis: string | null;
  enrolments_basis: string;
  listing: { status: string; last_confirmed_at: string | null; is_stale: boolean };
  subscription: { tier: string; price: string; period_end: string } | null;
};

export type TrainerIntake = {
  id: number;
  start_date: string;
  places_offered: number | null;
  places_remaining: number | null;
  is_open: boolean;
};

export type TrainerProgramme = {
  id: number;
  trade: { id: number; name: string; slug: string };
  title: string;
  fee: string | number;
  instalments_allowed: boolean;
  instalment_note: string;
  duration_weeks: number;
  hours_per_week: number | null;
  weekly_schedule: string;
  capacity: number | null;
  /** What the fee covers. A fee excluding materials is not comparable. */
  fee_includes_tools: boolean;
  fee_includes_materials: boolean;
  fee_includes_ppe: boolean;
  fee_includes_certificate: boolean;
  certificate_awarded: string;
  intake: TrainerIntake | null;
};

export type TrainerProfile = {
  id: number;
  name: string;
  owner_name: string;
  /** Private sign-in identity. The server owns this field. */
  owner_phone: string;
  /** Public number trainees use for WhatsApp enquiries. */
  contact_phone: string;
  area: { id: number; name: string; slug: string; region: string };
  address: string;
  latitude: number;
  longitude: number;
  /** The nearest well-known place. What a field officer navigates by. */
  landmark: string;
  year_established: number | null;
  premises_tenure: TrainerPremisesTenure | "";
  trainer_count: number | null;
  trainee_count: number | null;
  /** Declarations, stored server-side as the moment they were made. */
  declared_accurate_at: string | null;
  site_visit_consent_at: string | null;
  status: "draft" | "pending_approval" | "published" | "suspended" | string;
  status_label: string;
  review_note: string;
  submitted_at: string | null;
  editable: boolean;
  /** Shown as unconfirmed on the public listing. Drives the confirm prompt. */
  is_stale: boolean;
  last_confirmed_at: string | null;
  /** Only a published listing has anything that can go out of date. */
  can_confirm: boolean;
  logo: string | null;
  photos: TrainerPhoto[];
  identity: TrainerIdentity | null;
  programme: TrainerProgramme | null;
};

export type TrainerPremisesTenure = "owned" | "rented" | "shared";

export type TrainerRole = "owner" | "manager" | "lead_trainer";

export type TrainerIdDocument = "ghana_card" | "passport" | "voter_id";

/** A public workshop photograph. */
/** What a photograph shows. Mirrors ProviderPhoto.Kind on the server. */
export type ProviderPhotoKind = "workshop" | "work";

export type TrainerPhoto = {
  id: number;
  kind: ProviderPhotoKind;
  url: string;
  caption: string;
};

/**
 * Who the trainer says they are.
 *
 * `has_document` is a boolean and not a URL on purpose: Section 10 requires
 * identity documents are never publicly served, so nothing outside the back
 * office ever receives a link to one.
 */
export type TrainerIdentity = {
  full_name: string;
  role: TrainerRole | "";
  id_document_type: TrainerIdDocument | "";
  id_document_number: string;
  has_document: boolean;
  data_consent_given: boolean;
};

export type TrainerAccountStatus = "pending" | "confirmed" | "declined";

export type TrainerSession =
  | { authenticated: false; profile: null; phone?: never }
  | {
      authenticated: true;
      phone: string;
      /** A second way in, or null until the trainer verifies one. */
      email?: string | null;
      /** Whether the super admin has confirmed this trainer sign-up. */
      account_status?: TrainerAccountStatus;
      account_note?: string;
      profile: TrainerProfile | null;
    };

export type TraineeChannel = "whatsapp" | "telegram";

/** Mirrors TraineeAccount.EducationLevel in backend/trainees/models.py. */
export type TraineeEducationLevel =
  | "not_in_school"
  | "jhs"
  | "shs_general"
  | "shs_technical"
  | "tvet"
  | "university"
  | "other";

export type TraineeEducationStatus = "in_progress" | "completed" | "left";

export type TraineeAccount = {
  phone: string;
  /**
   * A second way to sign in, or null. The phone stays the identity — it is
   * what a workshop replies to on WhatsApp. Claimed by proving the address
   * with a one-time code, so it is read-only on the settings endpoint.
   */
  email: string | null;
  display_name: string;
  preferred_channel: TraineeChannel;
  /** All of the background is optional: registration never blocks on it. */
  education_level: TraineeEducationLevel | "";
  institution_name: string;
  field_of_study: string;
  education_status: TraineeEducationStatus | "";
  education_year: number | null;
  created_at: string;
};

/** Present only when a member of staff is viewing this account to help. */
export type TraineeSupport = {
  staff_name: string;
  reason: string;
  can_edit: boolean;
  expires_at: string;
  back_office_url: string;
};

export type TraineeSession =
  | { authenticated: false; account: null; support: null }
  | { authenticated: true; account: TraineeAccount; support: TraineeSupport | null };

export type TraineeProviderLink = {
  id: number;
  name: string;
  slug: string;
  area: string;
  area_slug: string;
  is_listed: boolean;
};

export type TraineeEnquiryStatus = "sent" | "replied" | "visited" | "enrolled" | "not_delivered";

export type TraineeEnquiry = {
  reference_code: string;
  provider: TraineeProviderLink;
  programme_title: string;
  intake_start: string | null;
  message: string;
  status: TraineeEnquiryStatus;
  whatsapp_url: string;
  created_at: string;
};

export type TraineeEnrolment = {
  id: number;
  provider: TraineeProviderLink;
  programme_title: string;
  started_on: string;
  completed_on: string | null;
  fee_paid: string | null;
};

export type SavedProvider = {
  provider: TraineeProviderLink;
  created_at: string;
};

export type TrainerArea = {
  id: number;
  name: string;
  slug: string;
  region_slug: string;
  provider_count: number;
  centroid_lat: number | null;
  centroid_lng: number | null;
};

export type EnquiryConfirmation = {
  reference_code: string;
  provider_name: string;
  whatsapp_url: string;
  expect_reply_within_hours: number;
  created_at: string;
};

/**
 * Screen 5, as the server computes it.
 *
 * `profile_views` is null rather than 0 on purpose: there is no analytics
 * source yet, and a zero reads as "nobody looked" — a claim the software
 * cannot make. `response_rate` is null when there were no enquiries to
 * measure, which is not the same as a rate of zero.
 */
export type TrainerDashboard = {
  provider: {name: string; slug: string};
  period_days: number;
  enquiries: number;
  profile_views: number | null;
  response_rate: number | null;
  response_rate_basis: string;
  enrolments: number;
  enrolment_fees_cedis: string | null;
  average_fee_cedis: string | null;
  enrolments_basis: string;
  listing: {
    status: string;
    last_confirmed_at: string | null;
    is_stale: boolean;
  };
  subscription: {tier: string; price: string; period_end: string} | null;
};

export type TrainerEnquiry = {
  reference_code: string;
  programme: string | null;
  trainee_name: string;
  trainee_phone: string;
  message: string;
  created_at: string;
  replied: boolean;
  /** Click-to-chat with the trainee, quoting the reference. Free — only a
   *  business-initiated template costs anything. */
  whatsapp_url: string;
};

/**
 * Which of the two public account areas the visitor is signed into.
 *
 * Both are nullable and both can be null at once: a member of staff is signed
 * into the back office, which is neither of these.
 */
export type Whoami = {
  trainer: {name: string} | null;
  trainee: {name: string} | null;
};
