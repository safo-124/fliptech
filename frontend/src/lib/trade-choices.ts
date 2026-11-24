/**
 * What a course or product is filed under on the forms: the categories
 * (backend catalog/listing.py, /api/trades/choices/), plus "Others
 * (describe)" which the forms add themselves.
 *
 * A listing already filed under a specific trade (welding, tailoring) keeps
 * it: editing it shows that trade too, so saving without touching the field
 * changes nothing. Its owner moves it to a category when they choose to.
 */

type Choice = { id: number; name: string; slug: string };

/** The choices, with the listing's current trade first when it is not one of them. */
export function choicesWith<T extends Choice>(choices: T[], all: T[], current?: number | string | null): Choice[] {
  const plain = choices.map(({ id, name, slug }) => ({ id, name, slug }));
  const id = Number(current);
  if (!current || !Number.isFinite(id) || plain.some((choice) => choice.id === id)) return plain;
  const kept = all.find((trade) => trade.id === id);
  return kept ? [{ id: kept.id, name: kept.name, slug: kept.slug }, ...plain] : plain;
}

/**
 * The category a new listing starts in, from a trade (the workshop's own, or
 * the item it is copied from): the trade's category, when one of the
 * choices is that category; else nothing chosen yet.
 */
export function categoryChoiceFor(
  choices: Choice[],
  all: (Choice & { category?: { name: string } | null })[],
  id: number | null | undefined,
): number | null {
  if (!id) return null;
  if (choices.some((choice) => choice.id === id)) return id;
  const category = all.find((trade) => trade.id === id)?.category?.name;
  return choices.find((choice) => choice.name === category)?.id ?? null;
}
