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
  seller: { id: number; business_name: string; area: string | null };
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
