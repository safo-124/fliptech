"use client";

import { BellRing, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { saveSearch } from "@/lib/account-api";
import type { MarketplaceParams } from "@/lib/api";

/** The parameters a saved search keeps; the order and the page are left out. */
const KEPT = [
  "q",
  "trade",
  "area",
  "region",
  "sold_by",
  "min_price",
  "max_price",
  "condition",
  "availability",
  "min_rating",
  "pay_online",
  "delivers",
  "verified",
  "on_sale",
] as const;

/** "Text me new matches": keep this search on the account. */
export function SaveSearch({ params, label }: { params: MarketplaceParams; label: string }) {
  const t = useTranslations("Marketplace");
  const [state, setState] = useState<"idle" | "busy" | "saved" | "signin" | "failed">("idle");

  async function save() {
    setState("busy");
    const kept = Object.fromEntries(KEPT.filter((key) => params[key]).map((key) => [key, params[key] as string]));
    try {
      await saveSearch(kept, label);
      setState("saved");
    } catch (error) {
      const status = (error as { status?: number }).status;
      setState(status === 401 || status === 403 ? "signin" : "failed");
    }
  }

  if (state === "saved") {
    return (
      <p className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-[var(--color-visit)]">
        <Check aria-hidden="true" className="size-4" />
        {t("saveSearchSaved")}
      </p>
    );
  }
  if (state === "signin") {
    return (
      <p className="text-sm">
        {t("saveSearchSignIn")}{" "}
        <Link href={`/account?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} className="font-semibold text-[var(--color-brand)] underline">
          {t("chatSignInLink")}
        </Link>
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void save()}
        disabled={state === "busy"}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-brand)]/30 px-3 text-sm font-bold text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]"
      >
        {state === "busy" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <BellRing aria-hidden="true" className="size-4" />}
        {t("saveSearch")}
      </button>
      {state === "failed" ? <span className="text-sm text-[var(--color-destructive)]">{t("saveSearchFailed")}</span> : null}
    </div>
  );
}
