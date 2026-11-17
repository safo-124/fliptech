"use client";

import { Handshake, Loader2, LockKeyhole, MapPin, Send, ShieldCheck, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { BasketLineRow } from "@/components/basket/BasketLineRow";
import { useBasket } from "@/components/basket/useBasket";
import { SellerBadges } from "@/components/marketplace/SellerBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAccount, getAddresses, updateAccount, type SavedAddress } from "@/lib/account-api";
import { checkoutSeller, groupFor, loadBasket } from "@/lib/basket";
import { formatCedis } from "@/lib/format";
import { priceBag, requestBuyerCode, verifyBuyerCode, type Fulfilment } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";
import type { BasketPrice } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Checking out one seller's part of the basket, on one page, for someone who
 * may never have used the site: the lines (still adjustable), phone (a code
 * typed on this page when it is not the signed-in buyer's own number; proving
 * it signs them in and the server merges their basket), name, Collect or
 * Delivery, the summary, who they are paying, and one button.
 *
 * A seller who takes payments: "Pay GH₵X with MoMo or card" goes to Paystack;
 * the basket keeps the lines until the payment is confirmed. One who does
 * not: "Send order to <seller>" sends it to them to be paid directly, and the
 * buyer lands on the order's page. Every total is the server's.
 */
export function BasketCheckout({ sellerId, initialWay }: { sellerId: number; initialWay?: Fulfilment }) {
  const t = useTranslations("Basket");
  const tm = useTranslations("Marketplace");
  const router = useRouter();
  const basket = useBasket();
  const group = groupFor(basket, sellerId);
  const [phone, setPhone] = useState("");
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fulfilment, setFulfilment] = useState<Fulfilment>(initialWay ?? "pickup");
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [payAtCollection, setPayAtCollection] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [price, setPrice] = useState<BasketPrice | null>(null);
  const [priceProblem, setPriceProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAddress, setSavedAddress] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const codeInput = useRef<HTMLInputElement>(null);

  // Signed in: their number, name and last address are known, and their own
  // number needs no code.
  useEffect(() => {
    let active = true;
    getAccount()
      .then((session) => {
        if (!active || !session.authenticated) return;
        setAccountPhone(session.account.phone);
        setPhone((typed) => typed || session.account.phone);
        setName((typed) => typed || session.account.display_name);
        setSavedAddress(session.account.delivery_address);
        if (session.account.delivery_address) setNote((typed) => typed || session.account.delivery_address);
        getAddresses()
          .then((found) => active && setAddresses(found.results))
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const delivers = Boolean(group?.delivery);
  const handover: Fulfilment = delivers ? fulfilment : "pickup";
  const pays = Boolean(group?.takes_payments);
  const items = (group?.lines ?? [])
    .filter((line) => line.available)
    .map((line) => ({ product: line.product, option: line.option, quantity: line.quantity }));
  const itemsKey = JSON.stringify(items);

  // A seller paid on the site: the exact sum to be charged, from the same
  // server function checkout uses (codes, student prices, deposits).
  useEffect(() => {
    if (!pays || itemsKey === "[]") return;
    let active = true;
    const handle = window.setTimeout(() => {
      priceBag(sellerId, {
        items: JSON.parse(itemsKey),
        fulfilment: handover,
        code: appliedCode || undefined,
        pay_at_collection: payAtCollection && handover === "pickup",
      })
        .then((priced) => {
          if (!active) return;
          setPrice(priced);
          setPriceProblem(null);
        })
        .catch((reason) => {
          if (!active) return;
          setPriceProblem(reason instanceof Error ? reason.message : tm("buyFailed"));
          if (appliedCode) setAppliedCode("");
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [pays, sellerId, itemsKey, handover, appliedCode, payAtCollection, tm]);

  async function send(e164: string) {
    const result = await checkoutSeller(sellerId, {
      phone: e164,
      name: name.trim(),
      fulfilment: handover,
      note: note.trim() || undefined,
      code: pays ? appliedCode || undefined : undefined,
      pay_at_collection: pays && payAtCollection && handover === "pickup",
    });
    if (savedAddress === "" && handover === "delivery" && note.trim()) {
      await updateAccount({ delivery_address: note.trim() }).catch(() => {});
    }
    if (result.kind === "pay") {
      window.location.assign(result.authorization_url);
      return;
    }
    // Sent to the maker: the lines left the basket; the order page says
    // what happens next and opens the chat.
    void loadBasket().catch(() => null);
    router.push(`/marketplace/order/${result.reference}`);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error(tm("buyNameNeeded"));
      if (handover === "delivery" && !note.trim()) throw new Error(tm("buyAddressNeeded"));
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      if (codeSent) {
        // Proving the number signs them in; the next basket request merges
        // this browser's basket into the account's.
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

  if (basket === null) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("loading")}
      </p>
    );
  }
  if (!group || !items.length) {
    return (
      <div className="space-y-3 py-8">
        <p>{t("nothingHere")}</p>
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/marketplace/basket">{t("viewBasket")}</Link>
        </Button>
      </div>
    );
  }

  const seller = group.seller;
  const ownNumber =
    Boolean(accountPhone) &&
    (() => {
      try {
        return toGhanaE164(ghanaPhoneSchema.parse(phone)) === accountPhone;
      } catch {
        return false;
      }
    })();
  const directTotals = group.totals[handover];
  const amount = pays
    ? price
      ? formatCedis(price.plan === "full" ? price.total : price.pay_now)
      : "…"
    : "";
  const buttonLabel = !pays
    ? codeSent
      ? t("verifyAndSend")
      : t("sendOrder", { seller: seller.business_name })
    : codeSent
      ? tm("verifyAndPay", { total: amount })
      : price && price.plan !== "full"
        ? t("payDepositAction", { total: amount })
        : t("payAction", { total: amount });
  const choice = (selected: boolean) =>
    cn(
      "flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-semibold",
      selected
        ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
        : "border-[var(--color-border)]",
    );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {/* ------------------------------------------- still adjustable */}
      <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] px-3">
        {group.lines.map((line) => (
          <BasketLineRow key={line.id} line={line} />
        ))}
      </ul>

      {/* ------------------------------------------------------- phone */}
      <div>
        <Label htmlFor="basket-phone">{tm("phoneLabel")}</Label>
        <Input
          id="basket-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          className="min-h-12 text-base"
          onChange={(event) => {
            setPhone(event.target.value);
            setCodeSent(false);
            setCode("");
          }}
          placeholder="024 123 4567"
          aria-describedby="basket-phone-hint"
        />
        <p id="basket-phone-hint" className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
          {ownNumber ? tm("phoneYours") : tm("phoneCodeHint")}
        </p>
      </div>
      {codeSent ? (
        <div className="rounded-xl border-2 border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)]/50 p-3">
          <Label htmlFor="basket-code">{tm("codeSentTo", { phone })}</Label>
          <Input
            ref={codeInput}
            id="basket-code"
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
        <Label htmlFor="basket-name">{tm("buyNameLabel")}</Label>
        <Input
          id="basket-name"
          autoComplete="name"
          required
          value={name}
          className="min-h-12 text-base"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {/* ------------------------------------------------ handing over */}
      <fieldset>
        <legend className="text-sm font-medium">{tm("handoverLabel")}</legend>
        <div className={cn("mt-1.5 grid gap-2", delivers ? "grid-cols-2" : "grid-cols-1")}>
          <label className={choice(handover === "pickup")}>
            <input type="radio" className="sr-only" checked={handover === "pickup"} onChange={() => setFulfilment("pickup")} />
            <Store aria-hidden="true" className="size-4" />
            {t("collect")}
          </label>
          {group.delivery ? (
            <label className={choice(handover === "delivery")}>
              <input type="radio" className="sr-only" checked={handover === "delivery"} onChange={() => setFulfilment("delivery")} />
              <Truck aria-hidden="true" className="size-4" />
              <span>
                {t("delivery")}
                <span className="block text-xs font-normal">{t("deliveryFee", { fee: formatCedis(group.delivery.fee) })}</span>
              </span>
            </label>
          ) : null}
        </div>
      </fieldset>
      {handover === "pickup" ? (
        group.pickup ? (
          <div className="rounded-xl bg-[var(--color-muted)] p-3 text-sm">
            <p className="flex items-start gap-2 font-semibold">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]" />
              <span>
                {group.pickup.name}
                <span className="block font-normal text-[var(--color-muted-foreground)]">
                  {[group.pickup.address, group.pickup.area].filter(Boolean).join(", ")}
                </span>
              </span>
            </p>
            {group.pickup.directions ? (
              <p className="mt-2 text-[var(--color-muted-foreground)]">
                <strong className="text-[var(--color-foreground)]">{tm("findTheGate")}</strong> {group.pickup.directions}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-muted-foreground)]">{tm("pickupArranged", { seller: seller.business_name })}</p>
        )
      ) : null}
      <div>
        <Label htmlFor="basket-note">{handover === "delivery" ? tm("addressLabel") : tm("noteLabel")}</Label>
        <textarea
          id="basket-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={handover === "delivery" ? tm("addressPlaceholder") : undefined}
          className="mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        />
      </div>
      {handover === "delivery" && addresses.length ? (
        <div className="flex flex-wrap gap-2">
          {addresses.map((saved) => (
            <button
              key={saved.id}
              type="button"
              onClick={() => setNote(saved.address)}
              className={`min-h-11 max-w-full truncate rounded-full border px-3 text-xs font-semibold ${
                note === saved.address
                  ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                  : "border-[var(--color-border)]"
              }`}
            >
              {saved.label || saved.address}
            </button>
          ))}
        </div>
      ) : null}

      {pays && handover === "pickup" && price?.collect_deposit_percent ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-[var(--color-border)] p-3 text-sm">
          <input
            type="checkbox"
            checked={payAtCollection}
            onChange={(event) => setPayAtCollection(event.target.checked)}
            className="mt-0.5 size-5 accent-[var(--color-brand)]"
          />
          <span>
            <span className="font-semibold">{tm("collectOption")}</span>
            <span className="block text-[var(--color-muted-foreground)]">
              {tm("collectHelp", { percent: price.collect_deposit_percent })}
            </span>
          </span>
        </label>
      ) : null}
      {pays ? (
        <details className="rounded-xl border border-[var(--color-border)]">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">{tm("discountLabel")}</summary>
          <div className="flex items-end gap-2 p-3 pt-0">
            <Input
              aria-label={tm("discountLabel")}
              autoCapitalize="characters"
              value={discount}
              className="min-h-11"
              onChange={(event) => setDiscount(event.target.value)}
            />
            <Button type="button" variant="outline" className="min-h-11" disabled={!discount.trim()} onClick={() => setAppliedCode(discount.trim())}>
              {tm("discountApply")}
            </Button>
          </div>
        </details>
      ) : null}

      {/* ------------------------------------------- the server's sum */}
      {pays && price ? (
        <dl className="space-y-1.5 rounded-xl bg-[var(--color-muted)] p-3 text-sm">
          {price.lines.map((line) => (
            <div key={`${line.product}-${line.option}`} className="flex justify-between gap-3">
              <dt className="min-w-0">
                {line.quantity} × {line.product_name}
                {line.option_label ? ` (${line.option_label})` : ""}
              </dt>
              <dd className="tabular-nums">{formatCedis(line.total)}</dd>
            </div>
          ))}
          {Number(price.discount) > 0 ? (
            <div className="flex justify-between gap-3 text-[var(--color-visit)]">
              <dt>{price.student ? tm("studentPrice") : tm("discountLine", { code: price.code })}</dt>
              <dd className="tabular-nums">−{formatCedis(price.discount)}</dd>
            </div>
          ) : null}
          {handover === "delivery" ? (
            <div className="flex justify-between gap-3">
              <dt>{t("delivery")}</dt>
              <dd className="tabular-nums">{formatCedis(price.delivery)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-1.5 text-base font-bold">
            <dt>{t("total")}</dt>
            <dd className="tabular-nums">{formatCedis(price.total)}</dd>
          </div>
          {price.plan === "collect" ? (
            <div className="flex justify-between gap-3 text-[var(--color-muted-foreground)]">
              <dt>{tm("collectCash")}</dt>
              <dd className="tabular-nums">{formatCedis(price.balance)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {!pays && directTotals ? (
        <dl className="space-y-1.5 rounded-xl bg-[var(--color-muted)] p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{t("subtotal")}</dt>
            <dd className="tabular-nums">{formatCedis(directTotals.subtotal)}</dd>
          </div>
          {handover === "delivery" ? (
            <div className="flex justify-between gap-3">
              <dt>{t("delivery")}</dt>
              <dd className="tabular-nums">{formatCedis(directTotals.delivery)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-1.5 text-base font-bold">
            <dt>{t("total")}</dt>
            <dd className="tabular-nums">{formatCedis(directTotals.total)}</dd>
          </div>
        </dl>
      ) : null}
      {pays && price?.plan === "deposit" ? (
        <p className="rounded-xl bg-[var(--color-brand-soft)] px-3 py-2.5 text-sm font-semibold text-[var(--color-brand-strong)]">
          {tm("depositPlain", { now: formatCedis(price.pay_now), later: formatCedis(price.balance) })}
        </p>
      ) : null}
      {priceProblem || group.problem ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {priceProblem || group.problem}
        </p>
      ) : null}

      {/* ------------------------------------------- who they are paying */}
      <div className="rounded-xl border border-[var(--color-border)] p-3 text-sm">
        <p className="font-semibold">
          {tm("payingSeller", { seller: seller.business_name })}
          {seller.area ? <span className="font-normal text-[var(--color-muted-foreground)]"> · {seller.area}</span> : null}
        </p>
        <div className="mt-1.5">
          <SellerBadges seller={seller} compact />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[var(--color-muted-foreground)]">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
          <span>
            {pays ? (
              <>
                <strong className="text-[var(--color-foreground)]">{tm("ifNotArrived")}</strong>{" "}
                {price?.protected
                  ? tm("protectedHelp", { seller: seller.business_name })
                  : tm("payHelp", { seller: seller.business_name })}{" "}
                <Link
                  href="/marketplace/terms#refunds"
                  className="font-semibold text-[var(--color-brand)] underline-offset-2 hover:underline"
                >
                  {tm("refundPolicy")}
                </Link>
              </>
            ) : (
              t("directTrust", { seller: seller.business_name })
            )}
          </span>
        </p>
      </div>

      {pays ? null : (
        <p className="flex items-start gap-2 rounded-xl bg-[var(--color-warn-bg)] px-3 py-2.5 text-sm">
          <Handshake aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          {t("directNote")}
        </p>
      )}
      <Button
        type="submit"
        variant="brand"
        className="h-auto min-h-12 w-full whitespace-normal py-2.5 text-center text-base"
        disabled={busy || (pays ? !price : !directTotals)}
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : pays ? (
          <LockKeyhole aria-hidden="true" />
        ) : (
          <Send aria-hidden="true" />
        )}
        {buttonLabel}
      </Button>
    </form>
  );
}
