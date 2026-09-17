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
import {
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  ImageIcon,
  MapPin,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatDate, formatDistance, formatDuration, formatFee } from "@/lib/format";
import type { ProviderCard as ProviderCardData } from "@/lib/types";

import { TrustBadges } from "./TrustBadges";

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 px-2.5 first:pl-0 last:pr-0">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </dt>
      <dd className="mt-1 text-[13px] font-semibold leading-5 tabular-nums text-[var(--color-foreground)] sm:text-sm">
        {value}
      </dd>
    </div>
  );
}

/**
 * Up to two initials from a workshop name, for a card with no imagery.
 *
 * Skips the words that are on almost every listing — "Works", "Enterprise",
 * "Ventures" and so on — because "AW" for "Accra Welding Works" identifies the
 * provider and "WW" does not.
 */
const SKIP_WORDS = new Set([
  "works",
  "workshop",
  "enterprise",
  "enterprises",
  "ventures",
  "limited",
  "ltd",
  "and",
  "the",
]);

function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const meaningful = words.filter((word) => !SKIP_WORDS.has(word.toLowerCase()));
  const chosen = (meaningful.length ? meaningful : words).slice(0, 2);
  return chosen.map((word) => word[0]!.toUpperCase()).join("");
}

export function ProviderCard({ provider }: { provider: ProviderCardData }) {
  const distance = formatDistance(provider.distance_m);

  return (
    <article className="h-full">
      <Card
        className="group h-full overflow-hidden transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30 hover:shadow-[var(--shadow-lg)]"
      >
        <Link
          href={`/${provider.area_slug}/${provider.slug}`}
          className="flex h-full flex-col p-4 focus-visible:outline-offset-[-2px] sm:p-[1.125rem]"
        >
          <div className="flex gap-3.5">
            {provider.primary_photo ? (
              <Image
                src={provider.primary_photo}
                alt=""
                width={84}
                height={84}
                className="size-[5.25rem] flex-none rounded-xl object-cover ring-1 ring-black/5"
                // Below the fold on all but the first row, and prepaid data is a
                // real cost to this user.
                loading="lazy"
                sizes="84px"
              />
            ) : provider.logo ? (
              /* No workshop photo but a logo: better than a grey placeholder,
                 and it is the mark the owner chose to be known by. object-contain
                 because a logo cropped to fill is a logo nobody recognises. */
              <Image
                src={provider.logo}
                alt=""
                width={84}
                height={84}
                className="size-[5.25rem] flex-none rounded-xl border border-[var(--color-border)] bg-white object-contain p-2"
                loading="lazy"
                sizes="84px"
              />
            ) : (
              /* Neither. The initials beat a generic icon: they are different
                 for every provider, so a column of cards stops looking like a
                 column of identical empty boxes. */
              <div
                aria-hidden="true"
                className="surface-grid grid size-[5.25rem] flex-none place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/80 text-lg font-bold tracking-tight text-[var(--color-muted-foreground)]"
              >
                {initials(provider.name) || <ImageIcon className="size-5" strokeWidth={1.7} />}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h2 className="line-clamp-2 flex-1 text-[15px] font-bold leading-snug tracking-tight sm:text-base">
                  {provider.name}
                </h2>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-secondary)] text-[var(--color-muted-foreground)] transition-colors group-hover:bg-[var(--color-brand-soft)] group-hover:text-[var(--color-brand-strong)]">
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] sm:text-sm">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {provider.area}
                  {distance ? ` · ${distance}` : ""}
                </span>
              </p>
            </div>
          </div>

          <div className="mt-3.5">
              <TrustBadges visit={provider.site_visit} government={provider.government_status} />
          </div>

          {provider.is_stale && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] px-3 py-2 text-xs leading-4 text-[var(--color-warn)]">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>Not confirmed recently. Check the fee before you travel.</span>
            </p>
          )}

          {/* mt-auto pins this to the bottom so the numbers align across a row. */}
          <dl className="mt-auto grid grid-cols-3 divide-x divide-[var(--color-border)] rounded-xl bg-[var(--color-muted)]/65 px-3 py-3.5">
            <Fact icon={WalletCards} label="Fee from" value={formatFee(provider.lowest_fee)} />
            <Fact icon={Clock3} label="Duration" value={formatDuration(provider.shortest_duration_weeks)} />
            <Fact
              icon={CalendarDays}
              label="Next intake"
              value={provider.next_intake ? formatDate(provider.next_intake) : "Ask provider"}
            />
          </dl>
        </Link>
      </Card>
    </article>
  );
}
