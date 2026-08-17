"use client";

/**
 * Screens 4a and 4b: the enquiry form, then the confirmation.
 *
 * The confirmation carries a reference the trainee can quote on the phone, a
 * realistic expectation of when a reply will come, and the handover to
 * WhatsApp. Building a chat product to compete with the one already on every
 * phone in Ghana would be the most expensive mistake available in this project.
 */

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";

import { EnquiryForm } from "@/components/EnquiryForm";
import type { EnquiryConfirmation } from "@/lib/types";

function EnquiryFlow() {
  const params = useSearchParams();
  const programmeId = Number(params.get("programme"));
  const intakeId = params.get("intake") ? Number(params.get("intake")) : undefined;
  const [sent, setSent] = useState<EnquiryConfirmation | null>(null);

  if (!programmeId) {
    return (
      <p className="p-4 text-sm">
        Choose a course first.{" "}
        <Link href="/" className="underline">
          Back to search
        </Link>
      </p>
    );
  }

  if (sent) {
    return (
      <div className="max-w-xl p-3 lg:px-6 lg:py-8">
        <h1 className="text-xl font-bold lg:text-2xl">Enquiry sent</h1>
        <p className="mt-2 text-sm">
          {sent.provider_name} has your enquiry. Expect a reply within about{" "}
          {sent.expect_reply_within_hours} hours.
        </p>

        <p className="mt-4 rounded border border-[var(--color-line)] p-3 text-sm">
          Your reference is{" "}
          <strong className="text-base tracking-wide">{sent.reference_code}</strong>
          <span className="mt-1 block text-xs text-[var(--color-ink-soft)]">
            Quote this if you call the workshop.
          </span>
        </p>

        <a
          href={sent.whatsapp_url}
          className="tap mt-4 w-full rounded bg-[var(--color-accent)] px-4 font-semibold text-[var(--color-accent-ink)]"
        >
          Continue on WhatsApp
        </a>

        {/*
          Honest advice that also multiplies the leads flowing to the paying
          side — a rare case of the two interests pointing the same way.
        */}
        <p className="mt-6 rounded bg-[var(--color-canvas-soft)] p-3 text-sm">
          Enquire with two more providers before you decide. Fees and start dates vary a lot,
          and comparing costs you nothing.
        </p>
        <Link href="/" className="tap mt-2 inline-flex underline">
          Compare more providers
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="px-3 pt-3 text-xl font-bold lg:px-6 lg:pt-8 lg:text-2xl">Send an enquiry</h1>
      <EnquiryForm programmeId={programmeId} intakeId={intakeId} onSent={setSent} />
    </>
  );
}

export default function EnquiryPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading…</p>}>
      <EnquiryFlow />
    </Suspense>
  );
}
