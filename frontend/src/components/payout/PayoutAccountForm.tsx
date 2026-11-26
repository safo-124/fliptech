"use client";

import { CheckCircle2, Clock, Loader2, UserCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  checkPayoutAccount,
  getPayoutAccount,
  savePayoutAccount,
  type PayoutAccount,
  type PayoutCheck,
} from "@/lib/payout-api";
import { TrainerApiError } from "@/lib/trainer-fetch";

/**
 * "Where should we send your money?" One wallet or bank account for each
 * person, used for selling and for teaching.
 *
 * 1. Their sign-in number is filled in and the network guessed from it.
 * 2. "Check" asks Paystack whose name is on it.
 * 3. "Is this you? KWAME MENSAH" — Yes saves it; No goes back to change it.
 *
 * When the name differs from the one on their checked ID, it is still saved
 * and the money waits until staff have looked; the person is told so.
 */
export function PayoutAccountForm({
  onSaved,
  onCancel,
  idPrefix = "payout",
}: {
  onSaved?: (saved: PayoutAccount) => void;
  /** Shown as "Cancel" when there is an account already. */
  onCancel?: () => void;
  idPrefix?: string;
}) {
  const t = useTranslations("PayoutAccount");
  const [data, setData] = useState<PayoutAccount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bank, setBank] = useState("");
  const [number, setNumber] = useState("");
  const [checked, setChecked] = useState<PayoutCheck | null>(null);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState<"check" | "save" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    getPayoutAccount()
      .then((loaded) => {
        if (!active) return;
        setData(loaded);
        setBank(loaded.account?.bank_code || loaded.suggestion.bank_code || "");
        setNumber(loaded.account ? "" : loaded.suggestion.number);
      })
      .catch((reason) => active && setLoadError(reason instanceof Error ? reason.message : t("loadFailed")));
    return () => {
      active = false;
    };
  }, [t]);

  function failed(reason: unknown) {
    if (reason instanceof TrainerApiError) {
      setErrors(Object.keys(reason.fields).length ? reason.fields : { detail: reason.message });
    } else {
      setErrors({ detail: reason instanceof Error ? reason.message : t("saveFailed") });
    }
  }

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setBusy("check");
    try {
      const found = await checkPayoutAccount({ bank_code: bank, account_number: number });
      setChecked(found);
      setTypedName("");
    } catch (reason) {
      failed(reason);
    }
    setBusy(null);
  }

  async function confirm(name: string) {
    setErrors({});
    setBusy("save");
    try {
      const saved = await savePayoutAccount({ bank_code: bank, account_number: number, confirmed_name: name });
      setData(saved);
      setChecked(null);
      onSaved?.(saved);
    } catch (reason) {
      // The name changed between the check and now: show the new one.
      const body = reason instanceof TrainerApiError ? (reason.body as { code?: string; name?: string } | null) : null;
      if (body?.code === "name_changed" && body.name && checked) setChecked({ ...checked, name: body.name });
      failed(reason);
    }
    setBusy(null);
  }

  if (loadError) return <p className="text-sm text-[var(--color-destructive)]">{loadError}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("loading")}
      </p>
    );
  }
  if (!data.payments_enabled) return <p className="text-sm text-[var(--color-muted-foreground)]">{t("paymentsOff")}</p>;

  const banks = data.banks;
  const guessed = !data.account && data.suggestion.bank_code && bank === data.suggestion.bank_code;

  // ------------------------------------------------- "Is this you?"
  if (checked) {
    return (
      <div className="space-y-3 rounded-2xl border-2 border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)]/50 p-4">
        {errors.detail ? (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">
            {errors.detail}
          </p>
        ) : null}
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t("checkedOn", { bank: checked.bank_name, last4: checked.account_last4 })}
        </p>
        {checked.name ? (
          <>
            <p className="text-base font-semibold">{t("isThisYou")}</p>
            <p className="flex items-center gap-2 text-xl font-extrabold tracking-wide">
              <UserCheck aria-hidden="true" className="size-6 text-[var(--color-brand)]" />
              {checked.name}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="brand" className="min-h-12" disabled={busy !== null} onClick={() => void confirm(checked.name)}>
                {busy === "save" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {t("yesMe")}
              </Button>
              <Button type="button" variant="outline" className="min-h-12" disabled={busy !== null} onClick={() => setChecked(null)}>
                {t("noChange")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">{t("noNameFound")}</p>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-typed-name`}>{t("typedNameLabel")}</Label>
              <Input
                id={`${idPrefix}-typed-name`}
                autoComplete="name"
                value={typedName}
                className="min-h-12 text-base"
                onChange={(event) => setTypedName(event.target.value)}
              />
              {errors.confirmed_name ? <p className="text-sm text-[var(--color-destructive)]">{errors.confirmed_name}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="brand"
                className="min-h-12"
                disabled={busy !== null || !typedName.trim()}
                onClick={() => void confirm(typedName.trim())}
              >
                {busy === "save" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {t("save")}
              </Button>
              <Button type="button" variant="outline" className="min-h-12" disabled={busy !== null} onClick={() => setChecked(null)}>
                {t("back")}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ------------------------------------------------- saved, unchanged
  const saved = data.account;
  return (
    <div className="space-y-4">
      {saved ? (
        <div className="space-y-2 rounded-xl bg-[var(--color-muted)] p-3 text-sm">
          <p className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-[var(--color-visit)]" />
            {t("savedTo", { bank: saved.bank_name, last4: saved.account_last4, name: saved.account_name })}
          </p>
          {saved.waiting_for_staff ? (
            <p className="flex items-start gap-2 text-[var(--color-warn)]">
              <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t("waitingForStaff")}
            </p>
          ) : null}
        </div>
      ) : null}

      <form noValidate onSubmit={check} className="grid gap-4 sm:grid-cols-2">
        {errors.detail ? (
          <p role="alert" className="text-sm text-[var(--color-destructive)] sm:col-span-2">
            {errors.detail}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-bank`}>{t("bankLabel")}</Label>
          <NativeSelect
            id={`${idPrefix}-bank`}
            value={bank}
            onChange={(event) => setBank(event.target.value)}
            aria-invalid={errors.bank_code ? true : undefined}
          >
            <option value="">{t("choose")}</option>
            {(["mobile_money", "ghipss"] as const).map((type) => {
              const group = banks.filter((one) => one.type === type);
              return group.length ? (
                <optgroup key={type} label={t(`group.${type}`)}>
                  {group.map((one) => (
                    <option key={one.code} value={one.code}>
                      {one.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </NativeSelect>
          {errors.bank_code ? (
            <p className="text-sm text-[var(--color-destructive)]">{errors.bank_code}</p>
          ) : guessed ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("guessed")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-number`}>{t("numberLabel")}</Label>
          <Input
            id={`${idPrefix}-number`}
            inputMode="numeric"
            autoComplete="off"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="024 000 0000"
            aria-invalid={errors.account_number ? true : undefined}
          />
          {errors.account_number ? (
            <p className="text-sm text-[var(--color-destructive)]">{errors.account_number}</p>
          ) : !saved && number && number === data.suggestion.number ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("yourNumber")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" variant="brand" className="min-h-11" disabled={busy !== null || !bank || !number.trim()}>
            {busy === "check" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {saved ? t("checkNew") : t("check")}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
