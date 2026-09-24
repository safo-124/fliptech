import type { Metadata, Viewport } from "next";
import {SiteFooter} from "@/components/SiteFooter";
import {SiteHeader} from "@/components/SiteHeader";
import {BRAND} from "@/lib/brand";

import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${BRAND} Skills Hub — find practical skills training in Ghana`,
    template: `%s | ${BRAND} Skills Hub`,
  },
  // Ghana, not Accra. This and the title are what search engines index, so
  // between them they decide whether somebody in Kumasi believes the site is
  // for them. Where the workshops actually are today is the hero's job, on the
  // page, where it can be specific without narrowing the whole product.
  description:
    "Compare fees, duration and start dates for welding, tailoring, plumbing and other trades training in Ghana.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000"),
};

// Fonts are self-hosted via @fontsource so the app does not depend on a font
// service, and the page does not block on a third-party connection.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#14181f",
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
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:block focus:bg-[var(--color-foreground)] focus:p-3 focus:text-white"
        >
          Skip to main content
        </a>

        <SiteHeader />

        <main id="main" className="mx-auto max-w-6xl xl:max-w-7xl 2xl:max-w-[100rem]">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
