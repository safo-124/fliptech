"use client";

/**
 * The enquiry form: verify a phone number, then send.
 *
 * Section 10 requires that forms retain what was typed when a connection drops
 * mid-submit, so the draft is mirrored into sessionStorage on every change and
 * restored on mount. Losing a typed message on a flaky connection is the exact
 * moment a trainee gives up.
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { postJson } from "@/lib/api";
import type { EnquiryConfirmation } from "@/lib/types";

const DRAFT_KEY = "skillshub.enquiry.draft";

// Ghana mobile numbers: +233 followed by nine digits, or the local 0 form.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+233|0)\d{9}$/, "Enter a Ghana number, like 0241234567");

const schema = z.object({
  phone: phoneSchema,
  trainee_name: z.string().trim().max(120).optional(),
  message: z.string().trim().max(1000).optional(),
});

type FormValues = z.infer<typeof schema>;

function toE164(phone: string) {
  return phone.startsWith("0") ? `+233${phone.slice(1)}` : phone;
}

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

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: {} });
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
        { phone: toE164(values.phone) },
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
      await postJson("/api/enquiries/verify-code/", { phone: toE164(values.phone), code });
      await send(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function send(values: FormValues) {
    const confirmation = await postJson<EnquiryConfirmation>("/api/enquiries/", {
      phone: toE164(values.phone),
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
      className="max-w-xl space-y-4 p-3 lg:px-6"
      noValidate
    >
      {step === "details" ? (
        <>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium">
              Your phone number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              {...register("phone")}
              className="tap mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-base shadow-xs"
              aria-describedby="phone-help"
            />
            <p id="phone-help" className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              We send one code to check the number is yours. The provider replies on WhatsApp.
            </p>
            {formState.errors.phone && (
              <p role="alert" className="mt-1 text-sm text-[var(--color-primary)]">
                {formState.errors.phone.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="trainee_name" className="block text-sm font-medium">
              Your name <span className="font-normal text-[var(--color-muted-foreground)]">(optional)</span>
            </label>
            <input
              id="trainee_name"
              {...register("trainee_name")}
              className="tap mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-base shadow-xs"
            />
          </div>

          <div>
            <label htmlFor="message" className="block text-sm font-medium">
              Your question <span className="font-normal text-[var(--color-muted-foreground)]">(optional)</span>
            </label>
            <textarea
              id="message"
              rows={3}
              {...register("message")}
              placeholder="Do you take complete beginners?"
              className="mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] p-3 text-base shadow-xs"
            />
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="code" className="block text-sm font-medium">
            Enter the 6-digit code we sent you
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className="tap mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-center text-xl tabular-nums tracking-[0.4em] shadow-xs"
          />
          <button
            type="button"
            onClick={() => setStep("details")}
            className="tap mt-2 text-sm underline"
          >
            Change my number
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="tap w-full rounded-md bg-[var(--color-primary)] px-4 font-medium text-[var(--color-primary-foreground)] disabled:opacity-60"
      >
        {busy ? "Sending…" : step === "details" ? "Continue" : "Send enquiry"}
      </button>
    </form>
  );
}
