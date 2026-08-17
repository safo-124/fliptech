import type { MetadataRoute } from "next";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The dashboard is per-owner and reached by a signed link. It must
        // never be crawled, and the token must never appear in an index.
        disallow: ["/dashboard/", "/enquiry/"],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
