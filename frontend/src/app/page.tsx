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

import { ArrowRight, GraduationCap, MapPin, PlayCircle, Search, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CourseTile } from "@/components/CourseTile";
import { TradeArt } from "@/components/TradeArt";
import { ProductTile } from "@/components/marketplace/ProductTile";
import { Button } from "@/components/ui/button";
import {
  getAllAreas,
  getAllTrades,
  getHomePictures,
  listCourses,
  searchProducts,
  searchProviders,
} from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { searchRedirectTarget } from "@/lib/search-redirect";
import { tradeClass } from "@/lib/trades";
import type { HomePicture, HomePictures } from "@/lib/types";

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

/** How many courses and products each half of the featured row shows. Three
    fills it on a desktop and costs a phone one screen. */
const FEATURED = 3;

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

  const [trades, areas, pictures, workshops, courses, products, t] = await Promise.all([
    // getAllTrades, not getTrades: categories are created by staff in the
    // back office, so the number is theirs to decide.
    getAllTrades().catch(() => []),
    getAllAreas().catch(() => []),
    getHomePictures().catch((): HomePictures => ({})),
    searchProviders({}).catch(() => null),
    listCourses().catch(() => null),
    searchProducts({}).catch(() => null),
    getTranslations("LandingPage"),
  ]);

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
  const training =
    chosen(pictures.training) ??
    (workshop?.primary_photo ? { url: workshop.primary_photo, alt: "" } : null);
  const firstPoster = featuredCourses.find((course) => course.poster)?.poster;
  const learning = chosen(pictures.learning) ?? (firstPoster ? { url: firstPoster, alt: "" } : null);
  const firstProduct = featuredProducts.find((product) => product.photo)?.photo;
  const market =
    chosen(pictures.marketplace) ?? (firstProduct ? { url: firstProduct, alt: "" } : null);

  return (
    <div>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero-wash">
        <div className="app-shell grid items-center gap-8 py-8 sm:py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10 lg:py-14">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-brand)] sm:text-xs">
              {t("eyebrow")}
            </p>
            <h1 className="mt-3 max-w-[16ch] text-[2.1rem] font-extrabold leading-[1.05] tracking-[-0.04em] text-[var(--color-brand-deep)] sm:text-5xl lg:text-[3.4rem]">
              {t("headline")}
            </h1>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-foreground)]/75 sm:text-lg">
              {t("subhead")}
            </p>

            {/* A GET form, so the core action needs no JavaScript. The fields
                are the ones /training reads; a free-text area box would be
                dropped on arrival, so the place is a list of real areas. */}
            <form action="/training" method="get" className="mt-7">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-2.5 shadow-[var(--shadow-lg)] sm:flex sm:items-center sm:gap-2 sm:p-2">
                <div className="flex flex-1 items-center gap-2.5 rounded-xl bg-[var(--color-muted)] px-3 sm:bg-transparent sm:px-2">
                  <Search aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand)]" />
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

                <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-[var(--color-muted)] px-3 sm:mt-0 sm:w-44 sm:shrink-0 sm:border-l sm:border-[var(--color-border)] sm:bg-transparent sm:px-3">
                  <MapPin aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand)]" />
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
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--color-muted-foreground)]">
                  {t("popular")}
                </span>
                {/* The first six by the display order staff set, so which
                    trades lead the hero is an editorial choice in the back
                    office rather than something hardcoded here. */}
                {trades.slice(0, 6).map((trade) => (
                  <Link
                    key={trade.slug}
                    href={`/training?trade=${trade.slug}`}
                    className="inline-flex min-h-9 items-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-xs font-semibold transition-colors hover:border-[var(--color-brand)]/40 hover:text-[var(--color-brand)]"
                  >
                    {trade.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          {hero ? <HeroPicture picture={hero} badge={t("heroBadge")} /> : null}
        </div>
      </section>

      {/* -------------------------------------------------------- pillars */}
      <section className="app-shell mt-8 grid gap-4 sm:mt-10 md:grid-cols-3">
        <Pillar
          href="/training"
          icon={<GraduationCap aria-hidden="true" className="size-6" />}
          tone="brand"
          title={t("pillarTrainingTitle")}
          body={t("pillarTrainingBody")}
          action={t("pillarTrainingAction")}
          picture={training}
        />
        <Pillar
          href="/learn"
          icon={<PlayCircle aria-hidden="true" className="size-6" />}
          tone="coral"
          title={t("pillarLearningTitle")}
          body={t("pillarLearningBody")}
          action={t("pillarLearningAction")}
          picture={learning}
        />
        <Pillar
          href="/marketplace"
          icon={<ShoppingBag aria-hidden="true" className="size-6" />}
          tone="dye"
          title={t("pillarMarketTitle")}
          body={t("pillarMarketBody")}
          action={t("pillarMarketAction")}
          picture={market}
        />
      </section>

      {/* ------------------------------------------------------ categories */}
      {trades.length ? (
        <section className="app-shell mt-12 sm:mt-14">
          <SectionHead
            title={t("skillsTitle")}
            body={t("skillsBody")}
            linkHref="/training"
            linkLabel={t("viewAll")}
          />
          {/* auto-fit, not a column count: staff decide how many categories
              exist. 8.5rem fits eight across a desktop, as the design has
              them, and two fixed columns on a phone, where auto-fit alone
              would collapse to one tile a row. */}
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
            {trades.map((trade) => (
              <li key={trade.slug}>
                <Link
                  href={`/trades/${trade.slug}`}
                  className={`${tradeClass(trade.colour)} group block h-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30 hover:shadow-[var(--shadow-card)]`}
                >
                  <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-[var(--trade-bg)]">
                    {trade.picture ? (
                      <Image
                        src={trade.picture}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 12vw, 50vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <TradeArt colour={trade.colour} picture={null} className="size-16" />
                    )}
                  </div>
                  <span className="block px-2 py-2.5 text-center text-[13px] font-bold leading-tight tracking-[-0.01em]">
                    {trade.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------- courses and products */}
      <section className="app-shell mt-12 grid gap-10 sm:mt-14 lg:grid-cols-2 lg:gap-8">
        <div>
          <SectionHead
            title={t("coursesTitle")}
            linkHref="/learn"
            linkLabel={t("coursesAll")}
          />
          {featuredCourses.length ? (
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {featuredCourses.map((course) => (
                <li key={course.id}>
                  <CourseTile course={course} />
                </li>
              ))}
            </ul>
          ) : (
            <Waiting body={t("coursesNone")} href="/trainer/dashboard#videos" action={t("coursesTeach")} />
          )}
        </div>
        <div>
          <SectionHead
            title={t("productsTitle")}
            linkHref="/marketplace"
            linkLabel={t("productsAll")}
          />
          {featuredProducts.length ? (
            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {featuredProducts.map((product) => (
                <li key={product.id}>
                  <ProductTile product={product} />
                </li>
              ))}
            </ul>
          ) : (
            <Waiting body={t("productsNone")} href="/sell" action={t("productsSell")} />
          )}
        </div>
      </section>

      {/* ------------------------------------------------------- become one */}
      <section className="app-shell mt-12 sm:mt-14">
        <div className="hero-wash rounded-3xl border border-[var(--color-brand)]/15 px-6 py-8 sm:px-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="max-w-[52ch]">
            <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)] sm:text-3xl">
              {t("providerTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-foreground)]/75 sm:text-base">
              {t("providerBody")}
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row lg:mt-0 lg:shrink-0">
            <Button asChild variant="brand" size="lg">
              <Link href="/trainer/join">
                {t("providerAction")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/sell">{t("providerSell")}</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The large picture beside the search, with the brand's note on it.
 *
 * Its credit sits on the picture whenever there is one, because a Creative
 * Commons photograph requires it. A workshop's photograph standing in for a
 * chosen one says whose it is and links there instead.
 */
function HeroPicture({ picture, badge }: { picture: Picture; badge: string }) {
  return (
    <figure className="relative">
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-[var(--color-brand-soft)] shadow-[var(--shadow-lg)]">
        <Image
          src={picture.url}
          alt={picture.alt}
          fill
          priority
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-cover"
        />
        {picture.credit || picture.caption ? (
          <figcaption className="absolute bottom-0 left-0 max-w-full rounded-tr-xl bg-black/55 px-3 py-1.5 text-[11px] text-white">
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
      {/* A note pinned to the picture, like a sign on a workshop wall. */}
      <span
        aria-hidden="true"
        className="absolute -top-3 right-3 max-w-[9rem] -rotate-6 rounded-2xl bg-[var(--color-brand-pink)] px-4 py-2.5 text-center text-sm font-extrabold italic leading-tight text-white shadow-[var(--shadow-lg)] sm:max-w-[11rem] sm:text-lg lg:-right-3"
      >
        {badge}
      </span>
    </figure>
  );
}

/** One of the three things the site does, with its picture when it has one. */
function Pillar({
  href,
  icon,
  tone,
  title,
  body,
  action,
  picture,
}: {
  href: string;
  icon: React.ReactNode;
  tone: "brand" | "coral" | "dye";
  title: string;
  body: string;
  action: string;
  picture: Picture | null;
}) {
  const tones = {
    brand: "bg-[var(--color-brand-soft)] border-[var(--color-brand)]/20",
    coral: "bg-[#fbe3dc] border-[#f3cec3]",
    dye: "bg-[#d9e4f2] border-[#c3d4ea]",
  } as const;
  const accents = {
    brand: "bg-[var(--color-brand)]",
    coral: "bg-[#c2456a]",
    dye: "bg-[#0c447c]",
  } as const;

  return (
    <Link
      href={href}
      className={`group flex min-h-40 overflow-hidden rounded-2xl border shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 ${tones[tone]}`}
    >
      <span className="flex min-w-0 flex-1 flex-col p-5">
        <span className="flex items-center gap-3">
          <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-white ${accents[tone]}`}>
            {icon}
          </span>
          <span className="text-lg font-extrabold tracking-[-0.02em]">{title}</span>
        </span>
        <span className="mt-2 block text-[13px] leading-snug text-[var(--color-foreground)]/70">
          {body}
        </span>
        {/* Styled as a button, but the whole card is the link: one target,
            and no link inside a link. */}
        <span
          className={`mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-bold text-white ${accents[tone]}`}
        >
          {action}
          <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
      {picture ? (
        <span className="relative hidden w-[38%] shrink-0 sm:block md:hidden lg:block">
          <Image src={picture.url} alt={picture.alt} fill sizes="(min-width: 1024px) 12vw, 30vw" className="object-cover" />
        </span>
      ) : null}
    </Link>
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
        <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)] sm:text-2xl">
          {title}
        </h2>
        {body ? <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{body}</p> : null}
      </div>
      <Link
        href={linkHref}
        className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--color-brand)] hover:underline"
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
    <div className="mt-5 rounded-2xl border border-dashed border-[var(--color-border-strong)] p-6 text-center">
      <p className="text-sm text-[var(--color-muted-foreground)]">{body}</p>
      <Link href={href} className="mt-2 inline-block text-sm font-bold text-[var(--color-brand)] hover:underline">
        {action}
      </Link>
    </div>
  );
}
