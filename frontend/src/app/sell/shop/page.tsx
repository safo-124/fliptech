import type {Metadata} from "next";
import {getTranslations} from "next-intl/server";

import {SellerDashboard} from "@/components/seller/SellerDashboard";
import {ClientMessages} from "@/i18n/ClientMessages";
import {SELLER_CLIENT_NAMESPACES} from "@/i18n/namespaces";
import {getAllAreas} from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SellerPages");
  // Nobody should land here from a search result: it is somebody's own shop
  // workspace and every page of it is behind a session.
  return {title: t("dashboardTitle"), robots: {index: false, follow: false}};
}

/**
 * The seller's workspace.
 *
 * The areas are fetched here rather than in the client component: they are
 * the same list for everybody, they change about never, and fetching them on
 * the server keeps them out of the signed-in request path.
 */
export default async function SellerShopPage() {
  const areas = await getAllAreas().catch(() => []);
  return (
    <div className="py-6">
      <ClientMessages namespaces={SELLER_CLIENT_NAMESPACES}>
        <SellerDashboard areas={areas} />
      </ClientMessages>
    </div>
  );
}
