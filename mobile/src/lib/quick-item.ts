/**
 * The quick "Add an item" form's rules, apart from its screen, so they can be
 * tested on their own. The same rules as the website's (frontend
 * src/lib/quick-item.ts): keep the two in step.
 */

import type { QuickItemInput, SellerProduct } from "./types";

export type QuickItemDraft = {
  name: string;
  price: string;
  availability: "available" | "made_to_order";
  trade: number | null;
  description: string;
  stock: string;
  condition: "new" | "used";
  wasPrice: string;
  options: string;
};

/** A new item: the shop's trade, new, stock not counted, ready now. */
export function blankDraft(trade: number | null): QuickItemDraft {
  return {
    name: "",
    price: "",
    availability: "available",
    trade,
    description: "",
    stock: "",
    condition: "new",
    wasPrice: "",
    options: "",
  };
}

/** "Add another like this": the same item, without its photos or stock count. */
export function likeThis(product: SellerProduct): QuickItemDraft {
  return {
    name: product.name,
    price: product.price ? plainPrice(product.price) : "",
    availability: product.availability === "made_to_order" ? "made_to_order" : "available",
    trade: product.trade,
    description: product.description,
    stock: "",
    condition: product.condition,
    wasPrice: product.was_price ? plainPrice(product.was_price) : "",
    options: product.options.map((option) => option.label).join(", "),
  };
}

/** "1200.00" as "1200", "1250.50" as is. */
function plainPrice(value: string) {
  return value.endsWith(".00") ? value.slice(0, -3) : value;
}

/** "1,200" or "GH₵ 1 200" as a number, null when empty or not a number. */
export function readPrice(text: string): number | null {
  const cleaned = text.replace(/GH₵|GHS|₵|,|\s/gi, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** A "before" price is only a sale when it is higher than the price. */
export function wasPriceTooLow(draft: Pick<QuickItemDraft, "price" | "wasPrice">) {
  const price = readPrice(draft.price);
  const was = readPrice(draft.wasPrice);
  return price !== null && was !== null && was <= price;
}

/** What the form sends. Prices go as typed: the server reads "1,200". */
export function toInput(
  draft: QuickItemDraft,
  photos: number[],
  publish: boolean,
): QuickItemInput {
  const stock = draft.stock.trim();
  return {
    name: draft.name.trim(),
    price: draft.price.trim() || null,
    was_price: draft.wasPrice.trim() || null,
    availability: draft.availability,
    trade: draft.trade,
    description: draft.description.trim(),
    condition: draft.condition,
    stock: stock === "" ? null : Math.max(0, Number.parseInt(stock, 10) || 0),
    options: draft.options
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
    photos,
    publish,
  };
}

/** The name placeholder for the shop's trade. */
export const NAME_EXAMPLES: Record<string, string> = {
  welding: "Metal shoe rack",
  tailoring: "Kente dress",
  hairdressing: "Braided wig",
  plumbing: "Water tank stand",
  "auto-mechanics": "Brake pads, Toyota Corolla",
  "electrical-installation": "Extension board, 4 sockets",
};

export function nameExample(tradeSlug: string | undefined, fallback: string) {
  return (tradeSlug && NAME_EXAMPLES[tradeSlug]) || fallback;
}
