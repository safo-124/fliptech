import type { MetadataRoute } from "next";

import { BRAND, BRAND_COLOURS } from "@/lib/brand";

import en from "../../messages/en.json";

/**
 * The web app manifest: what lets a phone install the site like an app.
 *
 * Installed, it opens from the home screen without the browser's address bar,
 * with the header's indigo as its title bar. It is still the same site, so
 * there is nothing to download from a store and nothing to update.
 *
 * English, because a manifest is fetched once and kept: it cannot follow the
 * language cookie the way the pages do. The name and description are the
 * ones the header and search results already use.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${BRAND} ${en.SiteHeader.productName}`,
    short_name: en.SiteHeader.productName,
    description: en.Layout.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND_COLOURS.canvas,
    theme_color: BRAND_COLOURS.deep,
    lang: "en-GH",
    dir: "ltr",
    categories: ["education"],
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
