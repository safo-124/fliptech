import {Store} from "lucide-react";
import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";
import {Suspense} from "react";

import {SellerSignIn} from "@/components/seller/SellerSignIn";
import {Badge} from "@/components/ui/badge";
import {ClientMessages} from "@/i18n/ClientMessages";
import {SELLER_CLIENT_NAMESPACES} from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SellerPages");
  return {title: t("signInTitle"), description: t("signInDescription")};
}

/**
 * Start selling, or come back to a shop.
 *
 * One page for both, because they are one act: a number that has sold before
 * signs in, a number that has not gets an account. Nothing distinguishes them
 * at this screen and nothing should.
 */
export default async function SellPage() {
  const t = await getTranslations("SellerPages");
  return (
    <div className="mx-auto max-w-md py-6">
      <header className="mb-5">
        <Badge variant="secondary">
          <Store aria-hidden="true" />
          {t("forSellers")}
        </Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.035em]">{t("heading")}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">{t("lead")}</p>
      </header>
      <ClientMessages namespaces={SELLER_CLIENT_NAMESPACES}>
        <Suspense>
          <SellerSignIn />
        </Suspense>
      </ClientMessages>
    </div>
  );
}
