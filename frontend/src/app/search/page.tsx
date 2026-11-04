/**
 * /search: one box for the whole site. Workshops, online courses, products
 * and shops, a few of each, updating as the visitor types.
 *
 * The first paint is rendered here for ?q=, so a shared link or a phone
 * still waiting for its JavaScript shows results; from then on the browser
 * searches as the visitor types (LiveSearch). Not indexed: a results page per
 * query is not a page anyone should land on from Google.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LiveSearch } from "@/components/search/LiveSearch";
import styles from "@/components/search/search.module.css";
import { ClientMessages } from "@/i18n/ClientMessages";
import { SEARCH_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { getTrades, siteSearch } from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SiteSearch");
  return { title: t("metaTitle"), robots: { index: false, follow: true } };
}

export default async function SiteSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  const [t, results, trades] = await Promise.all([
    getTranslations("SiteSearch"),
    q ? siteSearch(q).catch(() => null) : Promise.resolve(null),
    getTrades().catch(() => ({ results: [] })),
  ]);
  const popular = trades.results
    .filter((trade) => trade.provider_count > 0)
    .slice(0, 6)
    .map(({ slug, name, colour, provider_count }) => ({ slug, name, colour, provider_count }));

  return (
    <div className="pb-14">
      <section className="hero-wash">
        <div className="app-shell pt-8 pb-5 sm:pt-10">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-brand)] sm:text-xs">
            {t("eyebrow")}
          </p>
          <h1 className={`${styles.title} mt-2 font-extrabold leading-[1.08] tracking-[-0.035em] text-[var(--color-brand-deep)]`}>
            {t("title")}
          </h1>
        </div>
      </section>
      <div className="app-shell">
        <ClientMessages namespaces={SEARCH_CLIENT_NAMESPACES}>
          <LiveSearch initialQuery={q} initialResults={results} popular={popular} />
        </ClientMessages>
      </div>
    </div>
  );
}
