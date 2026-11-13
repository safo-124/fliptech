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
  /** The trade the card is labelled with: the one searched for, or its cheapest course's. */
  trade: { name: string; slug: string; colour: string } | null;
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
  /** See lib/trades.ts. */
  trade_colour: string;
  fee: string;
  instalments_allowed: boolean;
  instalment_note: string;
  /** What the fee covers, shown as a receipt on the listing. */
  fee_includes_tools: boolean;
  fee_includes_materials: boolean;
  fee_includes_ppe: boolean;
  fee_includes_certificate: boolean;
  certificate_awarded: string;
  /** Roughly what a trainee spends on top of the fee, in cedis, or null if unknown. */
  extra_costs: string | null;
  extra_costs_note: string;
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

/** One encoded copy of an uploaded video. `quality` is the short side in pixels. */
export type VideoSource = { quality: number; url: string; bytes: number | null };

/**
 * A teaching video on a listing. Only approved ones reach the public API.
 *
 * `upload` plays from the site's own files, smallest first in `sources`.
 * `youtube` is a link added before uploads existed and carries only its id.
 */
export type ProviderVideo = {
  id: number;
  title: string;
  kind: "upload" | "youtube";
  youtube_id: string;
  duration_seconds: number | null;
  poster: string | null;
  sources: VideoSource[];
  /** The HLS master playlist, for players that change sharpness with the signal. */
  stream?: string | null;
  /** Languages with captions; the WebVTT is behind the lesson's own lock. */
  captions?: LessonCaption[];
  /** A lesson of a paid course this viewer has not bought: no sources. */
  locked?: boolean;
  /** The heading this lesson sits under in its course; "" for none. */
  section?: string;
  /** What the lesson covers, in the trainer's words. */
  description?: string;
};

export type LessonCaption = { language: string; label: string; url: string };

/**
 * Online learning: a workshop's approved lessons, browsed as one course.
 * See backend/providers/learning.py.
 */
export type CourseCard = {
  id: number;
  name: string;
  slug: string;
  area: string;
  area_slug: string;
  trade: { name: string; slug: string; colour: string } | null;
  lessons: number;
  total_seconds: number | null;
  poster: string | null;
  /** Cedis for the whole course today, or null when it is free. */
  price: string | null;
  /** The price before a launch sale, while one is on. */
  full_price?: string | null;
  level?: CourseLevel | "";
  summary?: string;
  /** Average stars, or null before the first review. */
  rating?: number | null;
  reviews?: number;
  featured?: boolean;
};

export type CourseLevel = "beginner" | "intermediate" | "advanced";

export type RatingSummary = {
  average: number | null;
  count: number;
  /** "5" to "1": how many gave each. */
  spread: Record<string, number>;
};

export type CourseDetail = {
  course: CourseCard;
  lessons: ProviderVideo[];
  details: {
    summary: string;
    outcomes: string[];
    tools: string[];
    level: CourseLevel | "";
    sale_ends_at: string | null;
  };
  ratings: RatingSummary;
  /** The workshop's in-person programmes, offered once the videos are done. */
  programmes: {
    id: number;
    title: string;
    trade: string;
    fee: string;
    duration_weeks: number;
  }[];
};

export type LessonProgressRow = { position: number; furthest: number; completed: boolean };

export type Certificate = {
  code: string;
  trainee_name: string;
  course_name: string;
  area_name: string;
  trade_name: string;
  lessons: number;
  total_seconds: number;
  issued_at: string;
  is_revoked: boolean;
  path: string;
  course_path?: string;
};

export type CourseReview = {
  id: number;
  name: string;
  rating: number;
  body: string;
  reply: string;
  replied_at: string | null;
  created_at: string;
};

export type LessonQuestion = {
  id: number;
  name: string;
  body: string;
  at_seconds: number | null;
  answer: string;
  answered_at: string | null;
  created_at: string;
};

export type ProgressReply = {
  lesson: LessonProgressRow;
  course: {
    done: number;
    total: number;
    finished: boolean;
    needs_name: boolean;
    certificate: Certificate | null;
  };
};

