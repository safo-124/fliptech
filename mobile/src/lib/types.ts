/**
 * The API's shapes the app reads. Copied from frontend/src/lib/types.ts,
 * trimmed to the fields used here; the backend is the same for both.
 */

export type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type Trade = { name: string; slug: string; colour: string };

export type CourseCard = {
  id: number;
  name: string;
  slug: string;
  area: string;
  area_slug: string;
  trade: Trade | null;
  lessons: number;
  total_seconds: number | null;
  poster: string | null;
  price: string | null;
  full_price?: string | null;
  level?: string;
  summary?: string;
  rating?: number | null;
  reviews?: number;
  featured?: boolean;
};

export type ProductCard = {
  id: number;
  name: string;
  price: string | null;
  was_price: string | null;
  availability: "available" | "made_to_order" | "sold_out";
  trade: Trade | null;
  photo: string | null;
  seller: {
    id: number;
    business_name: string;
    area: string | null;
    /** The training listing, when the shop is also a workshop on the site. */
    workshop: { name: string; slug: string; area_slug: string } | null;
    verified?: boolean;
    rating?: { average: number; count: number } | null;
    student_discount?: number | null;
  };
  /** "used" for second-hand tools. */
  condition?: "new" | "used";
  /** "Only N left". */
  few_left?: number | null;
  sponsored: boolean;
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
  primary_photo: string | null;
  trade: Trade | null;
  lat: number;
  lng: number;
};

export type TradeOption = { id: number; name: string; slug: string; colour: string; provider_count: number };

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
  trade_colour: string;
  fee: string;
  instalments_allowed: boolean;
  instalment_note: string;
  fee_includes_tools: boolean;
  fee_includes_materials: boolean;
  fee_includes_ppe: boolean;
  fee_includes_certificate: boolean;
  certificate_awarded: string;
  extra_costs: string | null;
  extra_costs_note: string;
  duration_weeks: number;
  hours_per_week: number | null;
  weekly_schedule: string;
  capacity: number | null;
  intakes: Intake[];
};

export type WorkshopDetail = ProviderCard & {
  address: string;
  owner_name: string;
  photos: { id: number; kind: string; image: string; caption: string; before: string | null }[];
  directions: string;
  entrance_photo: string | null;
  master: {
    name: string;
    portrait: string | null;
    years_in_trade: number | null;
    apprentices_trained: number | null;
    languages: string[];
  } | null;
  videos: { id: number }[];
  programmes: Programme[];
  site_visit: { visited_on: string; outcome: "passed" | "passed_with_notes" | "failed" } | null;
  government_status: { registration_status: string; label: string };
  contact_phone: string;
};

export type EnquiryConfirmation = {
  reference_code: string;
  provider_name: string;
  /** The chat with the workshop the enquiry opened (/chats/<id>). */
  conversation_id?: number | null;
  /** Only when there is no chat (a switched-off account). */
  whatsapp_url: string | null;
  expect_reply_within_hours: number | null;
};

export type VideoSource = { quality: number; url: string; bytes: number | null };

/** A lesson of a course. A locked one, of a paid course not bought, has no sources. */
export type Lesson = {
  id: number;
  title: string;
  kind: "upload" | "youtube";
  youtube_id: string;
  duration_seconds: number | null;
  poster: string | null;
  sources: VideoSource[];
  stream?: string | null;
  locked?: boolean;
  section?: string;
  description?: string;
};

export type CourseDetail = {
  course: CourseCard;
  lessons: Lesson[];
  details: { summary: string; outcomes: string[]; tools: string[]; level: string; sale_ends_at: string | null };
  programmes: { id: number; title: string; trade: string; fee: string; duration_weeks: number }[];
};

export type LessonProgressRow = { position: number; furthest: number; completed: boolean };

export type Certificate = {
  code: string;
  trainee_name: string;
  course_name: string;
  lessons: number;
  issued_at: string;
  is_revoked: boolean;
  path: string;
};

