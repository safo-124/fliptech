/**
 * The front door: what Skills Hub is, and the three things it does.
 *
 * `/` used to be the search results. It is now the page that explains a
 * product with three parts — training, courses and a marketplace — and sends
 * people into whichever one they came for. Results live at /training.
 *
 * Two rules hold this page together.
 *
 * It tells the truth about what exists. Courses and the marketplace are built
 * into the layout because they are the plan and people need to see it, but
 * they are marked as coming rather than dressed up as live. A tile that looks
 * ready and leads nowhere costs more trust than an empty space.
 *
 * It stays a Server Component. The hero search is a plain GET form pointing
 * at /training, so the one thing anybody comes here to do works with no
 * JavaScript at all — the same rule the results page follows, and the reason
 * the site is usable on a cheap phone on a slow network.
 */

import {
  ArrowRight,
  Check,
  Clock,
  GraduationCap,
  MapPin,
  PlayCircle,
  Search,
  Store,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BrandShards } from "@/components/BrandShards";
import { ProviderCard } from "@/components/ProviderCard";
import { TradeArt } from "@/components/TradeArt";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAllAreas, getAllTrades, searchProviders } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { coverageSuffix, launchedRegionNames } from "@/lib/coverage";
import { searchRedirectTarget } from "@/lib/search-redirect";
import { tradeClass } from "@/lib/trades";

/** Long enough to be cheap, short enough that a new listing shows up today. */
export const revalidate = 300;

/** The homepage is the most-indexed URL on the site, so its title is national
    and static: a title that churned each time a region launched would keep
    resetting the longest-indexed string search engines hold. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("LandingPage");
  return {
    title: { absolute: t("metaTitle", { brand: BRAND }) },
    description: t("metaDescription"),
  };
}

/** How many workshops the front door shows before sending people to the list.
    Three fills a desktop row and costs a phone one screen, not six. */
