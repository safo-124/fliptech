import type {Metadata} from "next";
import {ArrowRight, LayoutDashboard} from "lucide-react";
import Link from "next/link";
import {getTranslations} from "next-intl/server";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {TrainerDashboard} from "@/components/trainer/TrainerDashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TrainerPages");
  return {title: t("dashboardMetaTitle"), description: t("dashboardDescription")};
}

export default async function TrainerDashboardPage() {
  const t = await getTranslations("TrainerPages");
  return (
    <>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="secondary">
            <LayoutDashboard aria-hidden="true" />
            {t("workspace")}
          </Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
            {t("dashboardHeading")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
            {t("dashboardLead")}
          </p>
        </div>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/trainer/join">
            {t("listOrUpdate")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </header>
      <TrainerDashboard />
    </>
  );
}
