"use client";

import {ArrowRight, ChevronDown} from "lucide-react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useCallback, useEffect, useId, useRef, useState} from "react";

import {NavIcon} from "./icons";
import styles from "./nav.module.css";
import type {NavLabels, NavSection} from "./types";

/** Is this page inside the section (so its tab shows as current)? */
export function inSection(pathname: string, section: NavSection) {
  if (section.key === "training") {
    return ["/training", "/map", "/trades", "/trainer"].some((root) => pathname.startsWith(root));
  }
  return pathname.startsWith(section.href);
}

/**
 * The three parts of the site, each with one panel. Only one panel is ever
 * open: hovering a tab moves the panel to it, a click toggles it, and Escape,
 * a click elsewhere or following a link closes it.
 *
 * Hover opens after a short pause and closes after a longer one, so moving
 * the pointer across the bar, or diagonally down into a panel, does not
 * flicker panels open and shut.
 */
export function MainNav({sections, labels}: {sections: NavSection[]; labels: NavLabels}) {
  const pathname = usePathname() ?? "/";
  // Which panel is open, and on which page: following a link changes the
  // page, so the panel counts as closed without an effect to reset it.
  const [state, setState] = useState<{key: NavSection["key"] | null; path: string}>({
    key: null,
    path: pathname,
  });
  const open = state.path === pathname ? state.key : null;
  const setOpen = useCallback(
    (key: NavSection["key"] | null) => setState({key, path: pathname}),
    [pathname],
  );
  const root = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseId = useId();

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = useCallback(
    (next: NavSection["key"] | null, ms: number) => {
      clear();
      timer.current = setTimeout(() => setOpen(next), ms);
    },
    [setOpen],
  );

  // Escape closes, and gives focus back to the tab; a click elsewhere closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(null);
      root.current?.querySelector<HTMLButtonElement>(`[data-tab="${open}"]`)?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen]);

  useEffect(() => clear, []);

  const current = sections.find((section) => section.key === open);

  return (
    <nav
      ref={root}
      aria-label={labels.mainNavigation}
      className={styles.desktop}
      onPointerLeave={(event) => event.pointerType === "mouse" && later(null, 220)}
      onPointerEnter={clear}
    >
      <ul className={styles.tabs}>
        {sections.map((section) => {
          const isOpen = open === section.key;
          const isHere = inSection(pathname, section);
          return (
            <li key={section.key}>
              <button
                type="button"
                data-tab={section.key}
                className={styles.tab}
                data-open={isOpen || undefined}
                data-here={isHere || undefined}
                aria-expanded={isOpen}
                aria-controls={`${baseId}-${section.key}`}
                onClick={() => {
                  clear();
                  setOpen(isOpen ? null : section.key);
                }}
                onPointerEnter={(event) =>
                  event.pointerType === "mouse" && later(section.key, open ? 0 : 90)
                }
              >
                <NavIcon name={section.icon} className={styles.tabIcon} />
                <span>{section.label}</span>
                <ChevronDown aria-hidden className={styles.chevron} />
              </button>
            </li>
          );
        })}
      </ul>

      {current ? (
        <div className={styles.panelWrap}>
          <div
            id={`${baseId}-${current.key}`}
            className={styles.panel}
            data-section={current.key}
            role="region"
            aria-label={current.label}
          >
            <div className={styles.panelList}>
              <ul>
                {current.shortcuts.map((shortcut) => (
                  <li key={shortcut.href}>
                    <Link
                      href={shortcut.href}
                      className={styles.shortcut}
                      aria-current={pathname === shortcut.href.split("?")[0] ? "page" : undefined}
                      onClick={() => setOpen(null)}
                    >
                      <span className={styles.shortcutIcon}>
                        <NavIcon name={shortcut.icon} />
                      </span>
                      <span>
                        <b>{shortcut.label}</b>
                        <small>{shortcut.hint}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={current.href} className={styles.seeAll} onClick={() => setOpen(null)}>
                {current.allLabel}
                <ArrowRight aria-hidden />
              </Link>
            </div>
            <Link href={current.feature.href} className={styles.feature} onClick={() => setOpen(null)}>
              <span className={styles.featureIcon}>
                <NavIcon name={current.icon} />
              </span>
              <b>{current.feature.title}</b>
              <span>{current.feature.body}</span>
              <span className={styles.featureCta}>
                {current.feature.cta}
                <ArrowRight aria-hidden />
              </span>
            </Link>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
