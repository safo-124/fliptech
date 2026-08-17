import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { BRAND } from "@/lib/brand";

import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${BRAND} Skills Hub — find practical skills training in Ghana`,
    template: `%s | ${BRAND} Skills Hub`,
  },
  description:
    "Compare fees, duration and start dates for welding, tailoring, plumbing and other trades training in Greater Accra.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
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
          className="sr-only focus:not-sr-only focus:block focus:bg-[var(--color-ink)] focus:p-3 focus:text-white"
        >
          Skip to results
        </a>

        <header className="border-b border-[var(--color-line)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-2 lg:px-6 lg:py-3 xl:max-w-7xl 2xl:max-w-[100rem]">
            <Link href="/" className="tap font-semibold lg:text-lg">
              Skills Hub
            </Link>
            <nav className="flex items-center gap-1">
              <Link href="/" className="tap px-3 text-sm">
                List
              </Link>
              <Link href="/map" className="tap px-3 text-sm underline">
                Map
              </Link>
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-6xl xl:max-w-7xl 2xl:max-w-[100rem]">
          {children}
        </main>

        <footer className="mt-8 border-t border-[var(--color-line)]">
          <div className="mx-auto max-w-6xl px-3 py-6 text-xs text-[var(--color-ink-soft)] lg:px-6 xl:max-w-7xl 2xl:max-w-[100rem]">
            <p className="max-w-prose">
              {BRAND} Skills Hub lists training providers in Greater Accra. A {BRAND} site
              visit is not a government accreditation.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
