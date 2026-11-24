/**
 * What a new product is filed under: the categories (backend
 * catalog/listing.py, /api/trades/choices/), plus "Others (describe)". The
 * same rule as the website's lib/trade-choices.ts.
 */

type Choice = { id: number; name: string };
type AnyTrade = Choice & { category?: { name: string } | null };

/**
 * The category a new item starts in, from a trade (the workshop's own, or
 * the item it copies): that trade's category, when it is one of the choices.
 */
export function categoryChoiceFor(choices: Choice[], all: AnyTrade[], id: number | null | undefined): number | null {
  if (!id) return null;
  if (choices.some((choice) => choice.id === id)) return id;
  const category = all.find((trade) => trade.id === id)?.category?.name;
  return choices.find((choice) => choice.name === category)?.id ?? null;
}
