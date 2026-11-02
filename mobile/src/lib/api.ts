import { API_URL } from "./config";
import type { CourseCard, Paginated, ProductCard, ProviderCard, TradeOption } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * GET a JSON endpoint. Errors come back worded for a person: these
 * messages reach the screen as they are.
 */
export async function getJson<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const url = `${API_URL}${path}${query.size ? `?${query}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError("No connection. Check your data or Wi-Fi and try again.", 0);
  }
  if (!response.ok) {
    throw new ApiError("Something went wrong on our side. Try again in a minute.", response.status);
  }
  return (await response.json()) as T;
}

/** Pages the map follows at most: 200 workshops, which covers any one view. */
const MAP_PAGES = 10;

export const api = {
  courses: (params: { q?: string; sort?: string; featured?: string } = {}) =>
    getJson<Paginated<CourseCard>>("/api/courses/", params),
  products: (params: { q?: string } = {}) => getJson<Paginated<ProductCard>>("/api/products/", params),
  providers: (params: { q?: string; trade?: string } = {}) =>
    getJson<Paginated<ProviderCard>>("/api/providers/", params),
  /** Every workshop for the map, following the pages, inside a box if given. */
  async mapProviders(params: { trade?: string; bbox?: string } = {}) {
    const all: ProviderCard[] = [];
    for (let page = 1; page <= MAP_PAGES; page++) {
      const found = await getJson<Paginated<ProviderCard>>("/api/providers/", { ...params, page: String(page) });
      all.push(...found.results);
      if (!found.next) break;
    }
    return all;
  },
  trades: () => getJson<Paginated<TradeOption>>("/api/trades/"),
};
