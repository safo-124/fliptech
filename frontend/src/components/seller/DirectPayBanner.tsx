"use client";

import { IdCard } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * For a shop that cannot take payment on the site yet: buyers can only
 * "Order from the maker" and pay directly. Sending the ID is what turns on
 * Buy now with MoMo or card. Shown above Orders and the item list.
 */
export function DirectPayBanner({ onSendId }: { onSendId: () => void }) {
  const t = useTranslations("SellerDashboard");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-warn)]/30 bg-[var(--color-warn-bg)] p-4">
      <IdCard aria-hidden="true" className="size-5 shrink-0 text-[var(--color-warn)]" />
      <p className="min-w-0 flex-1 text-sm font-medium text-[var(--color-warn)]">{t("directOnlyBanner")}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={onSendId}>
        {t("sendMyId")}
      </Button>
    </div>
  );
}
