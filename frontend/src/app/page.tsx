/**
 * The front door: what Skills Hub is, and the three things it does.
 *
 * `/` used to be the search results. It is now the page that explains a
 * product with three parts — training, online learning and a marketplace —
 * and sends people into whichever one they came for. Results live at
 * /training.
 *
 * Three rules hold this page together.
 *
 * It tells the truth about what exists. The featured courses and products
 * are the real ones, with the real price or none; there are no ratings,
 * "bestseller" badges or baskets, because the site has none of those things
 * and a page that implies otherwise costs more trust than it earns.
 *
 * Its pictures are real. Each place is filled by a photograph staff chose
 * in the back office (core.models.HomePicture). An empty place falls back
 * to something genuinely on the site — a workshop's photograph, a course's
 * still, a product — and only then to the plain card.
 *
 * It stays a Server Component. The hero search is a plain GET form pointing
 * at /training, so the one thing anybody comes here to do works with no
 * JavaScript at all — the same rule the results page follows, and the reason
 * the site is usable on a cheap phone on a slow network.
 */

import { ArrowRight, GraduationCap, PlayCircle, ShieldCheck, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CourseTile } from "@/components/CourseTile";
import { GhanaMap } from "@/components/home/GhanaMap";
import { HeroSearch, type HeroSearchLabels } from "@/components/home/HeroSearch";
import { HomeIntakes } from "@/components/home/HomeIntakes";
import { Rail } from "@/components/home/Rail";
import { CategoryIcon } from "@/components/CategoryIcon";
import { TradeIcon } from "@/components/TradeArt";
import { ProductTile } from "@/components/marketplace/ProductTile";
import {
  getAllAreas,
  getAllTrades,
  getHomePictures,
  getSiteStats,
  getTradeCategories,
  getUpcomingIntakes,
  listCourses,
  searchProducts,
  getFeaturedShops,
  searchProviders,
} from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { searchRedirectTarget } from "@/lib/search-redirect";
import { tradeClass } from "@/lib/trades";
import type { HomePicture, HomePictures, SiteStats } from "@/lib/types";
import styles from "./page.module.css";

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
    // The one address search engines should list. The same page also
    // answers on www. and the server's old nip.io name (kept for app builds).
    alternates: { canonical: "/" },
  };
}

/** How many courses and products each row holds. The rows scroll, so this
    is how far a visitor can browse before "View all". */
const FEATURED = 10;

/** A picture for one of the page's places: staff's choice, or a stand-in. */
type Picture = { url: string; alt: string; credit?: string; caption?: string; href?: string };

