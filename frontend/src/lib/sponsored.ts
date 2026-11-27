/**
 * A home page row with its sponsored places: the sponsored items first (the
 * server picks up to two at random, backend marketplace/promotion.py and
 * courses/promotion.py), then the rest, leaving out anything sponsored, so a
 * row never holds more paid places than the server chose and nothing twice.
 */
export function sponsoredFirst<T extends { id: number; sponsored?: boolean }>(
  sponsored: T[],
  rest: T[],
  limit: number,
): T[] {
  const chosen = new Set(sponsored.map((item) => item.id));
  return [...sponsored, ...rest.filter((item) => !item.sponsored && !chosen.has(item.id))].slice(0, limit);
}
