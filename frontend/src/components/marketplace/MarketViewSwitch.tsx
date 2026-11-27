import { LayoutGrid, Store } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * "Items | Shops" at the top of the marketplace: every item (/marketplace)
 * or every shop (/marketplace/shops). Two links, so either view can be
 * shared and opened from a search engine.
 */
export function MarketViewSwitch({ current }: { current: "items" | "shops" }) {
  const t = useTranslations("Marketplace");
  const tab = (active: boolean) =>
    `inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
      active
        ? "bg-[var(--color-brand)] text-white"
        : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
    }`;
  return (
    <nav
      aria-label={t("viewLabel")}
      className="mb-5 inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-card)] p-1"
    >
      <Link href="/marketplace" aria-current={current === "items" ? "page" : undefined} className={tab(current === "items")}>
        <LayoutGrid aria-hidden="true" className="size-4" />
        {t("viewItems")}
      </Link>
      <Link href="/marketplace/shops" aria-current={current === "shops" ? "page" : undefined} className={tab(current === "shops")}>
        <Store aria-hidden="true" className="size-4" />
        {t("viewShops")}
      </Link>
    </nav>
  );
}
