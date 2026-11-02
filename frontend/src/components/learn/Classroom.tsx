"use client";

import {
  Award,
  BookOpen,
  Captions as CaptionsIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Lock,
  MessageCircleQuestion,
  PlayCircle,
  Star,
  Tag,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  buyCourse,
  checkCourseCode,
  getCourseAccess,
  saveProgress,
  verifyPurchase,
} from "@/lib/course-api";
import { formatCedis } from "@/lib/format";
import { advance, readLocal, writeLocal, type ProgressMap } from "@/lib/learn-local";
import { TrainerApiError } from "@/lib/trainer-fetch";
import type { Certificate, CourseAccess, CourseCard, CourseDetail, ProviderVideo } from "@/lib/types";

import { CourseComplete } from "./CourseComplete";
import { CourseReviews } from "./CourseReviews";
import { clock, LessonPlayer, type PlayerReport } from "./LessonPlayer";
import { LessonQuestions } from "./LessonQuestions";
import { ProgressRing } from "./ProgressRing";
import { SaveOffline } from "./SaveOffline";

type Tab = "overview" | "questions" | "reviews";

/**
 * The course, as a place to learn in: the player, the lesson, its
 * questions, the course's reviews, and the contents with what is done.
 *
 * The page around this is cached and the same for everybody, with locked
 * lessons' files left out. On load this asks what this browser may watch
 * and how far it has got (courses/views.py, CourseAccessView), then picks
 * up where the learner left off. Coming back from Paystack, it has the
 * payment confirmed before unlocking anything.
 */
