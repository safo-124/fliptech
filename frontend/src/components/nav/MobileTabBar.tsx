"use client";

import {GraduationCap, Home, PlayCircle, ShoppingBag, UserRound} from "lucide-react";
import Link from "next/link";
import {usePathname} from "next/navigation";

import {useBasket} from "@/components/basket/useBasket";
import {cn} from "@/lib/utils";

/**
 * The bar along the bottom of a phone screen: the site's five places, one
 * thumb away, like the Android app's. The basket count rides on Shop.
 *
 * Hidden from lg, where the header has room for everything. Also hidden where
 * a page brings its own bar along the bottom (the trainer, seller and learner
 * dashboards: see .tabbar in globals.css) and on the full-screen map.
 *
 * A spacer the bar's height sits before it, so the footer's last line is
 * never under the bar.
 */
export type MobileTabBarLabels = {
  bar: string;
  home: string;
  training: string;
  learn: string;
  shop: string;
  account: string;
  basketItems: string;
};

/** Pages that are a full screen of their own (the map) go without the bar. */
const WITHOUT = ["/map"];

export function MobileTabBar({labels}: {labels: MobileTabBarLabels}) {
  const path = usePathname() ?? "/";
  const count = useBasket()?.count ?? 0;
  if (WITHOUT.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return null;

  const under = (...prefixes: string[]) =>
    prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
  const tabs = [
    {href: "/", label: labels.home, icon: Home, on: path === "/"},
    {href: "/training", label: labels.training, icon: GraduationCap, on: under("/training", "/trades", "/categories")},
    {href: "/learn", label: labels.learn, icon: PlayCircle, on: under("/learn")},
    {href: "/marketplace", label: labels.shop, icon: ShoppingBag, on: under("/marketplace", "/sell"), count},
    {href: "/account", label: labels.account, icon: UserRound, on: under("/account")},
  ];

  return (
    <div className="tabbar lg:hidden">
      <div aria-hidden="true" className="h-[calc(5.25rem+env(safe-area-inset-bottom))]" />
      <nav
        aria-label={labels.bar}
        className="fixed inset-x-2.5 bottom-[max(0.625rem,env(safe-area-inset-bottom))] z-[900] mx-auto max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/85 p-1.5 shadow-[var(--shadow-lg)] backdrop-blur-xl"
      >
        <ul className="grid grid-cols-5 gap-1">
          {tabs.map(({href, label, icon: Icon, on, count: badge}) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                aria-label={badge ? `${label}, ${labels.basketItems.replace("{count}", String(badge))}` : undefined}
                className={cn(
                  "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10.5px] font-semibold transition-colors",
                  on
                    ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
                {badge ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-[calc(50%-1.35rem)] top-1 grid min-w-[1.1rem] place-items-center rounded-full border-2 border-[var(--color-card)] bg-[var(--color-brand-pink)] px-1 text-[10px] font-bold leading-4 text-white"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
