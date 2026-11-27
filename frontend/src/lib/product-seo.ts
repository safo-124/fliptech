/**
 * What a product page tells search engines, beyond what a person sees: the
 * structured product data (schema.org Product, read by Google for prices and
 * stock in results and for free Shopping listings), and a description for
 * the results page when the seller wrote little or none.
 */

import type { ProductDetail } from "./types";

const AVAILABILITY: Record<ProductDetail["availability"], string> = {
  available: "https://schema.org/InStock",
  made_to_order: "https://schema.org/MadeToOrder",
  sold_out: "https://schema.org/OutOfStock",
};

/** schema.org Product for one product page. Price on request has no offer:
 * an offer without a price is one Google refuses. */
export function productJsonLd(product: ProductDetail, url: string) {
  const images = product.photos.map((photo) => photo.image).filter((image): image is string => Boolean(image));
  if (!images.length && product.photo) images.push(product.photo);
  const condition =
    product.condition === "used" ? "https://schema.org/UsedCondition" : "https://schema.org/NewCondition";
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(product.description.trim() ? { description: product.description.trim() } : {}),
    ...(images.length ? { image: images } : {}),
    sku: String(product.id),
    url,
    ...(product.trade ? { category: product.trade.name } : {}),
    brand: { "@type": "Brand", name: product.seller.business_name },
    ...(product.price !== null
      ? {
          offers: {
            "@type": "Offer",
            url,
            price: product.price,
            priceCurrency: "GHS",
            availability: AVAILABILITY[product.availability],
            itemCondition: condition,
            seller: { "@type": "Organization", name: product.seller.business_name },
          },
        }
      : {}),
  };
}

/** The seller's own words when there are enough of them to describe the
 * product in search results (cut at a word near 155 characters), else the
 * sentence built from the name, price, shop and town. */
export function metaDescription(written: string, fallback: string): string {
  const text = written.replace(/\s+/g, " ").trim();
  if (text.length < 50) return fallback;
  if (text.length <= 155) return text;
  const cut = text.slice(0, 155);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 100 ? cut.lastIndexOf(" ") : 155)}…`;
}

/** JSON for a <script type="application/ld+json">. Sellers type the names
 * and descriptions in it, so "<" and friends are escaped: no text can close
 * the script and run as a page of its own. */
export function scriptJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
