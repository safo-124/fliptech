import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

import { BRAND, BRAND_COLOURS } from "@/lib/brand";
import { markSvg } from "@/lib/brand-mark";

/**
 * The picture shown when the site itself is shared, rather than one listing:
 * the brand and what the site is for. Listings draw their own, in
 * [area]/[slug]/opengraph-image.tsx. Drawn once, at build time.
 */

export const alt = "Skills Hub: find practical skills training in Ghana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function SiteShareCard() {
  const t = await getTranslations("ShareCard");
  const { deep, glow, sand } = BRAND_COLOURS;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          color: "white",
          backgroundColor: deep,
          backgroundImage: `radial-gradient(circle at 10% 0%, ${glow}, ${deep} 65%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn by ImageResponse */}
          <img src={`data:image/svg+xml,${encodeURIComponent(markSvg())}`} width={84} height={84} alt="" />
          <span style={{ fontSize: 44, fontWeight: 700 }}>Skills Hub</span>
          <span style={{ fontSize: 30, opacity: 0.7 }}>by {BRAND}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.04, color: sand }}>{t("siteTitle")}</span>
          <span style={{ fontSize: 32, opacity: 0.85 }}>{t("siteLead")}</span>
        </div>
      </div>
    ),
    size,
  );
}
