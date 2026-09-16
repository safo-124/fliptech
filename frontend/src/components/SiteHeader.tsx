import {ArrowRight, Building2, UserPlus, UserRound} from "lucide-react";
import Link from "next/link";

import {BrandMark} from "@/components/BrandMark";
import {BrandShards} from "@/components/BrandShards";
import {Button} from "@/components/ui/button";
import {BRAND} from "@/lib/brand";

/**
 * The indigo band from the logo, carrying the brand on every page.
 *
 * Deliberately a band rather than a dark theme. The canvas, the result cards
 * and the map stay light because the trainee reading this is outdoors in
 * direct sun, which is the reason globals.css pins `color-scheme: light`.
 * Indigo at the top and bottom gives the site a brand without taking that back.
 *
 * The one filled action is warm, not violet: on an indigo field another violet
 * button vanishes, and sand-to-coral is the contrast the logo already makes.
 */
export function SiteHeader() {
  return (
    <header className="band sticky top-0 isolate z-[1000] overflow-hidden">
      {/* Small and low-contrast here: the header is 4rem tall and the nav sits
          on top of it, so the shards only need to break the flat indigo. */}
      <BrandShards className="pointer-events-none absolute -right-4 -top-6 h-[9rem] w-[16rem] opacity-25" />
      <div className="app-shell relative z-10 flex h-16 items-center justify-between gap-3 lg:h-[4.5rem]">
        <Link
          href="/"
          className="group inline-flex min-h-11 items-center gap-2.5 rounded-xl text-white"
        >
          <BrandMark className="size-9 transition-transform duration-500 group-hover:rotate-90" />
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-tight sm:text-base">
              Skills Hub
            </span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-white/60 sm:block">
              by {BRAND}
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1.5" aria-label="Main navigation">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden text-white/75 hover:bg-white/10 hover:text-white sm:inline-flex"
          >
            <Link href="/">
              Find training
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden text-white/75 hover:bg-white/10 hover:text-white md:inline-flex"
          >
            <Link href="/trainer/join">
              <Building2 aria-hidden />
              List your workshop
            </Link>
          </Button>
          <Button asChild variant="onBand" size="default" className="px-3 sm:px-4">
            <Link href="/trainee">
              <UserRound aria-hidden />
              <span className="hidden sm:inline">My account</span>
              <span className="sm:hidden">Account</span>
            </Link>
          </Button>
          <Button asChild variant="warm" size="default" className="px-3 sm:px-4">
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
