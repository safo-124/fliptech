"use client";

import { CheckCircle2, Loader2, Phone, ShoppingBag, Wallet } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatCedis } from "@/lib/format";
import {
  SellerApiError,
  getSellerOrders,
  getSellerPayout,
  getSellerPayoutBanks,
  markOrderHandedOver,
  saveSellerPayout,
  stopSellingOnline,
  type SellerPayout,
} from "@/lib/seller-api";
import type { MarketplaceOrder, PayoutBank } from "@/lib/types";

/**
 * The seller's "Orders" tab: where buyers' money goes, and what they paid for.
 *
 * Saving a payout account is what turns "Buy now" on for their products:
 * Paystack splits each payment straight to it, less Fliiptech's commission.
 * Then each paid order waits here until the seller marks it handed over.
 */
export function SellerOrdersTab() {
  const t = useTranslations("SellerGrowth");
  const [payout, setPayout] = useState<SellerPayout | null>(null);
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [banks, setBanks] = useState<PayoutBank[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bank_code: "", account_number: "", account_name: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [account, paid] = await Promise.all([getSellerPayout(), getSellerOrders()]);
    setPayout(account);
    setOrders(paid.results);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getSellerPayout(), getSellerOrders()])
      .then(([account, paid]) => {
        if (!active) return;
        setPayout(account);
        setOrders(paid.results);
        setEditing(!account.payout.ready);
      })
      .catch(() => {
        if (active) setProblem(t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const needBanks = Boolean(payout?.payments_enabled && editing && banks === null);
  useEffect(() => {
    if (!needBanks) return;
    let active = true;
    getSellerPayoutBanks()
      .then((loaded) => {
        if (active) setBanks(loaded.banks);
      })
      .catch((reason) => {
        if (!active) return;
        setBanks([]);
        setProblem(reason instanceof Error ? reason.message : t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [needBanks, t]);

  async function savePayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("payout");
    setErrors({});
    setProblem(null);
    setMessage(null);
    try {
      setPayout(await saveSellerPayout(form));
      setEditing(false);
      setMessage(t("payoutSaved"));
    } catch (reason) {
      if (reason instanceof SellerApiError && Object.keys(reason.fields).some((key) => key !== "detail")) {
        setErrors(reason.fields);
      } else {
        setProblem(reason instanceof Error ? reason.message : t("somethingWrong"));
      }
    }
    setBusy(null);
  }

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

  if (payout === null) {
    return (
      <Card className="p-8 text-center">
        {problem ? (
          <p className="text-sm text-[var(--color-destructive)]">{problem}</p>
        ) : (
          <Loader2 aria-hidden="true" className="mx-auto size-5 animate-spin text-[var(--color-muted-foreground)]" />
        )}
      </Card>
    );
  }

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

      {/* ------------------------------------------------ where money goes */}
      <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
            <Wallet aria-hidden="true" className="size-4" />
          </span>
          <div>
            <CardTitle>{t("payoutTitle")}</CardTitle>
            <CardDescription className="mt-1">
              {t("payoutLead", { percent: payout.commission_percent })}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {!payout.payments_enabled ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("paymentsOff")}</p>
          ) : payout.payout.ready && !editing ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-muted)] p-3">
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--color-visit)]" />
                {t("payoutTo", {
                  bank: payout.payout.bank_name,
                  last4: payout.payout.account_last4,
                  name: payout.payout.account_name,
                })}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                  {t("change")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => act("stop", stopSellingOnline, t("stoppedOnline"))}
                >
                  {t("stopOnline")}
                </Button>
              </div>
            </div>
          ) : (
            <form noValidate onSubmit={savePayout} className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="seller-payout-bank">{t("bankLabel")}</Label>
                <NativeSelect
                  id="seller-payout-bank"
                  value={form.bank_code}
                  onChange={(event) => setForm({ ...form, bank_code: event.target.value })}
                  aria-invalid={errors.bank_code ? true : undefined}
                  disabled={banks === null}
                >
                  <option value="">{banks === null ? t("loadingBanks") : t("choose")}</option>
                  {(["mobile_money", "ghipss"] as const).map((type) => {
                    const group = (banks ?? []).filter((bank) => bank.type === type);
                    return group.length ? (
                      <optgroup key={type} label={t(`bankGroup.${type}`)}>
                        {group.map((bank) => (
                          <option key={bank.code} value={bank.code}>
                            {bank.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </NativeSelect>
                {errors.bank_code ? <p className="text-sm text-[var(--color-destructive)]">{errors.bank_code}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-payout-number">{t("numberLabel")}</Label>
                <Input
                  id="seller-payout-number"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.account_number}
                  onChange={(event) => setForm({ ...form, account_number: event.target.value })}
                  placeholder="024 000 0000"
                  aria-invalid={errors.account_number ? true : undefined}
                />
                {errors.account_number ? (
                  <p className="text-sm text-[var(--color-destructive)]">{errors.account_number}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seller-payout-name">{t("nameLabel")}</Label>
                <Input
                  id="seller-payout-name"
                  autoComplete="name"
                  value={form.account_name}
                  onChange={(event) => setForm({ ...form, account_name: event.target.value })}
                  aria-invalid={errors.account_name ? true : undefined}
                />
                {errors.account_name ? (
                  <p className="text-sm text-[var(--color-destructive)]">{errors.account_name}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-3">
                <Button type="submit" variant="brand" disabled={busy !== null}>
                  {busy === "payout" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                  {t("savePayout")}
                </Button>
                {payout.payout.ready ? (
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    {t("cancel")}
                  </Button>
                ) : null}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------- orders */}
      <Card>
        <CardHeader>
          <CardTitle>{t("ordersTitle")}</CardTitle>
          <CardDescription>{t("ordersLead")}</CardDescription>
        </CardHeader>
        <CardContent>
          {orders.length ? (
            <ul className="space-y-3">
              {orders.map((order) => (
                <li key={order.reference} className="rounded-xl border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {order.quantity} × {order.product_name}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t("orderMeta", {
                          total: formatCedis(order.amount),
                          share: formatCedis(order.commission),
                          reference: order.reference,
                        })}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        order.stage === "new"
                          ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
                          : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                      }`}
                    >
                      {t(`stage.${order.stage}`)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    {order.buyer_name} ·{" "}
                    {order.fulfilment === "delivery" ? t("deliverTo", { address: order.note }) : t("collects")}
                  </p>
                  {order.fulfilment === "pickup" && order.note ? (
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">“{order.note}”</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={`tel:${order.buyer_phone}`}>
                        <Phone aria-hidden="true" />
                        {order.buyer_phone}
                      </a>
                    </Button>
                    {order.stage === "new" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="brand"
                        disabled={busy !== null}
                        onClick={() =>
                          act(order.reference, () => markOrderHandedOver(order.reference), t("handedOverSaved"))
                        }
                      >
                        {busy === order.reference ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                        {t("markHandedOver")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-6 text-center">
              <ShoppingBag aria-hidden="true" className="mx-auto size-6 text-[var(--color-muted-foreground)]" />
              <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{t("noOrders")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
