import { getTranslations } from "next-intl/server";

import { BrandMark } from "@/components/BrandMark";

/**
 * What a phone on a slow connection sees between tapping a result and the
 * listing arriving: the aperture closing and opening, instead of a page that
 * looks as if the tap did nothing. The header and footer stay where they are.
 *
 * Used as loading.tsx on the listing and trade pages, where those waits
 * happen, and deliberately not at the root: a root loading boundary would
 * stream the search page itself behind a fallback, and React's script for
 * swapping it in costs that page's 200 KB budget about half a kilobyte.
 */
export async function PageLoading() {
  const t = await getTranslations("Layout");
  return (
    <div role="status" aria-live="polite" className="grid min-h-[50dvh] place-items-center px-4">
      <div className="flex flex-col items-center gap-3 text-sm text-[var(--color-muted-foreground)]">
        <BrandMark motion="breathe" className="size-12" />
        <span>{t("loading")}</span>
      </div>
    </div>
  );
}
