/**
 * Returns and refunds, in plain words, at /returns: the address Google
 * Merchant Center points to, and the one the checkout and product pages link.
 *
 * Built on buyer protection. A Buy now payment is held until the buyer taps
 * "I've got it", or until MARKETPLACE_RELEASE_DAYS (3) days after the seller
 * hands it over with no problem reported; the returns window is that hold, so
 * every refund promised here is money still in hand. See backend
 * marketplace/payouts.py and the order page's "report by" date.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BRAND } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Returns");
  return {
    title: t("title"),
    description: t("metaDescription", { brand: BRAND }),
    alternates: { canonical: "/returns" },
  };
}

const SECTIONS = ["held", "window", "how", "exceptions", "changeOfMind", "refunds", "afterRelease"] as const;

export default async function ReturnsPage() {
  const t = await getTranslations("Returns");
  return (
    <article className="app-shell max-w-3xl py-8 pb-14">
      <h1 className="text-3xl font-bold tracking-[-0.035em]">{t("title")}</h1>
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{t("updated")}</p>
      <p className="mt-4 rounded-xl bg-[var(--color-visit-bg)] p-4 text-sm font-semibold leading-6 text-[var(--color-visit)]">
        {t("summary", { brand: BRAND })}
      </p>
      {SECTIONS.map((section) => (
        <section key={section} id={section} className="mt-7 scroll-mt-24">
          <h2 className="text-lg font-bold tracking-[-0.02em]">{t(`${section}.title`)}</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-[var(--color-foreground)]/85">
            {t(`${section}.body`, { brand: BRAND })}
          </p>
        </section>
      ))}
      <p className="mt-8 text-sm text-[var(--color-muted-foreground)]">
        {t("more")}{" "}
        <Link href="/marketplace/terms" className="font-semibold text-[var(--color-brand)] underline-offset-2 hover:underline">
          {t("termsLink")}
        </Link>
      </p>
    </article>
  );
}
