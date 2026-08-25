import type {Metadata} from "next";
import {Clock3, ShieldCheck, Smartphone} from "lucide-react";

import {Badge} from "@/components/ui/badge";
import {TrainerJoinWizard} from "@/components/trainer/TrainerJoinWizard";

export const metadata: Metadata = {
  title: "List your workshop",
  description: "Create or update your Skills Hub trainer and workshop profile.",
};

export default function TrainerJoinPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="relative mb-6 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)]/80 p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -right-16 -top-20 size-48 rounded-full bg-[var(--color-brand-soft)] blur-3xl"
        />
        <div className="relative">
          <Badge variant="secondary">
            <Smartphone aria-hidden="true" />
            For trainers
          </Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
          List your workshop
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
            Create your training profile from your phone. Skills Hub staff will check the
            details before anything becomes public.
          </p>
          <div className="mt-5 grid gap-2 text-xs text-[var(--color-muted-foreground)] sm:grid-cols-3">
            <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/60 px-3 py-2.5">
              <Clock3 aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand-strong)]" />
              Quick phone setup
            </p>
            <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/60 px-3 py-2.5">
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand-strong)]" />
              Reviewed by staff
            </p>
            <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/60 px-3 py-2.5">
              <Smartphone aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand-strong)]" />
              No password needed
            </p>
          </div>
        </div>
      </header>
      <TrainerJoinWizard />
    </div>
  );
}
