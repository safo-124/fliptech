import {ArrowRight, BookOpenCheck, Building2, UserPlus, UserRound} from "lucide-react";
import Link from "next/link";

import {Button} from "@/components/ui/button";
import {BRAND} from "@/lib/brand";

export function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-[1000] border-b border-[var(--color-border)]/80">
      <div className="app-shell flex h-16 items-center justify-between gap-3 lg:h-[4.5rem]">
        <Link href="/" className="group inline-flex min-h-11 items-center gap-2.5 rounded-xl">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)] text-white shadow-sm shadow-[var(--color-brand)]/20 transition-transform group-hover:-rotate-3"
          >
            <BookOpenCheck className="size-[1.15rem]" strokeWidth={2.2} />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-tight sm:text-base">
              Skills Hub
            </span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)] sm:block">
              by {BRAND}
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1.5" aria-label="Main navigation">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/">
              Find training
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link href="/trainer/join">
              <Building2 aria-hidden />
              List your workshop
            </Link>
          </Button>
          <Button asChild variant="outline" size="default" className="px-3 sm:px-4">
            <Link href="/trainee">
              <UserRound aria-hidden />
              <span className="hidden sm:inline">My account</span>
              <span className="sm:hidden">Account</span>
            </Link>
          </Button>
          <Button asChild variant="brand" size="default" className="px-3 sm:px-4">
            <Link href="/join">
              <UserPlus aria-hidden />
              Sign up
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