const FEATURED = 3;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // An old `/?trade=welding` link, from a flyer or a WhatsApp share, still
  // means a search. See lib/search-redirect.
  const moved = searchRedirectTarget(await searchParams);
  if (moved) permanentRedirect(moved);

  const [trades, areas, featured, regionNames, t, tCoverage] = await Promise.all([
    // getAllTrades, not getTrades: categories are created by staff in the
    // back office, so the number is theirs to decide. The paginated call
    // would quietly stop at twenty and the twenty-first category an admin
    // added would simply never appear, with nothing to show them why.
    getAllTrades().catch(() => []),
    getAllAreas().catch(() => []),
    searchProviders({}).catch(() => null),
    launchedRegionNames(),
    getTranslations("LandingPage"),
    getTranslations("Coverage"),
  ]);

  const coverage = coverageSuffix(regionNames, tCoverage);
  const workshops = featured?.results.slice(0, FEATURED) ?? [];

  return (
    <div className="pb-14">
      {/* ------------------------------------------------------------ hero */}
      <section className="band relative isolate overflow-hidden">
        <BrandShards className="pointer-events-none absolute -right-10 -top-16 h-[22rem] w-[30rem] opacity-30" />
        <div className="app-shell relative z-10 py-10 sm:py-14 lg:py-20">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-peach)] sm:text-xs">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 max-w-[18ch] text-[2rem] font-extrabold leading-[1.1] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
            {t("headline")}
          </h1>
          <p className="mt-4 max-w-[52ch] text-sm leading-relaxed text-white/75 sm:text-base">
            {t("subhead")}
          </p>

          {/* A GET form, so the core action needs no JavaScript. The fields
              are the ones /training reads; a free-text area box would be
              dropped on arrival, so the place is a list of real areas. */}
          <form action="/training" method="get" className="mt-7 max-w-3xl">
            <div className="rounded-2xl bg-[var(--color-card)] p-2.5 shadow-[var(--shadow-lg)] sm:flex sm:items-center sm:gap-2 sm:p-3">
              <div className="flex flex-1 items-center gap-2.5 rounded-xl bg-[var(--color-muted)] px-3 sm:bg-transparent sm:px-2">
                <Search aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
                <label htmlFor="landing-q" className="sr-only">
                  {t("skillLabel")}
                </label>
                <input
                  id="landing-q"
                  name="q"
                  type="search"
                  placeholder={t("skillPlaceholder")}
                  className="h-12 w-full min-w-0 border-0 bg-transparent text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)]"
                />
              </div>

              <div className="mt-2 flex flex-1 items-center gap-2.5 rounded-xl bg-[var(--color-muted)] px-3 sm:mt-0 sm:border-l sm:border-[var(--color-border)] sm:bg-transparent sm:px-3">
                <MapPin aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
                <label htmlFor="landing-area" className="sr-only">
                  {t("placeLabel")}
                </label>
                <select
                  id="landing-area"
                  name="area"
                  defaultValue=""
                  className="h-12 w-full min-w-0 border-0 bg-transparent text-sm text-[var(--color-foreground)] outline-none"
                >
                  <option value="">{t("anywhere")}</option>
                  {areas.map((area) => (
                    <option key={area.slug} value={area.slug}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="submit" variant="brand" size="lg" className="mt-2 w-full sm:mt-0 sm:w-auto">
                {t("searchAction")}
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </form>

          {trades.length ? (
            <div className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">
                {t("popular")}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {/* The first six by the display order staff set, so which
                    trades lead the hero is an editorial choice in the back
                    office rather than something hardcoded here. */}
                {trades.slice(0, 6).map((trade) => (
                  <Link
                    key={trade.slug}
                    href={`/training?trade=${trade.slug}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-white/25 bg-white/10 px-3.5 text-[13px] font-semibold text-white transition-colors hover:border-white/45 hover:bg-white/20"
                  >
                    {trade.name}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* -------------------------------------------------------- pillars */}
      {/* Pulled up over the band's lower edge. `relative` is load-bearing:
          the hero above is positioned, so without it these cards paint
          underneath and their titles disappear into the indigo. */}
      <section className="app-shell relative z-10 -mt-6 grid gap-3.5 sm:-mt-8 md:grid-cols-3">
        <Pillar
          href="/training"
          icon={<GraduationCap aria-hidden="true" className="size-5" />}
          tone="brand"
          title={t("pillarTrainingTitle")}
          body={t("pillarTrainingBody")}
          action={t("pillarTrainingAction")}
        />
        <Pillar
          icon={<PlayCircle aria-hidden="true" className="size-5" />}
          tone="coral"
          title={t("pillarLearningTitle")}
          body={t("pillarLearningBody")}
          soon={t("soon")}
        />
        <Pillar
          icon={<Store aria-hidden="true" className="size-5" />}
          tone="dye"
          title={t("pillarMarketTitle")}
          body={t("pillarMarketBody")}
          soon={t("soon")}
        />
      </section>

      {/* ------------------------------------------------------ categories */}
      {trades.length ? (
        <section className="app-shell mt-12 sm:mt-16">
          <SectionHead
            title={t("skillsTitle")}
            body={t("skillsBody")}
            linkHref="/training"
            linkLabel={t("viewAll")}
          />
          {/* Not a column count: staff decide how many categories exist, so
              six was only ever right by accident and a seventh would have
              left two orphans on the second row.

              auto-fit rather than auto-fill. auto-fill keeps the empty
              tracks it could fit — at 1280px that laid six tiles into seven
              columns and left a gap on the right. auto-fit collapses them,
              so the tiles stretch to fill whatever row they are on.

              11rem rather than something smaller: it caps a desktop row at
              six, so eight categories fall as 6 + 2 instead of 7 + 1, and
              the tiles stay big enough for the signboard picture.

              Two fixed columns on a phone, though. 11rem does not fit twice
              in 351px, so auto-fit alone collapsed the phone to one tile per
              row and six screens of scrolling. */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            {trades.map((trade) => (
              <Link
                key={trade.slug}
                href={`/trades/${trade.slug}`}
                className={`${tradeClass(trade.colour)} group flex flex-col items-center gap-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-center transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30 hover:shadow-[var(--shadow-card)]`}
              >
                <TradeArt
                  colour={trade.colour}
                  picture={trade.picture}
                  className="size-20 sm:size-24"
                  sizes="96px"
                />
                <span className="text-[13px] font-bold leading-tight tracking-[-0.01em]">
                  {trade.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------- workshops */}
      {workshops.length ? (
        <section className="app-shell mt-12 sm:mt-16">
          <SectionHead
            title={t("workshopsTitle", { coverage })}
            // Deliberately says nothing about site visits. Most listings have
            // not had one yet and the card says so itself, in those words; a
            // heading promising "visited and checked" sat directly above two
            // cards reading "Not visited by Fliiptech".
            body={t("workshopsBody")}
            linkHref="/training"
            linkLabel={t("seeAll")}
          />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workshops.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------ coming next */}
      <section className="app-shell mt-12 sm:mt-16">
        <Card className="border-dashed p-5 sm:p-7">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
              <Clock aria-hidden="true" className="size-4" />
            </span>
            <h2 className="text-lg font-extrabold tracking-[-0.025em]">{t("comingTitle")}</h2>
          </div>
          <p className="mt-2.5 max-w-[70ch] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            {t("comingBody")}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ComingRow
              icon={<PlayCircle aria-hidden="true" className="size-4" />}
              title={t("comingLearningTitle")}
              body={t("comingLearningBody")}
            />
            <ComingRow
              icon={<Store aria-hidden="true" className="size-4" />}
              title={t("comingMarketTitle")}
              body={t("comingMarketBody")}
            />
          </div>
        </Card>
      </section>

      {/* ------------------------------------------------------- become one */}
      <section className="app-shell mt-12 sm:mt-16">
        <div className="band relative isolate overflow-hidden rounded-3xl px-6 py-9 sm:px-10 sm:py-12">
          <BrandShards className="pointer-events-none absolute -bottom-20 -left-12 h-[18rem] w-[22rem] opacity-25" />
          <div className="relative z-10 lg:flex lg:items-end lg:justify-between lg:gap-10">
            <div className="max-w-[44ch]">
              <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-white sm:text-3xl">
                {t("providerTitle")}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-white/75 sm:text-base">
                {t("providerBody")}
              </p>
              <ul className="mt-5 space-y-2">
                {[t("providerPointFree"), t("providerPointSell")].map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-white/85">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-peach)]" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <Button asChild variant="warm" size="lg" className="mt-7 w-full lg:mt-0 lg:w-auto">
              <Link href="/trainer/join">
                {t("providerAction")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * One of the three things the site does.
 *
 * `href` and `soon` are deliberately exclusive: a pillar is either somewhere
 * you can go or something that is coming, and there is no third state where
 * it looks clickable and is not.
 */
function Pillar({
  href,
  icon,
  tone,
  title,
  body,
  action,
  soon,
}: {
  href?: string;
  icon: React.ReactNode;
  tone: "brand" | "coral" | "dye";
  title: string;
  body: string;
  action?: string;
  soon?: string;
}) {
  const tones = {
    brand: "bg-[var(--color-brand-soft)] border-[var(--color-brand)]/20",
    coral: "bg-[#fbe3dc] border-[#f3cec3]",
    dye: "bg-[#d9e4f2] border-[#c3d4ea]",
  } as const;
  const badges = {
    brand: "bg-[var(--color-brand)]",
    coral: "bg-[#b5523a]",
    dye: "bg-[#0c447c]",
  } as const;

  const inner = (
    <>
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-xl text-white ${badges[tone]}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-base font-bold tracking-[-0.015em]">{title}</span>
          {soon ? (
            <span className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-card)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--color-muted-foreground)]">
              {soon}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[13px] leading-snug text-[var(--color-muted-foreground)]">
          {body}
        </span>
        {action ? (
          <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold text-[var(--color-brand-strong)]">
            {action}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
        ) : null}
      </span>
    </>
  );

  const shell = `flex items-start gap-3.5 rounded-2xl border p-4 shadow-[var(--shadow-card)] ${tones[tone]}`;

  return href ? (
    <Link href={href} className={`${shell} transition-transform hover:-translate-y-0.5`}>
      {inner}
    </Link>
  ) : (
    // Not a link and not a button: there is nowhere to go yet, and a control
    // that does nothing when tapped is worse than one that is plainly inert.
    <div className={shell}>{inner}</div>
  );
}

function SectionHead({
  title,
  body,
  linkHref,
  linkLabel,
}: {
  title: string;
  body: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="text-xl font-extrabold tracking-[-0.03em] sm:text-2xl">{title}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{body}</p>
      </div>
      <Link
        href={linkHref}
        className="text-[13px] font-bold text-[var(--color-brand-strong)] hover:underline"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

function ComingRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/35 p-3.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-card)] text-[var(--color-muted-foreground)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold tracking-[-0.01em]">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[var(--color-muted-foreground)]">
          {body}
        </span>
      </span>
    </div>
  );
}
