import type {Metadata} from "next";
import {GraduationCap} from "lucide-react";
import {getTranslations} from "next-intl/server";
import {Suspense} from "react";

import {TraineeSignIn} from "@/components/trainee/TraineeSignIn";
import {Badge} from "@/components/ui/badge";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TraineePages");
  return {title: t("signInTitle"), description: t("signInDescription")};
}

export default async function TraineeSignInPage() {
  const t = await getTranslations("TraineePages");
  return (
    <div className="mx-auto max-w-md">
      <header className="mb-5">
        <Badge variant="secondary">
          <GraduationCap aria-hidden="true" />
          {t("forTrainees")}
        </Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.035em]">{t("signInHeading")}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
          {t("signInLead")}
        </p>
      </header>
      <Suspense>
        <TraineeSignIn />
      </Suspense>
    </div>
  );
}
