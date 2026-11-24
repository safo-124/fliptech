/**
 * Which set of examples a trade's placeholders come from. Examples are
 * written in the trainer's own trade so the box shows what good looks like
 * for them; a trade without its own set gets a neutral one ("named"), which
 * can carry the trade's name.
 */
const BY_SLUG = {
  welding: "welding",
  tailoring: "tailoring",
  plumbing: "plumbing",
  "auto-mechanics": "autoMechanics",
  hairdressing: "hairdressing",
  "electrical-installation": "electrical",
} as const;

export type TradeExampleKey = (typeof BY_SLUG)[keyof typeof BY_SLUG] | "named";

export function tradeExampleKey(slug: string | null | undefined): TradeExampleKey {
  return (slug && BY_SLUG[slug as keyof typeof BY_SLUG]) || "named";
}
