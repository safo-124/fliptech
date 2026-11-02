/**
 * Terms of sale for the marketplace: what a buyer and a seller can expect
 * when money passes through Fliiptech. A draft in plain words, to be read by
 * a lawyer before it is relied on; see DEPLOY.md.
 */

import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";

import {BRAND} from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("MarketTerms");
  return {title: t("title")};
}

const SECTIONS = ["who", "buying", "deposits", "delivery", "problems", "refunds", "sellers", "banned", "fees", "privacy"] as const;

export default async function MarketTermsPage() {
  const t = await getTranslations("MarketTerms");
  return (
    <article className="app-shell max-w-3xl py-8 pb-14">
      <h1 className="text-3xl font-bold tracking-[-0.035em]">{t("title")}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{t("updated")}</p>
      <p className="mt-4 text-sm leading-7">{t("intro", {brand: BRAND})}</p>
      {SECTIONS.map((section) => (
        <section key={section} className="mt-7">
          <h2 className="text-lg font-bold tracking-[-0.02em]">{t(`${section}.title`)}</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-[var(--color-foreground)]/85">
            {t(`${section}.body`, {brand: BRAND})}
          </p>
        </section>
      ))}
    </article>
  );
}
