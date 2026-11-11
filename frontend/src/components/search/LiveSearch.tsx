"use client";

import {
  ArrowRight,
  BellRing,
  Check,
  Clock,
  GraduationCap,
  Loader2,
  LocateFixed,
  MapPin,
  PlayCircle,
  Search,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { TradeIcon } from "@/components/TradeArt";
import { formatCedis, formatDate } from "@/lib/format";
import { keepTrainingAlert, searchEverything } from "@/lib/search-api";
import { openSignIn } from "@/lib/sign-in";
import { tradeClass } from "@/lib/trades";
import styles from "./search.module.css";
import type { ProviderCard, SearchTrade, SiteSearch } from "@/lib/types";

/** Wait this long after a key before searching: one request per pause, not per letter. */
const TYPE_DELAY_MS = 180;
/** And this long before counting it in the staff report: the search they settled on. */
const LOG_DELAY_MS = 1500;
const RECENT_KEY = "fliptech.recent-searches";

const RECENT_EVENT = "fliptech:recent-searches";

function parseRecent(raw: string): string[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((item) => typeof item === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function recentSnapshot() {
  try {
    return localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribeRecent(changed: () => void) {
  window.addEventListener(RECENT_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(RECENT_EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}

function writeRecent(list: string[]) {
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    else localStorage.removeItem(RECENT_KEY);
  } catch {
    // Private mode: recent searches are a convenience.
  }
  window.dispatchEvent(new Event(RECENT_EVENT));
}

function remember(q: string) {
  const list = parseRecent(recentSnapshot());
  writeRecent([q, ...list.filter((item) => item !== q)].slice(0, 6));
}

type Popular = (SearchTrade & { provider_count: number })[];

export function LiveSearch({
  initialQuery,
  initialResults,
  popular,
}: {
  initialQuery: string;
  initialResults: SiteSearch | null;
  popular: Popular;
}) {
  const t = useTranslations("SiteSearch");
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SiteSearch | null>(initialResults);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The browser's own list, read after hydration (the server has none).
  const recentRaw = useSyncExternalStore(subscribeRecent, recentSnapshot, () => "[]");
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<"idle" | "finding" | "refused">("idle");
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const logTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (q: string, where: { lat: number; lng: number } | null) => {
      pending.current?.abort();
      if (logTimer.current) clearTimeout(logTimer.current);
      const trimmed = q.trim();
      const url = new URL(window.location.href);
      if (trimmed) url.searchParams.set("q", trimmed);
      else url.searchParams.delete("q");
      window.history.replaceState(null, "", url.toString());
      if (!trimmed) {
        setResults(null);
        setBusy(false);
        return;
      }
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        const found = await searchEverything(trimmed, { ...where, signal: controller.signal });
        setResults(found);
        setFailed(false);
        logTimer.current = setTimeout(() => {
          void searchEverything(trimmed, { ...where, log: true }).catch(() => undefined);
          remember(trimmed);
        }, LOG_DELAY_MS);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (pending.current === controller) setBusy(false);
      }
    },
    [],
  );

  // Search as the visitor types, a moment after each key.
  useEffect(() => {
    if (query === (results?.q ?? "") && !near) return;
    const timer = setTimeout(() => void run(query, near), TYPE_DELAY_MS);
    return () => clearTimeout(timer);
    // results is read only to skip the first, server-rendered search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, near, run]);

  function locate() {
    if (near) {
      setNear(null);
      return;
    }
    if (!navigator.geolocation) {
      setLocating("refused");
      return;
    }
    setLocating("finding");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating("idle");
        setNear({ lat: coords.latitude, lng: coords.longitude });
      },
      () => setLocating("refused"),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  }

  function choose(q: string) {
    setQuery(q);
    input.current?.focus();
  }

  const empty =
    results &&
    !results.workshops.count &&
    !results.courses.count &&
    !results.products.count &&
    !results.shops.count;

  return (
    <div>
      {/* The box. A real form, so Enter (and a phone with no JavaScript yet)
          still searches: the server renders the same results. */}
      <form
        action="/search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void run(query, near);
          input.current?.blur();
        }}
        className="relative"
      >
        <label htmlFor="site-search" className="sr-only">
          {t("label")}
        </label>
        <div className={`${styles.box} flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-[var(--shadow-lg)]`}>
          <span className="grid size-10 shrink-0 place-items-center text-[var(--color-brand)]">
            {busy ? (
              <Loader2 aria-hidden="true" className="size-5 animate-spin" />
            ) : (
              <Search aria-hidden="true" className="size-5" />
            )}
          </span>
          <input
            ref={input}
            id="site-search"
            name="q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("placeholder")}
            autoComplete="off"
            autoFocus
            enterKeyHint="search"
            className={`${styles.input} min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--color-muted-foreground)]`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => choose("")}
              aria-label={t("clear")}
              className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={locate}
            aria-pressed={Boolean(near)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors ${
              near
                ? "bg-[var(--color-brand)] text-white"
                : "text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)]"
            }`}
          >
            {locating === "finding" ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <LocateFixed aria-hidden="true" className="size-4" />
            )}
            <span className={styles.nearLabel}>
              {locating === "finding" ? t("finding") : near ? t("nearMeOn") : t("nearMe")}
            </span>
          </button>
        </div>
        <p aria-live="polite" className="sr-only">
          {busy ? t("searching") : ""}
        </p>
        {locating === "refused" ? (
          <p role="status" className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            {t("refused")}
          </p>
        ) : null}
      </form>

      {failed ? (
        <p role="alert" className="mt-6 rounded-2xl bg-[var(--color-warn-bg)] p-4 text-sm text-[var(--color-warn)]">
          {t("offline")}
        </p>
      ) : null}

      {!query.trim() ? (
        <Starters popular={popular} recent={recent} onChoose={choose} onClearRecent={() => writeRecent([])} />
      ) : results ? (
        <div className={`mt-6 space-y-10 transition-opacity ${busy ? styles.dim : ""}`}>
          <Understood results={results} />
          {results.trades.length ? <TradeRow trades={results.trades} /> : null}
          {empty || (!results.workshops.count && results.understood.trade) ? (
            <Nothing results={results} popular={popular} onChoose={choose} nothing={Boolean(empty)} />
          ) : null}
          <Workshops results={results} />
          <Courses results={results} />
          <Products results={results} />
          <Shops results={results} />
        </div>
      ) : null}
    </div>
  );
}

function Starters({
  popular,
  recent,
  onChoose,
  onClearRecent,
}: {
  popular: Popular;
  recent: string[];
  onChoose: (q: string) => void;
  onClearRecent: () => void;
}) {
  const t = useTranslations("SiteSearch");
  return (
    <div className="mt-8 space-y-8">
      {recent.length ? (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[var(--color-muted-foreground)]">{t("recent")}</h2>
            <button type="button" onClick={onClearRecent} className="text-sm font-semibold text-[var(--color-brand)]">
              {t("clearRecent")}
            </button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {recent.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => onChoose(item)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 text-sm font-semibold hover:border-[var(--color-brand)]/40"
                >
                  <Clock aria-hidden="true" className="size-4 text-[var(--color-muted-foreground)]" />
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {popular.length ? (
        <section>
          <h2 className="text-sm font-bold text-[var(--color-muted-foreground)]">{t("popular")}</h2>
          <TradeRow trades={popular} />
        </section>
      ) : null}
      <p className="text-sm text-[var(--color-muted-foreground)]">{t("tips")}</p>
    </div>
  );
}

function Understood({ results }: { results: SiteSearch }) {
  const t = useTranslations("SiteSearch");
  const { trade, area } = results.understood;
  if (!trade && !area) return null;
  const what = trade && area ? t("tradeIn", { trade: trade.name, area: area.name }) : (trade?.name ?? area?.name);
  return (
    <p className="text-sm text-[var(--color-muted-foreground)]">
      {t.rich("understood", {
        what: what ?? "",
        b: (chunks) => <strong className="font-bold text-[var(--color-brand-deep)]">{chunks}</strong>,
      })}
    </p>
  );
}

function TradeRow({ trades }: { trades: (SearchTrade & { provider_count: number })[] }) {
  const t = useTranslations("SiteSearch");
  return (
    <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {trades.map((trade) => (
        <li key={trade.slug}>
          <Link
            href={`/training?trade=${trade.slug}`}
            className={`${tradeClass(trade.colour)} ${styles.tradeLink} group flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3`}
          >
            <span className={`${styles.tradeIcon} grid size-11 shrink-0 place-items-center rounded-xl text-[var(--trade-fg)]`}>
              <TradeIcon colour={trade.colour} className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-[var(--color-brand-deep)]">{trade.name}</span>
              <span className="block text-xs text-[var(--color-muted-foreground)]">
                {t("workshopCount", { count: trade.provider_count })}
              </span>
            </span>
            <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-muted-foreground)] transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SectionHead({
  icon: Icon,
  title,
  count,
  href,
}: {
  icon: typeof Search;
  title: string;
  count: number;
  href: string;
}) {
  const t = useTranslations("SiteSearch");
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--color-brand-deep)]">
        <Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {title}
      </h2>
      <Link href={href} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-[var(--color-brand)]">
        {t("seeAll", { count })}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

function trainingHref(results: SiteSearch) {
  const { trade, area } = results.understood;
  if (trade || area) {
    const query = new URLSearchParams();
    if (trade) query.set("trade", trade.slug);
    if (area) query.set("area", area.slug);
    return `/training?${query.toString()}`;
  }
  return `/training?q=${encodeURIComponent(results.q)}`;
}

function WorkshopCard({ provider }: { provider: ProviderCard }) {
  const t = useTranslations("SiteSearch");
  const facts = [
    provider.lowest_fee ? t("fromFee", { fee: formatCedis(provider.lowest_fee) }) : null,
    provider.next_intake ? t("starts", { date: formatDate(provider.next_intake) }) : null,
    provider.distance_m != null ? t("kmAway", { km: (provider.distance_m / 1000).toFixed(1) }) : null,
  ].filter(Boolean);
  return (
    <Link
      href={`/${provider.area_slug}/${provider.slug}`}
      className="group flex h-full gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <span className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[var(--color-muted)]">
        {provider.primary_photo ? (
          <Image src={provider.primary_photo} alt="" fill sizes="80px" className="object-cover" />
        ) : provider.trade ? (
          <span className={`${tradeClass(provider.trade.colour)} grid size-full place-items-center text-[var(--trade-fg)]`}>
            <TradeIcon colour={provider.trade.colour} className="size-7" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`${styles.name} block font-bold leading-snug text-[var(--color-brand-deep)]`}>
          {provider.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-sm text-[var(--color-muted-foreground)]">
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          {provider.area}
          {provider.trade ? ` · ${provider.trade.name}` : ""}
        </span>
        {facts.length ? (
          <span className="mt-1.5 block text-xs font-semibold text-[var(--color-foreground)]/80">{facts.join(" · ")}</span>
        ) : null}
      </span>
    </Link>
  );
}

function Workshops({ results }: { results: SiteSearch }) {
  const t = useTranslations("SiteSearch");
  if (!results.workshops.count) return null;
  return (
    <section>
      <SectionHead icon={GraduationCap} title={t("workshops")} count={results.workshops.count} href={trainingHref(results)} />
      <ul className={styles.cards}>
        {results.workshops.results.map((provider) => (
          <li key={provider.id}>
            <WorkshopCard provider={provider} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Courses({ results }: { results: SiteSearch }) {
  const t = useTranslations("SiteSearch");
  if (!results.courses.count) return null;
  const href = results.understood.trade
    ? `/learn?trade=${results.understood.trade.slug}`
    : `/learn?q=${encodeURIComponent(results.q)}`;
  return (
    <section>
      <SectionHead icon={PlayCircle} title={t("courses")} count={results.courses.count} href={href} />
      <ul className={styles.tiles}>
        {results.courses.results.map((course) => (
          <li key={course.id}>
            <Link href={`/learn/${course.area_slug}/${course.slug}`} className="group block">
              <span className="relative block aspect-video overflow-hidden rounded-xl bg-[var(--color-muted)]">
                {course.poster ? (
                  <Image src={course.poster} alt="" fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : null}
                <PlayCircle aria-hidden="true" className="absolute bottom-2 left-2 size-6 text-white drop-shadow" />
              </span>
              <span className="mt-2 block text-sm font-bold leading-snug text-[var(--color-brand-deep)]">{course.name}</span>
              <span className="block text-xs text-[var(--color-muted-foreground)]">
                {t("lessons", { count: course.lessons })} · {course.price ? formatCedis(course.price) : t("free")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Products({ results }: { results: SiteSearch }) {
  const t = useTranslations("SiteSearch");
  if (!results.products.count) return null;
  return (
    <section>
      <SectionHead
        icon={ShoppingBag}
        title={t("products")}
        count={results.products.count}
        href={`/marketplace?q=${encodeURIComponent(results.understood.words || results.q)}${
          results.understood.trade ? `&trade=${results.understood.trade.slug}` : ""
        }`}
      />
      <ul className={styles.tiles}>
        {results.products.results.map((product) => (
          <li key={product.id}>
            <Link href={`/marketplace/${product.id}`} className="group block">
              <span className="relative block aspect-square overflow-hidden rounded-xl bg-[var(--color-muted)]">
                {product.photo ? (
                  <Image src={product.photo} alt="" fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : null}
              </span>
              <span className="mt-2 block text-sm font-bold leading-snug text-[var(--color-brand-deep)]">{product.name}</span>
              <span className="block text-sm font-extrabold">
                {product.price ? formatCedis(product.price) : t("priceOnRequest")}
              </span>
              <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{product.seller.business_name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Shops({ results }: { results: SiteSearch }) {
  const t = useTranslations("SiteSearch");
  if (!results.shops.count) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--color-brand-deep)]">
        <Store aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {t("shops")}
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {results.shops.results.map((shop) => (
          <li key={shop.id}>
            <Link
              href={`/marketplace/seller/${shop.id}`}
              className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 hover:border-[var(--color-brand)]/40"
            >
              <span className="grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                <Store aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-bold text-[var(--color-brand-deep)]">{shop.business_name}</span>
                <span className="block text-xs text-[var(--color-muted-foreground)]">{shop.area}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Nothing({
  results,
  popular,
  onChoose,
  nothing,
}: {
  results: SiteSearch;
  popular: Popular;
  onChoose: (q: string) => void;
  /** Nothing at all, rather than no workshop for the trade. */
  nothing: boolean;
}) {
  const t = useTranslations("SiteSearch");
  const { trade, area } = results.understood;
  return (
    <section className="rounded-3xl border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-5 sm:p-7">
      <h2 className="text-xl font-extrabold tracking-tight text-[var(--color-brand-deep)]">
        {nothing
          ? t("nothingTitle", { q: results.q })
          : area
            ? t("noWorkshopIn", { trade: trade!.name.toLowerCase(), area: area.name })
            : t("noWorkshop", { trade: trade!.name.toLowerCase() })}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        {nothing ? t("nothingBody") : t("noWorkshopBody")}
      </p>
      {trade ? <AlertButton trade={trade} area={area} /> : null}
      {results.nearby.length && trade ? (
        <div className="mt-6">
          <h3 className="text-sm font-bold">
            {area && nothing
              ? t("nearbyTitle", { trade: trade.name.toLowerCase(), area: area.name })
              : t("nearbyAnywhere", { trade: trade.name.toLowerCase() })}
          </h3>
          <ul className={`mt-3 ${styles.cards}`}>
            {results.nearby.map((provider) => (
              <li key={provider.id}>
                <WorkshopCard provider={provider} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {nothing && !trade && popular.length ? <TradeRow trades={popular} /> : null}
      {results.trades_here.length && area ? (
        <div className="mt-6">
          <h3 className="text-sm font-bold">{t("tradesHere", { area: area.name })}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {results.trades_here.map((here) => (
              <li key={here.slug}>
                <button
                  type="button"
                  onClick={() => onChoose(`${here.name} ${area.name}`)}
                  className="inline-flex min-h-10 items-center rounded-full border border-[var(--color-border)] px-4 text-sm font-semibold hover:border-[var(--color-brand)]/40"
                >
                  {here.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** "Text me when one opens", for a trade (and place) that has no workshop yet. */
export function AlertButton({ trade, area }: { trade: SearchTrade; area: { slug: string; name: string } | null }) {
  const t = useTranslations("SiteSearch");
  const [state, setState] = useState<"idle" | "busy" | "saved" | "signin" | "failed">("idle");

  async function keep() {
    setState("busy");
    try {
      await keepTrainingAlert(trade.slug, area?.slug);
      setState("saved");
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        // Sign in here, then save it: no trip to another page.
        if (await openSignIn({ interest: "learn" })) return keep();
        setState("signin");
      } else setState("failed");
    }
  }

  if (state === "saved") {
    return (
      <p className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-visit)]">
        <Check aria-hidden="true" className="size-4" />
        {t("alertSaved", { trade: trade.name.toLowerCase() })}
      </p>
    );
  }
  if (state === "signin") {
    return (
      <p className="mt-4 text-sm">
        {t("alertSignIn")}{" "}
        <button type="button" onClick={() => void keep()} className="font-semibold text-[var(--color-brand)] underline">
          {t("alertSignInLink")}
        </button>
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void keep()}
        disabled={state === "busy"}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-70"
      >
        {state === "busy" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <BellRing aria-hidden="true" className="size-4" />}
        {area ? t("alertActionIn", { area: area.name }) : t("alertAction")}
      </button>
      {state === "failed" ? <span className="text-sm text-[var(--color-destructive)]">{t("alertFailed")}</span> : null}
    </div>
  );
}
