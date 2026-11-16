"use client";

import { Heart, Search, ShoppingBasket, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useBasket } from "@/components/basket/useBasket";
import { cn } from "@/lib/utils";

/** The marketplace's bar along the bottom of a phone screen: the shop,
    search, saved things and the basket with its count. Hidden from lg,
    where the header has room for all of it. */
export function MarketplaceBottomBar({
  labels,
}: {
  labels: { shop: string; search: string; saved: string; basket: string; bar: string };
}) {
  const path = usePathname();
  const count = useBasket()?.count ?? 0;
  const items = [
    { href: "/marketplace", label: labels.shop, icon: Store, on: path === "/marketplace" },
    { href: "/search", label: labels.search, icon: Search, on: path === "/search" },
    { href: "/marketplace/saved", label: labels.saved, icon: Heart, on: path === "/marketplace/saved" },
    {
      href: "/marketplace/basket",
      label: labels.basket,
      icon: ShoppingBasket,
      on: path.startsWith("/marketplace/basket") || path.startsWith("/marketplace/checkout"),
      count,
    },
  ];
  return (
    <nav
      aria-label={labels.bar}
      className="fixed inset-x-0 bottom-0 z-[900] border-t border-[var(--color-border)] bg-[var(--color-card)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map(({ href, label, icon: Icon, on, count: badge }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={on ? "page" : undefined}
              aria-label={badge ? `${label} (${badge})` : undefined}
              className={cn(
                "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                on ? "text-[var(--color-brand)]" : "text-[var(--color-muted-foreground)]",
              )}
            >
              <Icon aria-hidden="true" className="size-5" />
              {label}
              {badge ? (
                <span
                  aria-hidden
                  className="absolute right-[calc(50%-1.4rem)] top-1.5 grid min-w-5 place-items-center rounded-full bg-[var(--color-brand-pink)] px-1 text-[11px] font-bold leading-5 text-white"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
