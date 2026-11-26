"use client";

import { AlertCircle, CheckCircle2, Loader2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { PayoutAccountForm } from "@/components/payout/PayoutAccountForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { BRAND } from "@/lib/brand";
import { getTrainerCourse, setCoursePrice } from "@/lib/course-api";
import { formatCedis } from "@/lib/format";
import { TrainerApiError } from "@/lib/trainer-fetch";
import type { TrainerCourse } from "@/lib/types";

type Errors = Record<string, string | undefined>;

/**
 * Selling the course: where the money goes, what it costs, what has sold.
 *
 * In that order on purpose: a price can only be set once there is a payout
 * account, so a trainee can never pay for a course whose trainer cannot be
 * paid. Payments go through Paystack and are split straight to the
 * trainer's account; see backend courses/views.py.
 */
export function TrainerCourseSales({onSaved}: {onSaved?: () => void} = {}) {
  const t = useTranslations("TrainerCourse");
  const [course, setCourse] = useState<TrainerCourse | null>(null);
  const [editingPayout, setEditingPayout] = useState(false);
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<"price" | null>(null);

  useEffect(() => {
    let active = true;
    getTrainerCourse()
      .then((loaded) => {
        if (!active) return;
        setCourse(loaded);
        setPrice(loaded.price ?? "");
        setEditingPayout(!loaded.payout.ready);
      })
      .catch(() => {
        if (active) setProblem(t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  function fail(reason: unknown) {
    if (reason instanceof TrainerApiError && Object.keys(reason.fields).some((key) => key !== "detail")) {
      setErrors(reason.fields);
    } else {
      setProblem(reason instanceof Error ? reason.message : t("saveFailed"));
    }
  }

  async function submitPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("price");
    setErrors({});
    setProblem(null);
    setMessage(null);
    try {
      const saved = await setCoursePrice(price.trim());
      setCourse(saved);
      onSaved?.();
      setPrice(saved.price ?? "");
      setMessage(saved.price ? t("priceSaved", { price: formatCedis(saved.price) }) : t("madeFree"));
    } catch (reason) {
      fail(reason);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 sm:px-6">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
          <Wallet aria-hidden="true" className="size-4" />
        </div>
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <CardDescription className="mt-1 leading-6">{t("lead")}</CardDescription>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-6 pt-5 sm:px-6">
        {course === null ? (
          problem ? null : (
            <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {t("loading")}
            </p>
          )
        ) : !course.payments_enabled ? (
          <p className="text-sm leading-6 text-[var(--color-muted-foreground)]">
            {t("notEnabled", { brand: BRAND })}
          </p>
        ) : (
          <>
            {/* ------------------------------------------- where the money goes */}
            <section aria-labelledby="payout-heading" className="space-y-3">
              <h3 id="payout-heading" className="text-sm font-bold">
                {t("payoutTitle")}
              </h3>
              {course.payout.ready && !editingPayout ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-muted)] p-3">
                  <p className="flex items-center gap-2 text-sm">
                    <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--color-visit)]" />
                    {t("payoutTo", {
                      bank: course.payout.bank_name,
                      last4: course.payout.account_last4,
                      name: course.payout.account_name,
                    })}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingPayout(true)}>
                    {t("change")}
                  </Button>
                </div>
              ) : (
                <PayoutAccountForm
                  idPrefix="course-payout"
                  onCancel={course.payout.ready ? () => setEditingPayout(false) : undefined}
                  onSaved={() => {
                    setEditingPayout(false);
                    setMessage(t("payoutSaved"));
                    onSaved?.();
                    void getTrainerCourse()
                      .then(setCourse)
                      .catch(() => null);
                  }}
                />
              )}
            </section>

            {/* ------------------------------------------------------- the price */}
            <section aria-labelledby="price-heading" className="space-y-3">
              <h3 id="price-heading" className="text-sm font-bold">
                {t("priceTitle")}
              </h3>
              <form noValidate onSubmit={submitPrice} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="course-price">{t("priceLabel")}</Label>
                  <Input
                    id="course-price"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder={t("pricePlaceholder")}
                    disabled={!course.payout.ready}
                    aria-invalid={errors.price ? true : undefined}
                    className="w-40"
                  />
                </div>
                <Button type="submit" variant="brand" disabled={!course.payout.ready || saving !== null}>
                  {saving === "price" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                  {t("savePrice")}
                </Button>
              </form>
              {errors.price ? <p className="text-sm text-[var(--color-destructive)]">{errors.price}</p> : null}
              <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                {course.payout.ready ? t("priceHelp") : t("priceNeedsPayout")}
              </p>
            </section>

            {/* ------------------------------------------------------ what sold */}
            <p className="rounded-xl border border-[var(--color-border)] p-3 text-sm">
              {t("sales", { count: course.sales.count, total: formatCedis(course.sales.total) })}
            </p>
          </>
        )}

        {message ? (
          <p role="status" className="flex items-center gap-2 text-sm text-[var(--color-visit)]">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {message}
          </p>
        ) : null}
        {problem ? (
          <Alert variant="warning">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              <p>{problem}</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
