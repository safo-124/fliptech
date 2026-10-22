import {MapPin, ShieldCheck} from "lucide-react";
import Link from "next/link";
import {getTranslations} from "next-intl/server";

import {BrandMark} from "@/components/BrandMark";
import {BrandShards} from "@/components/BrandShards";
import {BRAND} from "@/lib/brand";
import {coveragePhrase, launchedRegionNames} from "@/lib/coverage";

export async function SiteFooter() {
  // Named while there are a few regions, the country once there are many.
  // Read from the API rather than written here, so it follows the rollout.
  const [t, tCoverage, regionNames] = await Promise.all([
    getTranslations("SiteFooter"),
    getTranslations("Coverage"),
    launchedRegionNames(),
  ]);
  const coverage = coveragePhrase(regionNames, tCoverage);

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