function chosen(picture: HomePicture | undefined): Picture | null {
  return picture ? { url: picture.url, alt: picture.alt, credit: picture.credit } : null;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // An old `/?trade=welding` link, from a flyer or a WhatsApp share, still
  // means a search. See lib/search-redirect.
  const moved = searchRedirectTarget(await searchParams);
  if (moved) permanentRedirect(moved);

  const [trades, areas, pictures, workshops, courses, products, stats, upcoming, t, shops, categories] = await Promise.all([
    // getAllTrades, not getTrades: trades are created by staff in the
    // back office, so the number is theirs to decide.
    getAllTrades().catch(() => []),
    getAllAreas().catch(() => []),
    getHomePictures().catch((): HomePictures => ({})),
    searchProviders({}).catch(() => null),
    listCourses().catch(() => null),
    searchProducts({}).catch(() => null),
    getSiteStats().catch(() => null),
    getUpcomingIntakes(3).catch(() => []),
    getTranslations("LandingPage"),
    getFeaturedShops().catch(() => null),
    getTradeCategories().catch(() => []),
  ]);
  const featuredShops = shops?.results ?? [];
  // Categories with something in them. Until there is one, the trades
  // themselves stand in, as they did before there were categories.
  const liveCategories = categories.filter((category) => category.live);
  // The same rule as /training's area choice: only places with a workshop,
  // so every choice in "Where are you looking?" leads to results.
  const placesWithWorkshops = areas
    .filter((area) => area.provider_count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const popularTrades = trades
    .map((trade, order) => ({trade, order}))
    .filter(({trade}) => trade.provider_count > 0)
    .sort((a, b) => b.trade.provider_count - a.trade.provider_count || a.order - b.order)
    .slice(0, 6)
    .map(({trade}) => trade);

  const featuredCourses = courses?.results.slice(0, FEATURED) ?? [];
  const featuredProducts = products?.results.slice(0, FEATURED) ?? [];

  // Stand-ins, from what is genuinely on the site. A workshop's photograph is
  // captioned with the workshop, so it never reads as the face of the site.
  const workshop = workshops?.results.find((provider) => provider.primary_photo);
  const hero =
    chosen(pictures.hero) ??
    (workshop?.primary_photo
      ? {
          url: workshop.primary_photo,
          alt: "",
          caption: t("heroCaption", { name: workshop.name, area: workshop.area }),
          href: `/${workshop.area_slug}/${workshop.slug}`,
        }
      : null);
  const pins = (workshops?.results ?? []).map(({ lat, lng }) => ({ lat, lng }));
  const townCount = placesWithWorkshops.length;

  const heroLabels: HeroSearchLabels = {
    tabsLabel: t("searchTabsLabel"),
    tabs: { training: t("tabTraining"), courses: t("tabCourses"), products: t("tabProducts") },
    skillLabel: t("skillLabel"),
    placeholders: {
      training: t("skillPlaceholder"),
      courses: t("coursePlaceholder"),
      products: t("productPlaceholder"),
    },
    placeLabel: t("placeLabel"),
    anywhere: t("anywhereInGhana"),
    actions: { training: t("searchAction"), courses: t("searchCourses"), products: t("searchProducts") },
    everything: t("searchEverything", { q: "{q}" }),
  };

  return (
    <div className="pb-4">
      {/* ------------------------------------------------------------ hero */}
      <section className={styles.hero}>
        <div className={`app-shell grid items-center gap-10 py-10 sm:py-14 lg:gap-14 lg:py-16 ${hero ? "lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]" : ""}`}>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-[var(--color-muted-foreground)]">{t("eyebrow")}</p>
            <h1 className="mt-3 max-w-[17ch] text-[2.25rem] font-bold leading-[1.08] tracking-[-0.035em] text-[var(--color-brand-deep)] sm:text-5xl lg:text-[3.25rem]">
              {t("headline")}
            </h1>
            <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg">
              {t("subhead")}
            </p>

            <HeroSearch areas={placesWithWorkshops} labels={heroLabels} />

            {popularTrades.length ? (
              <div className="mt-4 flex items-start gap-2">
                <span className="shrink-0 pt-2 text-[13px] text-[var(--color-muted-foreground)]">{t("popular")}</span>
                <div className={styles.chipRow}>
                  {popularTrades.map((trade) => (
                    <Link key={trade.slug} href={`/training?trade=${trade.slug}`} className={styles.chip}>
                      {trade.name}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {hero ? (
            <HeroPicture
              picture={hero}
              visited={stats && stats.visited > 0 ? t("visitedCard", { count: stats.visited, brand: BRAND }) : null}
            />
          ) : null}
        </div>

        {/* Real counts, shown once they are big enough to reassure rather
            than to say "nearly empty". */}
        {stats ? (
          <TrustStrip stats={workshops ? { ...stats, workshops: workshops.count } : stats} t={t} />
        ) : null}
      </section>

      {/* ---------------------------------------------------------- bento */}
      <section className="app-shell mt-10 grid gap-3 sm:mt-12 md:grid-cols-[1.5fr_1fr] md:grid-rows-2">
        <Link href="/training" className={`${styles.tile} md:row-span-2 md:min-h-[22rem]`}>
          <span className={styles.tileIcon}>
            <GraduationCap aria-hidden="true" className="size-5" />
          </span>
          <span className={styles.tileTitle}>{t("pillarTrainingTitle")}</span>
          <span className={styles.tileBody}>{t("pillarTrainingBody")}</span>
          <span className={styles.tileLink}>
            {t("pillarTrainingAction")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
          {townCount >= MIN_STAT ? (
            <span className={`${styles.tileStat} mt-auto pt-6`}>
              <strong>{townCount}</strong>
              {t("statTowns", { count: townCount })}
            </span>
          ) : null}
          <GhanaMap pins={pins} className={styles.tileMap} />
        </Link>
        <Link href="/learn" className={styles.tile}>
          <span className={styles.tileIcon}>
            <PlayCircle aria-hidden="true" className="size-5" />
          </span>
          <span className={styles.tileTitle}>{t("pillarLearningTitle")}</span>
          <span className={styles.tileBody}>{t("pillarLearningBody")}</span>
          <span className={styles.tileLink}>
            {t("pillarLearningAction")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
        </Link>
        <Link href="/marketplace" className={styles.tile}>
          <span className={styles.tileIcon}>
            <ShoppingBag aria-hidden="true" className="size-5" />
          </span>
          <span className={styles.tileTitle}>{t("pillarMarketTitle")}</span>
          <span className={styles.tileBody}>{t("pillarMarketBody")}</span>
          <span className={styles.tileLink}>
            {t("pillarMarketAction")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
        </Link>
      </section>

      {/* --------------------------------------------------- starting soon */}
      {upcoming.length ? <HomeIntakes intakes={upcoming} /> : null}

      {/* ---------------------------------------------------------- courses */}
      <section className="app-shell mt-14 sm:mt-16">
        {featuredCourses.length ? (
          <Rail
            label={t("coursesTitle")}
            previous={t("previous")}
            next={t("next")}
            head={<SectionHead title={t("coursesTitle")} body={t("coursesBody")} linkHref="/learn" linkLabel={t("coursesAll")} />}
          >
            {featuredCourses.map((course) => (
              <li key={course.id}>
                <CourseTile course={course} />
              </li>
            ))}
          </Rail>
        ) : (
          <>
            <SectionHead title={t("coursesTitle")} linkHref="/learn" linkLabel={t("coursesAll")} />
            <Waiting body={t("coursesNone")} href="/trainer/dashboard#videos" action={t("coursesTeach")} />
          </>
        )}
      </section>

      {/* ------------------------------------------------------ categories */}
      {liveCategories.length || trades.length ? (
        <section id="categories" className="app-shell mt-14 scroll-mt-24 sm:mt-16">
          <SectionHead
            title={liveCategories.length ? t("categoriesTitle") : t("skillsTitle")}
            body={liveCategories.length ? t("categoriesBody") : t("skillsBody")}
            linkHref="/training"
            linkLabel={t("viewAll")}
          />
          <ul className={styles.cats}>
            {liveCategories.length
              ? liveCategories.map((category) => (
                  <li key={category.slug}>
                    <Link href={`/categories/${category.slug}`} className={styles.cat}>
                      <span className={styles.catIcon}>
                        <CategoryIcon icon={category.icon} className="size-5" />
                      </span>
                      <span className={styles.catName}>{category.name}</span>
                      <span className={styles.catCount}>{t("skillCount", { count: category.provider_count })}</span>
                    </Link>
                  </li>
                ))
              : trades.map((trade) => (
                  <li key={trade.slug}>
                    <Link href={`/trades/${trade.slug}`} className={`${tradeClass(trade.colour)} ${styles.cat}`}>
                      <span className={styles.catIcon}>
                        {trade.picture ? (
                          <Image src={trade.picture} alt="" fill sizes="40px" className="object-cover" />
                        ) : (
                          <TradeIcon colour={trade.colour} className="size-5" />
                        )}
                      </span>
                      <span className={styles.catName}>{trade.name}</span>
                      <span className={styles.catCount}>{t("skillCount", { count: trade.provider_count })}</span>
                    </Link>
                  </li>
                ))}
          </ul>
        </section>
      ) : null}

      {/* --------------------------------------------------------- products */}
      <section className="app-shell mt-14 sm:mt-16">
        {featuredProducts.length ? (
          <Rail
            label={t("productsTitle")}
            previous={t("previous")}
            next={t("next")}
            head={<SectionHead title={t("productsTitle")} body={t("productsBody")} linkHref="/marketplace" linkLabel={t("productsAll")} />}
          >
            {featuredProducts.map((product) => (
              <li key={product.id}>
                <ProductTile product={product} />
              </li>
            ))}
          </Rail>
        ) : (
          <>
            <SectionHead title={t("productsTitle")} linkHref="/marketplace" linkLabel={t("productsAll")} />
            <Waiting body={t("productsNone")} href="/sell" action={t("productsSell")} />
          </>
        )}
      </section>

      {/* --------------------------------------------------- featured shops */}
      {featuredShops.length ? (
        <section className="app-shell mt-14 sm:mt-16">
          <SectionHead title={t("shopsTitle")} linkHref="/marketplace" linkLabel={t("productsAll")} />
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {featuredShops.map((shop) => (
              <li key={shop.id}>
                <Link
                  href={`/marketplace/seller/${shop.id}`}
                  className="block overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] transition-colors hover:border-[var(--color-border-strong)]"
                >
                  <div className="relative aspect-square bg-[var(--color-muted)]">
                    {shop.photo ? (
                      <Image src={shop.photo} alt="" fill sizes="(min-width: 1024px) 16vw, 50vw" className="object-cover" />
                    ) : null}
                  </div>
                  <p className="truncate px-3 pt-2.5 text-sm font-semibold">{shop.business_name}</p>
                  <p className="truncate px-3 pb-3 text-xs text-[var(--color-muted-foreground)]">{shop.area}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------------------------------------------------- how it works */}
      <section aria-labelledby="how-heading" className="app-shell mt-14 sm:mt-16">
        <h2 id="how-heading" className="text-xl font-semibold tracking-[-0.02em] text-[var(--color-brand-deep)] sm:text-2xl">
          {t("howTitle")}
        </h2>
        <ol className="mt-5 grid gap-3 md:grid-cols-3">
          {(["Find", "Learn", "Earn"] as const).map((step, index) => (
            <li key={step} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
              <span className="grid size-7 place-items-center rounded-full bg-[var(--color-muted)] text-[13px] font-semibold tabular-nums">
                {index + 1}
              </span>
              <h3 className="mt-3 text-base font-semibold">{t(`how${step}Title`)}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--color-muted-foreground)]">{t(`how${step}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------- become one */}
      <section className="app-shell mt-14 sm:mt-16">
        <div className="rounded-2xl bg-[var(--color-brand-deep)] px-6 py-8 text-white sm:px-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="max-w-[52ch]">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">{t("providerTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/75 sm:text-base">{t("providerBody")}</p>
          </div>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row lg:mt-0 lg:shrink-0">
            <Link
              href="/trainer/join"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-white/90"
            >
              {t("providerAction")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              href="/sell"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-white/35 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              {t("providerSell")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Below this a count reads as "nearly empty", so it is left out. */
const MIN_STAT = 10;

/**
 * "38 workshops listed · 12 visited by Fliiptech · …", each only once it is
 * at least MIN_STAT. The number and its words are one list item, so a screen
 * reader reads "38 workshops listed" as one phrase.
 */
function TrustStrip({
  stats,
  t,
}: {
  stats: SiteStats;
  t: Awaited<ReturnType<typeof getTranslations<"LandingPage">>>;
}) {
  const items = [
    { count: stats.workshops, label: t("statWorkshops", { count: stats.workshops }) },
    { count: stats.visited, label: t("statVisited", { brand: BRAND }) },
    { count: stats.lessons, label: t("statLessons", { count: stats.lessons }) },
    { count: stats.products, label: t("statProducts", { count: stats.products }) },
  ].filter((item) => item.count >= MIN_STAT);
  if (items.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-border)]">
      <ul className="app-shell flex flex-wrap gap-x-8 gap-y-2 py-4">
        {items.map((item) => (
          <li key={item.label} className="flex items-baseline gap-2 text-sm text-[var(--color-muted-foreground)]">
            <strong className="text-xl font-semibold tabular-nums tracking-[-0.02em] text-[var(--color-foreground)]">
              {item.count}
            </strong>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The picture beside the search. Its credit or caption sits on it whenever
 * there is one, because a Creative Commons photograph requires it; a
 * workshop's photograph standing in says whose it is and links there.
 */
function HeroPicture({ picture, visited }: { picture: Picture; visited: string | null }) {
  return (
    <figure className="relative">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--color-muted)]">
        <Image
          src={picture.url}
          alt={picture.alt}
          fill
          priority
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-cover"
        />
        {picture.credit || picture.caption ? (
          <figcaption className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-black/55 px-2.5 py-1 text-xs text-white backdrop-blur-sm">
            {picture.href ? (
              <Link href={picture.href} className="hover:underline">
                {picture.caption}
              </Link>
            ) : (
              (picture.caption ?? picture.credit)
            )}
          </figcaption>
        ) : null}
      </div>
      {visited ? (
        <span className="absolute -bottom-4 right-4 flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3.5 py-2.5 text-[13px] font-medium shadow-[var(--shadow-lg)] sm:-left-6 sm:right-auto">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
            <ShieldCheck aria-hidden="true" className="size-4" />
          </span>
          {visited}
        </span>
      ) : null}
    </figure>
  );
}

function SectionHead({
  title,
  body,
  linkHref,
  linkLabel,
}: {
  title: string;
  body?: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-[var(--color-brand-deep)] sm:text-2xl">
          {title}
        </h2>
        {body ? <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{body}</p> : null}
      </div>
      <Link
        href={linkHref}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-brand)] hover:underline"
      >
        {linkLabel}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

/** Where a featured row would be, before there is anything to feature. */
function Waiting({ body, href, action }: { body: string; href: string; action: string }) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-[var(--color-border-strong)] p-6 text-center">
      <p className="text-sm text-[var(--color-muted-foreground)]">{body}</p>
      <Link href={href} className="mt-2 inline-block text-sm font-semibold text-[var(--color-brand)] hover:underline">
        {action}
      </Link>
    </div>
  );
}
