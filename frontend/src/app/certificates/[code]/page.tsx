/**
 * /certificates/<code>: a course certificate, as anyone checking it sees it.
 *
 * An employer handed a printout scans its QR code, or types the code, and
 * lands here: the name, the course, the workshop's area, when it was
 * issued, and whether it still stands. Served by Django from the record it
 * issued (backend courses/learner.py), so a printout cannot say more than
 * this page does.
 */

import { AlertTriangle, ArrowRight, BadgeCheck, Clock3, PlayCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";

import { BrandMark } from "@/components/BrandMark";
import { CertificateActions } from "@/components/learn/CertificateActions";
import { ApiError, getCertificate } from "@/lib/api";
import { BRAND } from "@/lib/brand";

type Params = { code: string };

async function load(code: string) {
  try {
    return await getCertificate(code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { code } = await params;
  const [certificate, t] = await Promise.all([load(code).catch(() => null), getTranslations("Certificate")]);
  if (!certificate) return { title: t("notFound"), robots: { index: false } };
  return {
    title: t("metaTitle", { name: certificate.trainee_name, course: certificate.course_name }),
    description: t("metaDescription", { name: certificate.trainee_name, course: certificate.course_name, brand: BRAND }),
    robots: { index: false, follow: false },
  };
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
}

export default async function CertificatePage({ params }: { params: Promise<Params> }) {
  const { code } = await params;
  const [certificate, t] = await Promise.all([load(code), getTranslations("Certificate")]);
  if (!certificate) notFound();

  const address = `${siteUrl()}/certificates/${certificate.code}`;
  const qr = await QRCode.toString(address, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#2a1a5e", light: "#0000" },
  });
  const issued = new Date(certificate.issued_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hours = certificate.total_seconds / 3600;

  return (
    <div className="certificate-page pb-14 pt-6 sm:pt-10">
      <div className="app-shell mx-auto max-w-5xl">
        {certificate.is_revoked ? (
          <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 p-4 text-sm print:hidden">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--color-destructive)]" />
            <p>
              <strong>{t("revokedTitle")}</strong> {t("revokedBody", { brand: BRAND })}
            </p>
          </div>
        ) : (
          <div className="mb-5 flex items-center gap-3 rounded-2xl bg-[var(--color-visit-bg)] p-4 text-sm text-[var(--color-visit)] print:hidden">
            <BadgeCheck aria-hidden="true" className="size-5 shrink-0" />
            <p className="font-semibold">{t("genuine", { brand: BRAND })}</p>
          </div>
        )}

        {/* ---------------------------------------------------- the paper */}
        <article
          aria-label={t("label", { name: certificate.trainee_name })}
          className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[var(--color-brand-violet)] via-[var(--color-brand)] to-[var(--color-brand-pink)] p-[3px] shadow-[var(--shadow-lg)] print:rounded-none print:shadow-none"
        >
          <div className="relative overflow-hidden rounded-[calc(2rem-3px)] bg-[oklch(0.993_0.008_85)] px-6 py-10 sm:px-14 sm:py-14 print:rounded-none">
            <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-[var(--color-peach)]/25 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -right-20 size-80 rounded-full bg-[var(--color-brand-violet)]/15 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-4 rounded-[1.6rem] border border-[var(--color-brand)]/15 sm:inset-6" />

            <div className="relative flex flex-col items-center text-center">
              <div className="flex items-center gap-2.5">
                <BrandMark className="size-10" />
                <span className="text-lg font-extrabold tracking-[-0.02em] text-[var(--color-brand-deep)]">{BRAND}</span>
              </div>
              <p className="mt-8 text-xs font-extrabold uppercase tracking-[0.32em] text-[var(--color-brand)]">
                {t("heading")}
              </p>
              <p className="mt-6 text-sm text-[var(--color-muted-foreground)]">{t("certifies")}</p>
              <h1 className="mt-2 bg-gradient-to-r from-[var(--color-brand-deep)] via-[var(--color-brand)] to-[var(--color-brand-deep)] bg-clip-text font-serif text-4xl font-bold italic tracking-[-0.01em] text-transparent sm:text-6xl">
                {certificate.trainee_name}
              </h1>
              <span aria-hidden="true" className="mt-4 h-px w-48 bg-gradient-to-r from-transparent via-[var(--color-brand)]/40 to-transparent" />
              <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">{t("completed")}</p>
              <p className="mt-2 max-w-[28ch] text-2xl font-extrabold leading-tight tracking-[-0.02em] text-[var(--color-brand-deep)] sm:text-3xl">
                {certificate.course_name}
              </p>
              <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-[var(--color-foreground)]/75">
                {certificate.trade_name ? <span>{certificate.trade_name}</span> : null}
                {certificate.area_name ? <span>{certificate.area_name}</span> : null}
                <span className="inline-flex items-center gap-1">
                  <PlayCircle aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                  {t("lessons", { count: certificate.lessons })}
                </span>
                {hours > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock3 aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                    {hours >= 1 ? t("hours", { hours: hours.toFixed(1) }) : t("minutes", { minutes: Math.max(1, Math.round(hours * 60)) })}
                  </span>
                ) : null}
              </p>

              <div className="mt-10 grid w-full gap-6 sm:grid-cols-3 sm:items-end">
                <div className="text-center sm:text-left">
                  <p className="text-sm font-bold text-[var(--color-brand-deep)]">{issued}</p>
                  <p className="mt-1 border-t border-[var(--color-brand)]/20 pt-1 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                    {t("issued")}
                  </p>
                </div>
                <div className="mx-auto grid size-24 place-items-center rounded-full bg-gradient-to-br from-[var(--color-sand)] via-[var(--color-peach)] to-[var(--color-coral)] text-[var(--color-brand-deep)] shadow-lg ring-4 ring-white">
                  <span className="grid size-[5.2rem] place-items-center rounded-full border-2 border-dashed border-[var(--color-brand-deep)]/30 text-center">
                    <span>
                      <BadgeCheck aria-hidden="true" className="mx-auto size-7" />
                      <span className="mt-0.5 block text-[9px] font-extrabold uppercase leading-tight tracking-wider">
                        {t("seal")}
                      </span>
                    </span>
                  </span>
                </div>
                <div className="flex items-end justify-center gap-3 sm:justify-end">
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold tracking-[0.15em] text-[var(--color-brand-deep)]">
                      {certificate.code}
                    </p>
                    <p className="mt-1 border-t border-[var(--color-brand)]/20 pt-1 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      {t("checkCode")}
                    </p>
                  </div>
                  <span
                    role="img"
                    aria-label={t("qrLabel")}
                    className="block size-20 rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-black/5 [&>svg]:size-full"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                </div>
              </div>
            </div>
          </div>
        </article>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <CertificateActions
            url={address}
            labels={{
              print: t("print"),
              share: t("share"),
              copied: t("copied"),
              shareText: t("shareText", { course: certificate.course_name, brand: BRAND }),
            }}
          />
          <Link
            href={certificate.course_path}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--color-brand)] hover:underline"
          >
            {t("seeCourse")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <p className="mt-4 max-w-[70ch] text-xs leading-relaxed text-[var(--color-muted-foreground)] print:hidden">
          {t("about", { brand: BRAND })}
        </p>
      </div>
    </div>
  );
}
