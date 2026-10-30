import {Languages, MapPin, ShieldCheck} from "lucide-react";
import Link from "next/link";
import {getLocale, getTranslations} from "next-intl/server";

import {BrandMark} from "@/components/BrandMark";
import {enabledLocales, LOCALE_NAMES} from "@/i18n/config";
import {BRAND} from "@/lib/brand";
import {coveragePhrase, launchedRegionNames} from "@/lib/coverage";

/**
 * Columns of links, every one to a page that exists.
 *
 * No app-store badges, social icons, help centre or terms page: there are
 * none yet, and a footer link that goes nowhere is the same broken promise
 * as a home page tile that does. Add each one here the day it exists.
 */
export async function SiteFooter() {
  // Named while there are a few regions, the country once there are many.
  // Read from the API rather than written here, so it follows the rollout.
  const [t, tCoverage, regionNames, locale] = await Promise.all([
    getTranslations("SiteFooter"),
    getTranslations("Coverage"),
    launchedRegionNames(),
    getLocale(),
  ]);
  const coverage = coveragePhrase(regionNames, tCoverage);
  // Only once a second language is switched on; see i18n/config.ts.
  const languages = enabledLocales();
  const link = "text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-brand)] hover:underline";

  const columns = [
    {
      title: t("quickLinks"),
      links: [
        ["/", t("home")],
        ["/training", t("browseProviders")],
        ["/learn", t("learn")],
        ["/marketplace", t("marketplace")],
        ["/map", t("exploreMap")],
      ],
    },
    {
      title: t("forProviders"),
      links: [
        ["/trainer/join", t("forTrainers")],
        ["/sell", t("forSellers")],
        ["/trainer/dashboard", t("trainerSignIn")],
      ],
    },
    {
      title: t("about"),
      links: [["/privacy", t("privacy")]],
    },
  ];

  return (
    <footer className="mt-14 border-t border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="app-shell grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] lg:py-12">
        <div className="max-w-sm">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <BrandMark className="size-9" />
            <span className="leading-none">
              <span className="block text-lg font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)]">
                {BRAND.toLowerCase()}
              </span>
              <span className="mt-0.5 block text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--color-brand-pink)]">
                {t("productName")}
              </span>
            </span>
          </Link>
          <p className="mt-3 text-[13px] font-semibold">{t("tagline")}</p>
          <p className="mt-2 text-xs leading-5 text-[var(--color-muted-foreground)]">
            {t("summary", {brand: BRAND})}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--color-muted-foreground)]">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden /> {coverage}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden /> {t("honestLabels")}
            </span>
          </div>
        </div>

        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-[13px] font-bold">{column.title}</h2>
            <ul className="mt-3 space-y-2">
              {column.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className={link}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-[var(--color-border)]">
        <div className="app-shell flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-[var(--color-muted-foreground)]">
          <p>{t("copyright", {year: new Date().getFullYear(), brand: BRAND})}</p>
          {languages.length > 1 ? (
            // Each language in its own name, so somebody who cannot read the
            // current one can still find theirs. Plain links: the choice is a
            // cookie set by /language/<code>, and needs no JavaScript.
            <nav aria-label={t("language")} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Languages className="size-3.5" aria-hidden />
              {languages.map((code) =>
                code === locale ? (
                  <span key={code} aria-current="true" className="font-semibold text-[var(--color-foreground)]">
                    {LOCALE_NAMES[code]}
                  </span>
                ) : (
                  <a
                    key={code}
                    href={`/language/${code}`}
                    hrefLang={code}
                    lang={code}
                    className="hover:text-[var(--color-brand)] hover:underline"
                  >
                    {LOCALE_NAMES[code]}
                  </a>
                ),
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
