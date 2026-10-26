"use client";

import {
  ArrowRight,
  Bookmark,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Search,
  Send,
} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";

import type {TraineeTab} from "@/components/trainee/TraineeNav";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {formatDate} from "@/lib/format";
import {activityFeed, awaitingReply, completeness, profileTasks} from "@/lib/trainee-progress";
import {cn} from "@/lib/utils";
import type {SavedProvider, TraineeAccount, TraineeEnquiry, TraineeEnrolment} from "@/lib/types";

/**
 * A ring rather than a bar: it keeps its meaning at the size a phone has room
 * for, sitting beside the list of what is still outstanding.
 */
function ProgressRing({percent}: {percent: number}) {
  const t = useTranslations("TraineeOverview");
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      viewBox="0 0 64 64"
      className="size-16 shrink-0 -rotate-90"
      role="img"
      aria-label={t("profileComplete", {percent})}
    >
      <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-[var(--color-muted)]" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        className="stroke-[var(--color-brand)] transition-[stroke-dashoffset] duration-700"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)}
      />
      {/* Counter-rotated so the number reads upright inside the turned ring. */}
      <text
        x="32"
        y="32"
        className="rotate-90 fill-[var(--color-foreground)] text-[15px] font-bold"
        style={{transformOrigin: "32px 32px"}}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {percent}
      </text>
    </svg>
  );
}

function Stat({
  label,
  value,
  Icon,
  onClick,
  tone = "plain",
}: {
  label: string;
  value: number;
  Icon: typeof Send;
  onClick: () => void;
  tone?: "plain" | "brand";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3.5 text-left shadow-[var(--shadow-card)] transition-colors hover:border-[var(--color-border-strong)] sm:p-4"
    >
      <span
        className={cn(
          "grid size-8 place-items-center rounded-lg",
          tone === "brand"
            ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
            : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="text-2xl font-bold leading-none tabular-nums sm:text-3xl">{value}</span>
      <span className="text-xs font-medium leading-4 text-[var(--color-muted-foreground)]">{label}</span>
    </button>
  );
}

/** How each kind of activity is drawn; its verb is in "TraineeOverview.verbs". */
const ACTIVITY: Record<
  "enquiry" | "started" | "completed",
  {Icon: typeof Send; className: string}
> = {
  enquiry: {
    Icon: Send,
    className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  },
  started: {
    Icon: GraduationCap,
    className: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  },
  completed: {
    Icon: CheckCircle2,
    className: "bg-[var(--color-visit-bg)] text-[var(--color-visit)]",
  },
};

/**
 * What the account adds up to, on the screen you land on.
 *
 * Every number here is counted from the three lists the dashboard already
 * loads, so the overview costs no extra request and cannot drift from the
 * tabs behind it. See lib/trainee-progress.ts for the arithmetic.
 */
export function TraineeOverview({
  account,
  enquiries,
  enrolments,
  saved,
  onGo,
}: {
  account: TraineeAccount;
  enquiries: TraineeEnquiry[];
  enrolments: TraineeEnrolment[];
  saved: SavedProvider[];
  onGo: (tab: TraineeTab) => void;
}) {
  const t = useTranslations("TraineeOverview");
  const tProgress = useTranslations("TraineeProgress");
  const tasks = profileTasks(account);
  const percent = completeness(tasks);
  const outstanding = tasks.filter((task) => !task.done);
  const feed = activityFeed(enquiries, enrolments).slice(0, 6);
  const inTraining = enrolments.filter((item) => !item.completed_on).length;
  const waiting = awaitingReply(enquiries);
  const nothingYet = enquiries.length === 0 && enrolments.length === 0 && saved.length === 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("enquiriesSent")} value={enquiries.length} Icon={Send} onClick={() => onGo("enquiries")} />
        <Stat
          label={t("awaitingReply")}
          value={waiting}
          Icon={Clock3}
          tone={waiting > 0 ? "brand" : "plain"}
          onClick={() => onGo("enquiries")}
        />
        <Stat
          label={t("coursesInProgress")}
          value={inTraining}
          Icon={GraduationCap}
          onClick={() => onGo("training")}
        />
        <Stat label={t("savedWorkshops")} value={saved.length} Icon={Bookmark} onClick={() => onGo("saved")} />
      </div>

      {nothingYet ? (
        <Card className="border-dashed p-6 text-center sm:p-8">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
            <Search aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 text-lg font-semibold">{t("readyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
            {t("readyBody")}
          </p>
          <Button asChild variant="brand" className="mx-auto mt-5">
            <Link href="/training">
              {t("findTraining")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("recentActivity")}</CardTitle>
            <CardDescription>{t("recentActivityBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            {feed.length === 0 ? (
              <p className="py-2 text-sm text-[var(--color-muted-foreground)]">
                {t("nothingYet")}
              </p>
            ) : (
              <ol className="space-y-3">
                {feed.map((item) => {
                  const {Icon, className} = ACTIVITY[item.kind];
                  return (
                    <li key={item.id} className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
                          className,
                        )}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-5">
                          <span className="text-[var(--color-muted-foreground)]">
                            {t(`verbs.${item.kind}`)}{" "}
                          </span>
                          <span className="font-semibold">{item.title || t("trainingEnquiry")}</span>
                        </p>
                        <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                          {item.providerName} · {formatDate(item.at)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("yourProfile")}</CardTitle>
            <CardDescription>{percent === 100 ? t("allFilledIn") : t("allOptional")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <ProgressRing percent={percent} />
              <p className="text-sm leading-5 text-[var(--color-muted-foreground)]">
                {percent === 100
                  ? t("fullPicture")
                  : t.rich("thingsLeft", {
                      count: outstanding.length,
                      strong: (chunks) => (
                        <span className="font-semibold text-[var(--color-foreground)]">{chunks}</span>
                      ),
                    })}
              </p>
            </div>
            {outstanding.length > 0 ? (
              <>
                <ul className="space-y-2.5">
                  {outstanding.slice(0, 3).map((task) => (
                    <li key={task.key} className="text-sm leading-5">
                      <p className="font-semibold">{tProgress(`tasks.${task.key}.label`)}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {tProgress(`tasks.${task.key}.hint`)}
                      </p>
                    </li>
                  ))}
                </ul>
                <Button type="button" variant="outline" className="w-full" onClick={() => onGo("settings")}>
                  {t("updateDetails")}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