export function Classroom({ data }: { data: CourseDetail }) {
  const t = useTranslations("Classroom");
  const { course, lessons, programmes, ratings } = data;
  const paid = Boolean(course.price);
  const [access, setAccess] = useState<CourseAccess | null>(null);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [time, setTime] = useState(0);
  const [seek, setSeek] = useState<{ seconds: number; nonce: number } | null>(null);
  const [busy, setBusy] = useState<"buying" | "checking" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ certificate: Certificate | null; needsName: boolean } | null>(null);
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const celebrated = useRef(false);
  const progressRef = useRef<ProgressMap>({});
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);
  const signedIn = access?.signed_in ?? false;
  const signInHref = `/trainee/sign-in?next=${encodeURIComponent(`/learn/${course.area_slug}/${course.slug}`)}`;

  const refresh = useCallback(async () => {
    try {
      const loaded = await getCourseAccess(course.area_slug, course.slug);
      setAccess(loaded);
      setProgress(loaded.signed_in ? loaded.progress : readLocal(course.id));
      if (loaded.certificate) celebrated.current = true;
      return loaded;
    } catch {
      setProgress(readLocal(course.id));
      return null;
    }
  }, [course.area_slug, course.slug, course.id]);

  // ---------------------------------------------------- on arrival
  useEffect(() => {
    let active = true;
    async function load() {
      const url = new URL(window.location.href);
      const reference = url.searchParams.get("purchase");
      const asked = Number(url.searchParams.get("lesson"));
      if (reference && paid) {
        for (const name of ["purchase", "reference", "trxref"]) url.searchParams.delete(name);
        window.history.replaceState(null, "", url.toString());
        if (active) setBusy("checking");
        try {
          const result = await verifyPurchase(reference);
          if (active && !result.owned) setProblem(t("paymentNotConfirmed"));
        } catch (reason) {
          if (active) setProblem(reason instanceof Error ? reason.message : null);
        } finally {
          if (active) setBusy(null);
        }
      }
      const loaded = await refresh();
      if (!active) return;
      const at = lessons.findIndex((lesson) => lesson.id === asked);
      if (at >= 0) {
        setIndex(at);
        setChosen(true);
        return;
      }
      // Carry on: the first lesson not finished, after any started.
      const rows = loaded?.signed_in ? loaded.progress : readLocal(course.id);
      const started = lessons.some((lesson) => rows[String(lesson.id)]);
      if (started) {
        const next = lessons.findIndex((lesson) => !rows[String(lesson.id)]?.completed);
        if (next >= 0) setIndex(next);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [paid, refresh, lessons, course.id, t]);

  const playable: ProviderVideo[] = useMemo(
    () =>
      lessons.map((lesson) => {
        const sources = access?.sources[String(lesson.id)];
        const stream = access?.streams?.[String(lesson.id)] ?? lesson.stream;
        if (!lesson.locked || !sources) return { ...lesson, stream };
        return { ...lesson, locked: false, sources, stream };
      }),
    [lessons, access],
  );

  const current = playable[index];
  const finishedCount = lessons.filter((lesson) => progress[String(lesson.id)]?.completed).length;
  const share = lessons.length ? (finishedCount / lessons.length) * 100 : 0;
  const locked = Boolean(current?.locked);
  const owned = access?.owned ?? !paid;
  const certificate = done?.certificate ?? access?.certificate ?? null;

  function choose(position: number, play = false) {
    setIndex(position);
    setChosen(true);
    setAutoStart(play);
    setTime(0);
    const url = new URL(window.location.href);
    url.searchParams.set("lesson", String(lessons[position].id));
    window.history.replaceState(null, "", url.toString());
    if (window.innerWidth < 1024) {
      document.getElementById("player")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ---------------------------------------------------- progress
  const report = useCallback(
    (lesson: ProviderVideo, { position, duration, ended }: PlayerReport) => {
      setTime(position);
      const key = String(lesson.id);
      const updated = { ...progressRef.current, [key]: advance(progressRef.current[key], position, duration, ended) };
      progressRef.current = updated;
      setProgress(updated);
      const finishedAll = lessons.every((item) => updated[String(item.id)]?.completed);
      if (!signedIn) writeLocal(course.id, updated);
      if (signedIn) {
        saveProgress(lesson.id, position, ended)
          .then((reply) => {
            if (reply.course.finished && !celebrated.current) {
              celebrated.current = true;
              setDone({ certificate: reply.course.certificate, needsName: reply.course.needs_name });
              void refresh();
            }
          })
          .catch(() => {});
      } else if (finishedAll && !celebrated.current) {
        celebrated.current = true;
        setDone({ certificate: null, needsName: false });
      }
    },
    [signedIn, lessons, course.id, refresh],
  );

  // ---------------------------------------------------- buying
  async function buy(code?: string) {
    setBusy("buying");
    setProblem(null);
    try {
      const { authorization_url } = await buyCourse(course.area_slug, course.slug, code);
      window.location.assign(authorization_url);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("buyUnavailable"));
      setBusy(null);
      await refresh();
    }
  }

  if (!current) return null;
  const previous = index > 0 ? index - 1 : null;
  const next = index < lessons.length - 1 ? index + 1 : null;
  const startAt = progress[String(current.id)]?.completed ? 0 : (progress[String(current.id)]?.position ?? 0);
  const section = current.section;
  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: "overview", label: t("tabOverview"), icon: <BookOpen aria-hidden="true" className="size-4" /> },
    {
      id: "questions",
      label: t("tabQuestions"),
      icon: <MessageCircleQuestion aria-hidden="true" className="size-4" />,
      badge: questionCount ? String(questionCount) : undefined,
    },
    {
      id: "reviews",
      label: t("tabReviews"),
      icon: <Star aria-hidden="true" className="size-4" />,
      badge: ratings.average ? ratings.average.toFixed(1) : undefined,
    },
  ];

  return (
    <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ------------------------------------------------------ player */}
      <div id="player" className="min-w-0 scroll-mt-20 lg:col-start-1 lg:row-start-1">
        <div className="overflow-hidden rounded-2xl bg-black shadow-[var(--shadow-lg)] ring-1 ring-black/5 sm:rounded-3xl">
          {locked ? (
            <LockedLesson
              poster={current.poster}
              price={access?.price ?? course.price}
              busy={busy}
              problem={problem}
              signedIn={signedIn}
              paymentsEnabled={access?.payments_enabled ?? true}
              signInHref={signInHref}
              onBuy={() => buy()}
            />
          ) : (
            <LessonPlayer
              key={`${current.id}-${current.sources.length}-${current.stream ?? ""}`}
              video={current}
              playLabel={t("playLesson", { title: current.title })}
              startAt={startAt}
              autoStart={autoStart}
              seek={seek}
              next={next !== null ? { title: lessons[next].title } : null}
              onReport={(r) => report(current, r)}
              onNext={() => (next !== null ? choose(next, true) : undefined)}
            />
          )}
        </div>
        {busy === "checking" ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-brand)]">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {t("checkingPayment")}
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------------ the lesson */}
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-brand)]">
              {section ? `${section} · ` : ""}
              {t("lessonNumber", { number: index + 1, count: lessons.length })}
              {index === 0 && paid && !owned ? ` · ${t("freePreview")}` : null}
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em] text-[var(--color-brand-deep)] sm:text-2xl">
              {current.title}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-muted-foreground)]">
              {current.duration_seconds ? (
                <span className="inline-flex items-center gap-1">
                  <Clock3 aria-hidden="true" className="size-3.5" />
                  {clock(current.duration_seconds)}
                </span>
              ) : null}
              {current.captions?.length ? (
                <span className="inline-flex items-center gap-1">
                  <CaptionsIcon aria-hidden="true" className="size-3.5" />
                  {current.captions.map((c) => c.label).join(", ")}
                </span>
              ) : null}
              {progress[String(current.id)]?.completed ? (
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-visit)]">
                  <CheckCircle2 aria-hidden="true" className="size-3.5" />
                  {t("finished")}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveOffline
              video={current}
              course={{ name: course.name, area: course.area_slug, slug: course.slug }}
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={previous === null}
                onClick={() => previous !== null && choose(previous)}
                aria-label={t("previous")}
                className="grid size-10 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-card)] hover:bg-[var(--color-muted)] disabled:opacity-40"
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </button>
              <button
                type="button"
                disabled={next === null}
                onClick={() => next !== null && choose(next)}
                className="inline-flex h-10 items-center gap-1 rounded-full bg-[var(--color-brand)] pl-4 pr-3 text-sm font-semibold text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-40"
              >
                {t("next")}
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {!signedIn && access && finishedCount > 0 ? (
          <a
            href={signInHref}
            className="mt-4 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[var(--color-brand-soft)] to-transparent p-3 text-sm hover:from-[var(--color-brand-soft)]"
          >
            <Award aria-hidden="true" className="size-5 shrink-0 text-[var(--color-brand)]" />
            <span>
              <span className="font-bold">{t("keepProgressTitle")}</span>{" "}
              <span className="text-[var(--color-muted-foreground)]">{t("keepProgressBody")}</span>
            </span>
          </a>
        ) : null}
      </div>

      {/* ------------------------------------------------------ contents */}
      <aside
        aria-label={t("contents")}
        className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1"
      >
        <div className="space-y-4 lg:sticky lg:top-24">
          {paid && access && !owned ? (
            <BuyPanel
              course={course}
              access={access}
              busy={busy}
              problem={problem}
              signInHref={signInHref}
              onBuy={buy}
            />
          ) : null}
          <Curriculum
            lessons={playable}
            index={index}
            progress={progress}
            share={share}
            finished={finishedCount}
            certificate={certificate}
            onChoose={(position) => choose(position)}
            highlight={!chosen}
          />
        </div>
      </aside>

      {/* ------------------------------------------------------ tabs */}
      <div className="min-w-0 lg:col-start-1 lg:row-start-3">
        <div role="tablist" aria-label={t("aboutLesson")} className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-controls={`panel-${item.id}`}
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className="relative inline-flex min-h-11 shrink-0 items-center gap-2 px-4 text-sm font-semibold text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] aria-selected:text-[var(--color-brand)]"
            >
              {item.icon}
              {item.label}
              {item.badge ? (
                <span className="rounded-full bg-[var(--color-muted)] px-1.5 text-[11px] font-bold tabular-nums">
                  {item.badge}
                </span>
              ) : null}
              {tab === item.id ? (
                <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--color-brand)]" />
              ) : null}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="pt-5 animate-[fade-in_0.25s_ease-out]"
        >
          {tab === "overview" ? (
            <div className="space-y-4">
              {current.description ? (
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-[var(--color-foreground)]/85">
                  {current.description}
                </p>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">{t("noDescription")}</p>
              )}
              <button
                type="button"
                onClick={() => setTab("questions")}
                className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-brand)] hover:underline"
              >
                <MessageCircleQuestion aria-hidden="true" className="size-4" />
                {t("askAboutLesson")}
              </button>
            </div>
          ) : tab === "questions" ? (
            <LessonQuestions
              key={current.id}
              videoId={current.id}
              locked={locked}
              signedIn={signedIn}
              signInHref={signInHref}
              currentTime={time}
              onSeek={(seconds) => setSeek({ seconds, nonce: Date.now() })}
              onCount={setQuestionCount}
            />
          ) : (
            <CourseReviews
              key={access?.my_review?.id ?? "none"}
              area={course.area_slug}
              slug={course.slug}
              initial={ratings}
              mine={access?.my_review ?? null}
              canReview={access?.can_review ?? false}
              signedIn={signedIn}
              signInHref={signInHref}
            />
          )}
        </div>
      </div>

      {done ? (
        <CourseComplete
          courseName={course.name}
          area={course.area_slug}
          slug={course.slug}
          signedIn={signedIn}
          signInHref={signInHref}
          certificate={done.certificate}
          needsName={done.needsName}
          programmes={programmes}
          canReview={signedIn}
          onReview={() => {
            setTab("reviews");
            void refresh();
          }}
          onClose={() => setDone(null)}
        />
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------

function Curriculum({
  lessons,
  index,
  progress,
  share,
  finished,
  certificate,
  onChoose,
  highlight,
}: {
  lessons: ProviderVideo[];
  index: number;
  progress: ProgressMap;
  share: number;
  finished: number;
  certificate: Certificate | null;
  onChoose: (position: number) => void;
  highlight: boolean;
}) {
  const t = useTranslations("Classroom");
  const groups = useMemo(() => {
    const result: { title: string; items: { lesson: ProviderVideo; position: number }[] }[] = [];
    lessons.forEach((lesson, position) => {
      const title = lesson.section ?? "";
      const last = result[result.length - 1];
      if (last && last.title === title) last.items.push({ lesson, position });
      else result.push({ title, items: [{ lesson, position }] });
    });
    return result;
  }, [lessons]);
  const [closed, setClosed] = useState<Record<number, boolean>>({});
  const total = lessons.reduce((sum, lesson) => sum + (lesson.duration_seconds ?? 0), 0);

  return (
    <nav
      aria-label={t("contents")}
      className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-4 border-b border-[var(--color-border)] bg-gradient-to-br from-[var(--color-brand-soft)]/70 to-transparent p-4">
        <ProgressRing value={share} label={t("progressLabel", { done: finished, count: lessons.length })} />
        <div className="min-w-0">
          <h2 className="font-extrabold">{t("contents")}</h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t("doneOf", { done: finished, count: lessons.length })} · {clock(total)}
          </p>
          {certificate ? (
            <Link
              href={certificate.path}
              className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[var(--color-warn)] hover:underline"
            >
              <Award aria-hidden="true" className="size-3.5" />
              {t("viewCertificate")}
            </Link>
          ) : null}
        </div>
      </div>
      <div className="max-h-[min(60vh,34rem)] overflow-y-auto p-2">
        {groups.map((group, g) => {
          const isClosed = closed[g] ?? false;
          const groupDone = group.items.filter(({ lesson }) => progress[String(lesson.id)]?.completed).length;
          return (
            <div key={`${group.title}-${g}`} className="mb-1">
              {group.title ? (
                <button
                  type="button"
                  onClick={() => setClosed((map) => ({ ...map, [g]: !isClosed }))}
                  aria-expanded={!isClosed}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-muted)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold">{group.title}</span>
                    <span className="block text-[11px] text-[var(--color-muted-foreground)]">
                      {t("doneOf", { done: groupDone, count: group.items.length })}
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 transition-transform ${isClosed ? "-rotate-90" : ""}`}
                  />
                </button>
              ) : null}
              {!isClosed ? (
                <ol className="space-y-0.5">
                  {group.items.map(({ lesson, position }) => {
                    const row = progress[String(lesson.id)];
                    const active = position === index;
                    const partial =
                      row && !row.completed && lesson.duration_seconds
                        ? Math.min(100, (row.furthest / lesson.duration_seconds) * 100)
                        : 0;
                    return (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          onClick={() => onChoose(position)}
                          aria-current={active ? "true" : undefined}
                          className={`group flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[var(--color-muted)] aria-[current=true]:bg-[var(--color-brand-soft)] ${
                            active && highlight ? "ring-2 ring-[var(--color-brand)]/25" : ""
                          }`}
                        >
                          <span
                            className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors ${
                              row?.completed
                                ? "bg-[var(--color-visit)] text-white"
                                : active
                                  ? "bg-[var(--color-brand)] text-white"
                                  : "bg-[var(--color-muted)] text-[var(--color-foreground)]/70"
                            }`}
                          >
                            {row?.completed ? (
                              <CheckCircle2 aria-label={t("finished")} className="size-4" />
                            ) : lesson.locked ? (
                              <Lock aria-label={t("locked")} className="size-3.5" />
                            ) : active ? (
                              <PlayCircle aria-hidden="true" className="size-4" />
                            ) : (
                              position + 1
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-semibold leading-5">{lesson.title}</span>
                            <span className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                              {lesson.duration_seconds ? clock(lesson.duration_seconds) : null}
                              {lesson.captions?.length ? <span className="font-bold">CC</span> : null}
                            </span>
                            {partial > 0 ? (
                              <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--color-muted)]">
                                <span className="block h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${partial}%` }} />
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function Countdown({ until }: { until: string }) {
  const t = useTranslations("Classroom");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, new Date(until).getTime() - now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return (
    <span className="tabular-nums">
      {days ? t("endsInDays", { days, hours }) : t("endsInHours", { hours, minutes })}
    </span>
  );
}

function BuyPanel({
  course,
  access,
  busy,
  problem,
  signInHref,
  onBuy,
}: {
  course: CourseCard;
  access: CourseAccess;
  busy: "buying" | "checking" | null;
  problem: string | null;
  signInHref: string;
  onBuy: (code?: string) => void;
}) {
  const t = useTranslations("Classroom");
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<{ code: string; price: string; percent: number } | null>(null);
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const price = applied?.price ?? access.price ?? course.price;
  const was = applied ? access.price : access.full_price;

  async function apply(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    setCodeProblem(null);
    try {
      const reply = await checkCourseCode(course.area_slug, course.slug, code);
      setApplied({ code: reply.code, price: reply.price, percent: reply.percent_off });
    } catch (error) {
      setCodeProblem(error instanceof TrainerApiError ? error.message : t("tryAgain"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-brand)]/20 bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-[var(--color-brand-soft)] blur-2xl" />
      <p className="relative text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-brand)]">{t("unlockTitle")}</p>
      <p className="relative mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tracking-tight text-[var(--color-brand-deep)]">
          {price ? formatCedis(price) : ""}
        </span>
        {was ? <span className="text-base text-[var(--color-muted-foreground)] line-through">{formatCedis(was)}</span> : null}
      </p>
      {access.sale_ends_at && !applied ? (
        <p className="relative mt-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-warn-bg)] px-2.5 py-1 text-xs font-bold text-[var(--color-warn)]">
          <Tag aria-hidden="true" className="size-3.5" />
          {t("launchPrice")} · <Countdown until={access.sale_ends_at} />
        </p>
      ) : null}
      {applied ? (
        <p className="relative mt-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-visit-bg)] px-2.5 py-1 text-xs font-bold text-[var(--color-visit)]">
          <Ticket aria-hidden="true" className="size-3.5" />
          {t("codeApplied", { code: applied.code, percent: applied.percent })}
        </p>
      ) : null}
      <ul className="relative mt-3 space-y-1.5 text-sm text-[var(--color-foreground)]/80">
        <li className="flex gap-2">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
          {t("perkLessons")}
        </li>
        <li className="flex gap-2">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
          {t("perkCertificate")}
        </li>
        <li className="flex gap-2">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
          {t("perkOffline")}
        </li>
      </ul>
      <div className="relative mt-4">
        {!access.payments_enabled ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("buyUnavailable")}</p>
        ) : access.signed_in ? (
          <button
            type="button"
            onClick={() => onBuy(applied?.code)}
            disabled={busy !== null}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] text-base font-bold text-white shadow-lg shadow-[var(--color-brand)]/25 transition hover:bg-[var(--color-brand-strong)] disabled:opacity-70"
          >
            {busy === "buying" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {busy === "buying" ? t("buying") : t("buyNow", { price: price ? formatCedis(price) : "" })}
          </button>
        ) : (
          <a
            href={signInHref}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[var(--color-brand)] text-base font-bold text-white hover:bg-[var(--color-brand-strong)]"
          >
            {t("signInToBuy")}
          </a>
        )}
        <p className="mt-2 text-center text-xs text-[var(--color-muted-foreground)]">{t("payWith")}</p>
      </div>
      {access.payments_enabled ? (
        <div className="relative mt-3 border-t border-[var(--color-border)] pt-3">
          {open ? (
            <form onSubmit={apply} className="flex gap-2">
              <label htmlFor="promo" className="sr-only">
                {t("codeLabel")}
              </label>
              <input
                id="promo"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder={t("codeLabel")}
                maxLength={20}
                autoCapitalize="characters"
                className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--color-input)] px-3 text-sm font-semibold uppercase tracking-wider outline-none focus:border-[var(--color-brand)]"
              />
              <button
                type="submit"
                disabled={checking || code.trim().length < 3}
                className="h-10 rounded-lg border border-[var(--color-border-strong)] px-3 text-sm font-bold hover:bg-[var(--color-muted)] disabled:opacity-50"
              >
                {checking ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : t("apply")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand)] hover:underline"
            >
              <Ticket aria-hidden="true" className="size-4" />
              {t("haveCode")}
            </button>
          )}
          {codeProblem ? (
            <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">
              {codeProblem}
            </p>
          ) : null}
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="relative mt-3 text-sm font-semibold text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Where a locked lesson's player would be: its still, and the way to buy. */
function LockedLesson({
  poster,
  price,
  busy,
  problem,
  signedIn,
  paymentsEnabled,
  signInHref,
  onBuy,
}: {
  poster: string | null;
  price: string | null;
  busy: "buying" | "checking" | null;
  problem: string | null;
  signedIn: boolean;
  paymentsEnabled: boolean;
  signInHref: string;
  onBuy: () => void;
}) {
  const t = useTranslations("Classroom");
  const action =
    "inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-[var(--color-brand)] shadow-lg hover:bg-white/90 disabled:opacity-70";
  return (
    <div className="relative grid aspect-video place-items-center overflow-hidden text-center text-white">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 size-full scale-105 object-cover opacity-40 blur-[3px]" />
      ) : null}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[var(--color-brand-deep)]/80 via-black/50 to-black/70" />
      <div className="relative max-w-sm px-6 py-4">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
          <Lock aria-hidden="true" className="size-6" />
        </span>
        <p className="mt-3 text-lg font-extrabold sm:text-xl">{t("lockedTitle")}</p>
        <p className="mt-1 text-sm leading-relaxed text-white/80">
          {t("lockedBody", { price: price ? formatCedis(price) : "" })}
        </p>
        <div className="mt-4">
          {busy === "checking" ? (
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {t("checkingPayment")}
            </p>
          ) : !paymentsEnabled ? (
            <p className="text-sm text-white/80">{t("buyUnavailable")}</p>
          ) : signedIn ? (
            <button type="button" onClick={onBuy} disabled={busy !== null} className={action}>
              {busy === "buying" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {busy === "buying" ? t("buying") : t("buyNow", { price: price ? formatCedis(price) : "" })}
            </button>
          ) : (
            <a href={signInHref} className={action}>
              {t("signInToBuy")}
            </a>
          )}
        </div>
        {problem ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-[var(--color-peach)]">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}
