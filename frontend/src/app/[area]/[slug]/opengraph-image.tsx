import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

import { getProvider } from "@/lib/api";
import { BRAND, BRAND_COLOURS } from "@/lib/brand";
import { markSvg } from "@/lib/brand-mark";
import { titleCase } from "@/lib/format";
import { TRADE_HEX, tradeColour } from "@/lib/trades";

/**
 * The picture WhatsApp shows when a listing is shared: the card a parent
 * forwards to their child, or a trainee to a friend.
 *
 * Built to be read at the size of a chat bubble: the workshop's photograph,
 * its name, the fee, the length and the next start date, the visit stamp, and
 * a strip in the trade's colour. Drawn once on the server, so whoever shares
 * or opens it spends no data on anything but the image.
 *
 * Money is written GHS rather than with the cedi sign: the cedi sign is
 * missing from most fonts, including the one these images are drawn in,
 * which is why the site carries a font of its own for it.
 */

export const alt = "A training workshop's listing on Skills Hub";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GHS = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  currencyDisplay: "code",
  maximumFractionDigits: 0,
});
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// A visit is in the past, so it carries its year: "1 Dec" alone could be last year's.
const VISIT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A photograph as a data URL, or null: a missing picture must not break the card. */
async function photoData(url: string | null) {
  if (!url) return null;
  try {
    const response = await fetch(url, { next: { revalidate: 3600 } });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(jpeg|png)/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4_000_000) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function Mark({ size: px }: { size: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- drawn by ImageResponse
  return <img src={`data:image/svg+xml,${encodeURIComponent(markSvg())}`} width={px} height={px} alt="" />;
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <Mark size={52} />
      <span style={{ fontSize: 30, fontWeight: 700 }}>Skills Hub</span>
      <span style={{ fontSize: 22, opacity: 0.7 }}>by {BRAND}</span>
    </div>
  );
}

export default async function ShareCard({ params }: { params: Promise<{ area: string; slug: string }> }) {
  const { area, slug } = await params;
  const t = await getTranslations("ShareCard");
  const { deep, canvas } = BRAND_COLOURS;

  // A generated trade page shares the URL shape: /tema/welding-training.
  if (slug.endsWith("-training")) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: deep, color: "white", padding: 64 }}>
          <Brand />
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <span style={{ fontSize: 70, fontWeight: 800, lineHeight: 1.05 }}>
              {t("tradeTitle", { trade: titleCase(slug.slice(0, -"-training".length)), place: titleCase(area) })}
            </span>
            <span style={{ fontSize: 30, opacity: 0.8 }}>{t("tradeLead")}</span>
          </div>
        </div>
      ),
      size,
    );
  }

  const provider = await getProvider(area, slug).catch(() => null);
  if (!provider) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: deep, color: "white" }}>
        <Brand />
      </div>,
      size,
    );
  }

  const workshopPhoto = provider.photos.find((photo) => photo.kind === "workshop") ?? provider.photos[0];
  const photo = await photoData(workshopPhoto?.image ?? provider.primary_photo);
  const trade = TRADE_HEX[tradeColour(provider.trade?.colour)];
  const nextIntake = provider.programmes
    .flatMap((programme) => programme.intakes)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const visit = provider.site_visit;
  const facts = [
    [t("feeFrom"), provider.lowest_fee ? GHS.format(Number(provider.lowest_fee)) : t("askThem")],
    [
      t("length"),
      provider.shortest_duration_weeks
        ? t("months", { count: Math.max(1, Math.round(provider.shortest_duration_weeks / 4.345)) })
        : t("askThem"),
    ],
    [
      t("starts"),
      nextIntake
        ? nextIntake.places_remaining === null
          ? DATE.format(new Date(`${nextIntake.start_date}T00:00:00Z`))
          : t("startsWithPlaces", {
              date: DATE.format(new Date(`${nextIntake.start_date}T00:00:00Z`)),
              count: nextIntake.places_remaining,
            })
        : t("askThem"),
    ],
  ] as const;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: canvas }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- drawn by ImageResponse
          <img src={photo} width={470} height={630} style={{ objectFit: "cover" }} alt="" />
        ) : (
          <div style={{ width: 470, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: trade.bg }}>
            <Mark size={220} />
          </div>
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", background: deep, color: "white", padding: "48px 52px 40px", borderBottom: `14px solid ${trade.strong}` }}>
          <Brand />
          <span style={{ marginTop: 34, fontSize: 56, fontWeight: 800, lineHeight: 1.06 }}>{provider.name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, fontSize: 26 }}>
            {provider.trade ? (
              <span style={{ background: trade.bg, color: trade.fg, borderRadius: 999, padding: "4px 16px", fontWeight: 700 }}>
                {provider.trade.name}
              </span>
            ) : null}
            <span style={{ opacity: 0.8 }}>{provider.area}</span>
          </div>

          <div style={{ display: "flex", gap: 30, marginTop: "auto" }}>
            {facts.map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 20, opacity: 0.65, textTransform: "uppercase", letterSpacing: 2 }}>{label}</span>
                <span style={{ fontSize: 30, fontWeight: 700 }}>{value}</span>
              </div>
            ))}
          </div>

          {visit ? (
            <div style={{ position: "absolute", top: 40, right: 44, display: "flex", flexDirection: "column", alignItems: "center", transform: "rotate(-8deg)", border: "4px solid #8fe0b4", color: "#8fe0b4", borderRadius: 12, padding: "6px 16px" }}>
              <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase" }}>
                {t("visited")}
              </span>
              <span style={{ fontSize: 18 }}>{VISIT_DATE.format(new Date(`${visit.visited_on}T00:00:00Z`))}</span>
            </div>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
