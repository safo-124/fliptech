"use client";

import {
  ArrowRight,
  Award,
  GraduationCap,
  Loader2,
  PartyPopper,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { requestCertificate } from "@/lib/course-api";
import { formatCedis } from "@/lib/format";
import { TrainerApiError } from "@/lib/trainer-fetch";
import type { Certificate, CourseDetail } from "@/lib/types";

const COLOURS = [
  "var(--color-brand-violet)",
  "var(--color-brand-pink)",
  "var(--color-peach)",
  "var(--color-sand)",
  "var(--color-coral)",
  "var(--color-visit)",
];

/** The same scattered-looking numbers every time, so rendering stays pure. */
function scatter(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const PIECES = Array.from({ length: 70 }, (_, n) => ({
  left: scatter(n + 1) * 100,
  delay: scatter(n + 101) * 0.8,
  duration: 2.4 + scatter(n + 201) * 1.8,
  drift: `${(scatter(n + 301) - 0.5) * 30}vw`,
  spin: `${360 + scatter(n + 401) * 720}deg`,
  colour: COLOURS[n % COLOURS.length],
  wide: scatter(n + 501) > 0.5,
}));

/** Paper falling for a moment; nothing at all under reduced motion. */
function Confetti() {
  const pieces = PIECES;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden motion-reduce:hidden"
    >
      {pieces.map((piece, n) => (
        <span
          key={n}
          className="absolute top-0 block rounded-[2px]"
          style={
            {
              left: `${piece.left}%`,
              width: piece.wide ? 10 : 6,
              height: piece.wide ? 6 : 12,
              background: piece.colour,
              animation: `confetti-fall ${piece.duration}s cubic-bezier(.2,.6,.4,1) ${piece.delay}s forwards`,
              "--drift": piece.drift,
              "--spin": piece.spin,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * The course is finished: a moment to celebrate, the certificate, a word
 * for the trainer, and learning it in person next.
 */
export function CourseComplete({
  courseName,
  area,
  slug,
  signedIn,
  signInHref,
  certificate: initial,
  needsName,
  programmes,
  canReview,
  onReview,
  onClose,
}: {
  courseName: string;
  area: string;
  slug: string;
  signedIn: boolean;
  signInHref: string;
  certificate: Certificate | null;
  needsName: boolean;
  programmes: CourseDetail["programmes"];
  canReview: boolean;
  onReview: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("Classroom");
  const dialog = useRef<HTMLDialogElement>(null);
  const [claimed, setClaimed] = useState<Certificate | null>(null);
  const certificate = claimed ?? initial;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  async function claim(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      setClaimed(await requestCertificate(area, slug, name.trim()));
    } catch (error) {
      setProblem(
        error instanceof TrainerApiError ? error.message : t("tryAgain"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      aria-labelledby="course-done-title"
      className="m-auto w-[min(34rem,calc(100vw-2rem))] overflow-visible bg-transparent p-0 backdrop:bg-[oklch(0.2_0.06_292/0.6)] backdrop:backdrop-blur-sm"
    >
      {/* Inside the dialog, so it falls in front of the backdrop. */}
      <Confetti />
      <div className="relative max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-[var(--color-card)] shadow-2xl animate-[pop-in_0.35s_ease-out]">
        <div className="band relative isolate overflow-hidden px-6 pb-7 pt-8 text-center text-white">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={t("close")}
            className="absolute right-3 top-3 grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-[var(--color-sand)] via-[var(--color-peach)] to-[var(--color-coral)] text-[var(--color-brand-deep)] shadow-xl">
            <PartyPopper aria-hidden="true" className="size-8" />
          </span>
          <h2
            id="course-done-title"
            className="mt-4 text-2xl font-extrabold tracking-[-0.03em]"
          >
            {t("doneTitle")}
          </h2>
          <p className="mx-auto mt-1.5 max-w-[36ch] text-sm text-white/80">
            {t("doneBody", { name: courseName })}
          </p>
        </div>

        <div className="space-y-5 p-6">
          {/* ------------------------------------------------ certificate */}
          {certificate ? (
            <Link
              href={certificate.path}
              className="group flex items-center gap-4 rounded-2xl border border-[var(--color-warn)]/30 bg-gradient-to-br from-[var(--color-warn-bg)] to-[var(--color-card)] p-4 transition hover:shadow-[var(--shadow-card)]"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--color-warn)] text-white shadow">
                <Award aria-hidden="true" className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">
                  {t("certificateReady")}
                </span>
                <span className="block truncate text-sm text-[var(--color-muted-foreground)]">
                  {certificate.trainee_name} · {certificate.code}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-5 text-[var(--color-warn)] transition-transform group-hover:translate-x-1"
              />
            </Link>
          ) : !signedIn ? (
            <a
              href={signInHref}
              className="flex items-center gap-4 rounded-2xl border border-dashed border-[var(--color-border-strong)] p-4 hover:bg-[var(--color-muted)]"
            >
              <Award
                aria-hidden="true"
                className="size-8 text-[var(--color-warn)]"
              />
              <span>
                <span className="block font-bold">
                  {t("signInForCertificate")}
                </span>
                <span className="block text-sm text-[var(--color-muted-foreground)]">
                  {t("signInForCertificateBody")}
                </span>
              </span>
            </a>
          ) : needsName ? (
            <form
              onSubmit={claim}
              className="rounded-2xl border border-[var(--color-border)] p-4"
            >
              <label htmlFor="certificate-name" className="font-bold">
                {t("nameForCertificate")}
              </label>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {t("nameForCertificateHelp")}
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  id="certificate-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  autoComplete="name"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--color-input)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
                />
                <button
                  type="submit"
                  disabled={busy || name.trim().length < 2}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  ) : (
                    <Award aria-hidden="true" className="size-4" />
                  )}
                  {t("getCertificate")}
                </button>
              </div>
              {problem ? (
                <p
                  role="alert"
                  className="mt-2 text-sm text-[var(--color-destructive)]"
                >
                  {problem}
                </p>
              ) : null}
            </form>
          ) : null}

          {/* ------------------------------------------------ a review */}
          {canReview ? (
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
                onReview();
              }}
              className="flex w-full items-center gap-3 rounded-2xl bg-[var(--color-muted)] p-4 text-left hover:bg-[var(--color-secondary)]"
            >
              <Star
                aria-hidden="true"
                className="size-6 fill-[var(--color-warn)] text-[var(--color-warn)]"
              />
              <span>
                <span className="block font-bold">{t("rateCourse")}</span>
                <span className="block text-sm text-[var(--color-muted-foreground)]">
                  {t("rateCourseBody")}
                </span>
              </span>
            </button>
          ) : null}

          {/* ------------------------------------------------ in person */}
          {programmes.length ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.1em] text-[var(--color-brand)]">
                <GraduationCap aria-hidden="true" className="size-4" />
                {t("inPersonTitle")}
              </p>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {t("inPersonBody")}
              </p>
              <ul className="mt-3 space-y-2">
                {programmes.slice(0, 3).map((programme) => (
                  <li key={programme.id}>
                    <Link
                      href={`/enquiry?programme=${programme.id}`}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-3 transition hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-brand-soft)]/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">
                          {programme.title}
                        </span>
                        <span className="block text-xs text-[var(--color-muted-foreground)]">
                          {formatCedis(programme.fee)} ·{" "}
                          {t("weeks", { count: programme.duration_weeks })}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-[var(--color-brand)]">
                        {t("ask")}
                        <ArrowRight
                          aria-hidden="true"
                          className="size-4 transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
