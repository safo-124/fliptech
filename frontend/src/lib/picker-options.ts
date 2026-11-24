/**
 * Building the options for the searchable dropdown (components/ui/picker),
 * on the server or in the browser. Kept out of the component's file, which is
 * browser-only, so a server page can call these.
 */
import type {PickerOption} from "@/components/ui/picker";

/**
 * Areas as picker options, under their regions, a region's areas in order.
 * `onlyWithWorkshops` keeps the places a search would find something in.
 */
export function areaOptions(
  regions: {name: string; areas: {slug: string; name: string; provider_count: number}[]}[],
  {onlyWithWorkshops = false, countLabel}: {onlyWithWorkshops?: boolean; countLabel?: (count: number) => string} = {},
): PickerOption[] {
  return [...regions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((region) =>
      region.areas
        .filter((area) => !onlyWithWorkshops || area.provider_count > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((area) => ({
          value: area.slug,
          label: area.name,
          group: region.name,
          hint: countLabel && area.provider_count > 0 ? countLabel(area.provider_count) : undefined,
        })),
    );
}

/** Trades as picker options, under their categories when they have them. */
export function tradeOptions(
  trades: {slug: string; name: string; category?: {name: string} | null}[],
): PickerOption[] {
  const grouped = trades.some((trade) => trade.category?.name);
  const options = trades.map((trade) => ({
    value: trade.slug,
    label: trade.name,
    group: grouped ? (trade.category?.name ?? undefined) : undefined,
  }));
  // Grouped options together, each group once, in the order they come.
  if (!grouped) return options;
  const order: string[] = [];
  for (const option of options) if (option.group && !order.includes(option.group)) order.push(option.group);
  return [
    ...options.filter((option) => !option.group),
    ...order.flatMap((group) => options.filter((option) => option.group === group)),
  ];
}
