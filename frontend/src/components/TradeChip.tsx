import { tradeClass } from "@/lib/trades";

/**
 * A trade's name in its colour: the label a result card is scanned by.
 *
 * Styled by one class in globals.css rather than a run of utilities, because
 * it repeats on every card of the search page, whose HTML counts against a
 * 200 KB budget.
 */
export function TradeChip({
  name,
  colour,
  className = "",
}: {
  name: string;
  colour: string;
  className?: string;
}) {
  return <span className={`trade-chip ${tradeClass(colour)} ${className}`}>{name}</span>;
}
