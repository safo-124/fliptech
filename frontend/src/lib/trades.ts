/**
 * Trade colours. The names are catalog.models.Trade.Colour in the backend; the
 * values are the .trade-* classes in globals.css.
 *
 * No icons here on purpose: this module is small enough for any component,
 * client ones included. The icon for each colour is in TradeArt, which only
 * renders on the server.
 */

export const TRADE_COLOURS = [
  "spark",
  "dye",
  "coral",
  "timber",
  "signal",
  "steel",
  "clay",
  "leaf",
  "violet",
] as const;

export type TradeColour = (typeof TRADE_COLOURS)[number];

/** A colour the stylesheet knows, falling back to the brand's violet. */
export function tradeColour(value: string | null | undefined): TradeColour {
  return (TRADE_COLOURS as readonly string[]).includes(value ?? "")
    ? (value as TradeColour)
    : "violet";
}

/** The class that sets --trade-bg, --trade-fg and --trade-strong on an element. */
export function tradeClass(value: string | null | undefined) {
  return `trade-${tradeColour(value)}`;
}

/**
 * The same colours as hex, for images drawn on the server (the share cards),
 * where the stylesheet does not exist. Keep in step with the .trade-* classes.
 */
export const TRADE_HEX: Record<TradeColour, { bg: string; fg: string; strong: string }> = {
  spark: { bg: "#fde3cc", fg: "#7a3a05", strong: "#e8730c" },
  dye: { bg: "#d9e4f2", fg: "#0c447c", strong: "#2f6fb5" },
  coral: { bg: "#fbe3dc", fg: "#8a3b25", strong: "#e0806b" },
  timber: { bg: "#ecdfcf", fg: "#5c3d1e", strong: "#9a6a3a" },
  signal: { bg: "#fbefc4", fg: "#633806", strong: "#d9a406" },
  steel: { bg: "#e1e7ec", fg: "#2f4553", strong: "#5b7a8e" },
  clay: { bg: "#f4ddd6", fg: "#7a2e1b", strong: "#b5523a" },
  leaf: { bg: "#e2efd9", fg: "#2f5a12", strong: "#5c9a2d" },
  violet: { bg: "#ece6fb", fg: "#47208f", strong: "#9867e1" },
};
