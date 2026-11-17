import { useTranslations } from "next-intl";

import { MarketplaceBottomBar } from "@/components/basket/MarketplaceBottomBar";

/** Every marketplace page: room at the bottom of a phone screen for the
    marketplace bar (shop, search, saved, basket). */
export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Basket");
  return (
    <>
      <div className="pb-16 lg:pb-0">{children}</div>
      <MarketplaceBottomBar
        labels={{
          shop: t("shop"),
          search: t("search"),
          saved: t("saved"),
          basket: t("basket"),
          bar: t("marketplaceBar"),
        }}
      />
    </>
  );
}
