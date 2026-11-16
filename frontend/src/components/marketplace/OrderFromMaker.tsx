"use client";

import { CheckCircle2, Handshake, Loader2, MessageCircle, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAccount } from "@/lib/account-api";
import { BRAND } from "@/lib/brand";
import { formatCedis } from "@/lib/format";
import { orderFromMaker, requestBuyerCode, verifyBuyerCode, type Fulfilment } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";
import type { MarketplaceOrder, ProductOption } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "Order from the maker", for a maker who cannot take payment on the site
 * yet. A short form (phone, name, quantity, Collect or Delivery, a note)
 * sends the order to the maker's Orders, marked "Pay the maker directly",
 * and into the chat, where the two of them agree payment and pickup. The
 * phone is proved with a code on this same form, as at checkout.
 */
export function OrderFromMaker({
  productId,
  sellerName,
  price,
  options,
  delivers,
  maxQuantity = 20,
}: {
  productId: number;
  sellerName: string;
  price: string | null;
  options: ProductOption[];
  /** The maker delivers through the site (has a delivery fee). */
  delivers: boolean;
  maxQuantity?: number;
}) {
  const t = useTranslations("Marketplace");
  const most = Math.max(1, Math.min(20, maxQuantity));
  const choosable = options.filter((option) => option.available);
  const [open, setOpen] = useState(false);
  const [option, setOption] = useState<number | null>(choosable.length === 1 ? choosable[0].id : null);
  const [quantity, setQuantity] = useState(1);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [fulfilment, setFulfilment] = useState<Fulfilment>("pickup");
  const [note, setNote] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<(MarketplaceOrder & { conversation_id: number | null }) | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    getAccount()
      .then((session) => {
        if (!active || !session.authenticated) return;
        setPhone((typed) => typed || session.account.phone);
        setName((typed) => typed || session.account.display_name);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  const chosen = options.find((item) => item.id === option) ?? null;
  const needsChoice = choosable.length > 0 && chosen === null;
  const unit = chosen?.price ?? price;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsChoice) throw new Error(t("chooseOptionFirst"));
      if (!name.trim()) throw new Error(t("buyNameNeeded"));
      if (fulfilment === "delivery" && !note.trim()) throw new Error(t("buyAddressNeeded"));
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      if (codeSent) {
        await verifyBuyerCode(e164, code.trim());
      } else {
        const asked = await requestBuyerCode(e164);
        if (!asked.verified) {
          setCodeSent(true);
          setBusy(false);
          window.setTimeout(() => codeInput.current?.focus(), 50);
          return;
        }
      }
      setSent(
        await orderFromMaker(productId, {
          phone: e164,
          name: name.trim(),
          quantity,
          option,
          fulfilment,
          note: note.trim() || undefined,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("buyFailed"));
    }
    setBusy(false);
  }

  const choice = (selected: boolean) =>
    cn(
      "flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-semibold",
      selected
        ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
        : "border-[var(--color-border)]",
    );

  if (sent) {
    return (
      <section className="rounded-2xl border border-[var(--color-visit)]/30 bg-[var(--color-visit-bg)] p-4" role="status">
        <p className="flex items-center gap-2 text-base font-bold text-[var(--color-visit)]">
          <CheckCircle2 aria-hidden="true" className="size-5" />
          {t("directSentTitle", { seller: sellerName })}
        </p>
        <p className="mt-1.5 text-sm">{t("directSentBody", { seller: sellerName })}</p>
        <div className="mt-3 grid gap-2">
          {sent.conversation_id ? (
            <Button asChild variant="brand" className="min-h-12 w-full">
              <Link href={`/account/chats/${sent.conversation_id}`}>
                <MessageCircle aria-hidden="true" />
                {t("messageMaker")}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="min-h-11 w-full">
            <Link href={`/marketplace/order/${sent.reference}`}>{t("seeOrder")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-card)] p-4">
      <p className="flex items-start gap-2 text-sm leading-relaxed">
        <Handshake aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]" />
        {t("directLine", { brandShort: BRAND })}
      </p>
      {!open ? (
        <Button type="button" variant="brand" className="mt-3 min-h-12 w-full text-base" onClick={() => setOpen(true)}>
          {t("orderFromMaker")}
        </Button>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          {error ? (
            <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
              {error}
            </p>
          ) : null}
          {options.length ? (
            <fieldset>
              <legend className="text-sm font-medium">{t("chooseOption")}</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {options.map((item) => (
                  <label
                    key={item.id}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)]",
                      item.available ? "border-[var(--color-border)]" : "cursor-not-allowed border-dashed opacity-50",
                    )}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      disabled={!item.available}
                      checked={option === item.id}
                      onChange={() => setOption(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="flex items-end gap-3">
            <div className="w-24">
              <Label htmlFor="direct-quantity">{t("quantityLabel")}</Label>
              <input
                id="direct-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={most}
                value={quantity}
                onChange={(event) => setQuantity(Math.min(most, Math.max(1, Number(event.target.value) || 1)))}
                className="mt-1.5 h-12 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-base"
              />
            </div>
            <p className="pb-3 text-sm text-[var(--color-muted-foreground)]">
              {unit ? t("each", { price: formatCedis(unit) }) : t("onRequest")}
              {most < 20 ? (
                <span className="block font-semibold text-[var(--color-warn)]">{t("onlyLeft", { count: most })}</span>
              ) : null}
            </p>
          </div>
          <div>
            <Label htmlFor="direct-phone">{t("phoneLabel")}</Label>
            <Input
              id="direct-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              className="min-h-12 text-base"
              placeholder="024 123 4567"
              onChange={(event) => {
                setPhone(event.target.value);
                setCodeSent(false);
              }}
            />
          </div>
          {codeSent ? (
            <div className="rounded-xl border-2 border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)]/50 p-3">
              <Label htmlFor="direct-code">{t("codeSentTo", { phone })}</Label>
              <Input
                ref={codeInput}
                id="direct-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                className="mt-1.5 min-h-12 text-center text-lg font-semibold tracking-[0.3em]"
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="direct-name">{t("buyNameLabel")}</Label>
            <Input
              id="direct-name"
              autoComplete="name"
              value={name}
              className="min-h-12 text-base"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">{t("handoverLabel")}</legend>
            <div className={cn("mt-1.5 grid gap-2", delivers ? "grid-cols-2" : "grid-cols-1")}>
              <label className={choice(fulfilment === "pickup")}>
                <input type="radio" className="sr-only" checked={fulfilment === "pickup"} onChange={() => setFulfilment("pickup")} />
                <Store aria-hidden="true" className="size-4" />
                {t("pickup")}
              </label>
              {delivers ? (
                <label className={choice(fulfilment === "delivery")}>
                  <input type="radio" className="sr-only" checked={fulfilment === "delivery"} onChange={() => setFulfilment("delivery")} />
                  <Truck aria-hidden="true" className="size-4" />
                  {t("delivery")}
                </label>
              ) : null}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="direct-note">{fulfilment === "delivery" ? t("addressLabel") : t("noteLabel")}</Label>
            <textarea
              id="direct-note"
              rows={2}
              value={note}
              placeholder={fulfilment === "delivery" ? t("addressPlaceholder") : undefined}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
          </div>
          <Button type="submit" variant="brand" className="min-h-12 w-full text-base" disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {codeSent ? t("verifyAndSendOrder") : t("sendOrder")}
          </Button>
        </form>
      )}
    </section>
  );
}
