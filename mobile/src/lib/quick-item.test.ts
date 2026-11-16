import { blankDraft, likeThis, nameExample, readPrice, toInput, wasPriceTooLow } from "./quick-item";
import type { SellerProduct } from "./types";

const saved: SellerProduct = {
  id: 7,
  name: "Kente dress",
  description: "Hand-woven, any size.",
  price: "1200.00",
  was_price: null,
  trade: 3,
  availability: "made_to_order",
  condition: "new",
  stock: 4,
  options: [{ id: 1, label: "Small", price: null, available: true }],
  status: "published",
  visible: true,
  photos: [{ id: 9, image: "https://x/1.jpg" }],
};

describe("the quick item form", () => {
  it("starts in the shop's trade, new, stock not counted, ready now", () => {
    expect(blankDraft(5)).toMatchObject({ trade: 5, condition: "new", stock: "", availability: "available" });
  });

  it("reads prices as sellers type them", () => {
    expect(readPrice("1,200")).toBe(1200);
    expect(readPrice("GH₵ 1 250.50")).toBe(1250.5);
    expect(readPrice("")).toBeNull();
  });

  it("warns when the price before the sale is not higher", () => {
    expect(wasPriceTooLow({ price: "1,200", wasPrice: "1000" })).toBe(true);
    expect(wasPriceTooLow({ price: "1,200", wasPrice: "1,500" })).toBe(false);
  });

  it("sends an empty price as Ask for price, and sizes as a list", () => {
    const body = toInput({ ...blankDraft(null), name: " Rack ", options: "S, M, ,L" }, [4, 2], true);
    expect(body).toMatchObject({ name: "Rack", price: null, options: ["S", "M", "L"], photos: [4, 2], publish: true });
  });

  it("copies an item without its photos or stock count", () => {
    const copy = likeThis(saved);
    expect(copy).toMatchObject({ name: "Kente dress", price: "1200", availability: "made_to_order", options: "Small", stock: "" });
    expect(toInput(copy, [], false).photos).toEqual([]);
  });

  it("suggests a name from the trade", () => {
    expect(nameExample("welding", "x")).toBe("Metal shoe rack");
    expect(nameExample("hairdressing", "x")).toBe("Braided wig");
  });
});
