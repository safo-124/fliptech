"use client";

import { CheckCircle2, Loader2, MessageCircle, Phone, ShoppingBag, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { openOrderChat } from "@/lib/account-api";
import { formatCedis } from "@/lib/format";
import { API_URL } from "@/lib/trainer-fetch";
import {
  SellerApiError,
  getSellerOrders,
  getSellerPayout,
  getSellerPayoutBanks,
  getEarnings,
  getSellerPayouts,
  replyToProblem,
  type SellerPayouts,
  markOrderHandedOver,
  markOrderReady,
  saveSellerPayout,
  stopSellingOnline,
  type Earnings,
  type SellerPayout,
} from "@/lib/seller-api";
import type { MarketplaceOrder, PayoutBank } from "@/lib/types";

/**
 * Opens the chat with a paid order's buyer, so the seller can write first.
 * Beside Call, not instead of it: a buyer who checked out without an account
 * has no chat, and the server says to call them.
 */
function MessageBuyer({ reference }: { reference: string }) {
  const t = useTranslations("Chat");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setProblem(null);
    try {
      const thread = await openOrderChat(reference);
      router.push(`/inbox/${thread.id}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("failed"));
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void open()}>
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <MessageCircle aria-hidden="true" />}
        {t("messageBuyer")}
      </Button>
      {problem ? (
        <p role="alert" className="basis-full text-xs text-[var(--color-warn)]">
          {problem}
        </p>
      ) : null}
    </>
  );
}

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
              {payout.protected
                ? t("payoutLeadProtected", { percent: payout.commission_percent, days: payout.release_days })
                : t("payoutLead", { percent: payout.commission_percent })}
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

      <PayoutsSummary />

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
                      <ul className="text-sm font-semibold">
                        {order.items.map((item, index) => (
                          <li key={index}>
                            {item.quantity} × {item.product_name}
                            {item.option_label ? ` (${item.option_label})` : ""}
                          </li>
                        ))}
                      </ul>
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
                  {order.plan === "deposit" && order.balance_status !== "none" ? (
                    <p className="mt-2 rounded-lg bg-[var(--color-brand-soft)] px-3 py-2 text-xs text-[var(--color-brand-strong)]">
                      {t(`deposit.${order.balance_status}`, {
                        deposit: formatCedis(order.deposit),
                        balance: formatCedis(order.balance),
                      })}
                    </p>
                  ) : null}
                  {order.stage === "problem" ? (
                    <div className="mt-2 space-y-2 rounded-lg bg-[var(--color-warn-bg)] px-3 py-2 text-xs text-[var(--color-warn)]">
                      <p>{t("orderProblem", { problem: order.problem })}</p>
                      <ProblemReply reference={order.reference} replied={order.problem_reply ?? ""} />
                    </div>
                  ) : null}
                  {order.protected ? (
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t(`payout.${order.payout}`)}</p>
                  ) : null}
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
                    <MessageBuyer reference={order.reference} />
                    {order.plan === "deposit" && order.balance_status === "waiting" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="brand"
                        disabled={busy !== null}
                        onClick={() => act(order.reference, () => markOrderReady(order.reference), t("readySaved"))}
                      >
                        {t("markReady")}
                      </Button>
                    ) : null}
                    {order.stage === "new" && order.balance_status !== "waiting" && order.balance_status !== "due" ? (
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

      <EarningsCard />
    </div>
  );
}

function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** One month's sales, Fliiptech's share and the seller's, with a download. */
function EarningsCard() {
  const t = useTranslations("SellerGrowth");
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Earnings | null>(null);

  useEffect(() => {
    let active = true;
    getEarnings(month)
      .then((found) => {
        if (active) setData(found);
      })
      .catch(() => {
        if (active) setData(null);
      });
    return () => {
      active = false;
    };
  }, [month]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("earningsTitle")}</CardTitle>
        <CardDescription>{t("earningsLead")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="earnings-month">{t("earningsMonth")}</Label>
            <Input
              id="earnings-month"
              type="month"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              className="w-44"
            />
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={`${API_URL}/api/seller/earnings/?month=${month}&download=csv`}>{t("earningsDownload")}</a>
          </Button>
        </div>
        {data ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["orders", String(data.totals.orders)],
                  ["sales", formatCedis(data.totals.sales)],
                  ["fliiptech", formatCedis(data.totals.fliiptech)],
                  ["yours", formatCedis(data.totals.yours)],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-xl bg-[var(--color-muted)] p-3">
                  <p className="text-lg font-extrabold tabular-nums">{value}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{t(`earnings.${key}`)}</p>
                </div>
              ))}
            </div>
            {data.orders.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                      <th scope="col" className="py-2 pr-2 font-medium">{t("earningsDate")}</th>
                      <th scope="col" className="px-2 py-2 font-medium">{t("earningsWhat")}</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">{t("earnings.sales")}</th>
                      <th scope="col" className="py-2 pl-2 text-right font-medium">{t("earnings.yours")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((row) => (
                      <tr key={row.reference} className="border-t border-[var(--color-border)]">
                        <td className="py-2 pr-2 tabular-nums">{row.paid_at}</td>
                        <td className="px-2 py-2">{row.product}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCedis(row.total)}</td>
                        <td className="py-2 pl-2 text-right tabular-nums">{formatCedis(row.yours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("earningsNone")}</p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}


/** The seller's side of a reported problem, before staff decide. */
function ProblemReply({ reference, replied }: { reference: string; replied: string }) {
  const t = useTranslations("SellerDashboard");
  const [reply, setReply] = useState(replied);
  const [sent, setSent] = useState(Boolean(replied));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <p className="rounded-md bg-[var(--color-card)] p-2 text-[var(--color-foreground)]">
        <strong className="block">{t("problemReplySent")}</strong>
        {reply}
      </p>
    );
  }
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!reply.trim()) return;
        setBusy(true);
        setError(null);
        replyToProblem(reference, reply.trim())
          .then(() => setSent(true))
          .catch((reason: Error) => setError(reason.message))
          .finally(() => setBusy(false));
      }}
    >
      <p>{t("problemDeadline")}</p>
      <label className="sr-only" htmlFor={`reply-${reference}`}>
        {t("problemReplyLabel")}
      </label>
      <textarea
        id={`reply-${reference}`}
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        rows={2}
        maxLength={1000}
        placeholder={t("problemReplyLabel")}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm text-[var(--color-foreground)]"
      />
      {error ? <p className="text-[var(--color-destructive)]">{error}</p> : null}
      <Button type="submit" size="sm" variant="brand" disabled={busy || !reply.trim()}>
        {t("problemReplySend")}
      </Button>
    </form>
  );
}

/** Where the money is: paid out, held (and why), refunded. */
function PayoutsSummary() {
  const t = useTranslations("SellerDashboard");
  const [data, setData] = useState<SellerPayouts | null>(null);
  useEffect(() => {
    getSellerPayouts()
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data || !data.results.length) return null;
  const tiles = [
    { label: t("payoutsPaidOut"), value: data.totals.paid_out, tone: "text-[var(--color-visit)]" },
    { label: t("payoutsHeld"), value: data.totals.held, tone: "text-[var(--color-warn)]" },
    { label: t("payoutsRefunded"), value: data.totals.refunded, tone: "text-[var(--color-muted-foreground)]" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("payoutsTitle")}</CardTitle>
        <CardDescription>{t("payoutsHeldWhy")}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl bg-[var(--color-muted)] p-3">
              <dt className="text-xs text-[var(--color-muted-foreground)]">{tile.label}</dt>
              <dd className={`mt-1 text-lg font-extrabold tabular-nums ${tile.tone}`}>{formatCedis(tile.value)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
