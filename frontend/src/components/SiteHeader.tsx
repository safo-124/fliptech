import {Menu, Search} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";

import {AccountNav} from "@/components/AccountNav";
import {BrandMark} from "@/components/BrandMark";
import {BRAND} from "@/lib/brand";

/**
 * The site's header: a brand stripe, the logo, the three parts of the site
 * as a floating "island" with a panel of shortcuts under each, a search
 * pill, and the account.
 *
 * Still no JavaScript of its own. The panels open on hover and on keyboard
 * focus (CSS group-hover and focus-within), and the phone menu is a
 * <details>: the search page's budget has no room for a header script, and
 * none is needed. The account buttons are the one client island, as before.
 *
 * No active-page highlight, for the same reason: knowing the current page
 * would make this a client component on every page.
 */

/** The shortcuts the phone menu lists under its three tiles: the rest are a
    tap away on each section's own page, and every link here is paid for in
    the search page's budget. */
const PHONE_EXTRAS = ["/map", "/marketplace/saved", "/sell", "/trainer/join?new=1"];

type Shortcut = {href: string; label: string; hint: string};
type Section = {
  key: string;
  href: string;
  label: string;
  /** The section's colours (globals.css .tint-*). */
  tint: string;
  /** A one-character mark for the phone menu's tile: far lighter than an icon. */
  emoji: string;
  shortcuts: Shortcut[];
};

export function SiteHeader() {
  const t = useTranslations("SiteHeader");
  const tAccount = useTranslations("AccountNav");

  const sections: Section[] = [
    {
      key: "training",
      tint: "tint-training",
      emoji: "🎓",
      href: "/training",
      label: t("findTraining"),

      shortcuts: [
        {href: "/training", label: t("searchWorkshops"), hint: t("searchWorkshopsHint")},
        {href: "/map", label: t("map"), hint: t("mapHint")},
        {href: "/trainer/join?new=1", label: t("becomeProvider"), hint: t("becomeProviderHint")},
      ],
    },
    {
      key: "learn",
      tint: "tint-learn",
      emoji: "▶",
      href: "/learn",
      label: t("learn"),

      shortcuts: [
        {href: "/learn", label: t("allCourses"), hint: t("allCoursesHint")},
        {href: "/learn/mine", label: t("myCourses"), hint: t("myCoursesHint")},
      ],
    },
    {
      key: "market",
      tint: "tint-market",
      emoji: "🛍",
      href: "/marketplace",
      label: t("marketplace"),

      shortcuts: [
        {href: "/marketplace?sold_by=trainers", label: t("fromTrainers"), hint: t("fromTrainersHint")},
        {href: "/marketplace?condition=used", label: t("secondHand"), hint: t("secondHandHint")},
        {href: "/marketplace/saved", label: t("savedBag"), hint: t("savedBagHint")},
        {href: "/sell", label: t("sell"), hint: t("sellHint")},
      ],
    },
  ];

  return (
    <header className="sticky top-0 z-[1000]">
      {/* The brand stripe: the logo's colours, end to end. */}
      <div
        aria-hidden
        className="nav-stripe"
      />
      <div className="nav-bar">
        <div className="app-shell flex h-16 items-center justify-between gap-3 lg:h-[4.5rem]">
          <Link href="/" className="group inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl">
            <span className="nav-logo">
              <BrandMark motion="open" className="size-7 transition-transform duration-500 group-hover:rotate-90" />
            </span>
            {/* The mark alone below 360px, where the wordmark, two account
                buttons and the menu are wider than the screen. Still named. */}
            <span className="sr-only min-[360px]:hidden">{BRAND}</span>
            <span className="leading-none max-[359px]:hidden">
              <span className="nav-word">
                {BRAND.toLowerCase()}
              </span>
              <span className="nav-sub">
                {t("productName")}
              </span>
            </span>
          </Link>

          {/* The island: the three parts, each with its panel. From lg; at
              tablet width the menu carries them, since the panels and the
              account buttons do not fit side by side at 768px. */}
          <nav aria-label={t("mainNavigation")} className="hidden lg:block">
            <ul className="nav-island">
              {sections.map((section) => (
                <li key={section.key} className="nav-item relative">
                  <Link href={section.href} className="nav-link">
                    <i aria-hidden className={`size-2 rounded-full ${section.tint}`} />
                    {section.label}
                  </Link>
                  {/* The panel. pt-3 bridges the gap, so the pointer can
                      travel from the button into it without it closing. */}
                  <div className="nav-panel">
                    <div className="nav-card">
                      <div aria-hidden className={`h-1.5 ${section.tint}`} />
                      <ul className="p-2">
                        {section.shortcuts.map((shortcut) => (
                          <li key={shortcut.href}>
                            <Link href={shortcut.href} className="nav-shortcut">
                              <b>{shortcut.label}</b>
                              <small>{shortcut.hint}</small>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-1.5">
            {/* One link: an icon from sm, a search pill from xl. */}
            <Link
              href="/training"
              aria-label={t("search")}
              className="nav-search"
            >
              <Search aria-hidden className="size-5 text-[var(--color-brand)] xl:size-4" />
              <span aria-hidden className="hidden xl:inline">
                {t("searchPill")}
              </span>
            </Link>
            <AccountNav
              labels={{
                myAccount: tAccount("myAccount"),
                signUp: tAccount("signUp"),
              }}
            />
            {/* Every part of the site below lg. <details> rather than a
                script: it opens and closes with no JavaScript. Plain <a>,
                not <Link>: a full page load is what closes it, since the
                header stays mounted across client-side navigation. */}
            <details className="lg:hidden">
              <summary
                aria-label={t("menu")}
                className="nav-menu-btn"
              >
                <Menu aria-hidden className="size-5" />
              </summary>
              <nav
                aria-label={t("mainNavigation")}
                className="nav-sheet"
              >
                <div className="app-shell space-y-4 py-4">
                  <div className="grid grid-cols-3 gap-2">
                    {sections.map((section) => (
                      <a
                        key={section.key}
                        href={section.href}
                        className={`nav-tile ${section.tint}`}
                      >
                        <span aria-hidden className="text-2xl leading-none">{section.emoji}</span>
                        {section.label}
                      </a>
                    ))}
                  </div>
                  <ul className="grid grid-cols-2 gap-1">
                    {sections
                      .flatMap((section) => section.shortcuts)
                      .filter((shortcut) => PHONE_EXTRAS.includes(shortcut.href))
                      .map((shortcut) => (
                        <li key={shortcut.href}>
                          <a
                            href={shortcut.href}
                            className="nav-extra"
                          >
                            {shortcut.label}
                          </a>
                        </li>
                      ))}
                  </ul>
                </div>
              </nav>
            </details>
          </div>
        </div>
      </div>
    </header>
  );
}
