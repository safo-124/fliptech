/**
 * The search result card.
 *
 * Fee, duration and next intake sit on the card itself. Section 04 calls this
 * the single most important layout decision in the product: it lets someone
 * rule a provider out without a tap, which is what comparison actually means.
 * At low inventory, depth of information is the substitute for breadth of
 * choice — so none of these three may be moved behind a click.
 *
 * Two layout rules follow from that, and both matter once the cards sit in a
 * grid rather than a single column:
 *
 *  - The card is a flex column of full height with the facts row pinned to the
 *    bottom, so fee, duration and intake line up across a row. Ragged rows make
 *    the numbers hard to scan down, which defeats the point of putting them on
 *    the card. Badge text varies in length, so without this the rows drift.
 *  - The name wraps to two lines instead of truncating. It is the primary
 *    identifier, and "Accra Central Auto mechan…" is not something a trainee can
 *    compare or repeat over the phone.
 */

import Image from "next/image";
import Link from "next/link";

import { formatDate, formatDistance, formatDuration, formatFee } from "@/lib/format";
import type { ProviderCard as Card } from "@/lib/types";

import { TrustBadges } from "./TrustBadges";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-[var(--color-foreground)]">
        {value}
      </dd>
    </div>
  );
}

export function ProviderCard({ provider }: { provider: Card }) {
  const distance = formatDistance(provider.distance_m);

  return (
    <article className="card h-full transition-colors hover:border-[var(--color-muted-foreground)]/30">
      <Link
        href={`/${provider.area_slug}/${provider.slug}`}
        className="flex h-full flex-col p-4 focus-visible:outline-offset-0"
      >
        <div className="flex gap-3">
          {provider.primary_photo ? (
            <Image
              src={provider.primary_photo}
              alt=""
              width={88}
              height={88}
              className="h-20 w-20 flex-none rounded-lg object-cover"
              // Below the fold on all but the first row, and prepaid data is a
              // real cost to this user.
              loading="lazy"
              sizes="88px"
            />
          ) : (
            <div aria-hidden className="h-20 w-20 flex-none rounded-lg bg-[var(--color-muted)]" />
          )}

          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-base font-semibold leading-snug">{provider.name}</h2>
            <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">
              {provider.area}
              {distance ? ` · ${distance}` : ""}
            </p>
            <div className="mt-2">
              <TrustBadges visit={provider.site_visit} government={provider.government_status} />
            </div>
          </div>
        </div>

        {/* mt-auto pins this to the bottom so the numbers align across a row. */}
        <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-[var(--color-border)] pt-3">
          <Fact label="Fee from" value={formatFee(provider.lowest_fee)} />
          <Fact label="Duration" value={formatDuration(provider.shortest_duration_weeks)} />
          <Fact
            label="Next intake"
            value={provider.next_intake ? formatDate(provider.next_intake) : "Ask provider"}
          />
        </dl>

        {provider.is_stale && (
          <p className="mt-2 rounded-lg border border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] px-2 py-1 text-xs text-[var(--color-warn)]">
            Not confirmed recently. Check the fee before you travel.
          </p>
        )}
      </Link>
    </article>
  );
}
