/**
 * The link texted to a buyer a few days after they asked or paid: how was
 * the seller? See backend marketplace/reviews.py.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ReviewForm } from "@/components/marketplace/ReviewForm";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("reviewPageTitle"), robots: { index: false, follow: false } };
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  // The token carries ":" separators, which arrive still percent-encoded;
  // decoded once here so the API call does not encode them a second time.
  const { token: raw } = await params;
  let token = raw;
  try {
    token = decodeURIComponent(raw);
  } catch {
    // A malformed link: the API will say it is not valid.
  }
  return (
    <div className="app-shell max-w-xl py-8 pb-14">
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <ReviewForm token={token} />
      </ClientMessages>
    </div>
  );
}
