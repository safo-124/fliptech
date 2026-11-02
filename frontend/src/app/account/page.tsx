/**
 * /account: one sign-in for everyone. Buying needs nothing more; being a
 * trainee, trainer or seller is added from here, on the same login.
 */

import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";
import {Suspense} from "react";

import {AccountPage} from "@/components/account/AccountPage";
import {ClientMessages} from "@/i18n/ClientMessages";
import {ACCOUNT_CLIENT_NAMESPACES} from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return {title: t("metaTitle"), robots: {index: false, follow: false}};
}

export default function AccountRoute() {
  return (
    <div className="app-shell py-8 pb-14">
      <ClientMessages namespaces={ACCOUNT_CLIENT_NAMESPACES}>
        <Suspense>
          <AccountPage />
        </Suspense>
      </ClientMessages>
    </div>
  );
}
