/**
 * /<area>/<workshop>/report: "Report a problem" with one listing.
 *
 * Linked from the foot of every listing. The form is the client part; this
 * page only finds the listing, so a report always names the workshop it is
 * about and a mistyped address is a 404 rather than an orphaned report.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Flag } from "lucide-react";

import { ReportProblemForm } from "@/components/ReportProblemForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClientMessages } from "@/i18n/ClientMessages";
import { REPORT_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { ApiError, getProvider } from "@/lib/api";

type Params = { area: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { area, slug } = await params;
  const t = await getTranslations("ReportProblem");
  const provider = await getProvider(area, slug).catch(() => null);
  return {
    title: provider ? t("pageTitle", { name: provider.name }) : t("title"),
    // A form, not content: nothing here is worth a search result.
    robots: { index: false, follow: false },
  };
}

export default async function ReportProblemPage({ params }: { params: Promise<Params> }) {
  const { area, slug } = await params;
  const t = await getTranslations("ReportProblem");
  let provider;
  try {
    provider = await getProvider(area, slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const listingHref = `/${area}/${slug}`;

  return (
    <div className="relative overflow-hidden pb-12">
      <div
        aria-hidden="true"
        className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70"
      />
      <div className="app-shell relative mx-auto max-w-2xl py-4 sm:py-8">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link href={listingHref}>
            <ArrowLeft aria-hidden="true" />
            {t("backToListing", { name: provider.name })}
          </Link>
        </Button>

        <div className="mb-5 flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
            <Flag aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.035em]">{t("title")}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
              {t("lead", { name: provider.name })}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-5 sm:p-7">
            <ClientMessages namespaces={REPORT_CLIENT_NAMESPACES}>
              <ReportProblemForm
                providerId={provider.id}
                providerName={provider.name}
                listingHref={listingHref}
              />
            </ClientMessages>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
