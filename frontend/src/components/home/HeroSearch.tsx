"use client";

import {ArrowRight, MapPin, Search} from "lucide-react";
import {useState} from "react";

import {SuggestInput} from "@/components/search/SuggestInput";
import {Picker, type PickerOption} from "@/components/ui/picker";

/**
 * The home page's one search, for training, courses or products.
 *
 * Each tab is the same GET form pointed at a different page: /training (with
 * the place), /learn and /marketplace. Without JavaScript the training tab is
 * what renders, so the main thing anybody comes here to do still works.
 *
 * Labels come as props, so the home page ships no message catalogue for it.
 */
export type HeroSearchLabels = {
  tabs: {training: string; courses: string; products: string};
  tabsLabel: string;
  skillLabel: string;
  placeholders: {training: string; courses: string; products: string};
  placeLabel: string;
  anywhere: string;
  findArea: string;
  noMatch: string;
  actions: {training: string; courses: string; products: string};
  everything: string;
};

type Tab = "training" | "courses" | "products";

const ACTION: Record<Tab, string> = {training: "/training", courses: "/learn", products: "/marketplace"};

export function HeroSearch({
  areas,
  labels,
}: {
  /** Areas with a workshop, under their regions (areaOptions). */
  areas: PickerOption[];
  labels: HeroSearchLabels;
}) {
  const [tab, setTab] = useState<Tab>("training");
  const tabs: Tab[] = ["training", "courses", "products"];

  return (
    <form action={ACTION[tab]} method="get" className="mt-7">
      <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-card)] p-2">
        <div role="tablist" aria-label={labels.tabsLabel} className="flex gap-1 px-0.5 pb-2">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`min-h-9 rounded-lg px-3 text-[13px] font-semibold transition-colors ${
                tab === name
                  ? "bg-[var(--color-muted)] text-[var(--color-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {labels.tabs[name]}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <div className="flex min-w-0 flex-[1.4] items-center gap-2.5 rounded-lg bg-[var(--color-muted)] px-3.5">
            <Search aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
            <label htmlFor="landing-q" className="sr-only">
              {labels.skillLabel}
            </label>
            {tab === "training" ? (
              <SuggestInput
                key="training"
                id="landing-q"
                name="q"
                placeholder={labels.placeholders.training}
                everythingLabel={labels.everything}
                className="h-12 w-full min-w-0 border-0 bg-transparent text-[15px] text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)] sm:text-sm"
              />
            ) : (
              <input
                key={tab}
                id="landing-q"
                name="q"
                type="search"
                autoComplete="off"
                placeholder={labels.placeholders[tab]}
                className="h-12 w-full min-w-0 border-0 bg-transparent text-[15px] text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)] sm:text-sm"
              />
            )}
          </div>

          {tab === "training" ? (
            <div className="flex min-w-0 flex-1 items-center rounded-lg bg-[var(--color-muted)]">
              <Picker
                id="landing-area"
                name="area"
                label={labels.placeLabel}
                searchPlaceholder={labels.findArea}
                emptyLabel={labels.noMatch}
                options={[{value: "", label: labels.anywhere}, ...areas]}
                icon={<MapPin aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />}
                className="w-full"
                triggerClassName="h-12 px-3.5 text-[15px] text-[var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg sm:text-sm"
                selectClassName="h-12 w-full min-w-0 cursor-pointer border-0 bg-transparent px-3.5 text-[15px] text-[var(--color-foreground)] outline-none sm:text-sm"
              />
            </div>
          ) : null}

          <button
            type="submit"
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
          >
            {labels.actions[tab]}
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
