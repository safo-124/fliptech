/**
 * The marketplace's filters on the phone. The same names as the API's query
 * parameters (backend marketplace/views.py _filter_products) and the
 * website's, so a filter means the same thing everywhere.
 */
export type MarketFilters = {
  q?: string;
  trade?: string;
  sold_by?: "trainers" | "makers";
  /** One shop's products, from the "made by people who teach it" row. */
  seller?: { id: number; name: string };
  min_price?: string;
  max_price?: string;
  sort?: "" | "price" | "-price" | "newest";
  pay_online?: boolean;
  delivers?: boolean;
  verified?: boolean;
  on_sale?: boolean;
  in_stock?: boolean;
};

export const SORTS: { value: NonNullable<MarketFilters["sort"]>; label: string }[] = [
  { value: "", label: "Best match" },
  { value: "price", label: "Price: low to high" },
  { value: "-price", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
];

/** The switches, in the order the chips show them. */
export const SWITCHES = [
  ["pay_online", "Pay online"],
  ["delivers", "Delivers"],
  ["on_sale", "On sale"],
  ["in_stock", "In stock"],
  ["verified", "Verified"],
] as const;

/** A price as typed, kept only when it is a number. */
function price(raw: string | undefined) {
  const text = (raw ?? "").replace(/[^\d.]/g, "");
  return text && Number.isFinite(Number(text)) ? text : undefined;
}

/** The query string for /api/products/. */
export function queryParams(filters: MarketFilters, page = 1): Record<string, string | undefined> {
  return {
    q: filters.q || undefined,
    trade: filters.trade || undefined,
    sold_by: filters.sold_by,
    seller: filters.seller ? String(filters.seller.id) : undefined,
    min_price: price(filters.min_price),
    max_price: price(filters.max_price),
    sort: filters.sort || undefined,
    pay_online: filters.pay_online ? "1" : undefined,
    delivers: filters.delivers ? "1" : undefined,
    verified: filters.verified ? "1" : undefined,
    on_sale: filters.on_sale ? "1" : undefined,
    availability: filters.in_stock ? "available" : undefined,
    page: page > 1 ? String(page) : undefined,
  };
}

/** How many filters are on, not counting the search words or the sort. */
export function activeCount(filters: MarketFilters) {
  let count = 0;
  if (filters.sold_by) count++;
  if (filters.seller) count++;
  if (price(filters.min_price) || price(filters.max_price)) count++;
  for (const [key] of SWITCHES) if (filters[key]) count++;
  return count;
}