export type MyCourse = {
  course: CourseCard;
  done: number;
  total: number;
  bought: boolean;
  last_watched: string | null;
  resume: { id: number; title: string; position: number; duration_seconds: number | null } | null;
  certificate: Certificate | null;
};

export type ProviderDetail = ProviderCard & {
  address: string;
  owner_name: string;
  /** The workshop and the work. A work photo may carry the same piece `before`. */
  photos: {
    id: number;
    kind: ProviderPhotoKind;
    image: string;
    caption: string;
    before: string | null;
  }[];
  /** How a trainee finds the gate, written by the workshop for the public. */
  directions: string;
  /** A photo of the way in, for the "find the gate" card. */
  entrance_photo: string | null;
  /** The master or madam who teaches, for the portrait strip; null if unknown. */
  master: {
    name: string;
    portrait: string | null;
    years_in_trade: number | null;
    apprentices_trained: number | null;
    /** See lib/teaching-languages.ts. */
    languages: string[];
  } | null;
  videos: ProviderVideo[];
  programmes: Programme[];
  verifications: Verification[];
  government_status_detail: GovernmentStatusDetail;
  contact_phone: string;
};

/** One row of the search page's departures board. See UpcomingIntakesView. */
export type UpcomingIntake = {
  start_date: string;
  places_remaining: number | null;
  course: string;
  trade: string;
  trade_colour: string;
  provider: string;
  area: string;
  area_slug: string;
  slug: string;
};

export type Trade = {
  id: number;
  name: string;
  slug: string;
  description: string;
  /** See lib/trades.ts. */
  colour: string;
  /** The trade's hand-painted signboard picture, or null until there is one. */
  picture: string | null;
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
  profile_views: number;
  profile_views_basis: string;
  /** Set while counting is younger than the window, so a short count is not read as a slow month. */
  profile_views_counted_since: string | null;
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
  /** Roughly what a trainee spends on top of the fee, in cedis, or null if unknown. */
  extra_costs: string | null;
  extra_costs_note: string;
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
  /** Public directions to the gate. The landmark above is private. */
  directions: string;
  /** The master who teaches, for the listing's portrait strip. */
  lead_trainer_name?: string;
  in_trade_since?: number | null;
  apprentices_trained?: number | null;
  teaching_languages?: string[];
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
/** Mirrors ProviderPhoto.Kind. A "before" is paired with a "work" photo. */
export type ProviderPhotoKind = "workshop" | "work" | "before" | "entrance" | "portrait";

export type TrainerPhoto = {
  id: number;
  kind: ProviderPhotoKind;
  url: string;
  caption: string;
  /** For a "before": the id of the finished-work photo it pairs with. */
  before_of?: number | null;
};

/** Mirrors ProviderVideo.Status in backend/providers/models.py. */
export type TrainerVideoStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "failed"
  | "pending"
  | "approved"
  | "rejected";

/** One of the trainer's own videos, with where it stands. */
export type TrainerVideo = ProviderVideo & {
  status: TrainerVideoStatus;
  /** Why it was turned down, written for the trainer to act on. */
  review_note: string;
  /** Why it could not be prepared, likewise. */
  failure_reason: string;
  /** The file's name on the phone, to recognise it when an upload resumes. */
  upload_name: string;
  upload_size: number | null;
  upload_received: number;
  created_at: string;
};

/** The allowances, from backend/providers/videos.py limits(). */
export type TrainerVideoLimits = {
  max_videos: number;
  max_minutes: number;
  max_hours: number;
  max_upload_bytes: number;
  chunk_bytes: number;
  seconds_used: number;
};

export type TrainerVideoList = { videos: TrainerVideo[]; limits: TrainerVideoLimits };

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
  /** The trainee's own picture, or null. Shown to them and to staff in a
   *  support session; never to a workshop. */
  avatar: string | null;
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
  /** The chat with the workshop, at /account/chats/<id>. */
  conversation_id: number | null;
  /** Only for an enquiry from before the chat. */
  whatsapp_url: string | null;
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
  /** The chat with the workshop the enquiry opened, at /account/chats/<id>. */
  conversation_id: number | null;
  /** Only when there is no chat (a switched-off account). */
  whatsapp_url: string | null;
  expect_reply_within_hours: number;
  created_at: string;
};

