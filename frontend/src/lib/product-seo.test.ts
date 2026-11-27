import { describe, expect, it } from "vitest";

import { metaDescription, productJsonLd, scriptJson } from "./product-seo";
import type { ProductDetail } from "./types";

function product(fields: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 24,
    name: "Woven basket",
    slug: "woven-basket",
    price: "45.00",
    was_price: null,
    availability: "available",
    condition: "new",
    few_left: null,
    trade: { name: "Creative Arts & Craft", slug: "creative-arts", colour: "clay" },
    photo: "https://fliiptech.com/media/products/basket.jpg",
    seller: { id: 3, business_name: "Ama Crafts", area: "Tema" },
    sponsored: false,
    distance_km: null,
    buy_online: true,
    created_at: "2026-11-20T10:00:00Z",
    description: "",
    photos: [{ id: 1, image: "https://fliiptech.com/media/products/basket.jpg", caption: "", display_order: 0 }],
    options: [],
    pickup: null,
    ...fields,
  } as ProductDetail;
}

describe("productJsonLd", () => {
  it("gives Google the price in cedis, the stock, the condition and the photos", () => {
    const data = productJsonLd(product(), "https://fliiptech.com/marketplace/24");
    expect(data).toMatchObject({
      "@type": "Product",
      name: "Woven basket",
      sku: "24",
      image: ["https://fliiptech.com/media/products/basket.jpg"],
      brand: { name: "Ama Crafts" },
      offers: {
        price: "45.00",
        priceCurrency: "GHS",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
      },
    });
    expect(data).not.toHaveProperty("description");
  });

  it("says sold out, made to order and used, and leaves out an offer with no price", () => {
    expect(productJsonLd(product({ availability: "sold_out" }), "u").offers?.availability).toBe(
      "https://schema.org/OutOfStock",
    );
    expect(productJsonLd(product({ availability: "made_to_order" }), "u").offers?.availability).toBe(
      "https://schema.org/MadeToOrder",
    );
    expect(productJsonLd(product({ condition: "used" }), "u").offers?.itemCondition).toBe(
      "https://schema.org/UsedCondition",
    );
    expect(productJsonLd(product({ price: null }), "u")).not.toHaveProperty("offers");
  });
});

describe("metaDescription", () => {
  it("uses the seller's words when there are enough, cut near 155 characters", () => {
    const long = "Hand-woven from elephant grass in Bolgatanga, with leather handles. ".repeat(4);
    const description = metaDescription(long, "fallback");
    expect(description.length).toBeLessThanOrEqual(156);
    expect(description.endsWith("…")).toBe(true);
    expect(metaDescription("A sturdy basket for the market, woven by hand in Tema.", "fallback")).toBe(
      "A sturdy basket for the market, woven by hand in Tema.",
    );
  });

  it("falls back when the seller wrote little or nothing", () => {
    expect(metaDescription("", "Woven basket for GH₵45")).toBe("Woven basket for GH₵45");
    expect(metaDescription("nice", "Woven basket for GH₵45")).toBe("Woven basket for GH₵45");
  });
});

describe("scriptJson", () => {
  it("lets no text a seller types close the script", () => {
    const text = scriptJson({ name: "</script><script>alert(1)</script> & co" });
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script> & co" });
  });
});
