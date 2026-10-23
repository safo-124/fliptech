"use client";

/**
 * "Report a problem" with a listing. See backend Complaint.
 *
 * No sign-in and no code: somebody reporting a workshop that took their money
 * should not have to prove a phone number first, and some will only report
 * if they can stay anonymous. Name and number are therefore optional, and the
 * form says plainly that the workshop never sees them.
 */

import { AlertCircle, Check, Loader2, Phone, Send } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, postJson } from "@/lib/api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";

/** In the order a worried trainee is most likely to need them. */
const CATEGORIES = ["money", "unsafe", "not_there", "wrong_details", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const MIN_DETAIL = 10;

type Errors = Partial<Record<"category" | "detail" | "phone", string>>;

export function ReportProblemForm({
  providerId,
  providerName,
  listingHref,
}: {
  providerId: number;
  providerName: string;
  listingHref: string;
}) {
  const t = useTranslations("ReportProblem");
  const [category, setCategory] = useState<Category | "">("");
  const [detail, setDetail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);

  // The thank-you is shorter than the form, so without this a phone is left
  // scrolled below it, looking at the footer.
  useEffect(() => {
    if (!reference) return;
    sentHeadingRef.current?.focus();
    sentHeadingRef.current?.scrollIntoView({ block: "center" });
  }, [reference]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    if (!category) found.category = t("categoryRequired");
    if (detail.trim().length < MIN_DETAIL) found.detail = t("detailRequired");
    if (phone.trim() && !ghanaPhoneSchema.safeParse(phone).success) found.phone = t("phoneInvalid");
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;

    setSending(true);
    try {
      const sent = await postJson<{ reference: string }>("/api/complaints/", {
        provider_id: providerId,
        category,
        detail: detail.trim(),
        reporter_name: name.trim(),
        reporter_phone: phone.trim() ? toGhanaE164(phone) : "",
        website,
      });
      setReference(sent.reference);
    } catch (reason) {
      setFailure(reason instanceof ApiError && reason.status === 429 ? reason.message : t("failed"));
    } finally {
      setSending(false);
    }
  }

  if (reference) {
    return (
      <div role="status" aria-live="polite">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
          <Check className="size-6" strokeWidth={2.5} aria-hidden="true" />
        </div>
        <h2
          ref={sentHeadingRef}
          tabIndex={-1}
          className="mt-4 text-2xl font-bold tracking-tight outline-none"
        >
          {t("sentTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">{t("sentBody")}</p>
        <div className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
            {t("referenceLabel")}
          </p>
          <strong className="mt-1 block text-2xl tracking-[0.08em]">{reference}</strong>
          <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">{t("quoteReference")}</p>
        </div>
        <Button asChild variant="outline" className="mt-5 w-full sm:w-auto">
          <Link href={listingHref}>{t("backToListing", { name: providerName })}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <fieldset aria-describedby={errors.category ? "category-error" : undefined}>
        <legend className="text-sm font-semibold">{t("categoryLegend")}</legend>
        <div className="mt-3 grid gap-2">
          {CATEGORIES.map((value) => (
            <label
              key={value}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3.5 py-2.5 text-sm has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)]/50"
            >
              <input
                type="radio"
                name="category"
                value={value}
                checked={category === value}
                onChange={() => setCategory(value)}
                className="size-4 accent-[var(--color-brand)]"
              />
              <span>{t(`categories.${value}`)}</span>
            </label>
          ))}
        </div>
        {errors.category ? <FieldError id="category-error" message={errors.category} /> : null}
      </fieldset>

      {category === "unsafe" ? (
        <Alert variant="warning">
          <Phone aria-hidden="true" />
          <AlertDescription>{t("emergency")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="detail">{t("detailLabel")}</Label>
        <Textarea
          id="detail"
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          maxLength={2000}
          aria-invalid={Boolean(errors.detail)}
          aria-describedby={errors.detail ? "detail-help detail-error" : "detail-help"}
        />
        <p id="detail-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
          {t("detailHelp")}
        </p>
        {errors.detail ? <FieldError id="detail-error" message={errors.detail} /> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="reporter-name">
            {t("nameLabel")} <span className="font-normal text-[var(--color-muted-foreground)]">{t("optional")}</span>
          </Label>
          <Input
            id="reporter-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            autoComplete="name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reporter-phone">
            {t("phoneLabel")} <span className="font-normal text-[var(--color-muted-foreground)]">{t("optional")}</span>
          </Label>
          <Input
            id="reporter-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="024 123 4567"
            autoComplete="tel"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "phone-error" : undefined}
          />
          {errors.phone ? <FieldError id="phone-error" message={errors.phone} /> : null}
        </div>
      </div>
      <p className="-mt-3 text-xs leading-5 text-[var(--color-muted-foreground)]">{t("privacy")}</p>

      {/* Hidden from people; a bot that fills in every field fills this. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {failure ? (
        <Alert variant="warning" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" variant="brand" disabled={sending} className="w-full sm:w-auto">
        {sending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
        {sending ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm text-[var(--color-destructive)]">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
