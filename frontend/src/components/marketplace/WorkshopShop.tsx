import { ArrowRight, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ProductTile } from "@/components/marketplace/ProductTile";
import { searchProducts } from "@/lib/api";

/**
 * "Shop at this workshop": what a training workshop sells in the
 * marketplace, on its own profile. Nothing at all when it sells nothing, or
 * when the marketplace cannot be reached: the profile must not fail for it.
 */
export async function WorkshopShop({ providerId, name }: { providerId: number; name: string }) {
  const [products, t] = await Promise.all([
    searchProducts({ workshop: String(providerId) }).catch(() => null),
    getTranslations("Marketplace"),
  ]);
  const results = products?.results.slice(0, 8) ?? [];
  if (!results.length) return null;
  const shop = results[0].seller;

  return (
    <section aria-labelledby="workshop-shop" className="app-shell mt-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="workshop-shop" className="flex items-center gap-2 text-xl font-extrabold tracking-[-0.025em]">
            <ShoppingBag aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            {t("workshopShopTitle")}
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-[var(--color-muted-foreground)]">
            {t("workshopShopBody", { name })}
          </p>
        </div>
        <Link
          href={`/marketplace/seller/${shop.id}`}
          className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-brand)]"
        >
          {t("trainersProducts", { count: products?.count ?? results.length })}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        {results.map((product) => (
          <ProductTile key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
