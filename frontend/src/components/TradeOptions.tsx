/**
 * The trades as <option>s for a <select>, grouped under their categories
 * (<optgroup>), so a long list reads as a few short ones. A trade staff have
 * not placed yet comes after the groups, on its own. With no categories at
 * all it is the plain list it always was.
 */

type TradeOption = {
  id?: number;
  slug?: string;
  name: string;
  category?: { name: string } | null;
};

export function TradeOptions({ trades, by = "slug" }: { trades: TradeOption[]; by?: "slug" | "id" }) {
  const option = (trade: TradeOption) => {
    const value = by === "id" ? String(trade.id ?? "") : (trade.slug ?? "");
    return (
      <option key={value} value={value}>
        {trade.name}
      </option>
    );
  };

  const groups = new Map<string, TradeOption[]>();
  const loose: TradeOption[] = [];
  for (const trade of trades) {
    const name = trade.category?.name;
    if (!name) loose.push(trade);
    else groups.set(name, [...(groups.get(name) ?? []), trade]);
  }
  if (!groups.size) return <>{trades.map(option)}</>;
  return (
    <>
      {[...groups].map(([name, members]) => (
        <optgroup key={name} label={name}>
          {members.map(option)}
        </optgroup>
      ))}
      {loose.map(option)}
    </>
  );
}
