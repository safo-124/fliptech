import {MapPin, ShieldCheck} from "lucide-react";
import Link from "next/link";

import {BRAND} from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-[var(--color-border)] bg-[var(--color-card)]/65">
      <div className="app-shell grid gap-7 py-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:py-10">
        <div className="max-w-xl">
          <p className="text-sm font-semibold">A clearer way to choose practical training.</p>
          <p className="mt-2 text-xs leading-5 text-[var(--color-muted-foreground)]">
            Compare fees, course length and intake dates before you travel. A {BRAND} site
            visit and a government record are shown separately so you always know what was
            checked.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--color-muted-foreground)]">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden /> Greater Accra
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden /> Honest verification labels
            </span>
          </div>
        </div>
        <nav className="flex gap-5 text-xs font-medium" aria-label="Footer navigation">
          <Link href="/" className="hover:underline">Browse providers</Link>
          <Link href="/map" className="hover:underline">Explore map</Link>
          <Link href="/trainer/join" className="hover:underline">For trainers</Link>
        </nav>
      </div>
    </footer>
  );
}
