/**
 * Trade colours, as on the website (frontend/src/lib/trades.ts, TRADE_HEX).
 * The names come from the API (catalog.models.Trade.Colour); a name this
 * does not know falls back to the brand's violet.
 */
const TRADE_HEX = {
  spark: { bg: "#fde3cc", fg: "#7a3a05", strong: "#e8730c" },
  dye: { bg: "#d9e4f2", fg: "#0c447c", strong: "#2f6fb5" },
  coral: { bg: "#fbe3dc", fg: "#8a3b25", strong: "#e0806b" },
  timber: { bg: "#ecdfcf", fg: "#5c3d1e", strong: "#9a6a3a" },
  signal: { bg: "#fbefc4", fg: "#633806", strong: "#d9a406" },
  steel: { bg: "#e1e7ec", fg: "#2f4553", strong: "#5b7a8e" },
  clay: { bg: "#f4ddd6", fg: "#7a2e1b", strong: "#b5523a" },
  leaf: { bg: "#e2efd9", fg: "#2f5a12", strong: "#5c9a2d" },
  violet: { bg: "#ece6fb", fg: "#47208f", strong: "#9867e1" },
} as const;

export type TradeColour = keyof typeof TRADE_HEX;

export function tradeHex(colour: string | null | undefined) {
  return TRADE_HEX[(colour ?? "") in TRADE_HEX ? (colour as TradeColour) : "violet"];
}
