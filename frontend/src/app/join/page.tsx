import type {Metadata} from "next";
import {ArrowRight, Building2, GraduationCap, ShieldCheck} from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Join Skills Hub as a trainee looking for training or as a workshop that trains people.",
};

const CHOICES = [
  {
    href: "/trainee/sign-in",
    Icon: GraduationCap,
    eyebrow: "I want to learn a trade",
    title: "Sign up as a trainee",
    points: [
      "Keep all your enquiries in one place",
      "Save workshops to compare later",
      "Just your phone number, no password",
    ],
    cta: "Continue as a trainee",
  },
  {
    href: "/trainer/join",
    Icon: Building2,
    eyebrow: "I run a workshop or training centre",
    title: "Sign up as a trainer",
    points: [
      "Create your workshop profile from your phone",
      "Fliptech confirms your sign-up before anything goes public",
      "Receive enquiries from people ready to train",
    ],
    cta: "Continue as a trainer",
  },
];

/** Plain links only: this page ships no client JavaScript. */
export default function JoinPage() {
  return (
    <div className="mx-auto max-w-4xl px-3 py-8 sm:py-12 lg:px-6">
      <header className="mb-7 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
          Join Skills Hub
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">Who are you signing up as?</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
          Already have an account? Pick the same option. Signing in works the same way.
        </p>
      </header>
      <ul className="grid gap-4 md:grid-cols-2">
        {CHOICES.map(({href, Icon, eyebrow, title, points, cta}) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex h-full flex-col rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand)]/40 focus-visible:outline-2"
            >
              <span className="grid size-12 place-items-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <span className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
                {eyebrow}
              </span>
              <span className="mt-1 text-xl font-bold tracking-tight">{title}</span>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-[var(--color-muted-foreground)]">
                {points.map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
                    {point}
                  </li>
                ))}
              </ul>
              <span className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 text-sm font-semibold text-white group-hover:bg-[var(--color-brand-strong)]">
                {cta}
                <ArrowRight aria-hidden="true" className="size-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