/**
 * Screen 5, as the server computes it.
 *
 * `response_rate` is null when there were no enquiries to measure, which is
 * not the same as a rate of zero. Profile views are counted by a beacon from
 * the profile page, once per visitor per day.
 */
export type TrainerDashboard = {
  provider: {name: string; slug: string};
  period_days: number;
  enquiries: number;
  profile_views: number;
  profile_views_basis: string;
  profile_views_counted_since: string | null;
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
  /** Null for an enquiry in the chat: their number is theirs to share. */
  trainee_phone: string | null;
  message: string;
  created_at: string;
  replied: boolean;
  /** WhatsApp to the trainee, only for an enquiry from before the chat. */
  whatsapp_url: string | null;
  /** The chat the enquiry opened, at /inbox/<id>. */
  conversation_id: number | null;
};

/**
 * Which of the two public account areas the visitor is signed into.
 *
 * Both are nullable and both can be null at once: a member of staff is signed
 * into the back office, which is neither of these.
 */
export type Whoami = {
  /** Everyone signed in has a customer account. */
  customer: {name: string; avatar?: string | null} | null;
  seller: {name: string} | null;
  trainer: {name: string} | null;
  // Only the trainee has a picture — a workshop is represented by its listing
  // photos, not a portrait.
  trainee: {name: string; avatar: string | null} | null;
};

// ---------------------------------------------------------------------------
// Marketplace

/** The seller as a buyer sees them. No phone number: contacting a seller goes
    through an enquiry that can be counted and moderated, and printing the
    number would route around it. */
export type SellerCard = {
  id: number;
  business_name: string;
  about: string;
  area: string;
  area_slug: string;
  region: string;
  /** The training listing, when this seller is also a workshop. The strongest
      thing a buyer can be told: not an anonymous account, a place with an
      address, and here is the page. */
  workshop: {name: string; slug: string; area_slug: string} | null;
  /** From buyers who asked or paid through the site; null with none yet. */
  rating: {average: number; count: number} | null;
  /** Usually replies within a day. */
  replies_fast: boolean;
  /** Staff visited and saw the work being made. */
  verified: boolean;
  /** Cedis added for delivery at checkout; null when they don't deliver through the site. */
  delivery_fee: string | null;
  delivery_area: string;
  /** Made-to-order work can be bought for this deposit (%), or ask-only when null. */
  deposit_percent: number | null;
  /** Percent off for the workshop's own trainees, when the shop is a workshop. */
  student_discount: number | null;
  /** Pay on collection: this share online, the rest in cash. */
  collect_deposit_percent?: number | null;
  /** confirmed (lists and answers), payments (ID checked), verified (visited). */
  level?: "confirmed" | "payments" | "verified";
  /** Away: Buy now is off until this date. */
  away_until: string | null;
  away_note: string;
};

export type ProductCard = {
  id: number;
  name: string;
  slug: string;
  /** Null means "price on request", a real answer for something made to order. */
  price: string | null;
  /** The price before a sale, shown crossed out; only when it was higher. */
  was_price: string | null;
  availability: "available" | "made_to_order" | "sold_out";
  /** "used" for second-hand tools. */
  condition: "new" | "used";
  /** "Only N left", when the seller counts stock and few remain. */
  few_left?: number | null;
  trade: {name: string; slug: string; colour: string} | null;
  photo: string | null;
  seller: SellerCard;
  /** A paid boost is running: shown as "Sponsored". */
  sponsored: boolean;
  /** From the point the buyer gave (?near=), when they gave one. */
  distance_km: number | null;
  /** Whether "Buy now" is offered: the seller can be paid on the site. */
  buy_online: boolean;
  created_at: string;
};

/** A buyer's review, as anyone sees it: a first name at most. */
export type SellerReview = {
  id: number;
  rating: number;
  comment: string;
  bought: boolean;
  product_name: string;
  buyer_name: string;
  created_at: string;
};

