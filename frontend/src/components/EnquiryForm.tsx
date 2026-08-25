"use client";

/**
 * The enquiry form: verify a phone number, then send.
 *
 * Section 10 requires that forms retain what was typed when a connection drops
 * mid-submit, so the draft is mirrored into sessionStorage on every change and
 * restored on mount. Losing a typed message on a flaky connection is the exact
 * moment a trainee gives up.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  Check,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Phone,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";
import type { EnquiryConfirmation } from "@/lib/types";

const DRAFT_KEY = "skillshub.enquiry.draft";

const schema = z.object({
  phone: ghanaPhoneSchema,
  trainee_name: z.string().trim().max(120).optional(),
  message: z.string().trim().max(1000).optional(),
});

type FormValues = z.infer<typeof schema>;

export function EnquiryForm({
  programmeId,
  intakeId,
  onSent,
}: {
  programmeId: number;
  intakeId?: number;
  onSent: (confirmation: EnquiryConfirmation) => void;
}) {
  const [step, setStep] = useState<"details" | "code">("details");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: "", trainee_name: "", message: "" },
  });
  const { register, handleSubmit, getValues, reset, formState } = form;

  // Restore anything typed before a reload or a dropped connection.
  useEffect(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        reset(JSON.parse(saved));
      } catch {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    }
  }, [reset]);

  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  // Persisted from the form's own change event rather than react-hook-form's
  // watch(), whose returned function cannot be memoized safely and so forces a
  // re-subscribe on every render.
  function saveDraft() {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(getValues()));
  }

  async function requestCode(values: FormValues) {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{ verified: boolean; code_sent: boolean }>(
        "/api/enquiries/request-code/",
        { phone: toGhanaE164(values.phone) },
      );
      // Already verified in this session: no second SMS for the second and
      // third provider a trainee enquires with.
      if (result.verified) await send(values);
      else setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyThenSend(values: FormValues) {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/enquiries/verify-code/", {
        phone: toGhanaE164(values.phone),
        code,
      });
      await send(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function send(values: FormValues) {
    const confirmation = await postJson<EnquiryConfirmation>("/api/enquiries/", {
      phone: toGhanaE164(values.phone),
      programme_id: programmeId,
      ...(intakeId ? { intake_id: intakeId } : {}),
      trainee_name: values.trainee_name ?? "",
      message: values.message ?? "",
    });
    sessionStorage.removeItem(DRAFT_KEY);
    onSent(confirmation);
  }

  return (
    <form
      onSubmit={handleSubmit(step === "details" ? requestCode : verifyThenSend)}
      onChange={saveDraft}
      className="space-y-6"
      noValidate
    >
      <ol aria-label="Enquiry progress" className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <li
          aria-current={step === "details" ? "step" : undefined}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span
            className={`flex size-7 items-center justify-center rounded-full text-xs ${
              step === "details"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "bg-[var(--color-visit-bg)] text-[var(--color-visit)]"
            }`}
          >
            {step === "code" ? <Check className="size-4" aria-hidden="true" /> : "1"}
          </span>
          <span className={step === "code" ? "hidden text-[var(--color-muted-foreground)] sm:inline" : ""}>
            Your details
          </span>
        </li>
        <li aria-hidden="true" className="h-px bg-[var(--color-border)]" />
        <li
          aria-current={step === "code" ? "step" : undefined}
          className={`flex items-center gap-2 text-sm font-semibold ${
            step === "details" ? "text-[var(--color-muted-foreground)]" : ""
          }`}
        >
          <span
            className={`flex size-7 items-center justify-center rounded-full text-xs ${
              step === "code"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "bg-[var(--color-muted)]"
            }`}
          >
            2
          </span>
          Verify number
        </li>
      </ol>

      <p className="sr-only" aria-live="polite">
        {step === "details" ? "Step 1 of 2: your details" : "Step 2 of 2: verify your number"}
      </p>

      {step === "details" ? (
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
          <legend className="sr-only">Your enquiry details</legend>

          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center gap-2">
              <Phone className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
              Your phone number
              <span className="text-[var(--color-destructive)]" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="024 123 4567"
              {...register("phone")}
              aria-required="true"
              aria-invalid={formState.errors.phone ? "true" : "false"}
              aria-describedby={formState.errors.phone ? "phone-help phone-error" : "phone-help"}
            />
            <p id="phone-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
              We send one code to check the number is yours. The provider replies on WhatsApp.
            </p>
            {formState.errors.phone && (
              <p
                id="phone-error"
                role="alert"
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-destructive)]"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {formState.errors.phone.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="trainee_name" className="flex items-center gap-2">
              <UserRound className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
              Your name
              <span className="font-normal text-[var(--color-muted-foreground)]">(optional)</span>
            </Label>
            <Input
              id="trainee_name"
              autoComplete="name"
              placeholder="How the provider should address you"
              {...register("trainee_name")}
              aria-invalid={formState.errors.trainee_name ? "true" : "false"}
              aria-describedby={formState.errors.trainee_name ? "trainee-name-error" : undefined}
            />
            {formState.errors.trainee_name && (
              <p
                id="trainee-name-error"
                role="alert"
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-destructive)]"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {formState.errors.trainee_name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="message" className="flex items-center gap-2">
              <MessageCircle className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
              Your question
              <span className="font-normal text-[var(--color-muted-foreground)]">(optional)</span>
            </Label>
            <Textarea
              id="message"
              rows={3}
              {...register("message")}
              placeholder="Do you take complete beginners?"
              aria-invalid={formState.errors.message ? "true" : "false"}
              aria-describedby={formState.errors.message ? "message-help message-error" : "message-help"}
            />
            <div className="flex items-start justify-between gap-3">
              <p id="message-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                Ask about experience level, tools, schedules or payment options.
              </p>
              <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">Up to 1,000 characters</span>
            </div>
            {formState.errors.message && (
              <p
                id="message-error"
                role="alert"
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-destructive)]"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                {formState.errors.message.message}
              </p>
            )}
          </div>
        </fieldset>
      ) : (
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
          <legend className="sr-only">Verify your phone number</legend>
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/60 p-4">
            <div className="flex gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-card)] text-[var(--color-brand-strong)] shadow-xs">
                <MessageCircle className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold">Check your messages</p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  We sent a one-time code to {getValues("phone")}. It may take a few moments to
                  arrive.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Enter the 6-digit code we sent you</Label>
            <Input
              ref={codeInputRef}
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              className="h-14 text-center text-xl font-semibold tabular-nums tracking-[0.45em]"
              aria-required="true"
              aria-describedby="code-help"
            />
            <p id="code-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
              Enter numbers only. The code expires after a short time for your security.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              setCode("");
              setStep("details");
            }}
            className="-ml-3"
          >
            Change my number
          </Button>
        </fieldset>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>We couldn’t complete that step</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <Button type="submit" variant="brand" size="lg" disabled={busy} className="w-full">
          {busy ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : step === "details" ? (
            <>
              Continue
              <LockKeyhole aria-hidden="true" />
            </>
          ) : (
            <>
              <MessageCircle aria-hidden="true" />
              Send enquiry
            </>
          )}
        </Button>
        <p className="text-center text-xs leading-5 text-[var(--color-muted-foreground)]">
          {step === "details"
            ? "Next, we’ll verify your number with a one-time code."
            : "Your enquiry is sent only after the code is verified."}
        </p>
      </div>
    </form>
  );
}
