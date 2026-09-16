import {MapPin, ShieldCheck} from "lucide-react";
import Link from "next/link";

import {BrandMark} from "@/components/BrandMark";
import {BrandShards} from "@/components/BrandShards";
import {BRAND} from "@/lib/brand";

export function SiteFooter() {
  return (
    // Closes the page on the same indigo the header opens it with.
    <footer className="band relative isolate mt-14 overflow-hidden">
      <BrandShards className="pointer-events-none absolute -bottom-8 right-0 h-[14rem] w-[18rem] opacity-40" />
      <div className="app-shell relative z-10 grid gap-7 py-9 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:py-12">
        <div className="max-w-xl">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <p className="text-sm font-semibold text-white">
              A clearer way to choose practical training.
            </p>
          </div>
          <p className="mt-3 text-xs leading-5 text-white/60">
            Compare fees, course length and intake dates before you travel. A {BRAND} site
            visit and a government record are shown separately so you always know what was
            checked.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/60">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden /> Greater Accra
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden /> Honest verification labels
            </span>
          </div>
        </div>
        <nav className="flex gap-5 text-xs font-medium text-white/75" aria-label="Footer navigation">
          <Link href="/" className="hover:text-white hover:underline">Browse providers</Link>
          <Link href="/map" className="hover:text-white hover:underline">Explore map</Link>
          <Link href="/trainer/join" className="hover:text-white hover:underline">For trainers</Link>
          <Link href="/privacy" className="hover:text-white hover:underline">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
