/**
 * The eight pictures at the top of /marketplace, in a shopper's words. The
 * slugs are the backend's (marketplace/kinds.py), which decides what each
 * one finds; the label is the key in messages (Marketplace.kind.*).
 */
export const MARKET_KINDS = [
  "hair-beauty",
  "clothes",
  "bags-shoes",
  "furniture",
  "food",
  "soap-oils",
  "tools",
  "crafts",
] as const;

export type MarketKind = (typeof MARKET_KINDS)[number];

export function isMarketKind(value: string | undefined): value is MarketKind {
  return MARKET_KINDS.includes(value as MarketKind);
}

/** "How much?" in the More sheet: bands rather than two number boxes. */
export const PRICE_BANDS = [
  { value: "0-100", min: undefined, max: "100" },
  { value: "100-500", min: "100", max: "500" },
  { value: "500-2000", min: "500", max: "2000" },
  { value: "2000-", min: "2000", max: undefined },
] as const;

/** The band a min and max price make, if they make one. */
export function bandFor(min: string | undefined, max: string | undefined): string {
  const band = PRICE_BANDS.find((b) => (b.min ?? "") === (min ?? "") && (b.max ?? "") === (max ?? ""));
  return band?.value ?? "";
}

/** A chosen band as the min and max price the API reads. */
export function bandPrices(value: string | undefined): { min_price?: string; max_price?: string } | null {
  const band = PRICE_BANDS.find((b) => b.value === value);
  if (!band) return null;
  return { min_price: band.min, max_price: band.max };
}