export type SellerShop = {
  seller: SellerCard;
  products: ProductCard[];
  /** Shop plan benefits show only while the plan runs. */
  on_plan: boolean;
  banner: string | null;
  reviews: SellerReview[];
};

/** An order on the site, as its buyer or seller sees it. See marketplace/selling_views.py. */
export type MarketplaceOrder = {
  reference: string;
  product: number | null;
  product_name: string;
  unit_price: string;
  quantity: number;
  amount: string;
  commission: string;
  currency: string;
  buyer_name: string;
  buyer_phone: string;
  fulfilment: "pickup" | "delivery";
  note: string;
  items: {
    product: number | null;
    product_name: string;
    option_label: string;
    unit_price: string;
    quantity: number;
  }[];
  plan: "full" | "deposit" | "collect";
  /** For a deposit order: what was paid first, and what is owed when ready. */
  deposit: string;
  balance: string;
  balance_status: "none" | "waiting" | "due" | "paid";
  ready_at: string | null;
  delivery: string;
  discount: string;
  discount_code: string;
  status: "pending" | "paid" | "failed";
  stage: "new" | "delivered" | "received" | "problem" | "refunded";
  payout: "split" | "held" | "sending" | "released" | "failed" | "refunded";
  /** Buyer protection: the seller is paid once the buyer has it. */
  protected: boolean;
  problem: string;
  problem_at?: string | null;
  /** The seller's side of a reported problem. */
  problem_reply?: string;
  problem_replied_at?: string | null;
  /** Collect from the workshop, for a paid pickup order. */
  pickup?: PickupPoint | null;
  seller_name: string;
  /** Only once paid. */
  /** For "Message the seller": the chat is with the shop. */
  seller_id: number;
  seller_phone: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  created_at: string;
};

/** A bag line kept in the browser, and the server's price for a bag. */
export type BagItem = {product: number; option: number | null; quantity: number};

export type BasketPrice = {
  lines: {
    product: number;
    product_name: string;
    option: number | null;
    option_label: string;
    unit_price: string;
    quantity: number;
    total: string;
  }[];
  subtotal: string;
  discount: string;
  code: string;
  delivery: string;
  delivery_fee: string | null;
  delivery_area: string;
  total: string;
  protected: boolean;
  /** The workshop's student price was applied. */
  student?: boolean;
  /** "deposit" when anything is made to order: pay_now now, balance when ready. */
  plan: "full" | "deposit" | "collect";
  deposit_percent: number | null;
  /** Pay on collection: this share online, the rest in cash. */
  collect_deposit_percent?: number | null;
  pay_now: string;
  balance: string;
};

export type FeaturedShop = SellerCard & {photo: string | null};

/** A shop that is also a training workshop, with how much it has on show. */
export type TrainerShop = FeaturedShop & {product_count: number};

export type ProductOption = {id: number; label: string; price: string | null; available: boolean};

export type ProductDetail = ProductCard & {
  description: string;
  photos: {id: number; image: string | null; caption: string; display_order: number}[];
  /** Sizes, colours or versions; one must be chosen when any is available. */
  options: ProductOption[];
  /** Collect from the workshop: its address and map point, for a shop that is one. */
  pickup: PickupPoint | null;
};

export type PickupPoint = {
  name: string;
  address: string;
  directions: string;
  area: string;
  lat: number | null;
  lng: number | null;
  workshop_path: string;
};

/** Learn and buy: a workshop's course and kit together. See backend bundles.py. */
export type Bundle = {
  id: number;
  title: string;
  blurb: string;
  percent_off: number;
  is_active: boolean;
  includes_course: boolean;
  course: {name: string; price: string | null; path: string; area_slug: string; slug: string} | null;
  items: {product: {id: number; name: string; price: string | null; photo: string | null}; quantity: number}[];
  seller: {id: number; business_name: string};
  full_price: string | null;
  price: string | null;
  saving: string | null;
  delivery_fee: string | null;
  buy_online: boolean;
  problem: string;
};

/** A staff-chosen home page photograph. See backend core.models.HomePicture. */
export type HomePicture = { url: string; alt: string; credit: string };

