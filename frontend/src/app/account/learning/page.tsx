/**
 * /account/learning: the learning half of the one account area, what used to
 * be /trainee (which now redirects here). Enquiries to workshops, training,
 * saved workshops and learning preferences. Name, email, photo and closing
 * the account are on /account, once for the whole site.
 */

import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";

import {AccountSections} from "@/components/account/AccountSections";
import {TraineeDashboard} from "@/components/trainee/TraineeDashboard";
import {ClientMessages} from "@/i18n/ClientMessages";
import {TRAINEE_CLIENT_NAMESPACES} from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TraineePages");
  return {title: t("accountTitle"), robots: {index: false, follow: false}};
}

export default function LearningPage() {
  return (
    <div className="mx-auto min-h-[60dvh] max-w-[84rem] px-3 py-5 sm:py-7 lg:px-6 lg:py-10">
      <ClientMessages namespaces={[...TRAINEE_CLIENT_NAMESPACES, "AccountSections"]}>
        <AccountSections current="learning" wide />
        <TraineeDashboard />
      </ClientMessages>
    </div>
  );
}
