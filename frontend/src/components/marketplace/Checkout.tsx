"use client";

import { Loader2, LockKeyhole, MapPin, ShieldCheck, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { SellerBadges } from "@/components/marketplace/SellerBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAccount, getAddresses, updateAccount, type SavedAddress } from "@/lib/account-api";
import { savePaymentQueue, type QueuedSeller } from "@/lib/checkout-queue";
import { formatCedis } from "@/lib/format";
import {
  getShopForCheckout,
  orderBag,
  priceBag,
  requestBuyerCode,
  verifyBuyerCode,
  type Fulfilment,
} from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";
import type { BagItem, BasketPrice, PickupPoint, SellerCard } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Paying one seller, on one page, for someone who has never used the site.
 *
 * No account and no Register step: a phone number, a 6-digit code typed on
 * this same page (proving it signs them in to a new account, silently), a
 * name, Collect or Delivery, the order summary, who they are paying, and one
 * button to Paystack. A signed-in buyer's own number needs no code.
 *
 * The total shown is the server's (POST /api/sellers/<id>/price/), asked
 * again whenever the items, the handover or the code change, so delivery and
 * discounts are never worked out in the browser. The bag is not emptied when
 * the buyer leaves for Paystack: the order page empties it once the payment
 * is confirmed, so a failed or cancelled payment comes back to a full bag.
 */
export function Checkout({
  sellerId,
  sellerName,
  items,
  seller: givenSeller,
  pickup: givenPickup,
  queue = [],
}: {
  sellerId: number;
  sellerName: string;
  items: BagItem[];
  /** The shop, when the page has it already; otherwise it is fetched. */
  seller?: SellerCard | null;
  pickup?: PickupPoint | null;
  /** Other sellers' bags to pay for after this one, with the same details
      ("one checkout for the whole bag"). */
  queue?: QueuedSeller[];
}) {
  const t = useTranslations("Marketplace");
  const [phone, setPhone] = useState("");
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fulfilment, setFulfilment] = useState<Fulfilment>("pickup");
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [price, setPrice] = useState<BasketPrice | null>(null);
  const [priceProblem, setPriceProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAddress, setSavedAddress] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [payAtCollection, setPayAtCollection] = useState(false);
  const [shop, setShop] = useState<{ seller: SellerCard | null; pickup: PickupPoint | null } | null>(
    givenSeller !== undefined ? { seller: givenSeller ?? null, pickup: givenPickup ?? null } : null,
  );
  const codeInput = useRef<HTMLInputElement>(null);

  // The shop, for who they are paying and where to collect.
  useEffect(() => {
    if (shop) return;
    let active = true;
    getShopForCheckout(sellerId)
      .then((found) => active && setShop({ seller: found.seller, pickup: found.pickup ?? null }))
      .catch(() => active && setShop({ seller: null, pickup: null }));
    return () => {
      active = false;
    };
  }, [sellerId, shop]);

  // Signed in: their number, name and last address are already known, and
  // the number needs no code (it is the account's own).
  useEffect(() => {
    let active = true;
    getAccount()
      .then((session) => {
        if (!active || !session.authenticated) return;
        setAccountPhone(session.account.phone);
        setPhone((typed) => typed || session.account.phone);
        setName((typed) => typed || session.account.display_name);
        setSavedAddress(session.account.delivery_address);
        if (session.account.delivery_address) {
          setNote((typed) => typed || session.account.delivery_address);
        }
        getAddresses()
          .then((found) => active && setAddresses(found.results))
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const seller = shop?.seller ?? null;
  // Delivery only from a seller who offers it, at their fixed fee.
  const delivers = Boolean(seller && seller.delivery_fee !== null);
  const handover: Fulfilment = delivers ? fulfilment : "pickup";

  const itemsKey = JSON.stringify(items);
  useEffect(() => {
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
          setPriceProblem(reason instanceof Error ? reason.message : t("buyFailed"));
          if (appliedCode) setAppliedCode("");
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [sellerId, itemsKey, handover, appliedCode, payAtCollection, t]);

  async function pay(e164: string) {
    const { authorization_url } = await orderBag(sellerId, {
      items,
      phone: e164,
      name: name.trim(),
      fulfilment: handover,
      note: note.trim() || undefined,
      code: appliedCode || undefined,
      pay_at_collection: payAtCollection && handover === "pickup",
    });
    // The rest of the bag, paid one seller after another with these details.
    savePaymentQueue(
      queue.length
        ? { details: { phone: e164, name: name.trim(), fulfilment: handover, note: note.trim() }, sellers: queue }
        : null,
    );
    // The first delivery address is kept for next time.
    if (savedAddress === "" && handover === "delivery" && note.trim()) {
      await updateAccount({ delivery_address: note.trim() }).catch(() => {});
    }
    window.location.assign(authorization_url);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error(t("buyNameNeeded"));
      if (handover === "delivery" && !note.trim()) throw new Error(t("buyAddressNeeded"));
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      if (codeSent) {
        // The code, typed on this page: proving the number signs them in.
        await verifyBuyerCode(e164, code.trim());
        await pay(e164);
        return;
      }
      const asked = await requestBuyerCode(e164);
      if (asked.verified) {
        await pay(e164);
        return;
      }
      setCodeSent(true);
      window.setTimeout(() => codeInput.current?.focus(), 50);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("buyFailed"));
    }
    setBusy(false);
  }

  const ownNumber = Boolean(accountPhone) && (() => {
    try {
      return toGhanaE164(ghanaPhoneSchema.parse(phone)) === accountPhone;
    } catch {
      return false;
    }
  })();

  // A deposit or pay-on-collection order charges part now; the button says so.
  const now = price ? formatCedis(price.plan === "full" ? price.total : price.pay_now) : "…";
  const payLabel = codeSent
    ? t("verifyAndPay", { total: now })
    : price && price.plan !== "full"
      ? t("payDepositAction", { total: now })
      : t("payAction", { total: now });
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

      {/* ------------------------------------------------------- the phone */}
      <div>
        <Label htmlFor="buy-phone">{t("phoneLabel")}</Label>
        <Input
          id="buy-phone"
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
          aria-describedby="buy-phone-hint"
        />
        <p id="buy-phone-hint" className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
          {ownNumber ? t("phoneYours") : t("phoneCodeHint")}
        </p>
      </div>

      {codeSent ? (
        <div className="rounded-xl border-2 border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)]/50 p-3">
          <Label htmlFor="buy-code">{t("codeSentTo", { phone })}</Label>
          <Input
            ref={codeInput}
            id="buy-code"
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
        <Label htmlFor="buy-name">{t("buyNameLabel")}</Label>
        <Input
          id="buy-name"
          autoComplete="name"
          required
          value={name}
          className="min-h-12 text-base"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {/* ------------------------------------------------- how it arrives */}
      <fieldset>
        <legend className="text-sm font-medium">{t("handoverLabel")}</legend>
        <div className={cn("mt-1.5 grid gap-2", delivers ? "grid-cols-2" : "grid-cols-1")}>
          <label className={choice(handover === "pickup")}>
            <input
              type="radio"
              className="sr-only"
              checked={handover === "pickup"}
              onChange={() => setFulfilment("pickup")}
            />
            <Store aria-hidden="true" className="size-4" />
            {t("pickup")}
          </label>
          {delivers ? (
            <label className={choice(handover === "delivery")}>
              <input
                type="radio"
                className="sr-only"
                checked={handover === "delivery"}
                onChange={() => setFulfilment("delivery")}
              />
              <Truck aria-hidden="true" className="size-4" />
              <span>
                {t("delivery")}
                <span className="block text-xs font-normal">
                  {t("deliveryFeeShort", { fee: formatCedis(seller?.delivery_fee ?? "0") })}
                </span>
              </span>
            </label>
          ) : null}
        </div>
      </fieldset>

      {handover === "pickup" ? (
        shop?.pickup ? (
          <div className="rounded-xl bg-[var(--color-muted)] p-3 text-sm">
            <p className="flex items-start gap-2 font-semibold">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]" />
              <span>
                {shop.pickup.name}
                <span className="block font-normal text-[var(--color-muted-foreground)]">
                  {[shop.pickup.address, shop.pickup.area].filter(Boolean).join(", ")}
                </span>
              </span>
            </p>
            {shop.pickup.directions ? (
              <p className="mt-2 text-[var(--color-muted-foreground)]">
                <strong className="text-[var(--color-foreground)]">{t("findTheGate")}</strong> {shop.pickup.directions}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("pickupArranged", { seller: sellerName })}</p>
        )
      ) : null}

      <div>
        <Label htmlFor="buy-note">{handover === "delivery" ? t("addressLabel") : t("noteLabel")}</Label>
        <textarea
          id="buy-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={handover === "delivery" ? t("addressPlaceholder") : undefined}
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

      {handover === "pickup" && price?.collect_deposit_percent ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-[var(--color-border)] p-3 text-sm">
          <input
            type="checkbox"
            checked={payAtCollection}
            onChange={(event) => setPayAtCollection(event.target.checked)}
            className="mt-0.5 size-5 accent-[var(--color-brand)]"
          />
          <span>
            <span className="font-semibold">{t("collectOption")}</span>
            <span className="block text-[var(--color-muted-foreground)]">
              {t("collectHelp", { percent: price.collect_deposit_percent })}
            </span>
          </span>
        </label>
      ) : null}

      <details className="rounded-xl border border-[var(--color-border)]">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">
          {t("discountLabel")}
        </summary>
        <div className="flex items-end gap-2 p-3 pt-0">
          <Input
            id="buy-discount"
            aria-label={t("discountLabel")}
            autoCapitalize="characters"
            value={discount}
            className="min-h-11"
            onChange={(event) => setDiscount(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!discount.trim()}
            onClick={() => setAppliedCode(discount.trim())}
          >
            {t("discountApply")}
          </Button>
        </div>
      </details>

      {/* ------------------------------------------- the server's sum */}
      {price ? (
        <dl className="space-y-1.5 rounded-xl bg-[var(--color-muted)] p-3 text-sm">
          {price.lines.map((line) => (
            <div key={`${line.product}-${line.option}`} className="flex justify-between gap-3">
              <dt className="min-w-0">
                {line.quantity} × {line.product_name}
                {line.option_label ? ` (${line.option_label})` : ""}
                <span className="block text-xs text-[var(--color-muted-foreground)]">
                  {t("each", { price: formatCedis(line.unit_price) })}
                </span>
              </dt>
              <dd className="tabular-nums">{formatCedis(line.total)}</dd>
            </div>
          ))}
          {Number(price.discount) > 0 ? (
            <div className="flex justify-between gap-3 text-[var(--color-visit)]">
              <dt>{price.student ? t("studentPrice") : t("discountLine", { code: price.code })}</dt>
              <dd className="tabular-nums">−{formatCedis(price.discount)}</dd>
            </div>
          ) : null}
          {handover === "delivery" ? (
            <div className="flex justify-between gap-3">
              <dt>{t("deliveryLine")}</dt>
              <dd className="tabular-nums">{formatCedis(price.delivery)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-1.5 text-base font-bold">
            <dt>{t("totalLine")}</dt>
            <dd className="tabular-nums">{formatCedis(price.total)}</dd>
          </div>
          {price.plan === "collect" ? (
            <>
              <div className="flex justify-between gap-3 text-[var(--color-brand-strong)]">
                <dt>{t("collectNow", { percent: price.collect_deposit_percent ?? 0 })}</dt>
                <dd className="tabular-nums">{formatCedis(price.pay_now)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-[var(--color-muted-foreground)]">
                <dt>{t("collectCash")}</dt>
                <dd className="tabular-nums">{formatCedis(price.balance)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      ) : null}
      {/* Made to order with a deposit: said plainly, before paying. */}
      {price?.plan === "deposit" ? (
        <p className="rounded-xl bg-[var(--color-brand-soft)] px-3 py-2.5 text-sm font-semibold text-[var(--color-brand-strong)]">
          {t("depositPlain", { now: formatCedis(price.pay_now), later: formatCedis(price.balance) })}
        </p>
      ) : null}
      {priceProblem ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {priceProblem}
        </p>
      ) : null}

      {/* ------------------------------------------- who they are paying */}
      <div className="rounded-xl border border-[var(--color-border)] p-3 text-sm">
        <p className="font-semibold">
          {t("payingSeller", { seller: seller?.business_name ?? sellerName })}
          {seller?.area ? (
            <span className="font-normal text-[var(--color-muted-foreground)]"> · {seller.area}</span>
          ) : null}
        </p>
        {seller ? (
          <div className="mt-1.5">
            <SellerBadges seller={seller} compact />
          </div>
        ) : null}
        <p className="mt-2 flex items-start gap-1.5 text-[var(--color-muted-foreground)]">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
          <span>
            <strong className="text-[var(--color-foreground)]">{t("ifNotArrived")}</strong>{" "}
            {price?.protected ? t("protectedHelp", { seller: sellerName }) : t("payHelp", { seller: sellerName })}{" "}
            <Link href="/marketplace/terms#refunds" className="font-semibold text-[var(--color-brand)] underline-offset-2 hover:underline">
              {t("refundPolicy")}
            </Link>
          </span>
        </p>
      </div>

      <Button type="submit" variant="brand" className="min-h-12 w-full text-base" disabled={busy || !price}>
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LockKeyhole aria-hidden="true" />}
        {payLabel}
      </Button>
    </form>
  );
}
