"use client";

import {ArrowRight, Menu, Search, X} from "lucide-react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useId, useState} from "react";

import {NavIcon} from "./icons";
import {inSection} from "./MainNav";
import styles from "./nav.module.css";
import type {NavLabels, NavSection} from "./types";

/**
 * Below lg: a menu button that opens one sheet with every part of the site.
 * Each section is a coloured heading with its shortcuts under it, so nothing
 * is two taps deep. It closes on a link, on Escape and on the dimmed area,
 * and the page behind does not scroll while it is open.
 */
export function MobileNav({
  sections,
  labels,
  searchLabel,
}: {
  sections: NavSection[];
  labels: NavLabels;
  searchLabel: string;
}) {
  const pathname = usePathname() ?? "/";
  // The page the sheet was opened on: once a link changes the page, the
  // sheet counts as closed, with no effect needed to reset it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpenOn(null);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <div className={styles.mobile}>
      <button
        type="button"
        className={styles.menuButton}
        data-open={open || undefined}
        aria-label={open ? labels.close : labels.menu}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label={labels.close}
            tabIndex={-1}
            className={styles.scrim}
            onClick={() => setOpen(false)}
          />
          <nav id={id} aria-label={labels.mainNavigation} className={styles.sheet}>
            <Link href="/search" className={styles.sheetSearch} onClick={() => setOpen(false)}>
              <Search aria-hidden />
              {searchLabel}
            </Link>

            {sections.map((section) => (
              <section key={section.key} className={styles.sheetSection} data-section={section.key}>
                <Link
                  href={section.href}
                  className={styles.sheetHeading}
                  data-here={inSection(pathname, section) || undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className={styles.sheetHeadingIcon}>
                    <NavIcon name={section.icon} />
                  </span>
                  <b>{section.label}</b>
                  <ArrowRight aria-hidden />
                </Link>
                <ul className={styles.sheetLinks}>
                  {section.shortcuts.map((shortcut) => (
                    <li key={shortcut.href}>
                      <Link
                        href={shortcut.href}
                        className={styles.sheetLink}
                        aria-current={pathname === shortcut.href.split("?")[0] ? "page" : undefined}
                        onClick={() => setOpen(false)}
                      >
                        <NavIcon name={shortcut.icon} />
                        {shortcut.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        </>
      ) : null}
    </div>
  );
}
