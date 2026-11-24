"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * A dropdown that can be searched and grouped, in place of a plain <select>.
 *
 * It is a form field like the select it replaces: a hidden input carries the
 * name and value, so a GET form submits it the same way. Until the page's
 * script has loaded it *is* that select, so the form works on first paint and
 * without JavaScript.
 *
 * On a phone the list opens as a sheet from the bottom of the screen; on a
 * wider screen, under the field. Long lists get a search box; an option may
 * sit under a group heading (a region, a category).
 */
export type PickerOption = {
  value: string;
  label: string;
  /** A heading the option sits under, e.g. its region. */
  group?: string;
  /** A short note on the right, e.g. "4 workshops". */
  hint?: string;
};

/** Search appears when a list is longer than this. */
const SEARCH_FROM = 8;

const subscribe = () => () => {};

export function Picker({
  name,
  label,
  options,
  defaultValue = "",
  id,
  searchPlaceholder,
  emptyLabel,
  submitOnChange = false,
  onChange,
  className,
  triggerClassName,
  selectClassName,
  icon,
}: {
  name: string;
  /** What the field is for, read to screen readers and shown over the sheet. */
  label: string;
  options: PickerOption[];
  defaultValue?: string;
  id?: string;
  searchPlaceholder?: string;
  /** Shown when the search matches nothing. */
  emptyLabel?: string;
  /** Submit the form as soon as something is picked (a sort order). */
  submitOnChange?: boolean;
  onChange?: (value: string) => void;
  className?: string;
  triggerClassName?: string;
  /** The plain select's classes, for the moment before the script loads. */
  selectClassName?: string;
  icon?: React.ReactNode;
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // A phone gets the list as a sheet at the top level of the page, so no
  // section's stacking (an isolated band, a card) can put it under the bar.
  const [sheet, setSheet] = useState(false);
  // Under the field on a wider screen, also at the top level of the page (a
  // band with overflow hidden would cut it off), placed from the field.
  const [place, setPlace] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const listId = useId();

  const searchable = options.length > SEARCH_FROM;
  const term = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      term
        ? options.filter(
            (option) =>
              option.label.toLowerCase().includes(term) ||
              (option.group ?? "").toLowerCase().includes(term),
          )
        : options,
    [options, term],
  );
  const chosen = options.find((option) => option.value === value) ?? options[0];

  // Close on a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !popup.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // A list placed from the field would drift from it: close on scroll/resize.
  useEffect(() => {
    if (!open || sheet) return;
    const away = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open, sheet]);

  // Focus the search (or the list) when it opens; keep the active row in view.
  useEffect(() => {
    if (open)
      (searchable ? search.current : list.current)?.focus({
        preventScroll: true,
      });
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!ready) {
    // Before the script: the plain select, grouped the same way.
    const groups = new Map<string, PickerOption[]>();
    const loose: PickerOption[] = [];
    for (const option of options) {
      if (option.group)
        groups.set(option.group, [...(groups.get(option.group) ?? []), option]);
      else loose.push(option);
    }
    return (
      <select
        id={id}
        name={name}
        aria-label={label}
        defaultValue={defaultValue}
        className={selectClassName}
      >
        {loose.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {[...groups].map(([group, members]) => (
          <optgroup key={group} label={group}>
            {members.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  }

  const openList = () => {
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setSheet(window.matchMedia("(max-width: 39.999rem)").matches);
    const rect = trigger.current?.getBoundingClientRect();
    // Kept on screen: a field near the right edge opens its list leftwards.
    if (rect)
      setPlace({
        top: rect.bottom + 6,
        left: Math.max(
          16,
          Math.min(
            rect.left,
            window.innerWidth - 16 - Math.max(rect.width, 352),
          ),
        ),
        width: rect.width,
      });
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  };
  const pick = (option: PickerOption) => {
    setValue(option.value);
    if (hidden.current) hidden.current.value = option.value;
    onChange?.(option.value);
    close();
    if (submitOnChange) hidden.current?.form?.requestSubmit();
  };
  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(shown.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <span ref={box} className={cn("relative inline-block", className)}>
      <input ref={hidden} type="hidden" name={name} defaultValue={value} />
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-label={`${label}: ${chosen?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openList();
          }
        }}
        className={cn("picker-trigger", triggerClassName)}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">
          {chosen?.label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="picker-chevron size-4 shrink-0 opacity-60"
        />
      </button>

      {open
        ? createPortal(
            <>
              {/* The dimmed page behind the sheet, on a phone only. */}
              {sheet ? (
                <span
                  aria-hidden="true"
                  className="fixed inset-0 z-[1190] bg-[var(--color-brand-deep)]/35"
                  onClick={() => close()}
                />
              ) : null}
              <span
                ref={popup}
                className={cn(
                  "flex flex-col border border-[var(--color-border)] bg-[var(--color-card)] font-normal tracking-normal text-[var(--color-foreground)] shadow-[var(--shadow-lg)]",
                  sheet
                    ? "fixed inset-x-0 bottom-0 z-[1200] max-h-[75vh] rounded-t-2xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[15px]"
                    : "fixed z-[1200] max-h-[min(22rem,calc(100vh-var(--picker-top)-1rem))] w-max max-w-[22rem] rounded-xl p-1.5 text-sm",
                )}
                style={
                  sheet || !place
                    ? undefined
                    : ({
                        top: place.top,
                        left: place.left,
                        minWidth: place.width,
                        "--picker-top": `${place.top}px`,
                      } as React.CSSProperties)
                }
              >
                {sheet ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="mx-auto mb-2 mt-1 block h-1 w-10 rounded-full bg-[var(--color-border-strong)]"
                    />
                    <span className="px-2 pb-2 text-sm font-semibold">
                      {label}
                    </span>
                  </>
                ) : null}
                {searchable ? (
                  <span
                    className={cn(
                      "mb-1 flex items-center gap-2 border-b border-[var(--color-border)] px-2.5 pb-2",
                      !sheet && "pt-1",
                    )}
                  >
                    <Search
                      aria-hidden="true"
                      className="size-4 shrink-0 text-[var(--color-muted-foreground)]"
                    />
                    <input
                      ref={search}
                      type="text"
                      role="combobox"
                      aria-label={searchPlaceholder ?? label}
                      aria-controls={listId}
                      aria-expanded="true"
                      aria-activedescendant={
                        shown[active] ? `${listId}-${active}` : undefined
                      }
                      autoComplete="off"
                      placeholder={searchPlaceholder}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                      }}
                      onKeyDown={onListKey}
                      className={cn(
                        "h-9 w-full min-w-0 border-0 bg-transparent !shadow-none !outline-none placeholder:text-[var(--color-muted-foreground)]",
                        sheet ? "text-base" : "text-sm",
                      )}
                    />
                  </span>
                ) : null}
                <div
                  ref={list}
                  id={listId}
                  role="listbox"
                  aria-label={label}
                  tabIndex={searchable ? -1 : 0}
                  aria-activedescendant={
                    !searchable && shown[active]
                      ? `${listId}-${active}`
                      : undefined
                  }
                  onKeyDown={searchable ? undefined : onListKey}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain !outline-none"
                >
                  {shown.map((option, index) => {
                    const heading =
                      option.group && option.group !== shown[index - 1]?.group
                        ? option.group
                        : null;
                    const selected = option.value === value;
                    return (
                      <div key={option.value || "_any"}>
                        {heading ? (
                          <p className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                            {heading}
                          </p>
                        ) : null}
                        <div
                          id={`${listId}-${index}`}
                          data-index={index}
                          role="option"
                          aria-selected={selected}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => pick(option)}
                          onMouseMove={() => setActive(index)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5",
                            sheet ? "min-h-11" : "min-h-9",
                            index === active && "bg-[var(--color-brand-soft)]",
                            selected && "font-semibold",
                          )}
                        >
                          <Check
                            aria-hidden="true"
                            className={cn(
                              "size-4 shrink-0 text-[var(--color-brand)]",
                              !selected && "invisible",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                          {option.hint ? (
                            <span className="shrink-0 text-xs font-normal tabular-nums text-[var(--color-muted-foreground)]">
                              {option.hint}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {shown.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-[var(--color-muted-foreground)]">
                      {emptyLabel}
                    </p>
                  ) : null}
                </div>
              </span>
            </>,
            document.body,
          )
        : null}
    </span>
  );
}
