"use client";

import { ArrowUpRight, GraduationCap, MapPin, Search, ShoppingBag, Wrench } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { suggest, suggestionHref } from "@/lib/search-api";
import type { SearchSuggestion } from "@/lib/types";

import styles from "./search.module.css";

const ICONS = {
  trade_area: MapPin,
  trade: Wrench,
  area: MapPin,
  workshop: GraduationCap,
  product: ShoppingBag,
} as const;

/**
 * A plain search input that suggests as the visitor types: trades, "welding
 * in Tema", areas, workshops and products by name, and a last row to search
 * the whole site. Still an ordinary field in its form, so submitting without
 * picking a suggestion does what the form always did.
 *
 * Labels come as props, so the home page ships no message catalogue for it.
 */
export function SuggestInput({
  id,
  name,
  placeholder,
  className,
  everythingLabel,
}: {
  id: string;
  name: string;
  placeholder: string;
  className: string;
  /** "Search everything for “{q}”" */
  everythingLabel: string;
}) {
  const [value, setValue] = useState("");
  const [items, setItems] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggest(q, controller.signal)
        .then((found) => {
          setItems(found);
          setActive(-1);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  useEffect(() => {
    function away(event: PointerEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const q = value.trim();
  const rows: { href: string; label: string; sub?: string; kind: keyof typeof ICONS | "everything" }[] = [
    ...(q.length >= 2 ? items : []).map((item) => ({
      href: suggestionHref(item),
      label: item.label,
      sub: "sub" in item ? item.sub : undefined,
      kind: item.kind,
    })),
    ...(q.length >= 2
      ? [{ href: `/search?q=${encodeURIComponent(q)}`, label: everythingLabel.replace("{q}", q), kind: "everything" as const }]
      : []),
  ];
  const showing = open && rows.length > 0;

  return (
    <div ref={box} className="relative w-full min-w-0">
      <input
        id={id}
        name={name}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!showing) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % rows.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index <= 0 ? rows.length - 1 : index - 1));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            window.location.assign(rows[active].href);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`${styles.input} ${className}`}
      />
      {showing ? (
        <ul
          id={listId}
          role="listbox"
          className={`${styles.list} overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] py-1.5 shadow-[var(--shadow-lg)]`}
        >
          {rows.map((row, index) => {
            const Icon = row.kind === "everything" ? Search : ICONS[row.kind];
            return (
              <li key={row.href} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
                <a
                  href={row.href}
                  onPointerEnter={() => setActive(index)}
                  className={`flex min-h-11 items-center gap-3 px-3.5 py-2 text-sm ${
                    index === active ? styles.active : ""
                  } ${row.kind === "everything" ? "border-t border-[var(--color-border)] font-semibold text-[var(--color-brand)]" : ""}`}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand)]" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-[var(--color-foreground)]">{row.label}</span>
                    {row.sub ? <span className="text-[var(--color-muted-foreground)]"> · {row.sub}</span> : null}
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
