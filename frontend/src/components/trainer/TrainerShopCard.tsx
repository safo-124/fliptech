"use client";

import { ArrowRight, Loader2, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSellerSession, startSelling, type SellerSession } from "@/lib/seller-api";

/**
 * Sell in the marketplace, from the trainer's own dashboard. One tap: the
 * shop is made on this same login, already named and placed like the
 * workshop, and staff confirm it as for any seller. A trainer who already
 * has a shop gets the way to it.
 */
export function TrainerShopCard() {
  const t = useTranslations("TrainerDashboard");
  const router = useRouter();
  const [session, setSession] = useState<SellerSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getSellerSession()
      .then((found) => {
        if (live) setSession(found);
      })
      .catch(() => {
        if (live) setSession({ authenticated: false, seller: null });
      });
    return () => {
      live = false;
    };
  }, []);

  async function open() {
    setBusy(true);
    setProblem(null);
    try {
      await startSelling();
      router.push("/sell/shop");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("shopFailed"));
      setBusy(false);
    }
  }

  if (session === null) return null;
  const hasShop = session.authenticated && session.seller;

  return (
    <section
      aria-labelledby="trainer-shop-heading"
      className="flex flex-col gap-4 rounded-2xl border border-[var(--color-brand)]/15 bg-[var(--color-brand-soft)] p-5 sm:flex-row sm:items-center"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--color-card)] text-[var(--color-brand)]">
        <Store aria-hidden="true" className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="trainer-shop-heading" className="text-base font-bold">
          {hasShop ? t("shopOpenTitle") : t("shopStartTitle")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
          {hasShop ? t("shopOpenBody") : t("shopStartBody")}
        </p>
        {problem ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-[var(--color-destructive)]">
            {problem}
          </p>
        ) : null}
      </div>
      {hasShop ? (
        <Button asChild variant="brand" className="w-full sm:w-auto">
          <Link href="/sell/shop">
            {t("shopOpenAction")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button type="button" variant="brand" className="w-full sm:w-auto" disabled={busy} onClick={() => void open()}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Store aria-hidden="true" />}
          {t("shopStartAction")}
        </Button>
      )}
    </section>
  );
}