/** What this signed-in phone may watch of a course. See backend courses/views.py. */
export type CourseAccess = {
  price: string | null;
  full_price: string | null;
  sale_ends_at: string | null;
  owned: boolean;
  signed_in: boolean;
  payments_enabled: boolean;
  sources: Record<string, VideoSource[]>;
  streams: Record<string, string>;
  progress: Record<string, LessonProgressRow>;
  certificate: Certificate | null;
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

export type ProductOption = { id: number; label: string; price: string | null; available: boolean };

export type ProductDetail = ProductCard & {
  description: string;
  buy_online: boolean;
  photos: { id: number; image: string | null; caption: string; display_order: number }[];
  options: ProductOption[];
  /** Collect from the workshop, when the shop is a training workshop. */
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
  plan: "full" | "deposit" | "collect";
  deposit_percent: number | null;
  collect_deposit_percent?: number | null;
  pay_now: string;
  balance: string;
  /** The workshop's student price was applied. */
  student?: boolean;
};

export type Order = {
  reference: string;
  product_name: string;
  quantity: number;
  amount: string;
  buyer_name: string;
  buyer_phone: string;
  fulfilment: "pickup" | "delivery";
  note: string;
  items: { product: number | null; product_name: string; option_label: string; unit_price: string; quantity: number }[];
  plan: "full" | "deposit" | "collect";
  deposit: string;
  balance: string;
  balance_status: string;
  delivery: string;
  discount: string;
  status: "pending" | "paid" | "failed" | "refunded";
  stage: string;
  protected: boolean;
  seller_name: string;
  seller_phone: string | null;
  /** For "Message the seller". */
  seller_id?: number;
  created_at?: string;
  paid_at?: string | null;
  problem?: string;
  problem_reply?: string;
  pickup?: PickupPoint | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  received_at?: string | null;
};

/** A shop that is also a training workshop. See backend TrainerShopsView. */
export type TrainerShop = {
  id: number;
  business_name: string;
  area: string;
  photo: string | null;
  product_count: number;
  workshop: { name: string; slug: string; area_slug: string };
};

/** A shop page. See backend SellerDetailView. */
export type ShopDetail = {
  seller: {
    id: number;
    business_name: string;
    about: string;
    area: string;
    region: string;
    workshop: { name: string; slug: string; area_slug: string } | null;
    rating: { average: number; count: number } | null;
    verified: boolean;
    replies_fast: boolean;
    delivery_fee: string | null;
    delivery_area: string;
    student_discount: number | null;
    away_until: string | null;
    away_note: string;
  };
  products: ProductCard[];
  on_plan: boolean;
  banner: string | null;
  reviews: { id: number; rating: number; comment: string; bought: boolean; product_name: string; buyer_name: string; created_at: string }[];
};

export type FollowState = { following: boolean; followers: number; signed_in: boolean };

/**
 * Chats between a person and a shop or a training workshop (backend
 * marketplace/chat.py). "buyer" is the person's side, a buyer or a trainee;
 * "seller" is the shop's or the workshop's.
 */
export type ChatMessage = {
  id: number;
  sender: "buyer" | "seller";
  /** "enquiry" carries a course card; "phone" is the sender sharing their own number. */
  kind?: "text" | "enquiry" | "phone";
  body: string;
  product: { id: number; name: string; price: string | null; photo: string | null } | null;
  course?: { reference: string; title: string; fee: string | null; starts: string | null } | null;
  created_at: string;
};

export type ChatReportReason = "scam" | "money" | "abuse" | "other";

export type ChatSummary = {
  id: number;
  kind?: "shop" | "workshop";
  with: { name: string; id: number | null };
  /** The shop or workshop in the chat, and its page on the site. */
  business?: { kind: "shop" | "workshop"; id: number; name: string; path: string };
  last: ChatMessage | null;
  unread: number;
  last_message_at: string;
};

export type ChatThread = ChatSummary & { messages: ChatMessage[] };

export type SavedSearch = {
  id: number;
  label: string;
  params: Record<string, string>;
  path: string;
  created_at: string;
  last_told_at: string | null;
};

/** Learn and buy: a workshop's course and kit together. See backend bundles.py. */
export type Bundle = {
  id: number;
  title: string;
  blurb: string;
  percent_off: number;
  includes_course: boolean;
  course: { name: string; price: string | null; path: string; area_slug: string; slug: string } | null;
  items: { product: { id: number; name: string; price: string | null; photo: string | null }; quantity: number }[];
  seller: { id: number; business_name: string };
  full_price: string | null;
  price: string | null;
  saving: string | null;
  delivery_fee: string | null;
  buy_online: boolean;
  problem: string;
};

export type SellerPayouts = {
  results: {
    reference: string;
    product: string;
    paid_at: string;
    yours: string;
    state: "paid_out" | "held" | "refunded";
    stage: string;
    due: string | null;
    waiting_for: "" | "handover" | "buyer" | "problem";
  }[];
  totals: { paid_out: string; held: string; refunded: string };
  level: "confirmed" | "payments" | "verified";
  takes_payments: boolean;
};

export type SellerProduct = {
  id: number;
  name: string;
  price: string | null;
  availability: "available" | "made_to_order" | "sold_out";
  stock: number | null;
  status: "draft" | "published" | "suspended";
  visible: boolean;
  photos: { id: number; image: string | null }[];
};

/** Site search (backend search/views.py). */
export type SiteSearch = {
  q: string;
  understood: {
    trade: Trade | null;
    area: { slug: string; name: string; region: string } | null;
    words: string;
  };
  trades: (Trade & { provider_count: number })[];
  workshops: { count: number; results: ProviderCard[] };
  courses: { count: number; results: CourseCard[] };
  products: { count: number; results: ProductCard[] };
  shops: { count: number; results: { id: number; business_name: string; area: string }[] };
  nearby: ProviderCard[];
  trades_here: Trade[];
};
