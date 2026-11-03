"use client";

import { BadgeCheck, Clock, IdCard, Loader2, ShieldCheck, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSellerId, sendSellerId, type SellerIdState } from "@/lib/seller-api";

/**
 * The ID check before taking payments, and the seller's level: confirmed
 * (list and answer), payments (ID checked), verified maker (visited).
 */
export function SellerIdCard() {
  const t = useTranslations("SellerDashboard");
  const [state, setState] = useState<SellerIdState | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSellerId()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  async function send(file: File) {
    setBusy(true);
    setProblem(null);
    try {
      setState(await sendSellerId(file));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("idFailed"));
    }
    setBusy(false);
  }

  if (!state) return null;
  const levels = [
    { key: "confirmed", label: t("levelConfirmed"), Icon: BadgeCheck },
    { key: "payments", label: t("levelPayments"), Icon: ShieldCheck },
    { key: "verified", label: t("levelVerified"), Icon: BadgeCheck },
  ] as const;
  const reached = levels.findIndex((level) => level.key === state.level);

  return (
    <section
      aria-labelledby="seller-id"
      className="mb-5 space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
    >
      <h2 id="seller-id" className="flex items-center gap-2 text-base font-bold">
        <IdCard aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {t("idTitle")}
      </h2>
      <ol className="grid grid-cols-3 gap-2">
        {levels.map((level, index) => (
          <li
            key={level.key}
            className={`rounded-xl px-2 py-2 text-center text-xs font-semibold ${
              index <= reached
                ? "bg-[var(--color-visit-bg)] text-[var(--color-visit)]"
                : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
            }`}
          >
            <level.Icon aria-hidden="true" className="mx-auto mb-1 size-4" />
            {level.label}
          </li>
        ))}
      </ol>
      {state.status === "checked" ? (
        <p className="text-sm text-[var(--color-visit)]">{t("idChecked")}</p>
      ) : state.status === "submitted" ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Clock aria-hidden="true" className="size-4" />
          {t("idWaiting")}
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {state.required ? t("idNeeded") : t("idOptional")}
          </p>
          {state.note ? <p className="text-sm text-[var(--color-destructive)]">{state.note}</p> : null}
        </>
      )}
      {state.status !== "checked" ? (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
            }}
          />
          <Button type="button" variant={state.status === "submitted" ? "outline" : "brand"} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Upload aria-hidden="true" />}
            {state.status === "submitted" ? t("idReplace") : t("idSend")}
          </Button>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("idPrivacy")}</p>
        </>
      ) : null}
      {problem ? <p role="alert" className="text-sm text-[var(--color-destructive)]">{problem}</p> : null}
    </section>
  );
}
