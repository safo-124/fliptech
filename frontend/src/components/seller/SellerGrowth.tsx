"use client";

import { Crown, Eye, ImagePlus, Loader2, MessageCircle, Rocket, ShoppingBag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCedis } from "@/lib/format";
import {
  boostProduct,
  buyShopPlan,
  getSellerGrowth,
  getSellerStats,
  removeShopBanner,
  uploadShopBanner,
  verifySellerPayment,
  type BoostKind,
  type SellerGrowth,
  type SellerStats,
} from "@/lib/seller-api";

function day(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The seller's "Grow" tab: what people did with their products in the last
 * 30 days, and the two things they can pay for.
 *
 * Numbers first, because they are what make paying sensible: a product
 * many people look at and few ask about wants a better photo, not a boost;
 * one nobody sees wants a boost. Coming back from Paystack, this asks the
 * server to confirm the payment (marketplace/payments.py) before saying
 * anything is running.
 */
export function SellerGrowthTab() {
  const t = useTranslations("SellerGrowth");
  const [stats, setStats] = useState<SellerStats | null>(null);
  const [growth, setGrowth] = useState<SellerGrowth | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [numbers, paid] = await Promise.all([getSellerStats(), getSellerGrowth()]);
    setStats(numbers);
    setGrowth(paid);
  }, []);

  useEffect(() => {
    let active = true;
    async function start() {
      const url = new URL(window.location.href);
      const reference = url.searchParams.get("payment");
      if (reference) {
        for (const name of ["payment", "reference", "trxref"]) url.searchParams.delete(name);
        window.history.replaceState(null, "", url.toString());
        setBusy("checking");
        try {
          const result = await verifySellerPayment(reference);
          if (!active) return;
          setMessage(
            result.status === "paid"
              ? result.kind === "plan_month"
                ? t("planPaid")
                : t("boostPaid")
              : null,
          );
          setProblem(result.status === "paid" ? null : t("notPaid"));
        } catch (reason) {
          if (active) setProblem(reason instanceof Error ? reason.message : t("notPaid"));
        }
        if (active) setBusy(null);
      }
      try {
        await load();
      } catch {
        if (active) setProblem(t("loadFailed"));
      }
    }
    void start();
    return () => {
      active = false;
    };
  }, [load, t]);

  async function act(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setProblem(null);
    setMessage(null);
    try {
      await action();
      await load();
      if (done) setMessage(done);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("somethingWrong"));
    }
    setBusy(null);
  }

  async function pay(key: string, start: () => Promise<{ authorization_url?: string }>) {
    setBusy(key);
    setProblem(null);
    try {
      const { authorization_url } = await start();
      if (authorization_url) {
        window.location.assign(authorization_url);
        return;
      }
      await load();
      setMessage(t("boostStarted"));
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("somethingWrong"));
    }
    setBusy(null);
  }

  if (!stats || !growth) {
    return (
      <Card className="p-8 text-center">
        {problem ? (
          <p className="text-sm text-[var(--color-destructive)]">{problem}</p>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {busy === "checking" ? t("checkingPayment") : t("loading")}
          </p>
        )}
      </Card>
    );
  }

  const boostedUntil = new Map(growth.boosts.map((boost) => [boost.product, boost.ends_at]));
  const onShow = stats.products.filter((product) => product.status === "published");

  return (
    <div className="space-y-5">
      {message ? (
        <p role="status" className="rounded-lg bg-[var(--color-visit-bg)] px-3 py-2 text-sm text-[var(--color-visit)]">
          {message}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}

      {/* ------------------------------------------------------- numbers */}
      <Card>
        <CardHeader>
          <CardTitle>{t("numbersTitle", { days: stats.days })}</CardTitle>
          <CardDescription>{t("numbersLead")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["views", Eye, stats.totals.views],
                ["questions", MessageCircle, stats.totals.enquiries],
                ["sold", ShoppingBag, stats.totals.sold],
              ] as const
            ).map(([key, Icon, value]) => (
              <div key={key} className="rounded-xl bg-[var(--color-muted)] p-3">
                <Icon aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                <p className="mt-1 text-xl font-extrabold">{value}</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{t(`total.${key}`)}</p>
              </div>
            ))}
          </div>
          {stats.products.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                    <th scope="col" className="py-2 pr-2 font-medium">{t("product")}</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">{t("views7")}</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">{t("views30")}</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">{t("questions30")}</th>
                    <th scope="col" className="py-2 pl-2 text-right font-medium">{t("sold30")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.products.map((product) => (
                    <tr key={product.id} className="border-t border-[var(--color-border)]">
                      <td className="py-2 pr-2">
                        <span className="font-medium">{product.name}</span>
                        {product.boosted_until ? (
                          <span className="ml-2 rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-brand-strong)]">
                            {t("boostedUntil", { date: day(product.boosted_until) })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{product.views_7d}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{product.views_30d}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{product.enquiries_30d}</td>
                      <td className="py-2 pl-2 text-right tabular-nums">{product.sold_30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("noProductsYet")}</p>
          )}
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("numbersHow")}</p>
        </CardContent>
      </Card>

      {!growth.payments_enabled ? (
        <Card className="p-5 text-sm text-[var(--color-muted-foreground)]">{t("paymentsOff")}</Card>
      ) : (
        <>
          {/* ------------------------------------------------------ boosts */}
          <Card>
            <CardHeader className="flex-row items-start gap-3 space-y-0">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <Rocket aria-hidden="true" className="size-4" />
              </span>
              <div>
                <CardTitle>{t("boostTitle")}</CardTitle>
                <CardDescription className="mt-1">
                  {t("boostLead", {
                    week: formatCedis(growth.prices.boost_week),
                    month: formatCedis(growth.prices.boost_month),
                  })}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {onShow.length ? (
                <ul className="divide-y divide-[var(--color-border)]">
                  {onShow.map((product) => {
                    const until = boostedUntil.get(product.id);
                    return (
                      <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{product.name}</p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {until ? t("boostedUntil", { date: day(until) }) : t("viewsThisWeek", { count: product.views_7d })}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {growth.plan.free_boost_available ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="brand"
                              disabled={busy !== null}
                              onClick={() => pay(`free-${product.id}`, () => boostProduct(product.id, "plan_credit"))}
                            >
                              {t("useFreeBoost")}
                            </Button>
                          ) : null}
                          {(["boost_week", "boost_month"] as BoostKind[]).map((kind) => (
                            <Button
                              key={kind}
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => pay(`${kind}-${product.id}`, () => boostProduct(product.id, kind))}
                            >
                              {busy === `${kind}-${product.id}` ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                              {t(kind === "boost_week" ? "boostWeek" : "boostMonth", {
                                price: formatCedis(growth.prices[kind]),
                              })}
                            </Button>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">{t("boostNothingOnShow")}</p>
              )}
              <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">{t("boostHow")}</p>
            </CardContent>
          </Card>

          {/* ------------------------------------------------------- plan */}
          <Card className={growth.plan.running ? "border-[var(--color-brand)]/40" : undefined}>
            <CardHeader className="flex-row items-start gap-3 space-y-0">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <Crown aria-hidden="true" className="size-4" />
              </span>
              <div>
                <CardTitle>
                  {growth.plan.running && growth.plan.ends_at
                    ? t("planRunning", { date: day(growth.plan.ends_at) })
                    : t("planTitle", { price: formatCedis(growth.prices.plan_month) })}
                </CardTitle>
                <CardDescription className="mt-1">{t("planLead")}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>
                  {t("planUnlimited", { limit: growth.free_product_limit, published: growth.published })}
                </li>
                <li>{t("planBanner")}</li>
                <li>{t("planFreeBoost")}</li>
                <li>{t("planFirst")}</li>
              </ul>
              <Button
                type="button"
                variant={growth.plan.running ? "outline" : "brand"}
                disabled={busy !== null}
                onClick={() => pay("plan", buyShopPlan)}
              >
                {busy === "plan" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {growth.plan.running
                  ? t("planAddMonth", { price: formatCedis(growth.prices.plan_month) })
                  : t("planBuy", { price: formatCedis(growth.prices.plan_month) })}
              </Button>
              <p className="text-xs text-[var(--color-muted-foreground)]">{t("planHow")}</p>

              {/* ------------------------------------------------- banner */}
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-sm font-semibold">{t("bannerTitle")}</p>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {growth.plan.running ? t("bannerLead") : t("bannerNeedsPlan")}
                </p>
                {growth.banner ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={growth.banner} alt="" className="mt-3 aspect-[4/1] w-full rounded-lg object-cover" />
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-muted)]">
                    <ImagePlus aria-hidden="true" className="size-4" />
                    {growth.banner ? t("bannerReplace") : t("bannerAdd")}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={busy !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void act("banner", () => uploadShopBanner(file), t("bannerSaved"));
                      }}
                    />
                  </label>
                  {growth.banner ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => act("banner", removeShopBanner)}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("bannerRemove")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
