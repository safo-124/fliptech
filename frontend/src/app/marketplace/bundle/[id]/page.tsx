import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BundleCheckout } from "@/components/marketplace/BundleCheckout";
import { BundleCard } from "@/components/marketplace/CourseShop";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { ApiError, getBundle } from "@/lib/api";

async function load(id: string) {
  if (!/^\d+$/.test(id)) notFound();
  try {
    return await getBundle(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [bundle, t] = await Promise.all([load(id), getTranslations("Marketplace")]);
  return { title: t("bundleTitleMeta", { title: bundle.title }) };
}

/** Learn and buy: a workshop's course and kit, then paying for it. */
export default async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [bundle, t] = await Promise.all([load(id), getTranslations("Marketplace")]);
  return (
    <div className="app-shell max-w-4xl py-6 pb-14">
      <Link
        href={bundle.course?.path ?? `/marketplace/seller/${bundle.seller.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {bundle.course ? t("bundleBack") : bundle.seller.business_name}
      </Link>
      <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
        <BundleCard bundle={bundle} action={false} />
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
            <BundleCheckout bundle={bundle} />
          </ClientMessages>
        </div>
      </div>
    </div>
  );
}
