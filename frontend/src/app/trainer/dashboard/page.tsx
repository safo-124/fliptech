import type {Metadata} from "next";
import {ArrowRight, LayoutDashboard} from "lucide-react";
import Link from "next/link";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {TrainerDashboard} from "@/components/trainer/TrainerDashboard";

export const metadata: Metadata = {
  title: "Trainer dashboard",
  description: "View your Skills Hub workshop profile and review status.",
};

export default function TrainerDashboardPage() {
  return (
    <>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="secondary">
            <LayoutDashboard aria-hidden="true" />
            Trainer workspace
          </Badge>
          <h1 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
            Your trainer dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
            Track your listing status and keep your public workshop details accurate.
          </p>
        </div>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/trainer/join">
            List or update workshop
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </header>
      <TrainerDashboard />
    </>
  );
}
