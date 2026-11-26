"use client";

import { Handshake, Loader2, LockKeyhole, LogIn, ShieldCheck, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useBasket } from "@/components/basket/useBasket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAccount, updateAccount } from "@/lib/account-api";
import { checkoutAll, loadBasket, type BasketGroup } from "@/lib/basket";
import { formatCedis, withArea } from "@/lib/format";
import { requestBuyerCode, verifyBuyerCode, type Fulfilment } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";
import { openSignIn, SESSION_CHANGED } from "@/lib/sign-in";
import { cn } from "@/lib/utils";

/** The groups that can go in one payment: sellers paid on the site, with
    something still buyable. */
export function payableGroups(groups: BasketGroup[]) {
  return groups.filter((group) => group.takes_payments && group.lines.some((line) => line.available));
}

/**
 * /marketplace/checkout: paying several sellers at once. One phone, one name,
 * one address; Collect or Delivery for each seller; one total and one MoMo
 * prompt. Each seller still gets their own order, and the receipt lists them.
 * Discount codes and paying part on collection stay on one seller's own
 * checkout, linked from here.
 */
export function CheckoutAll() {
  const t = useTranslations("Basket");
  const tm = useTranslations("Marketplace");
  const basket = useBasket();
  const [phone, setPhone] = useState("");
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [savedAddress, setSavedAddress] = useState<string | null>(null);
  const [ways, setWays] = useState<Record<number, Fulfilment>>({});
  const [codeOn, setCodeOn] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    function load() {
      getAccount()
        .then((session) => {
          if (active) setCodeOn(Boolean(session.sign_in?.code));
          if (!active || !session.authenticated) return;
          setAccountPhone(session.account.phone);
          setPhone((typed) => typed || session.account.phone);
          setName((typed) => typed || session.account.display_name);
          setSavedAddress(session.account.delivery_address);
          if (session.account.delivery_address) setNote((typed) => typed || session.account.delivery_address);
        })
        .catch(() => {});
    }
    load();
    function signedIn() {
      load();
      void loadBasket().catch(() => null);
    }
    window.addEventListener(SESSION_CHANGED, signedIn);
    return () => {
      active = false;
      window.removeEventListener(SESSION_CHANGED, signedIn);
    };
  }, []);

  if (basket === null) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("loading")}
      </p>
    );
  }
  const groups = payableGroups(basket.groups);
  const direct = basket.groups.filter((group) => !group.takes_payments && group.lines.some((line) => line.available));
  if (!groups.length) {
    return (
      <div className="space-y-3 py-8">
        <p>{t("nothingToPay")}</p>
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/marketplace/basket">{t("viewBasket")}</Link>
        </Button>
      </div>
    );
  }

  const wayFor = (group: BasketGroup): Fulfilment => (group.delivery ? (ways[group.seller.id] ?? "pickup") : "pickup");
  const parts = groups.map((group) => ({ group, way: wayFor(group), totals: group.totals[wayFor(group)] }));
  const ready = parts.every((part) => part.totals);
  const sum = parts.reduce((total, part) => total + Number(part.totals?.pay_now ?? 0), 0);
  const total = formatCedis(sum.toFixed(2));
  const anyDelivery = parts.some((part) => part.way === "delivery");
  const anyDeposit = parts.some((part) => part.totals && part.totals.plan !== "full");
  const anyProblem = groups.find((group) => group.problem)?.problem;
  const needsSignIn = !accountPhone && !codeOn;
  const ownNumber = (() => {
    try {
      return Boolean(accountPhone) && toGhanaE164(ghanaPhoneSchema.parse(phone)) === accountPhone;
    } catch {
      return false;
    }
  })();
  const choice = (selected: boolean) =>
    cn(
      "flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-semibold",
      selected
        ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
        : "border-[var(--color-border)]",
    );

  async function send(e164: string) {
    const result = await checkoutAll({
      phone: e164,
      name: name.trim(),
      note: note.trim() || undefined,
      groups: parts.map((part) => ({ seller: part.group.seller.id, fulfilment: part.way })),
    });
    if (savedAddress === "" && anyDelivery && note.trim()) {
      await updateAccount({ delivery_address: note.trim() }).catch(() => {});
    }
    window.location.assign(result.authorization_url);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error(tm("buyNameNeeded"));
      if (anyDelivery && !note.trim()) throw new Error(tm("buyAddressNeeded"));
      if (!codeOn && accountPhone) {
        // Text codes are off: the order goes on the signed-in buyer's own
        // number, which needs no code.
        await send(accountPhone);
        return;
      }
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      if (codeSent) {
        await verifyBuyerCode(e164, code.trim());
        await send(e164);
        return;
      }
      const asked = await requestBuyerCode(e164);
      if (asked.verified) {
        await send(e164);
        return;
      }
      setCodeSent(true);
      window.setTimeout(() => codeInput.current?.focus(), 50);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tm("buyFailed"));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {groups.length > 1 ? (
        <p className="rounded-xl bg-[var(--color-brand-soft)] px-3 py-2.5 text-sm text-[var(--color-brand-strong)]">
          {t("oneTimeBody", { count: groups.length })}
        </p>
      ) : null}

      {/* ------------------------------------------- each seller's part */}
      <ol className="space-y-3">
        {parts.map(({ group, way, totals }, index) => (
          <li key={group.seller.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="flex min-w-0 items-center gap-2 text-base font-bold">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-xs text-[var(--color-brand-strong)]">
                  {index + 1}
                </span>
                <span className="truncate">{group.seller.business_name}</span>
              </h2>
              <p className="shrink-0 text-base font-bold tabular-nums">{totals ? formatCedis(totals.pay_now) : "…"}</p>
            </div>
            <ul className="mt-2 space-y-0.5 text-sm text-[var(--color-muted-foreground)]">
              {group.lines
                .filter((line) => line.available)
                .map((line) => (
                  <li key={line.id}>
                    {line.quantity} × {line.name}
                    {line.option_label ? ` (${line.option_label})` : ""}
                  </li>
                ))}
            </ul>
            {group.delivery ? (
              <fieldset className="mt-3">
                <legend className="sr-only">
                  {t("collect")} / {t("delivery")}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <label className={choice(way === "pickup")}>
                    <input
                      type="radio"
                      className="sr-only"
                      checked={way === "pickup"}
                      onChange={() => setWays((now) => ({ ...now, [group.seller.id]: "pickup" }))}
                    />
                    <Store aria-hidden="true" className="size-4" />
                    {t("collect")}
                  </label>
                  <label className={choice(way === "delivery")}>
                    <input
                      type="radio"
                      className="sr-only"
                      checked={way === "delivery"}
                      onChange={() => setWays((now) => ({ ...now, [group.seller.id]: "delivery" }))}
                    />
                    <Truck aria-hidden="true" className="size-4" />
                    <span>
                      {t("delivery")}
                      <span className="block text-xs font-normal">{t("deliveryFee", { fee: formatCedis(group.delivery.fee) })}</span>
                    </span>
                  </label>
                </div>
              </fieldset>
            ) : (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                <Store aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t("collectOnly")}
                  {group.pickup ? `: ${withArea(group.pickup.address, group.pickup.area)}` : group.seller.area ? `: ${group.seller.area}` : ""}
                </span>
              </p>
            )}
            {totals && totals.plan !== "full" ? (
              <p className="mt-2 text-xs font-semibold text-[var(--color-brand-strong)]">
                {tm("depositPlain", { now: formatCedis(totals.pay_now), later: formatCedis(totals.balance) })}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {direct.length ? (
        <p className="flex items-start gap-2 rounded-xl bg-[var(--color-warn-bg)] px-3 py-2.5 text-sm">
          <Handshake aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          {t("directLeftOut", { sellers: direct.map((group) => group.seller.business_name).join(", ") })}
        </p>
      ) : null}

      {/* ------------------------------------------------------- who */}
      {needsSignIn ? (
        <div className="space-y-3 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)]/50 p-4">
          <p className="text-base font-bold">{t("signInTitle")}</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("signInBody")}</p>
          <Button
            type="button"
            variant="brand"
            className="min-h-12 w-full"
            onClick={() => void openSignIn({ interest: "buy", reason: t("signInReason") })}
          >
            <LogIn aria-hidden="true" />
            {t("signInButton")}
          </Button>
        </div>
      ) : (
        <div>
          <Label htmlFor="all-phone">{tm("phoneLabel")}</Label>
          <Input
            id="all-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            // No text codes: only the account's own number can be used.
            readOnly={!codeOn}
            className={cn("min-h-12 text-base", !codeOn && "bg-[var(--color-muted)]")}
            onChange={(event) => {
              setPhone(event.target.value);
              setCodeSent(false);
              setCode("");
            }}
            placeholder="024 123 4567"
            aria-describedby="all-phone-hint"
          />
          <p id="all-phone-hint" className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
            {!codeOn ? t("phoneFromAccount") : ownNumber ? tm("phoneYours") : tm("phoneCodeHint")}
          </p>
        </div>
      )}
      {codeSent ? (
        <div className="rounded-xl border-2 border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)]/50 p-3">
          <Label htmlFor="all-code">{tm("codeSentTo", { phone })}</Label>
          <Input
            ref={codeInput}
            id="all-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            className="mt-1.5 min-h-12 text-center text-lg font-semibold tracking-[0.3em]"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </div>
      ) : null}
      <div>
        <Label htmlFor="all-name">{tm("buyNameLabel")}</Label>
        <Input
          id="all-name"
          autoComplete="name"
          required
          value={name}
          className="min-h-12 text-base"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="all-note">{anyDelivery ? tm("addressLabel") : tm("noteLabel")}</Label>
        <textarea
          id="all-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={anyDelivery ? tm("addressPlaceholder") : undefined}
          className="mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        />
      </div>

      {/* ------------------------------------------------------ total */}
      <dl className="space-y-1.5 rounded-xl bg-[var(--color-muted)] p-3 text-sm">
        {parts.map(({ group, totals }) => (
          <div key={group.seller.id} className="flex justify-between gap-3">
            <dt className="min-w-0 truncate">{group.seller.business_name}</dt>
            <dd className="tabular-nums">{totals ? formatCedis(totals.pay_now) : "…"}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-1.5 text-base font-bold">
          <dt>{anyDeposit ? t("payNowTotal") : t("total")}</dt>
          <dd className="tabular-nums">{total}</dd>
        </div>
      </dl>
      {anyProblem ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {anyProblem}
        </p>
      ) : null}
      <p className="flex items-start gap-1.5 text-sm text-[var(--color-muted-foreground)]">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
        <span>
          {t("heldNote")}{" "}
          <Link href="/marketplace/terms#refunds" className="font-semibold text-[var(--color-brand)] underline-offset-2 hover:underline">
            {tm("refundPolicy")}
          </Link>
        </span>
      </p>

      <Button
        type="submit"
        variant="brand"
        className="h-auto min-h-12 w-full whitespace-normal py-2.5 text-center text-base"
        disabled={busy || needsSignIn || !ready}
      >
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LockKeyhole aria-hidden="true" />}
        {codeSent ? tm("verifyAndPay", { total }) : t("payAllAction", { total })}
      </Button>
    </form>
  );
}
