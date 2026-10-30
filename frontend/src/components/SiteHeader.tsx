import {Menu, Search} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";

import {AccountNav} from "@/components/AccountNav";
import {BrandMark} from "@/components/BrandMark";
import {BRAND} from "@/lib/brand";

/**
 * A white bar with the brand on the left and the site's parts in the middle.
 *
 * Light, like the rest of the canvas: the trainee reading this is often
 * outdoors in direct sun, which is the reason globals.css pins
 * `color-scheme: light`. The brand's violet carries the one filled action.
 *
 * Every link is plain: no active-page highlight, because knowing the current
 * page would make this a client component on every page, the search page
 * included, and its budget has no room for that.
 */
export function SiteHeader() {
  const t = useTranslations("SiteHeader");
  const tAccount = useTranslations("AccountNav");
  // No display in the shared classes: each link says whether it shows, so
  // "hidden" is never fighting an "inline-flex" for the same element.
  const link =
    "min-h-11 items-center rounded-lg px-2.5 text-sm font-medium text-[var(--color-foreground)]/80 transition-colors hover:text-[var(--color-brand)]";

  return (
    <header className="sticky top-0 z-[1000] border-b border-[var(--color-border)] bg-[var(--color-card)]/95 backdrop-blur">
      <div className="app-shell flex h-16 items-center justify-between gap-3 lg:h-[4.5rem]">
        <Link href="/" className="group inline-flex min-h-11 items-center gap-2.5 rounded-xl">
          <BrandMark motion="open" className="size-9 transition-transform duration-500 group-hover:rotate-90" />
          {/* The mark alone below 360px, where the wordmark, two account
              buttons and the menu are wider than the screen. Still named. */}
          <span className="sr-only min-[360px]:hidden">{BRAND}</span>
          <span className="leading-none max-[359px]:hidden">
            <span className="block text-lg font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)]">
              {BRAND.toLowerCase()}
            </span>
            <span className="mt-0.5 block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--color-brand-pink)]">
              {t("productName")}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-0.5 md:flex" aria-label={t("mainNavigation")}>
          {/* Two at tablet width, all five from lg: at 768px anything more
              beside the account buttons pushes the page sideways. Below md
              the home page's cards lead into each part. */}
          <Link href="/" className={`${link} hidden lg:inline-flex`}>
            {t("home")}
          </Link>
          <Link href="/training" className={`${link} inline-flex`}>
            {t("findTraining")}
          </Link>
          <Link href="/learn" className={`${link} hidden lg:inline-flex`}>
            {t("learn")}
          </Link>
          <Link href="/marketplace" className={`${link} inline-flex`}>
            {t("marketplace")}
          </Link>
          <Link href="/trainer/join?new=1" className={`${link} hidden lg:inline-flex`}>
            {t("becomeProvider")}
          </Link>
        </nav>

        <div className="flex items-center gap-1.5">
          <Link
            href="/training"
            aria-label={t("search")}
            className="hidden size-11 place-items-center rounded-lg text-[var(--color-foreground)]/80 hover:text-[var(--color-brand)] sm:grid"
          >
            <Search aria-hidden className="size-5" />
          </Link>
          <AccountNav
            labels={{
              myAccount: tAccount("myAccount"),
              signUp: tAccount("signUp"),
            }}
          />
          {/* Every part of the site, below lg, where the bar has no room
              for them. <details> rather than a script: it opens and closes
              with no JavaScript, so it costs the search page's budget only
              its few lines of HTML. Plain <a>, not <Link>: a full page load
              is what closes it, since the header stays mounted across
              client-side navigation and would otherwise stay open. */}
          <details className="relative lg:hidden">
            <summary
              aria-label={t("menu")}
              className="grid size-11 cursor-pointer list-none place-items-center rounded-lg text-[var(--color-foreground)]/80 hover:text-[var(--color-brand)] [&::-webkit-details-marker]:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </summary>
            <nav
              aria-label={t("mainNavigation")}
              className="absolute right-0 top-full mt-2 w-60 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-[var(--shadow-lg)]"
            >
              {(
                [
                  ["/", t("home")],
                  ["/training", t("findTraining")],
                  ["/learn", t("learn")],
                  ["/marketplace", t("marketplace")],
                  ["/map", t("map")],
                  ["/trainer/join?new=1", t("becomeProvider")],
                ] as const
              ).map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-[var(--color-muted)] hover:text-[var(--color-brand)]"
                >
                  {label}
                </a>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
