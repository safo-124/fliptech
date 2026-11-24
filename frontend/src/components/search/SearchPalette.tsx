"use client";

import {ArrowRight, GraduationCap, Loader2, PlayCircle, Search, ShoppingBag, Store, Tag} from "lucide-react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useId, useRef, useState} from "react";

import {searchEverything} from "@/lib/search-api";
import type {SiteSearch} from "@/lib/types";

/**
 * The header's search, as a panel over the page: type, see workshops,
 * courses, products and trades as you go, pick one with the arrows or the
 * mouse. Enter with nothing picked opens the full results at /search.
 *
 * The button is still a link to /search, so without JavaScript (or with a
 * modifier key, to open a new tab) it does what it always did. Ctrl+K or ⌘K
 * opens the panel from anywhere.
 *
 * Labels come as props, so pages ship no message catalogue for it.
 */
export type SearchPaletteLabels = {
  open: string;
  pill: string;
  placeholder: string;
  close: string;
  trades: string;
  workshops: string;
  courses: string;
  products: string;
  shops: string;
  everything: string;
  empty: string;
  failed: string;
  hint: string;
};

type Item = {key: string; href: string; title: string; sub: string; icon: React.ReactNode};

const TYPE_DELAY_MS = 180;

function groups(results: SiteSearch, labels: SearchPaletteLabels): {label: string; items: Item[]}[] {
  const icon = "size-4";
  return [
    {
      label: labels.trades,
      items: results.trades.slice(0, 3).map((trade) => ({
        key: `t-${trade.slug}`,
        href: `/training?trade=${trade.slug}`,
        title: trade.name,
        sub: "",
        icon: <Tag aria-hidden="true" className={icon} />,
      })),
    },
    {
      label: labels.workshops,
      items: results.workshops.results.slice(0, 4).map((workshop) => ({
        key: `w-${workshop.id}`,
        href: `/${workshop.area_slug}/${workshop.slug}`,
        title: workshop.name,
        sub: workshop.area,
        icon: <GraduationCap aria-hidden="true" className={icon} />,
      })),
    },
    {
      label: labels.courses,
      items: results.courses.results.slice(0, 3).map((course) => ({
        key: `c-${course.id}`,
        href: `/learn/${course.area_slug}/${course.slug}`,
        title: course.title || course.name,
        sub: course.name,
        icon: <PlayCircle aria-hidden="true" className={icon} />,
      })),
    },
    {
      label: labels.products,
      items: results.products.results.slice(0, 4).map((product) => ({
        key: `p-${product.id}`,
        href: `/marketplace/${product.id}`,
        title: product.name,
        sub: product.seller.business_name,
        icon: <ShoppingBag aria-hidden="true" className={icon} />,
      })),
    },
    {
      label: labels.shops,
      items: results.shops.results.slice(0, 2).map((shop) => ({
        key: `s-${shop.id}`,
        href: `/marketplace/seller/${shop.id}`,
        title: shop.business_name,
        sub: shop.area,
        icon: <Store aria-hidden="true" className={icon} />,
      })),
    },
  ].filter((group) => group.items.length > 0);
}

export function SearchPalette({labels}: {labels: SearchPaletteLabels}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SiteSearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);
  const listId = useId();

  // Ctrl+K / ⌘K from anywhere on the site.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const back = opener.current;
    input.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflowY;
    root.style.overflowY = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflowY = overflow;
      document.removeEventListener("keydown", onKey);
      back?.focus({preventScroll: true});
    };
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      searchEverything(q, {signal: controller.signal})
        .then((found) => {
          setResults(found);
          setFailed(false);
          setActive(-1);
        })
        .catch((error: unknown) => {
          if ((error as Error).name !== "AbortError") setFailed(true);
        })
        .finally(() => setBusy(false));
    }, TYPE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const typed = query.trim();
  const shown = typed.length >= 2 && results ? groups(results, labels) : [];
  const flat = shown.flatMap((group) => group.items);
  const everythingHref = `/search?q=${encodeURIComponent(typed)}`;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && flat[active]) go(flat[active].href);
      else if (typed) go(everythingHref);
    }
  };

  // Each row's place in the flat list, for the arrow keys.
  const offsets = shown.map((_, at) => shown.slice(0, at).reduce((sum, group) => sum + group.items.length, 0));
  return (
    <>
      <Link
        ref={opener}
        href="/search"
        aria-label={labels.open}
        aria-haspopup="dialog"
        className="nav-search"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Search aria-hidden className="size-5 text-[var(--color-brand)] xl:size-4" />
        <span aria-hidden className="hidden xl:inline">
          {labels.pill}
        </span>
        <kbd aria-hidden className="ml-3 hidden rounded border border-[var(--color-border)] bg-[var(--color-muted)] px-1.5 py-px text-[11px] font-medium text-[var(--color-muted-foreground)] xl:inline">
          Ctrl K
        </kbd>
      </Link>

      {open ? (
        <div
          className="fixed inset-0 z-[1100] flex items-start justify-center bg-[var(--color-brand-deep)]/40 px-3 pt-[10vh] backdrop-blur-[2px]"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={labels.open}
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
              {busy ? (
                <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />
              ) : (
                <Search aria-hidden className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
              )}
              <input
                ref={input}
                type="text"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls={listId}
                aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                aria-label={labels.placeholder}
                placeholder={labels.placeholder}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKey}
                className="h-14 w-full min-w-0 border-0 bg-transparent text-base !shadow-none !outline-none placeholder:text-[var(--color-muted-foreground)]"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-px text-[11px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                {labels.close}
              </button>
            </div>

            <div id={listId} role="listbox" aria-label={labels.open} className="max-h-[60vh] overflow-y-auto p-1.5">
              {shown.map((group, at) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <p className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    {group.label}
                  </p>
                  {group.items.map((item, position) => {
                    const mine = offsets[at] + position;
                    return (
                      <Link
                        key={item.key}
                        id={`${listId}-${mine}`}
                        role="option"
                        aria-selected={active === mine}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        onMouseEnter={() => setActive(mine)}
                        className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${
                          active === mine ? "bg-[var(--color-brand-soft)]" : ""
                        }`}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--color-muted)] text-[var(--color-brand)]">
                          {item.icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{item.title}</span>
                          {item.sub ? (
                            <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{item.sub}</span>
                          ) : null}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ))}

              {typed.length >= 2 && results && !busy && flat.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--color-muted-foreground)]">{labels.empty}</p>
              ) : null}
              {failed ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--color-muted-foreground)]">{labels.failed}</p>
              ) : null}
              {typed ? (
                <Link
                  href={everythingHref}
                  onClick={() => setOpen(false)}
                  className="mt-1 flex items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[var(--color-brand)] hover:bg-[var(--color-muted)]"
                >
                  {labels.everything.replace("{q}", typed)}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              ) : (
                <p className="px-3 py-6 text-center text-sm text-[var(--color-muted-foreground)]">{labels.hint}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
