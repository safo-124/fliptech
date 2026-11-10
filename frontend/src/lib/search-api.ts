/**
 * Site search from the browser, as the visitor types. Plain fetches to the
 * public API origin: no cookies needed, so they can be cancelled and retried
 * freely. The training alert is the one call that needs the session.
 */

import {browserApiUrl} from "./api-origin";
import {trainerFetch as sessionFetch} from "./trainer-fetch";
import type {SearchSuggestion, SiteSearch} from "./types";

function url(path: string, params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  return `${browserApiUrl()}${path}?${query.toString()}`;
}

export async function searchEverything(
  q: string,
  options: {lat?: number; lng?: number; log?: boolean; signal?: AbortSignal} = {},
): Promise<SiteSearch> {
  const response = await fetch(
    url("/api/search/", {
      q,
      lat: options.lat?.toFixed(3),
      lng: options.lng?.toFixed(3),
      log: options.log ? "1" : undefined,
    }),
    {signal: options.signal},
  );
  if (!response.ok) throw new Error(`Search ${response.status}`);
  return (await response.json()) as SiteSearch;
}

export async function suggest(q: string, signal?: AbortSignal): Promise<SearchSuggestion[]> {
  const response = await fetch(url("/api/search/suggest/", {q}), {signal});
  if (!response.ok) return [];
  return ((await response.json()) as {results: SearchSuggestion[]}).results;
}

/** Where a suggestion leads. */
export function suggestionHref(item: SearchSuggestion): string {
  switch (item.kind) {
    case "trade_area":
      return `/training?trade=${item.trade}&area=${item.area}`;
    case "trade":
      return `/training?trade=${item.trade}`;
    case "area":
      return `/training?area=${item.area}`;
    case "workshop":
      return `/${item.area}/${item.slug}`;
    case "product":
      return `/marketplace/${item.id}`;
  }
}

/** "Text me when one opens": a signed-in account only (401/403 otherwise). */
export function keepTrainingAlert(trade: string, area?: string) {
  return sessionFetch<{id: number}>("/api/search/alerts/", {
    method: "POST",
    body: JSON.stringify({trade, area: area || undefined}),
  });
}
