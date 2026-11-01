/**
 * Ask several makers at once: bulk orders and custom jobs. See backend
 * marketplace/quotes.py.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { QuoteForm } from "@/components/marketplace/QuoteForm";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { getAllAreas, getAllTrades } from "@/lib/api";
import { BRAND } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("quoteMetaTitle"), description: t("quoteLead", { brand: BRAND }) };
}

export default async function QuotePage() {
  const [trades, areas, t] = await Promise.all([
    getAllTrades().catch(() => []),
    getAllAreas().catch(() => []),
    getTranslations("Marketplace"),
  ]);
  return (
    <div className="app-shell max-w-2xl py-8 pb-14">
      <h1 className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">{t("quoteTitle")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        {t("quoteLead", { brand: BRAND })}
      </p>
      <div className="mt-6">
        <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
          <QuoteForm
            trades={trades.map((trade) => ({ slug: trade.slug, name: trade.name }))}
            areas={areas.map((area) => ({ slug: area.slug, name: area.name }))}
          />
        </ClientMessages>
      </div>
    </div>
  );
}
