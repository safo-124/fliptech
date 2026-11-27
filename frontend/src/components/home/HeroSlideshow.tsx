"use client";

/**
 * The home page's big picture, as a slideshow: staff's chosen picture, if
 * there is one, then shops taking turns (backend HeroShopsView), each with
 * its own photo, its name and town, and a way into the shop.
 *
 * A new picture every five seconds, cross-fading, the one on show drifting
 * in slowly. It holds still while a mouse is over it or a key is in it, has a
 * pause button (anything that moves by itself for longer than five seconds
 * must be stoppable), and dots to pick a picture; phones can swipe.
 *
 * Kind to data and to people who get dizzy:
 * - Only the first picture loads with the page. The others load once the
 *   page is ready, each small.
 * - With Data Saver on, or on a 2G connection, it does not turn by itself or
 *   fetch ahead: one picture, and the others only if someone asks for them.
 * - With "reduce motion" on, nothing drifts and nothing turns by itself.
 */

import { ArrowRight, Pause, Play, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import styles from "./HeroSlideshow.module.css";

export type HeroSlide = {
  url: string;
  alt: string;
  caption?: string;
  credit?: string;
  href?: string;
  /** "Trainer", for a shop with a training workshop behind it. */
  badge?: string;
  /** "Visit shop". */
  action?: string;
  /** "2 of 5", for screen readers. */
  label: string;
  /** "Show picture 2 of 5", on its dot. */
  show: string;
};

export type HeroSlideshowLabels = { region: string; pause: string; play: string };

const TURN_MS = 5000;
const SWIPE_PX = 40;
/** Where each picture drifts towards, so no two in a row move alike. */
const ORIGINS = ["30% 40%", "70% 35%", "45% 70%", "65% 65%", "35% 30%"];

/** The Network Information API, where the browser has it (Chrome on Android). */
type Connection = {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

function connection(): Connection | undefined {
  return (navigator as Navigator & { connection?: Connection }).connection;
}

function onMotionChange(notify: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function onConnectionChange(notify: () => void) {
  const link = connection();
  link?.addEventListener?.("change", notify);
  return () => link?.removeEventListener?.("change", notify);
}

function onVisibilityChange(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const lightData = () => {
  const link = connection();
  return Boolean(link?.saveData || link?.effectiveType === "2g" || link?.effectiveType === "slow-2g");
};
const pageHidden = () => document.visibilityState === "hidden";

export function HeroSlideshow({
  slides,
  labels,
  visited,
}: {
  slides: HeroSlide[];
  labels: HeroSlideshowLabels;
  /** The "visited by Fliiptech" card beside the picture, or null. */
  visited: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hold, setHold] = useState(false);
  // Set just after the first paint, so the first picture drifts too.
  const [started, setStarted] = useState(false);
  // The page has finished loading: the other pictures may load now.
  const [ready, setReady] = useState(false);
  const touchX = useRef<number | null>(null);

  // Before the browser is known (the server's render), assume the stillest.
  const reduced = useSyncExternalStore(onMotionChange, reducedMotion, () => true);
  const lite = useSyncExternalStore(onConnectionChange, lightData, () => true);
  const hidden = useSyncExternalStore(onVisibilityChange, pageHidden, () => false);

  const many = slides.length > 1;
  const turning = many && !paused && !hold && !reduced && !lite && !hidden;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setStarted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const go = () => setReady(true);
    if (document.readyState === "complete") {
      const soon = window.setTimeout(go, 300);
      return () => window.clearTimeout(soon);
    }
    window.addEventListener("load", go, { once: true });
    return () => window.removeEventListener("load", go);
  }, []);

  useEffect(() => {
    if (!turning) return;
    const next = window.setTimeout(() => setIndex((now) => (now + 1) % slides.length), TURN_MS);
    return () => window.clearTimeout(next);
  }, [turning, index, slides.length]);

  const step = (by: number) => setIndex((now) => (now + by + slides.length) % slides.length);

  return (
    <div
      className="relative"
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHold(false);
      }}
    >
      <div
        className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--color-muted)]"
        aria-live={turning ? "off" : "polite"}
        onTouchStart={(event) => {
          touchX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchX.current;
          touchX.current = null;
          const end = event.changedTouches[0]?.clientX;
          if (!many || start === null || end === undefined || Math.abs(end - start) < SWIPE_PX) return;
          step(end < start ? 1 : -1);
        }}
      >
        {slides.map((slide, position) => {
          const active = position === index;
          // The first with the page; the rest once it has loaded, unless data
          // is short, when only the one asked for.
          const load = position === 0 || active || (ready && !lite);
          const photo: ReactNode = load ? (
            <Image
              src={slide.url}
              alt={slide.href ? "" : slide.alt}
              fill
              sizes="(min-width: 1024px) 45vw, 100vw"
              loading={position === 0 ? "eager" : "lazy"}
              fetchPriority={position === 0 ? "high" : "auto"}
              className={`object-cover ${styles.photo}`}
            />
          ) : null;
          return (
            <div
              key={`${position}-${slide.url}`}
              role="group"
              aria-roledescription="slide"
              aria-label={slide.label}
              aria-hidden={!active}
              inert={!active}
              className={`${styles.slide} ${active ? styles.active : ""} ${active && started && !reduced ? styles.moving : ""}`}
              style={{ "--origin": ORIGINS[position % ORIGINS.length] } as CSSProperties}
            >
              {slide.href ? (
                <Link
                  href={slide.href}
                  className="absolute inset-0"
                  aria-label={[slide.caption, slide.action].filter(Boolean).join(". ")}
                >
                  {photo}
                </Link>
              ) : (
                photo
              )}
              {slide.caption || slide.credit ? (
                // Above the "visited" card, which overlaps the picture's foot.
                <p
                  className={`pointer-events-none absolute left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg bg-black/55 px-2.5 py-1.5 text-xs text-white backdrop-blur-sm ${
                    visited ? "bottom-10" : "bottom-3"
                  }`}
                >
                  {slide.badge ? (
                    <span className="shrink-0 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--color-brand-deep)]">
                      {slide.badge}
                    </span>
                  ) : null}
                  <span className="truncate font-semibold">{slide.caption ?? slide.credit}</span>
                  {slide.action ? (
                    <span className="hidden shrink-0 items-center gap-1 text-white/85 sm:inline-flex">
                      {slide.action}
                      <ArrowRight aria-hidden="true" className="size-3" />
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          );
        })}

        {many ? (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-full bg-black/40 px-1.5 py-1 backdrop-blur-sm">
            {slides.map((slide, position) => (
              <button
                key={`dot-${position}`}
                type="button"
                onClick={() => setIndex(position)}
                aria-label={slide.show}
                aria-current={position === index ? "true" : undefined}
                className="grid size-6 place-items-center rounded-full"
              >
                <span
                  aria-hidden="true"
                  className={`block rounded-full transition-all ${
                    position === index ? "h-2 w-4 bg-white" : "size-2 bg-white/55 hover:bg-white/80"
                  }`}
                />
              </button>
            ))}
            {!reduced && !lite ? (
              <button
                type="button"
                onClick={() => setPaused((now) => !now)}
                aria-label={paused ? labels.play : labels.pause}
                className="ml-0.5 grid size-6 place-items-center rounded-full text-white hover:bg-white/15"
              >
                {paused ? (
                  <Play aria-hidden="true" className="size-3.5 fill-current" />
                ) : (
                  <Pause aria-hidden="true" className="size-3.5 fill-current" />
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {visited ? (
        <span className="absolute -bottom-4 right-4 z-10 flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3.5 py-2.5 text-[13px] font-medium shadow-[var(--shadow-lg)] sm:-left-6 sm:right-auto">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
            <ShieldCheck aria-hidden="true" className="size-4" />
          </span>
          {visited}
        </span>
      ) : null}
    </div>
  );
}
