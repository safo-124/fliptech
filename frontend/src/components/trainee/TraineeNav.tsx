"use client";

import {Bookmark, GraduationCap, LayoutDashboard, LogOut, Send, Settings} from "lucide-react";
import {Loader2} from "lucide-react";

import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";

export type TraineeTab = "overview" | "enquiries" | "training" | "saved" | "settings";

export const TRAINEE_TABS: Array<{
  key: TraineeTab;
  label: string;
  /** Two or three letters for the bottom bar, where a phone gives each tab
   * about four characters before the row wraps. */
  short: string;
  Icon: typeof Send;
}> = [
  {key: "overview", label: "Overview", short: "Home", Icon: LayoutDashboard},
  {key: "enquiries", label: "Enquiries", short: "Sent", Icon: Send},
  {key: "training", label: "My training", short: "Training", Icon: GraduationCap},
  {key: "saved", label: "Saved", short: "Saved", Icon: Bookmark},
  {key: "settings", label: "Settings", short: "Settings", Icon: Settings},
];

type Counts = Partial<Record<TraineeTab, number>>;

/**
 * The account's own navigation, in the two shapes a phone and a desktop want.
 *
 * One list of tabs rendered twice rather than two components: the tabs, their
 * order and their counts have to agree, and keeping them in one array is what
 * makes that true by construction.
 *
 * On a phone it is a fixed bottom bar. That is where a thumb reaches, and it
 * is the shape every app this audience already uses puts navigation in. On a
 * desktop it is a sidebar, which stops the content being a narrow ribbon down
 * the middle of a wide screen.
 */
export function TraineeSidebar({
  tab,
  onSelect,
  counts,
  children,
  onSignOut,
  busy,
  canSignOut,
}: {
  tab: TraineeTab;
  onSelect: (tab: TraineeTab) => void;
  counts: Counts;
  children?: React.ReactNode;
  onSignOut: () => void;
  busy: boolean;
  canSignOut: boolean;
}) {
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-[5.5rem] space-y-4">
        {children}
        <nav aria-label="Account sections" className="space-y-1">
          {TRAINEE_TABS.map(({key, label, Icon}) => {
            const active = tab === key;
            const count = counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors",
                  active
                    ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
                    : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                {count ? (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                      active
                        ? "bg-[var(--color-brand)] text-white"
                        : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        {canSignOut ? (
          <Button type="button" variant="outline" onClick={onSignOut} disabled={busy} className="w-full">
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LogOut aria-hidden="true" />}
            Sign out
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

export function TraineeBottomBar({
  tab,
  onSelect,
  counts,
}: {
  tab: TraineeTab;
  onSelect: (tab: TraineeTab) => void;
  counts: Counts;
}) {
  return (
    <nav
      aria-label="Account sections"
      /* pb-[env(safe-area-inset-bottom)] keeps the row clear of the iOS home
         indicator, which otherwise sits on top of the last few pixels. */
      className="fixed inset-x-0 bottom-0 z-[900] border-t border-[var(--color-border)] bg-[var(--color-card)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {TRAINEE_TABS.map(({key, short, Icon}) => {
          const active = tab === key;
          const count = counts[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onSelect(key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition-colors",
                  active ? "text-[var(--color-brand-strong)]" : "text-[var(--color-muted-foreground)]",
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-[var(--color-brand)]"
                  />
                ) : null}
                <span className="relative">
                  <Icon aria-hidden="true" className="size-5" />
                  {count ? (
                    <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-[var(--color-brand)] px-1 text-[9px] font-bold leading-4 text-white tabular-nums">
                      {count > 9 ? "9+" : count}
                    </span>
                  ) : null}
                </span>
                {short}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
