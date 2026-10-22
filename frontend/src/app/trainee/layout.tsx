import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";

import {ClientMessages} from "@/i18n/ClientMessages";
import {TRAINEE_CLIENT_NAMESPACES} from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TraineePages");
  return {title: t("accountTitle"), robots: {index: false, follow: false}};
}

export default function TraineeLayout({children}: {children: React.ReactNode}) {
  // Wider than the public pages: the account is a two-column workspace from
  // lg up, and a 5xl cap left the content as a ribbon down a wide screen.
  return (
    <div className="mx-auto min-h-[60dvh] max-w-[84rem] px-3 py-5 sm:py-7 lg:px-6 lg:py-10">
      <ClientMessages namespaces={TRAINEE_CLIENT_NAMESPACES}>{children}</ClientMessages>
    </div>
  );
}
