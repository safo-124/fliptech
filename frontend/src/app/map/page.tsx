/**
 * Screen 2 route. The map component is loaded client-side only, because Leaflet
 * touches `window` at import time and would break the server render.
 *
 * The provider list is still fetched on the server, so the map has its data in
 * the first payload rather than after a second round trip on a 3G connection.
 *
 * On a desktop the ranked list sits beside the map rather than being replaced
 * by it. The map wins demonstrations and loses users; where there is room for
 * both, the comparison tool stays on screen.
 */

import Link from "next/link";

import { MapLoader } from "@/components/MapLoader";
import { ProviderCard } from "@/components/ProviderCard";
import { searchProviders } from "@/lib/api";

export const metadata = { title: "Map of training providers" };

export default async function MapPage() {
  const results = await searchProviders({}).catch(() => null);

  if (!results) {
    return (
      <p className="p-4 text-sm lg:px-6">
        The map could not load.{" "}
        <Link href="/" className="underline">
          Use the list view
        </Link>
        .
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 lg:px-6 lg:py-3">
        <h1 className="text-sm font-semibold lg:text-base">
          Map view · {results.count} providers
        </h1>
        <Link href="/" className="tap text-sm underline">
          Back to list
        </Link>
      </div>

      <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-4 lg:px-6">
        {/* Hidden on a phone, where the map is the whole point of this screen. */}
        <ul className="hidden max-h-[75dvh] space-y-3 overflow-y-auto pr-1 lg:block">
          {results.results.map((provider) => (
            <li key={provider.id}>
              <ProviderCard provider={provider} />
            </li>
          ))}
        </ul>

        <div className="lg:overflow-hidden lg:rounded-lg lg:border lg:border-[var(--color-line)]">
          <MapLoader providers={results.results} />
        </div>
      </div>

      <p className="max-w-prose px-3 py-3 text-xs text-[var(--color-ink-soft)] lg:px-6">
        The list view shows fee, duration and next intake on each card, which makes comparing
        easier than the map does.
      </p>
    </div>
  );
}
