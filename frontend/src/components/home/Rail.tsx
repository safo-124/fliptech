"use client";

import {ArrowLeft, ArrowRight} from "lucide-react";
import {useRef} from "react";

/**
 * A row of cards that scrolls sideways, with arrows on wide screens.
 *
 * One card or thirty both look deliberate: the row never leaves a gap the
 * width of the missing cards, which a fixed grid did when only one course
 * existed. On a phone it is a swipe; the arrows are hidden there.
 */
export function Rail({
  children,
  label,
  previous,
  next,
  head,
}: {
  children: React.ReactNode;
  /** Names the list for screen readers, e.g. "Featured online courses". */
  label: string;
  previous: string;
  next: string;
  /** The heading row; the arrows sit at its end. */
  head: React.ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const move = (direction: 1 | -1) => {
    const element = list.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({left: direction * Math.max(element.clientWidth * 0.8, 240), behavior: reduce ? "auto" : "smooth"});
  };
  const arrow =
    "hidden size-9 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-card)] text-[var(--color-foreground)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] md:grid";

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">{head}</div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className={arrow} aria-label={previous} onClick={() => move(-1)}>
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>
          <button type="button" className={arrow} aria-label={next} onClick={() => move(1)}>
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      <ul
        ref={list}
        aria-label={label}
        className="-mx-3 mt-5 grid snap-x snap-mandatory auto-cols-[78%] grid-flow-col gap-3 overflow-x-auto scroll-px-3 px-3 pb-2 [scrollbar-width:none] sm:auto-cols-[42%] md:mx-0 md:scroll-px-0 md:px-0 lg:auto-cols-[calc((100%-3*0.75rem)/4)] xl:auto-cols-[calc((100%-4*0.75rem)/5)] [&::-webkit-scrollbar]:hidden [&>li]:snap-start"
      >
        {children}
      </ul>
    </div>
  );
}
