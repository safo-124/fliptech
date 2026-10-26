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
import { useTranslations } from "next-intl";
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
  const t = useTranslations("EnquiryPage");
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
          <Link href="/training">
            <ArrowLeft aria-hidden="true" />
            {t("backToSearch")}
          </Link>
        </Button>
        <Card className="border-dashed text-center">
          <CardContent className="px-5 py-10 sm:px-10 sm:py-14">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
              <Search aria-hidden="true" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight">{t("chooseCourseTitle")}</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
              {t("chooseCourseBody")}
            </p>
            <Button asChild variant="brand" className="mt-6">
              <Link href="/training">
                {t("findTraining")}
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
              {t("messageReady")}
            </Badge>
            <h1
              ref={confirmationHeadingRef}
              tabIndex={-1}
              className="mt-3 text-3xl font-bold tracking-[-0.03em] outline-none sm:text-4xl"
            >
              {t("sentTitle")}
            </h1>
            <p className="mt-3 max-w-lg text-base leading-7 text-[var(--color-muted-foreground)]">
              {t.rich("sentBody", {
                provider: sent.provider_name,
                hours: sent.expect_reply_within_hours,
                strong: (chunks) => (
                  <span className="font-semibold text-[var(--color-foreground)]">{chunks}</span>
                ),
              })}
            </p>

            <div className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/70 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  {t("yourReference")}
                </p>
                <strong className="mt-1 block text-2xl tracking-[0.08em]">
                  {sent.reference_code}
                </strong>
              </div>
              <p className="mt-2 max-w-52 text-xs leading-5 text-[var(--color-muted-foreground)] sm:mt-0 sm:text-right">
                {t("quoteReference")}
              </p>
            </div>

            <Button asChild variant="brand" size="lg" className="mt-5 w-full">
              <a href={sent.whatsapp_url}>
                <MessageCircle aria-hidden="true" />
                {t("continueWhatsApp")}
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
                  <strong>{t("compareTitle")}</strong>{" "}
                  <span className="text-[var(--color-muted-foreground)]">{t("compareBody")}</span>
                </p>
              </div>
            </div>
            <Button asChild variant="ghost" className="mt-3 w-full">
              <Link href="/training">
                {t("compareMore")}
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
        <Link href="/training">
          <ArrowLeft aria-hidden="true" />
          {t("backToSearch")}
        </Link>
      </Button>

      <div className="mb-5 sm:mb-7">
        <Badge variant="secondary">
          <LockKeyhole aria-hidden="true" />
          {t("privateBadge")}
        </Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
          {t("formTitle")}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
          {t("formLead")}
        </p>
      </div>

      <Card>
        <CardContent className="p-5 sm:p-7">
          <EnquiryForm programmeId={programmeId} intakeId={intakeId} onSent={setSent} />
        </CardContent>
      </Card>

      <p className="mt-4 flex items-start justify-center gap-2 text-center text-xs leading-5 text-[var(--color-muted-foreground)]">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {t("numberSharedOnly")}
      </p>
    </EnquiryPageFrame>
  );
}

function EnquiryLoading() {
  const t = useTranslations("EnquiryPage");
  return (
    <EnquiryPageFrame>
      <div role="status" className="space-y-4" aria-label={t("loading")}>
        <Skeleton className="h-6 w-36" aria-hidden="true" />
        <Skeleton className="h-11 w-3/4" aria-hidden="true" />
        <Skeleton className="h-20 w-full" aria-hidden="true" />
        <Skeleton className="h-96 w-full" aria-hidden="true" />
        <span className="sr-only">{t("loadingEllipsis")}</span>
      </div>
    </EnquiryPageFrame>
  );
}

export default function EnquiryPage() {
  return (
    <Suspense fallback={<EnquiryLoading />}>
      <EnquiryFlow />
    </Suspense>
  );
}
