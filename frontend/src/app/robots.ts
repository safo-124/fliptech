import type { MetadataRoute } from "next";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Trainer and trainee routes contain private sessions or signed links.
        // Neither those tokens nor anyone's own enquiries belong in an index.
        disallow: ["/dashboard/", "/trainer/", "/trainee/", "/enquiry/"],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
