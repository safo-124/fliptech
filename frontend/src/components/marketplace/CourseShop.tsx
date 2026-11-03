import { ArrowRight, GraduationCap, PackageCheck, Wrench } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ProductTile } from "@/components/marketplace/ProductTile";
import { Button } from "@/components/ui/button";
import { getCourseBundles, getCourseTools } from "@/lib/api";
import type { Bundle } from "@/lib/types";

/**
 * The course page's marketplace part: "Learn and buy" bundles from the
 * workshop, then "Tools you need" as products to buy. Either is left out
 * when there is nothing, and neither can fail the course page.
 */
export async function CourseShop({ area, slug }: { area: string; slug: string }) {
  const [tools, bundles, t] = await Promise.all([
    getCourseTools(area, slug).catch(() => null),
    getCourseBundles(area, slug).catch(() => null),
    getTranslations("Marketplace"),
  ]);
  const offered = (bundles?.results ?? []).filter((bundle) => bundle.buy_online);
  const products = tools?.products ?? [];
  if (!offered.length && !products.length) return null;

  return (
    <>
      {offered.length ? (
        <section aria-labelledby="course-bundles" className="app-shell mx-auto mt-12 max-w-6xl">
          <h2 id="course-bundles" className="flex items-center gap-2 text-xl font-extrabold tracking-[-0.025em]">
            <PackageCheck aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            {t("bundlesTitle")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("bundlesBody")}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {offered.map((bundle) => (
              <BundleCard key={bundle.id} bundle={bundle} />
            ))}
          </div>
        </section>
      ) : null}

      {products.length ? (
        <section aria-labelledby="course-tools" className="app-shell mx-auto mt-12 max-w-6xl">
          <h2 id="course-tools" className="flex items-center gap-2 text-xl font-extrabold tracking-[-0.025em]">
            <Wrench aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            {t("toolsTitle")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {tools?.chosen ? t("toolsChosen") : t("toolsSuggested")}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
            {products.map((product) => (
              <ProductTile key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export async function BundleCard({ bundle, action = true }: { bundle: Bundle; action?: boolean }) {
  const t = await getTranslations("Marketplace");
  return (
    <article className="flex flex-col rounded-2xl border border-[var(--color-brand)]/20 bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{bundle.title}</h3>
          {bundle.blurb ? <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{bundle.blurb}</p> : null}
        </div>
        {bundle.saving && Number(bundle.saving) > 0 ? (
          <span className="shrink-0 rounded-full bg-[var(--color-visit-bg)] px-2.5 py-1 text-xs font-extrabold text-[var(--color-visit)]">
            {t("bundleSave", { amount: `GH₵${Number(bundle.saving).toLocaleString("en-GH")}` })}
          </span>
        ) : null}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {bundle.course ? (
          <li className="flex items-center gap-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <GraduationCap aria-hidden="true" className="size-5" />
            </span>
            {t("bundleCourse", { name: bundle.course.name })}
          </li>
        ) : null}
        {bundle.items.map((item) => (
          <li key={item.product.id} className="flex items-center gap-2.5">
            <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-[var(--color-muted)]">
              {item.product.photo ? <Image src={item.product.photo} alt="" fill sizes="40px" className="object-cover" /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {item.quantity > 1 ? `${item.quantity} × ` : ""}
              {item.product.name}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <p>
          <span className="text-2xl font-extrabold tracking-[-0.02em]">GH₵{Number(bundle.price).toLocaleString("en-GH")}</span>
          {bundle.full_price && bundle.full_price !== bundle.price ? (
            <span className="ml-2 text-sm text-[var(--color-muted-foreground)] line-through">
              GH₵{Number(bundle.full_price).toLocaleString("en-GH")}
            </span>
          ) : null}
        </p>
        {action ? (
          <Button asChild variant="brand">
            <Link href={`/marketplace/bundle/${bundle.id}`}>
              {t("bundleBuy")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
