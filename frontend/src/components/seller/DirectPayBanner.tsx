"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * For a shop that cannot take payment on the site yet. Online payment is the
 * only way to buy, so its products are hidden from buyers until the seller
 * adds a MoMo number (Orders tab). Shown above Orders and the item list.
 */
export function DirectPayBanner({ onAddMomo }: { onAddMomo: () => void }) {
  const t = useTranslations("SellerDashboard");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-warn)]/30 bg-[var(--color-warn-bg)] p-4">
      <Wallet aria-hidden="true" className="size-5 shrink-0 text-[var(--color-warn)]" />
      <p className="min-w-0 flex-1 text-sm font-medium text-[var(--color-warn)]">{t("directOnlyBanner")}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={onAddMomo}>
        {t("addMomo")}
      </Button>
    </div>
  );
}