/** By place. A place with no picture is absent, and the page falls back. */
export type HomePictures = Partial<
  Record<"hero" | "training" | "learning" | "marketplace", HomePicture>
>;

/** The home page's trust strip. See backend core/site_stats.py. */
export type SiteStats = { workshops: number; visited: number; lessons: number; products: number };

/** What this browser may watch of a course. See backend courses/views.py. */
export type CourseAccess = {
  price: string | null;
  full_price: string | null;
  sale_ends_at: string | null;
  owned: boolean;
  signed_in: boolean;
  payments_enabled: boolean;
  /** By lesson id: the sources this viewer may play. */
  sources: Record<string, VideoSource[]>;
  /** By lesson id: the HLS stream, where one has been made. */
  streams: Record<string, string>;
  /** By lesson id, for a signed-in trainee. */
  progress: Record<string, LessonProgressRow>;
  certificate: Certificate | null;
  my_review: CourseReview | null;
  can_review: boolean;
};

/** The trainer's course studio. See backend courses/studio.py. */
export type StudioDetails = {
  summary: string;
  outcomes: string;
  tools: string;
  /** Marketplace products linked as "Tools you need". */
  tool_products: { id: number; name: string; seller: string }[];
  level: CourseLevel | "";
  levels: { value: CourseLevel; label: string }[];
  price: string | null;
  sale_price: string | null;
  sale_ends_at: string | null;
  on_sale: boolean;
  featured_until: string | null;
  course_path: string | null;
};

export type StudioLesson = {
  id: number;
  title: string;
  status: string;
  position: number;
  section: string;
  description: string;
  duration_seconds: number | null;
  poster: string | null;
  kind: "upload" | "youtube";
  stream: string;
  captions: LessonCaption[];
};

export type StudioCode = {
  id: number;
  code: string;
  percent_off: number;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  is_active: boolean;
  usable: boolean;
};

export type StudioStats = {
  totals: {
    plays: number;
    plays_30: number;
    learners: number;
    certificates: number;
    sales: number;
    earned: string;
    sales_30: number;
    earned_30: string;
    unanswered: number;
  };
  ratings: RatingSummary;
  daily: { day: string; plays: number }[];
  lessons: { id: number; title: string; plays: number; started: number; finished: number }[];
  codes: { code: string; uses: number }[];
};

export type StudioQuestion = LessonQuestion & { lesson: { id: number; title: string } };

/** A trainer's course price, payout account and sales. */
export type TrainerCourse = {
  payments_enabled: boolean;
  price: string | null;
  min_price: string;
  payout: {
    ready: boolean;
    bank_code: string;
    bank_name: string;
    account_last4: string;
    account_name: string;
  };
  sales: { count: number; total: string };
};

export type PayoutBank = { code: string; name: string; type: "mobile_money" | "ghipss" };

/** Site search (backend search/views.py). */
export type SearchTrade = {slug: string; name: string; colour: string};
export type SearchArea = {slug: string; name: string; region: string};

export type SiteSearch = {
  q: string;
  /** The trade and place read out of the words, and what was left over. */
  understood: {trade: SearchTrade | null; area: SearchArea | null; words: string};
  trades: (SearchTrade & {provider_count: number})[];
  workshops: {count: number; results: ProviderCard[]};
  courses: {count: number; results: CourseCard[]};
  products: {count: number; results: ProductCard[]};
  shops: {count: number; results: SellerCard[]};
  /** When no workshop matched a trade: the closest ones teaching it. */
  nearby: ProviderCard[];
  /** What else is taught in the area searched. */
  trades_here: SearchTrade[];
};

export type SearchSuggestion =
  | {kind: "trade_area"; label: string; trade: string; area: string}
  | {kind: "trade"; label: string; trade: string; count: number}
  | {kind: "area"; label: string; area: string}
  | {kind: "workshop"; label: string; sub: string; slug: string; area: string}
  | {kind: "product"; label: string; sub: string; id: number};

export type NearbyHelp = {
  trade: SearchTrade | null;
  area: SearchArea | null;
  nearby: ProviderCard[];
  trades_here: SearchTrade[];
};
