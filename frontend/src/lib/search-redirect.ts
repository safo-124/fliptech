/**
 * Old search URLs, now that `/` is the landing page and results live at
 * `/training`.
 *
 * Every `/?trade=welding` link printed on a flyer, pasted into WhatsApp or
 * sitting in somebody's history has to keep working — and a share from the
 * search page is the one link this product most wants people to send each
 * other. A visitor who lands on a marketing page having asked for welding in
 * Adenta has been given less than they asked for, silently.
 *
 * Only a recognised search key triggers it. Tracking parameters and the
 * `?fbclid=` sort of thing a share adds must not bounce somebody off the
 * landing page they were sent to.
 */

const SEARCH_KEYS = [
  "trade",
  "area",
  "region",
  "max_fee",
  "verified_only",
  "places",
  "q",
  "lat",
  "lng",
  "radius_km",
  "bbox",
  "page",
] as const;

/**
 * The `/training` URL an old search link should become, or null to stay put.
 *
 * Unknown keys are dropped rather than carried over: they were never read by
 * the search page, and passing them on would let any URL grow a query string
 * that looks official.
 */
export function searchRedirectTarget(
  params: Record<string, string | string[] | undefined>,
): string | null {
  const query = new URLSearchParams();
  for (const key of SEARCH_KEYS) {
    const value = params[key];
    // A repeated key (?trade=a&trade=b) arrives as an array. The search page
    // reads one value, so take the first rather than dropping the filter.
    const single = Array.isArray(value) ? value[0] : value;
    if (single) query.set(key, single);
  }
  const search = query.toString();
  return search ? `/training?${search}` : null;
}
