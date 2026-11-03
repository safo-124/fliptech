/**
 * Django API client.
 *
 * Fetches run on the server by default, so the browser never pays for them and
 * the API host is not exposed on the critical path. Section 10 asks that failed
 * requests retry — a mid-range Android on 3G drops connections routinely — so
 * every read goes through `fetchJson`, which retries twice with a short backoff.
 */

import {browserApiUrl} from "./api-origin";
import type {
  AreaSummary,
  Certificate,
  CourseCard,
  CourseDetail,
  HomePictures,
  SiteStats,
  DashboardData,
  Paginated,
  ProductCard,
  ProductDetail,
  ProviderCard,
  ProviderDetail,
  Region,
  SellerShop,
  Bundle,
  FeaturedShop,
  TrainerShop,
  Trade,
  UpcomingIntake,
} from "./types";

/**
 * Server-rendered requests go straight to Django over the container network;
 * the browser must use the public HTTPS origin.
 *
 * Using NEXT_PUBLIC_API_URL for both works in development, where they are the
 * same host, and breaks in production in two ways: every SSR request would
 * leave the machine, cross TLS and come back, and a container that cannot
 * resolve the public hostname would fail to render at all.
 */
const API_URL =
  typeof window === "undefined"
    ? (process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000")
    : browserApiUrl();

/**
 * Extra headers that only a server-rendered request needs.
 *
 * SSR reaches gunicorn over loopback while Django is configured for the public
 * origin, and two production settings reject that request:
 *
 *   SECURE_SSL_REDIRECT   the hop is plain HTTP, so Django answers 301 to
 *                         https://127.0.0.1/..., which has neither a listener
 *                         nor a certificate that would match. This header is
 *                         what prevents it, and it is not a lie: the request
 *                         did arrive over TLS, at Caddy, which terminated it.
 *                         Caddy sets the same header on browser traffic.
 *
 *   ALLOWED_HOSTS         the Host is "127.0.0.1:8000" and Django answers 400
 *                         DisallowedHost. That one cannot be fixed here —
 *                         Node's fetch silently ignores a Host header, so
 *                         DJANGO_ALLOWED_HOSTS has to list 127.0.0.1.
 *
 * Empty in the browser, where the request goes to the public HTTPS origin and
 * Caddy supplies the header itself.
 */
export const SSR_HEADERS: Record<string, string> =
  typeof window === "undefined" ? { "X-Forwarded-Proto": "https" } : {};

/** Search results change when staff edit a listing, not by the second. */
const LIST_REVALIDATE_SECONDS = 300;
const MAX_COMPLETE_PAGES = 100;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The one cache tag on every marketplace read. When a seller saves anything,
 * Django asks /revalidate to expire it (see app/revalidate/route.ts), so
 * product and shop pages change at once instead of up to five minutes later.
 */
export const MARKETPLACE_TAG = "marketplace";
/** Course pages, expired by Django when a course changes. */
export const LEARN_TAG = "learn";

async function fetchJson<T>(
  path: string,
  {
    revalidate = LIST_REVALIDATE_SECONDS,
    retries = 2,
    tags,
  }: { revalidate?: number; retries?: number; tags?: string[] } = {},
): Promise<T> {
  const url = `${API_URL}${path}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { next: { revalidate, tags }, headers: SSR_HEADERS });
      if (response.status === 404) throw new ApiError("Not found", 404);
      if (!response.ok) throw new ApiError(`API ${response.status}`, response.status);
      return (await response.json()) as T;
    } catch (error) {
      // A 404 is an answer, not a failure. Retrying it wastes the user's data.
      if (error instanceof ApiError && error.status === 404) throw error;
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export type SearchParams = {
  trade?: string;
  area?: string;
  region?: string;
  max_fee?: string;
  verified_only?: string;
  /** Only providers with a course that can seat a group this size. */
  places?: string;
  q?: string;
  lat?: string;
  lng?: string;
  radius_km?: string;
  bbox?: string;
  page?: string;
};

export function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function searchProviders(params: SearchParams = {}) {
  return fetchJson<Paginated<ProviderCard>>(`/api/providers/${buildQuery(params)}`);
}

/**
 * Follow a DRF paginated collection to completion.
 *
 * Dedicated map and sitemap routes cannot honestly use only page one: DRF's
 * global page size is deliberately small for the comparison list. Every
 * subsequent URL is reduced back to its path/query so server-side requests
 * keep using API_URL_INTERNAL instead of following Django's public hostname.
 */
async function fetchCompleteCollection<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  const visited = new Set<string>();
  let next: string | null = path;
  let expectedCount: number | null = null;

  while (next) {
    if (visited.has(next) || visited.size >= MAX_COMPLETE_PAGES) {
      throw new ApiError("API pagination did not complete safely", 502);
    }
    visited.add(next);

    const page: Paginated<T> = await fetchJson<Paginated<T>>(next);
    expectedCount ??= page.count;
    if (page.count !== expectedCount) {
      throw new ApiError("API collection changed while it was loading", 502);
    }
    items.push(...page.results);

    if (page.next) {
      const nextUrl = new URL(page.next, API_URL);
      next = `${nextUrl.pathname}${nextUrl.search}`;
    } else {
      next = null;
    }
  }

  if (items.length !== expectedCount) {
    throw new ApiError("API returned an incomplete collection", 502);
  }
  return items;
}

/** Every published provider, or an error—never a misleading partial map. */
export async function searchAllProviders(params: SearchParams = {}) {
  const providers = await fetchCompleteCollection<ProviderCard>(
    `/api/providers/${buildQuery(params)}`,
  );
  const unique = new Map(providers.map((provider) => [provider.id, provider]));
  if (unique.size !== providers.length) {
    throw new ApiError("API returned duplicate providers across pages", 502);
  }
  return [...unique.values()];
}

export function getProvider(area: string, slug: string) {
  return fetchJson<ProviderDetail>(`/api/providers/${area}/${slug}/`);
}

/** The next courses to start, for the departures board on the search page. */
// Three: what a phone shows, and each row more counts against the search
// page's 200 KB budget.
export function getUpcomingIntakes(limit = 3) {
  return fetchJson<UpcomingIntake[]>(`/api/intakes/upcoming/?limit=${limit}`);
}

export function getTrades() {
  return fetchJson<Paginated<Trade>>("/api/trades/");
}

export function getAllTrades() {
  return fetchCompleteCollection<Trade>("/api/trades/");
}

export function getTrade(slug: string) {
  return fetchJson<Trade>(`/api/trades/${slug}/`);
}

export function getRegions() {
  return fetchJson<Paginated<Region>>("/api/regions/");
}

export function getAllRegions() {
  return fetchCompleteCollection<Region>("/api/regions/");
}

export function getAreas() {
  return fetchJson<Paginated<{ slug: string; name: string; region_slug: string; provider_count: number }>>(
    "/api/areas/",
  );
}

export function getAllAreas() {
  return fetchCompleteCollection<Region["areas"][number]>("/api/areas/");
}

export function getAreaSummary(params: { trade: string; area?: string; region?: string }) {
  return fetchJson<AreaSummary>(`/api/pages/summary/${buildQuery(params)}`);
}

/** The dashboard is per-owner and must never be cached or shared. */
export function getDashboard(token: string) {
  return fetchJson<DashboardData>(`/api/dashboard/${token}/`, { revalidate: 0 });
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Client-side, from the enquiry form.
 *
 * Verifying a phone number now signs the trainee in, so the next POST carries
 * a session cookie and Django enforces CSRF on it. The token is echoed from
 * the readable csrftoken cookie; an anonymous visitor has none and needs none.
 */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = readCsrfCookie();
  if (token) headers["X-CSRFToken"] = token;
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      (data as { detail?: string }).detail ?? "Something went wrong. Try again.",
      response.status,
    );
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Marketplace
//
// Reads only. Asking a seller about something is a write from the browser and
// lives in marketplace-api.ts, next to the CSRF handling every write needs.

export type MarketplaceParams = {
  trade?: string;
  area?: string;
  region?: string;
  availability?: string;
  q?: string;
  /** "price", "-price", "newest" or "nearest"; empty is boosted first. */
  sort?: string;
  /** "lat,lng", from the buyer's "Near me". */
  near?: string;
  /** Comma-separated ids: the products saved in this browser. */
  ids?: string;
  page?: string;
  /** "trainers" (shops that are training workshops) or "makers". */
  sold_by?: string;
  /** One workshop's shop, by Provider id; or one shop, by seller id. */
  workshop?: string;
  seller?: string;
  /** In cedis, inclusive. */
  min_price?: string;
  max_price?: string;
  /** "1" to switch on. */
  pay_online?: string;
  delivers?: string;
  verified?: string;
  on_sale?: string;
  /** "4" for shops rated 4 stars or more. */
  min_rating?: string;
  /** "new" or "used" (second-hand). */
  condition?: string;
};

export function searchProducts(params: MarketplaceParams = {}) {
  return fetchJson<Paginated<ProductCard>>(`/api/products/${buildQuery(params)}`, {
    tags: [MARKETPLACE_TAG],
  });
}

/** Every product on show, for the sitemap. Capped, like the providers. */
export async function searchAllProducts() {
  const all: ProductCard[] = [];
  for (let page = 1; page <= MAX_COMPLETE_PAGES; page++) {
    const found = await searchProducts({ page: String(page) });
    all.push(...found.results);
    if (!found.next) break;
  }
  return all;
}

/** Shop plan shops for the home page. */
/** "Tools you need" for a course, as marketplace products. */
export function getCourseTools(area: string, slug: string) {
  return fetchJson<{chosen: boolean; tools: string[]; products: ProductCard[]}>(
    `/api/courses/${area}/${slug}/tools/`,
    {tags: [MARKETPLACE_TAG]},
  );
}

/** Bundles a course is sold in (its workshop's shop's). */
export function getCourseBundles(area: string, slug: string) {
  return fetchJson<{results: Bundle[]}>(`/api/courses/${area}/${slug}/bundles/`, {tags: [MARKETPLACE_TAG]});
}

export function getShopBundles(sellerId: number) {
  return fetchJson<{results: Bundle[]}>(`/api/sellers/${sellerId}/bundles/`, {tags: [MARKETPLACE_TAG]});
}

export function getBundle(id: string) {
  return fetchJson<Bundle>(`/api/bundles/${id}/`, {tags: [MARKETPLACE_TAG]});
}

/** Training workshops that also sell, most products first. */
export function getTrainerShops() {
  return fetchJson<{results: TrainerShop[]}>("/api/sellers/trainers/", {tags: [MARKETPLACE_TAG]});
}

export function getFeaturedShops() {
  return fetchJson<{results: FeaturedShop[]}>("/api/sellers/featured/", {tags: [MARKETPLACE_TAG]});
}

export function getProduct(id: string | number) {
  return fetchJson<ProductDetail>(`/api/products/${id}/`, {tags: [MARKETPLACE_TAG]});
}

export function getSellerShop(id: string | number) {
  return fetchJson<SellerShop>(`/api/sellers/${id}/`, {tags: [MARKETPLACE_TAG]});
}

// ---------------------------------------------------------------------------
// Online learning
//
// The workshops' approved videos, one course per workshop. Reads only.

export type CourseQuery = {
  trade?: string;
  page?: string;
  /** Words to look for in names, areas, trades and lesson titles. */
  q?: string;
  sort?: "newest" | "popular" | "rating" | "free";
  level?: string;
  price?: "free" | "paid";
  featured?: "1";
};

export function listCourses(params: CourseQuery = {}) {
  return fetchJson<Paginated<CourseCard>>(`/api/courses/${buildQuery(params)}`, {tags: [LEARN_TAG]});
}

export function getCourse(area: string, slug: string) {
  return fetchJson<CourseDetail>(`/api/courses/${area}/${slug}/`, {tags: [LEARN_TAG]});
}

/** A course certificate, checked by its code. */
export function getCertificate(code: string) {
  return fetchJson<Certificate & {course_path: string}>(
    `/api/certificates/${encodeURIComponent(code)}/`,
    {revalidate: 60},
  );
}

/** The home page's staff-chosen photographs. See types.HomePictures. */
export function getHomePictures() {
  return fetchJson<HomePictures>("/api/site/home-pictures/");
}

/** Real counts for the home page's trust strip. See types.SiteStats. */
export function getSiteStats() {
  return fetchJson<SiteStats>("/api/site/stats/");
}
