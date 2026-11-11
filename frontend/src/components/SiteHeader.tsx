import {Search} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";

import {AccountNav} from "@/components/AccountNav";
import {BrandMark} from "@/components/BrandMark";
import {BRAND} from "@/lib/brand";
import {MainNav} from "@/components/nav/MainNav";
import {MobileNav} from "@/components/nav/MobileNav";
import type {NavLabels, NavSection} from "@/components/nav/types";

/**
 * The site's header: a brand stripe, the logo, the three parts of the site
 * (each opening one panel of shortcuts and a featured next step), search,
 * and the account. Below lg a menu button opens every part in one sheet.
 *
 * The menus are client components (nav/MainNav, nav/MobileNav): they keep
 * one panel open at a time, close on Escape, a click elsewhere or a link,
 * and mark the section you are in. This file stays a server component and
 * hands them already-translated text.
 */
export function SiteHeader() {
  const t = useTranslations("SiteHeader");
  const tAccount = useTranslations("AccountNav");

  const sections: NavSection[] = [
    {
      key: "training",
      icon: "training",
      href: "/training",
      label: t("findTraining"),
      allLabel: t("allTraining"),
      shortcuts: [
        {href: "/training", label: t("searchWorkshops"), hint: t("searchWorkshopsHint"), icon: "search"},
        {href: "/map", label: t("map"), hint: t("mapHint"), icon: "map"},
        {
          href: "/trainer/join?new=1",
          label: t("becomeProvider"),
          hint: t("becomeProviderHint"),
          icon: "provider",
        },
      ],
      feature: {
        title: t("trainingFeatureTitle"),
        body: t("trainingFeatureBody"),
        cta: t("trainingFeatureCta"),
        href: "/training",
      },
    },
    {
      key: "learn",
      icon: "learn",
      href: "/learn",
      label: t("learn"),
      allLabel: t("allLearn"),
      shortcuts: [
        {href: "/learn", label: t("allCourses"), hint: t("allCoursesHint"), icon: "courses"},
        {href: "/learn/mine", label: t("myCourses"), hint: t("myCoursesHint"), icon: "myCourses"},
        {href: "/learn/saved", label: t("savedLessons"), hint: t("savedLessonsHint"), icon: "saved"},
      ],
      feature: {
        title: t("learnFeatureTitle"),
        body: t("learnFeatureBody"),
        cta: t("learnFeatureCta"),
        href: "/learn",
      },
    },
    {
      key: "market",
      icon: "market",
      href: "/marketplace",
      label: t("marketplace"),
      allLabel: t("allMarket"),
      shortcuts: [
        {href: "/marketplace?sold_by=trainers", label: t("fromTrainers"), hint: t("fromTrainersHint"), icon: "trainers"},
        {href: "/marketplace?condition=used", label: t("secondHand"), hint: t("secondHandHint"), icon: "used"},
        {href: "/marketplace/saved", label: t("savedBag"), hint: t("savedBagHint"), icon: "saved"},
        {href: "/sell", label: t("sell"), hint: t("sellHint"), icon: "sell"},
      ],
      feature: {
        title: t("marketFeatureTitle"),
        body: t("marketFeatureBody"),
        cta: t("marketFeatureCta"),
        href: "/sell",
      },
    },
  ];

  const labels: NavLabels = {
    mainNavigation: t("mainNavigation"),
    menu: t("menu"),
    close: t("closeMenu"),
    search: t("search"),
  };

  return (
    <header className="sticky top-0 z-[1000]">
      {/* The brand stripe: the logo's colours, end to end. */}
      <div aria-hidden className="nav-stripe" />
      <div className="nav-bar">
        <div className="app-shell flex h-16 items-center justify-between gap-3 lg:h-[4.5rem]">
          <Link href="/" className="group inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl">
            <span className="nav-logo">
              <BrandMark motion="open" className="size-7 transition-transform duration-500 group-hover:rotate-90" />
            </span>
            {/* The mark alone below 360px, where the wordmark, two account
                buttons and the menu are wider than the screen. Still named. */}
            <span className="sr-only min-[360px]:hidden">{BRAND}</span>
            <span className="leading-none max-[359px]:hidden">
              <span className="nav-word">{BRAND.toLowerCase()}</span>
              <span className="nav-sub">{t("productName")}</span>
            </span>
          </Link>

          <MainNav sections={sections} labels={labels} />

          <div className="flex items-center gap-1.5">
            {/* An icon from sm, a search pill from xl. */}
            <Link href="/search" aria-label={t("search")} className="nav-search">
              <Search aria-hidden className="size-5 text-[var(--color-brand)] xl:size-4" />
              <span aria-hidden className="hidden xl:inline">
                {t("searchPill")}
              </span>
            </Link>
            <AccountNav
              labels={{
                myAccount: tAccount("myAccount"),
                signUp: tAccount("signUp"),
                account: tAccount("account"),
                orders: tAccount("orders"),
                saved: tAccount("saved"),
                courses: tAccount("courses"),
                workshop: tAccount("workshop"),
                shop: tAccount("shop"),
                signOut: tAccount("signOut"),
                menu: tAccount("menu"),
              }}
            />
            <MobileNav sections={sections} labels={labels} searchLabel={t("searchPill")} />
          </div>
        </div>
      </div>
    </header>
  );
}
