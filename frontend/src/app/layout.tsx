import type { Metadata, Viewport } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import {SiteFooter} from "@/components/SiteFooter";
import {SiteHeader} from "@/components/SiteHeader";
import {BRAND, BRAND_COLOURS} from "@/lib/brand";

import "@fontsource-variable/inter";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Layout");
  const tHeader = await getTranslations("SiteHeader");
  return {
    title: {
      default: t("titleDefault", { brand: BRAND }),
      template: t("titleTemplate", { brand: BRAND }),
    },
    // Ghana, not Accra. This and the title are what search engines index, so
    // between them they decide whether somebody in Kumasi believes the site is
    // for them. Where the workshops actually are today is the hero's job, on the
    // page, where it can be specific without narrowing the whole product.
    description: t("description"),
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000"),
    // Drawn from the header's mark; see app/icons. The manifest that makes the
    // site installable is app/manifest.ts, which Next links by itself.
    icons: {
      icon: [{url: "/icons/mark.svg", type: "image/svg+xml"}],
      apple: [{url: "/icons/apple-touch-icon.png", sizes: "180x180"}],
    },
    // What an iPhone uses when the site is added to its home screen.
    appleWebApp: {capable: true, title: tHeader("productName"), statusBarStyle: "default"},
  };
}

// Fonts are self-hosted via @fontsource so the app does not depend on a font
// service, and the page does not block on a third-party connection.
//
// The theme colour is the header band's indigo: Android tints the browser bar
// with it, and an installed site's title bar is this colour.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: BRAND_COLOURS.deep,
};

/**
 * Mobile-first, but not mobile-only.
 *
 * The container grows in steps rather than stopping at one width. Capping at
 * 1152px looked deliberate on a laptop and looked abandoned on a 2560px
 * monitor, with the content stranded in the middle of the screen. It still
 * stops growing eventually: a card grid that spans an entire ultrawide is
 * harder to scan, not easier.
 *
 * The trainee arrives on a phone, so that layout is the one the design is
 * optimised for. Two other audiences arrive on a desktop and were not served by
 * a hard phone-width cap: the NGO programme officer building a shortlist
 * (Section 03), and search-engine traffic landing on a generated area page —
 * which Section 04 shows as a desktop view that stacks to one column on a phone.
 *
 * Nothing here changes what the phone receives. The breakpoints only widen the
 * container and let the card list become a grid on screens that have the room.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Layout");
  // "en" is read as Ghanaian English: dates and money are written the way they
  // are in Ghana. A future "tw" or "gaa" needs no region suffix.
  const locale = await getLocale();
  return (
    <html lang={locale === "en" ? "en-GH" : locale}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:block focus:bg-[var(--color-foreground)] focus:p-3 focus:text-white"
        >
          {t("skipToContent")}
        </a>

        <SiteHeader />

        <main id="main" className="mx-auto max-w-6xl xl:max-w-7xl 2xl:max-w-[100rem]">
          {children}
        </main>
        <SiteFooter />

        {/* The offline worker, public/sw.js. Registered after load, so it never
            competes with the page for a slow connection, and a few bytes
            inline rather than a client component. Not in development, where it
            would serve kept copies over hot reload. */}
        {process.env.NODE_ENV === "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                'if("serviceWorker"in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})',
            }}
          />
        )}
      </body>
    </html>
  );
}
