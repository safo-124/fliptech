import {Languages, MapPin, ShieldCheck} from "lucide-react";
import Link from "next/link";
import {getLocale, getTranslations} from "next-intl/server";

import {BrandMark} from "@/components/BrandMark";
import {BrandShards} from "@/components/BrandShards";
import {enabledLocales, LOCALE_NAMES} from "@/i18n/config";
import {BRAND} from "@/lib/brand";
import {coveragePhrase, launchedRegionNames} from "@/lib/coverage";

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

  return (
    // Closes the page on the same indigo the header opens it with.
    <footer className="band relative isolate mt-14 overflow-hidden">
      <BrandShards className="pointer-events-none absolute -bottom-8 right-0 h-[14rem] w-[18rem] opacity-40" />
      <div className="app-shell relative z-10 grid gap-7 py-9 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:py-12">
        <div className="max-w-xl">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <p className="text-sm font-semibold text-white">
              {t("tagline")}
            </p>
          </div>
          <p className="mt-3 text-xs leading-5 text-white/60">
            {t("summary", {brand: BRAND})}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/60">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden /> {coverage}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden /> {t("honestLabels")}
            </span>
          </div>
          {languages.length > 1 ? (
            // Each language in its own name, so somebody who cannot read the
            // current one can still find theirs. Plain links: the choice is a
            // cookie set by /language/<code>, and needs no JavaScript.
            <nav aria-label={t("language")} className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <Languages className="size-3.5 text-white/60" aria-hidden />
              {languages.map((code) =>
                code === locale ? (
                  <span key={code} aria-current="true" className="font-semibold text-white">
                    {LOCALE_NAMES[code]}
                  </span>
                ) : (
                  <a
                    key={code}
                    href={`/language/${code}`}
                    hrefLang={code}
                    lang={code}
                    className="text-white/75 hover:text-white hover:underline"
                  >
                    {LOCALE_NAMES[code]}
                  </a>
                ),
              )}
            </nav>
          ) : null}
        </div>
        <nav className="flex gap-5 text-xs font-medium text-white/75" aria-label={t("footerNavigation")}>
          <Link href="/" className="hover:text-white hover:underline">{t("browseProviders")}</Link>
          <Link href="/map" className="hover:text-white hover:underline">{t("exploreMap")}</Link>
          <Link href="/trainer/join" className="hover:text-white hover:underline">{t("forTrainers")}</Link>
          <Link href="/privacy" className="hover:text-white hover:underline">{t("privacy")}</Link>
        </nav>
      </div>
    </footer>
  );
}
