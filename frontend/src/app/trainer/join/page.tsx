import type {Metadata} from "next";
import {Clock3, ShieldCheck, Smartphone} from "lucide-react";
import {getTranslations} from "next-intl/server";
import {Suspense} from "react";

import {Badge} from "@/components/ui/badge";
import {TrainerJoinWizard, TrainerJoinWizardLoading} from "@/components/trainer/TrainerJoinWizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TrainerPages");
  return {title: t("joinTitle"), description: t("joinDescription")};
}

export default async function TrainerJoinPage() {
  const t = await getTranslations("TrainerPages");
  return (
    <div className="mx-auto max-w-2xl">
      <header className="relative mb-6 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)]/80 p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -right-16 -top-20 size-48 rounded-full bg-[var(--color-brand-soft)] blur-3xl"
        />
        <div className="relative">
          <Badge variant="secondary">
            <Smartphone aria-hidden="true" />
            {t("forTrainers")}
          </Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
            {t("joinTitle")}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
            {t("joinLead")}
          </p>
          <div className="mt-5 grid gap-2 text-xs text-[var(--color-muted-foreground)] sm:grid-cols-3">
            <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/60 px-3 py-2.5">
              <Clock3 aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand-strong)]" />
              {t("quickSetup")}
            </p>
            <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/60 px-3 py-2.5">
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand-strong)]" />
              {t("reviewedByStaff")}
            </p>
            <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/60 px-3 py-2.5">
              <Smartphone aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand-strong)]" />
              {t("noPassword")}
            </p>
          </div>
        </div>
      </header>
      {/* The wizard reads ?new=1 to tell a sign-up from a sign-in, and a
          component reading the query string needs a Suspense boundary on a
          statically rendered page. */}
      <Suspense fallback={<TrainerJoinWizardLoading />}>
        <TrainerJoinWizard />
      </Suspense>
    </div>
  );
}
