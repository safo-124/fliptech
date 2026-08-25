import type { MetadataRoute } from "next";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Trainer routes contain private sessions or signed links. Neither
        // those tokens nor incomplete profile drafts belong in an index.
        disallow: ["/dashboard/", "/trainer/", "/enquiry/"],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
