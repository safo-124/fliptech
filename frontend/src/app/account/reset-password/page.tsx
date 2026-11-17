import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";
import {Suspense} from "react";

import {ResetPasswordForm} from "@/components/auth/PasswordPages";
import {ClientMessages} from "@/i18n/ClientMessages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PasswordPages");
  return {title: t("resetTitle"), robots: {index: false, follow: false}};
}

export default async function Page() {
  const t = await getTranslations("PasswordPages");
  return (
    <div className="app-shell max-w-md py-10 pb-14">
      <h1 className="mb-4 text-2xl font-extrabold tracking-[-0.02em]">{t("resetTitle")}</h1>
      <ClientMessages namespaces={["PasswordPages", "SignIn"]}>
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </ClientMessages>
    </div>
  );
}
