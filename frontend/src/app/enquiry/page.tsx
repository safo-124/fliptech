"use client";

/**
 * Screens 4a and 4b: the enquiry form, then the confirmation.
 *
 * The confirmation carries a reference the trainee can quote on the phone, a
 * realistic expectation of when a reply will come, and the handover to
 * WhatsApp. Building a chat product to compete with the one already on every
 * phone in Ghana would be the most expensive mistake available in this project.
 */

import {
  ArrowLeft,
  ArrowRight,
  Check,
  LockKeyhole,
  MessageCircle,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { EnquiryForm } from "@/components/EnquiryForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { EnquiryConfirmation } from "@/lib/types";

function EnquiryPageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[calc(100dvh-12rem)] overflow-hidden pb-12">
      <div
        aria-hidden="true"
        className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[32rem] opacity-70"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-16 size-80 -translate-x-1/2 rounded-full bg-[var(--color-brand-soft)]/70 blur-3xl"
      />
      <div className="app-shell relative mx-auto max-w-2xl py-4 sm:py-8 lg:py-12">
        {children}
      </div>
    </div>
  );
}

function EnquiryFlow() {
  const params = useSearchParams();
  const programmeId = Number(params.get("programme"));
  const intakeId = params.get("intake") ? Number(params.get("intake")) : undefined;
  const [sent, setSent] = useState<EnquiryConfirmation | null>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sent) confirmationHeadingRef.current?.focus();
  }, [sent]);

  if (!programmeId) {
    return (
      <EnquiryPageFrame>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link href="/">
            <ArrowLeft aria-hidden="true" />
            Back to search
          </Link>
        </Button>
        <Card className="border-dashed text-center">
          <CardContent className="px-5 py-10 sm:px-10 sm:py-14">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
              <Search aria-hidden="true" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight">Choose a course first</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
              Open a provider, compare the available courses, then choose the one you want to
              ask about.
            </p>
            <Button asChild variant="brand" className="mt-6">
              <Link href="/">
                Find training
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </EnquiryPageFrame>
    );
  }

  if (sent) {
    return (
      <EnquiryPageFrame>
        <Card className="overflow-hidden" role="status" aria-live="polite">
          <div className="h-1.5 bg-[var(--color-visit)]" aria-hidden="true" />
          <CardContent className="px-5 py-8 sm:px-9 sm:py-10">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
              <Check className="size-7" strokeWidth={2.5} aria-hidden="true" />
            </div>
            <Badge variant="visit" className="mt-5">
              Message ready
            </Badge>
            <h1
              ref={confirmationHeadingRef}
              tabIndex={-1}
              className="mt-3 text-3xl font-bold tracking-[-0.03em] outline-none sm:text-4xl"
            >
              Enquiry sent
            </h1>
            <p className="mt-3 max-w-lg text-base leading-7 text-[var(--color-muted-foreground)]">
              <span className="font-semibold text-[var(--color-foreground)]">
                {sent.provider_name}
              </span>{" "}
              has your enquiry. Expect a reply within about {sent.expect_reply_within_hours}{" "}
              hours.
            </p>

            <div className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/70 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  Your reference
                </p>
                <strong className="mt-1 block text-2xl tracking-[0.08em]">
                  {sent.reference_code}
                </strong>
              </div>
              <p className="mt-2 max-w-52 text-xs leading-5 text-[var(--color-muted-foreground)] sm:mt-0 sm:text-right">
                Quote this reference if you call the workshop.
              </p>
            </div>

            <Button asChild variant="brand" size="lg" className="mt-5 w-full">
              <a href={sent.whatsapp_url}>
                <MessageCircle aria-hidden="true" />
                Continue on WhatsApp
              </a>
            </Button>

            <Separator className="my-7" />

            {/*
              Honest advice that also multiplies the leads flowing to the paying
              side — a rare case of the two interests pointing the same way.
            */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-4">
              <div className="flex gap-3">
                <ShieldCheck
                  className="mt-0.5 size-5 shrink-0 text-[var(--color-visit)]"
                  aria-hidden="true"
                />
                <p className="text-sm leading-6">
                  <strong>Compare before you decide.</strong>{" "}
                  <span className="text-[var(--color-muted-foreground)]">
                    Enquire with two more providers. Fees and start dates vary, and comparing
                    costs you nothing.
                  </span>
                </p>
              </div>
            </div>
            <Button asChild variant="ghost" className="mt-3 w-full">
              <Link href="/">
                Compare more providers
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </EnquiryPageFrame>
    );
  }

  return (
    <EnquiryPageFrame>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/">
          <ArrowLeft aria-hidden="true" />
          Back to search
        </Link>
      </Button>

      <div className="mb-5 sm:mb-7">
        <Badge variant="secondary">
          <LockKeyhole aria-hidden="true" />
          Private and secure
        </Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
          Send an enquiry
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
          Ask the workshop about availability, fees or anything else you need to know. We’ll
          confirm your phone number before sending.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-7">
          <EnquiryForm programmeId={programmeId} intakeId={intakeId} onSent={setSent} />
        </CardContent>
      </Card>

      <p className="mt-4 flex items-start justify-center gap-2 text-center text-xs leading-5 text-[var(--color-muted-foreground)]">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Your number is shared only so the selected provider can reply to this enquiry.
      </p>
    </EnquiryPageFrame>
  );
}

export default function EnquiryPage() {
  return (
    <Suspense
      fallback={
        <EnquiryPageFrame>
          <div role="status" className="space-y-4" aria-label="Loading enquiry form">
            <Skeleton className="h-6 w-36" aria-hidden="true" />
            <Skeleton className="h-11 w-3/4" aria-hidden="true" />
            <Skeleton className="h-20 w-full" aria-hidden="true" />
            <Skeleton className="h-96 w-full" aria-hidden="true" />
            <span className="sr-only">Loading enquiry form…</span>
          </div>
        </EnquiryPageFrame>
      }
    >
      <EnquiryFlow />
    </Suspense>
  );
}
