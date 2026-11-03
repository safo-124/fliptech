"use client";

import {
  Award,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Eye,
  GraduationCap,
  LayoutList,
  Loader2,
  MessageCircleQuestion,
  Megaphone,
  PenLine,
  PlayCircle,
  Send,
  Sparkles,
  Star,
  Ticket,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Stars } from "@/components/learn/Stars";
import { TrainerCourseSales } from "@/components/trainer/TrainerCourseSales";
import {
  answerQuestion,
  buyStudioBoost,
  createStudioCode,
  deleteStudioCode,
  getStudioBoost,
  getStudioCodes,
  getStudioDetails,
  getStudioQuestions,
  getStudioReviews,
  getStudioStats,
  replyToReview,
  saveStudioDetails,
  setStudioCodeActive,
  verifyStudioBoost,
} from "@/lib/course-api";
import { formatCedis } from "@/lib/format";
import { TrainerApiError } from "@/lib/trainer-fetch";
import type { CourseReview, StudioCode, StudioDetails, StudioQuestion, StudioStats } from "@/lib/types";

import { LessonFunnel, PlaysChart } from "./StudioCharts";
import { ToolProducts } from "@/components/trainer/studio/ToolProducts";
import { StudioLessons } from "./StudioLessons";

type Tab = "overview" | "lessons" | "page" | "selling" | "learners";

const TABS: { id: Tab; icon: typeof BarChart3 }[] = [
  { id: "overview", icon: BarChart3 },
  { id: "lessons", icon: LayoutList },
  { id: "page", icon: PenLine },
  { id: "selling", icon: Wallet },
  { id: "learners", icon: Users },
];

const field =
  "w-full rounded-xl border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-sm outline-none transition focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/15";

/**
 * The trainer's course studio: how the course is doing, its lessons, its
 * page, selling it, and its learners. See backend courses/studio.py.
 */
export function CourseStudio() {
  const t = useTranslations("CourseStudio");
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    if (params.get("boost")) return "selling";
    const wanted = params.get("tab");
    return TABS.find((item) => item.id === wanted)?.id ?? "overview";
  });
  const [unanswered, setUnanswered] = useState(0);
  const [coursePath, setCoursePath] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    getStudioDetails()
      .then((details) => setCoursePath(details.course_path))
      .catch((error) => {
        if (error instanceof TrainerApiError && [401, 403, 404].includes(error.status)) setSignedOut(true);
      });
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  }

  if (signedOut) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-dashed border-[var(--color-border-strong)] p-8 text-center">
        <GraduationCap aria-hidden="true" className="mx-auto size-10 text-[var(--color-brand)]" />
        <h1 className="mt-3 text-xl font-extrabold">{t("signedOutTitle")}</h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">{t("signedOutBody")}</p>
        <Link
          href="/trainer/dashboard"
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white"
        >
          {t("toDashboard")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <header className="relative overflow-hidden rounded-3xl band px-5 py-6 text-white sm:px-8 sm:py-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-[var(--color-brand-pink)]/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-peach)]">{t("eyebrow")}</p>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">{t("title")}</h1>
            <p className="mt-1.5 max-w-[60ch] text-sm text-white/75">{t("lead")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {coursePath ? (
              <Link
                href={coursePath}
                target="_blank"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 text-sm font-semibold hover:bg-white/20"
              >
                <Eye aria-hidden="true" className="size-4" />
                {t("viewCourse")}
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </Link>
            ) : null}
            <Link
              href="/trainer/dashboard#videos"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-[var(--color-brand)] hover:bg-white/90"
            >
              <PlayCircle aria-hidden="true" className="size-4" />
              {t("addLesson")}
            </Link>
          </div>
        </div>
      </header>

      <div role="tablist" aria-label={t("title")} className="sticky top-14 z-20 -mx-3 mt-5 flex gap-1 overflow-x-auto bg-[var(--color-background)]/90 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-full sm:border sm:border-[var(--color-border)] sm:bg-[var(--color-card)]/90 sm:p-1.5">
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`studio-${id}`}
            onClick={() => choose(id)}
            className="relative inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[var(--color-muted-foreground)] transition hover:text-[var(--color-foreground)] aria-selected:bg-[var(--color-brand)] aria-selected:text-white aria-selected:shadow-md"
          >
            <Icon aria-hidden="true" className="size-4" />
            {t(`tab.${id}`)}
            {id === "learners" && unanswered ? (
              <span className="grid min-w-5 place-items-center rounded-full bg-[var(--color-coral)] px-1 text-[11px] font-extrabold text-white">
                {unanswered}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div id={`studio-${tab}`} role="tabpanel" className="mt-6 animate-[fade-in_0.25s_ease-out]">
        {tab === "overview" ? (
          <Overview onUnanswered={setUnanswered} onGo={choose} />
        ) : tab === "lessons" ? (
          <StudioLessons />
        ) : tab === "page" ? (
          <CoursePageEditor />
        ) : tab === "selling" ? (
          <Selling />
        ) : (
          <Learners onUnanswered={setUnanswered} />
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------

function Overview({ onUnanswered, onGo }: { onUnanswered: (n: number) => void; onGo: (tab: Tab) => void }) {
  const t = useTranslations("CourseStudio");
  const [stats, setStats] = useState<StudioStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getStudioStats()
      .then((loaded) => {
        setStats(loaded);
        onUnanswered(loaded.totals.unanswered);
      })
      .catch(() => setFailed(true));
  }, [onUnanswered]);

  if (failed) return <p role="alert" className="text-sm text-[var(--color-destructive)]">{t("loadFailed")}</p>;
  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="h-28 animate-pulse rounded-2xl bg-[var(--color-muted)]" />
        ))}
      </div>
    );
  }
  const { totals } = stats;
  const tiles = [
    { icon: PlayCircle, label: t("tilePlays"), value: totals.plays_30.toLocaleString(), sub: t("tilePlaysSub", { count: totals.plays }) },
    { icon: Users, label: t("tileLearners"), value: totals.learners.toLocaleString(), sub: t("tileCertificates", { count: totals.certificates }) },
    { icon: Wallet, label: t("tileEarned"), value: formatCedis(totals.earned_30), sub: t("tileEarnedSub", { total: formatCedis(totals.earned), count: totals.sales }) },
    {
      icon: Star,
      label: t("tileRating"),
      value: stats.ratings.average ? stats.ratings.average.toFixed(1) : "–",
      sub: t("tileRatingSub", { count: stats.ratings.count }),
    },
  ];

  return (
    <div className="space-y-6">
      {totals.unanswered ? (
        <button
          type="button"
          onClick={() => onGo("learners")}
          className="flex w-full items-center gap-3 rounded-2xl border border-[var(--color-coral)]/40 bg-[var(--color-coral)]/10 p-4 text-left hover:bg-[var(--color-coral)]/15"
        >
          <MessageCircleQuestion aria-hidden="true" className="size-6 shrink-0 text-[var(--color-coral)]" />
          <span className="text-sm">
            <strong>{t("unansweredTitle", { count: totals.unanswered })}</strong> {t("unansweredBody")}
          </span>
        </button>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value, sub }) => (
          <li key={label} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
            <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
              <span className="grid size-8 place-items-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              {label}
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-[var(--color-brand-deep)]">{value}</p>
            <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{sub}</p>
          </li>
        ))}
      </ul>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="plays-heading" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
          <h2 id="plays-heading" className="font-bold">{t("playsTitle")}</h2>
          <p className="mb-5 text-xs text-[var(--color-muted-foreground)]">{t("playsSub")}</p>
          <PlaysChart daily={stats.daily} />
        </section>
        <section aria-labelledby="funnel-heading" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
          <h2 id="funnel-heading" className="font-bold">{t("funnelTitle")}</h2>
          <p className="mb-4 text-xs text-[var(--color-muted-foreground)]">{t("funnelSub")}</p>
          {stats.lessons.length ? (
            <LessonFunnel lessons={stats.lessons} />
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("noLessons")}</p>
          )}
        </section>
      </div>

      {stats.codes.length ? (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
          <h2 className="font-bold">{t("codesUsed")}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {stats.codes.map((code) => (
              <li key={code.code} className="rounded-full bg-[var(--color-muted)] px-3 py-1 text-sm">
                <span className="font-mono font-bold">{code.code}</span> · {t("salesCount", { count: code.uses })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------

function CoursePageEditor() {
  const t = useTranslations("CourseStudio");
  const [details, setDetails] = useState<StudioDetails | null>(null);
  const [form, setForm] = useState({ summary: "", outcomes: "", tools: "", level: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getStudioDetails()
      .then((loaded) => {
        setDetails(loaded);
        setForm({ summary: loaded.summary, outcomes: loaded.outcomes, tools: loaded.tools, level: loaded.level });
      })
      .catch(() => setNote({ ok: false, text: t("loadFailed") }));
  }, [t]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      setDetails(await saveStudioDetails(form));
      setNote({ ok: true, text: t("pageSaved") });
    } catch (error) {
      setNote({ ok: false, text: error instanceof TrainerApiError ? error.message : t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }

  if (!details) {
    return note ? <p role="alert" className="text-sm text-[var(--color-destructive)]">{note.text}</p> : <Loader2 className="size-5 animate-spin" />;
  }

  const outcomes = form.outcomes.split("\n").map((line) => line.replace(/^[\s\-•]+/, "").trim()).filter(Boolean);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <form onSubmit={save} className="space-y-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
        <div>
          <label htmlFor="studio-summary" className="text-sm font-bold">{t("summaryLabel")}</label>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("summaryHelp")}</p>
          <textarea
            id="studio-summary"
            value={form.summary}
            onChange={(event) => setForm({ ...form, summary: event.target.value })}
            rows={3}
            maxLength={1200}
            className={`${field} mt-1.5 py-2.5`}
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="studio-outcomes" className="text-sm font-bold">{t("outcomesLabel")}</label>
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("oneALine")}</p>
            <textarea
              id="studio-outcomes"
              value={form.outcomes}
              onChange={(event) => setForm({ ...form, outcomes: event.target.value })}
              rows={6}
              maxLength={1500}
              placeholder={t("outcomesPlaceholder")}
              className={`${field} mt-1.5 py-2.5`}
            />
          </div>
          <div>
            <label htmlFor="studio-tools" className="text-sm font-bold">{t("toolsLabel")}</label>
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("oneALine")}</p>
            <textarea
              id="studio-tools"
              value={form.tools}
              onChange={(event) => setForm({ ...form, tools: event.target.value })}
              rows={6}
              maxLength={1000}
              placeholder={t("toolsPlaceholder")}
              className={`${field} mt-1.5 py-2.5`}
            />
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-bold">{t("levelLabel")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {[{ value: "", label: t("levelNone") }, ...details.levels].map((option) => (
              <label
                key={option.value}
                className="cursor-pointer rounded-full border border-[var(--color-border-strong)] px-4 py-2 text-sm font-semibold transition has-[:checked]:border-transparent has-[:checked]:bg-[var(--color-brand)] has-[:checked]:text-white"
              >
                <input
                  type="radio"
                  name="level"
                  value={option.value}
                  checked={form.level === option.value}
                  onChange={() => setForm({ ...form, level: option.value })}
                  className="sr-only"
                />
                {option.value ? t(`level.${option.value as "beginner" | "intermediate" | "advanced"}`) : option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-6 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-60"
          >
            {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t("savePage")}
          </button>
          {note ? (
            <span role="status" className={`text-sm font-semibold ${note.ok ? "text-[var(--color-visit)]" : "text-[var(--color-destructive)]"}`}>
              {note.text}
            </span>
          ) : null}
        </div>
      </form>
      <div className="lg:col-start-1">
        <ToolProducts details={details} onSaved={setDetails} />
      </div>

      {/* A preview of what learners will read. */}
      <aside aria-label={t("preview")} className="h-fit rounded-2xl border border-dashed border-[var(--color-border-strong)] p-5 lg:sticky lg:top-32">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">{t("preview")}</p>
        <p className="mt-3 text-sm leading-relaxed">{form.summary || <span className="text-[var(--color-muted-foreground)]">{t("previewEmpty")}</span>}</p>
        {outcomes.length ? (
          <>
            <p className="mt-4 text-sm font-extrabold">{t("outcomesLabel")}</p>
            <ul className="mt-2 space-y-1.5">
              {outcomes.map((outcome) => (
                <li key={outcome} className="flex gap-2 text-sm">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
                  {outcome}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </aside>
    </div>
  );
}

// --------------------------------------------------------------------------

function Selling() {
  const t = useTranslations("CourseStudio");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <TrainerCourseSales />
        <LaunchPrice />
      </div>
      <div className="space-y-6">
        <PromoCodes />
        <Promote />
        <p className="text-xs text-[var(--color-muted-foreground)]">{t("sellingNote")}</p>
      </div>
    </div>
  );
}

function Panel({ icon: Icon, title, lead, children }: { icon: typeof Ticket; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
      <h2 className="flex items-center gap-2 font-bold">
        <span className="grid size-8 place-items-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        {title}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{lead}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LaunchPrice() {
  const t = useTranslations("CourseStudio");
  const [details, setDetails] = useState<StudioDetails | null>(null);
  const [price, setPrice] = useState("");
  const [ends, setEnds] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getStudioDetails()
      .then((loaded) => {
        setDetails(loaded);
        setPrice(loaded.sale_price ?? "");
        setEnds(loaded.sale_ends_at ? loaded.sale_ends_at.slice(0, 10) : "");
      })
      .catch(() => {});
  }, []);

  async function save(clear = false) {
    setBusy(true);
    setNote(null);
    try {
      const reply = await saveStudioDetails(clear ? { sale_price: "" } : { sale_price: price, sale_ends_at: ends || null });
      setDetails(reply);
      if (clear) {
        setPrice("");
        setEnds("");
      }
      setNote({ ok: true, text: clear ? t("saleEnded") : t("saleSaved") });
    } catch (error) {
      setNote({ ok: false, text: error instanceof TrainerApiError ? error.message : t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }

  if (!details) return null;
  return (
    <Panel icon={Sparkles} title={t("saleTitle")} lead={details.price ? t("saleLead", { price: formatCedis(details.price) }) : t("saleNeedsPrice")}>
      {details.price ? (
        <>
          {details.on_sale ? (
            <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-visit-bg)] px-3 py-1 text-xs font-bold text-[var(--color-visit)]">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {t("saleOn", { price: formatCedis(details.sale_price ?? "0") })}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sale-price" className="text-sm font-semibold">{t("salePriceLabel")}</label>
              <input id="sale-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="99" className={`${field} mt-1 h-11`} />
            </div>
            <div>
              <label htmlFor="sale-ends" className="text-sm font-semibold">{t("saleEndsLabel")}</label>
              <input id="sale-ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className={`${field} mt-1 h-11`} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={busy || !price} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {t("saveSale")}
            </button>
            {details.sale_price ? (
              <button type="button" onClick={() => void save(true)} disabled={busy} className="min-h-10 rounded-full px-4 text-sm font-semibold text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]">
                {t("endSale")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {note ? <p role="status" className={`mt-2 text-sm ${note.ok ? "text-[var(--color-visit)]" : "text-[var(--color-destructive)]"}`}>{note.text}</p> : null}
    </Panel>
  );
}

function PromoCodes() {
  const t = useTranslations("CourseStudio");
  const [codes, setCodes] = useState<StudioCode[] | null>(null);
  const [form, setForm] = useState({ code: "", percent_off: "20", max_uses: "", expires_at: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    getStudioCodes().then((reply) => setCodes(reply.codes)).catch(() => setCodes([]));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const made = await createStudioCode({
        code: form.code,
        percent_off: Number(form.percent_off),
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        expires_at: form.expires_at || null,
      });
      setCodes((list) => [made, ...(list ?? [])]);
      setForm({ code: "", percent_off: "20", max_uses: "", expires_at: "" });
    } catch (error) {
      setProblem(error instanceof TrainerApiError ? error.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon={Ticket} title={t("codesTitle")} lead={t("codesLead")}>
      <form onSubmit={create} className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <label htmlFor="code-word" className="sr-only">{t("codeLabel")}</label>
        <input id="code-word" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="LAUNCH20" maxLength={20} className={`${field} h-11 font-mono font-bold uppercase tracking-wider`} />
        <label htmlFor="code-off" className="sr-only">{t("percentLabel")}</label>
        <select id="code-off" value={form.percent_off} onChange={(e) => setForm({ ...form, percent_off: e.target.value })} className={`${field} h-11`}>
          {[10, 15, 20, 25, 30, 40, 50].map((n) => (
            <option key={n} value={n}>{t("percentOff", { percent: n })}</option>
          ))}
        </select>
        <label htmlFor="code-uses" className="sr-only">{t("maxUsesLabel")}</label>
        <input id="code-uses" inputMode="numeric" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value.replace(/\D/g, "") })} placeholder={t("maxUsesLabel")} className={`${field} h-11`} />
        <label htmlFor="code-ends" className="sr-only">{t("codeEndsLabel")}</label>
        <input id="code-ends" type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} className={`${field} h-11 sm:col-span-1`} title={t("codeEndsLabel")} />
        <button type="submit" disabled={busy || form.code.length < 3} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Ticket aria-hidden="true" className="size-4" />}
          {t("createCode")}
        </button>
      </form>
      {problem ? <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{problem}</p> : null}
      {codes?.length ? (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {codes.map((code) => (
            <li key={code.id} className="flex items-center gap-3 py-2.5">
              <span className={`rounded-lg border-2 border-dashed px-2.5 py-1 font-mono text-sm font-bold tracking-wider ${code.usable ? "border-[var(--color-brand)]/40 text-[var(--color-brand)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)] line-through"}`}>
                {code.code}
              </span>
              <span className="min-w-0 flex-1 text-xs text-[var(--color-muted-foreground)]">
                {t("percentOff", { percent: code.percent_off })} · {t("usesCount", { uses: code.uses, max: code.max_uses ?? "∞" })}
                {code.expires_at ? ` · ${t("until", { date: new Date(code.expires_at).toLocaleDateString("en-GB") })}` : ""}
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={code.is_active}
                  onChange={async (e) => {
                    const updated = await setStudioCodeActive(code.id, e.target.checked);
                    setCodes((list) => list?.map((c) => (c.id === code.id ? updated : c)) ?? null);
                  }}
                  className="size-4 accent-[var(--color-brand)]"
                />
                {t("on")}
              </label>
              <button
                type="button"
                onClick={async () => {
                  await deleteStudioCode(code.id);
                  setCodes((list) => list?.filter((c) => c.id !== code.id) ?? null);
                }}
                aria-label={t("deleteCode", { code: code.code })}
                className="grid size-9 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-destructive)]"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function Promote() {
  const t = useTranslations("CourseStudio");
  const [boost, setBoost] = useState<Awaited<ReturnType<typeof getStudioBoost>> | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => getStudioBoost().then(setBoost).catch(() => {}), []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const reference = url.searchParams.get("boost");
    (async () => {
      if (reference) {
        for (const name of ["boost", "reference", "trxref"]) url.searchParams.delete(name);
        window.history.replaceState(null, "", url.toString());
        try {
          const result = await verifyStudioBoost(reference);
          setNote(result.status === "paid" ? { ok: true, text: t("boostPaid") } : { ok: false, text: t("boostNotPaid") });
        } catch (error) {
          setNote({ ok: false, text: error instanceof TrainerApiError ? error.message : t("boostNotPaid") });
        }
      }
      await load();
    })();
  }, [load, t]);

  async function buy(days: number) {
    setBusy(days);
    setNote(null);
    try {
      const { authorization_url } = await buyStudioBoost(days);
      window.location.assign(authorization_url);
    } catch (error) {
      setNote({ ok: false, text: error instanceof TrainerApiError ? error.message : t("saveFailed") });
      setBusy(null);
    }
  }

  if (!boost) return null;
  return (
    <Panel icon={Megaphone} title={t("boostTitle")} lead={t("boostLead")}>
      {boost.featured_until ? (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--color-sand)] to-[var(--color-peach)] px-3 py-1 text-xs font-extrabold text-[var(--color-brand-deep)]">
          <Sparkles aria-hidden="true" className="size-3.5" />
          {t("featuredUntil", { date: new Date(boost.featured_until).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) })}
        </p>
      ) : null}
      {boost.payments_enabled ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {boost.options.map((option) => (
            <button
              key={option.days}
              type="button"
              onClick={() => void buy(option.days)}
              disabled={busy !== null}
              className="group rounded-2xl border border-[var(--color-border)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-brand)]/40 hover:shadow-[var(--shadow-card)] disabled:opacity-60"
            >
              <span className="block text-sm font-semibold text-[var(--color-muted-foreground)]">
                {option.days === 7 ? t("aWeek") : t("aMonth")}
              </span>
              <span className="mt-1 block text-2xl font-extrabold text-[var(--color-brand-deep)]">{formatCedis(option.price)}</span>
              <span className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-[var(--color-brand)]">
                {busy === option.days ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Sparkles aria-hidden="true" className="size-4" />}
                {t("featureIt")}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("boostOff")}</p>
      )}
      {note ? <p role="status" className={`mt-3 text-sm font-semibold ${note.ok ? "text-[var(--color-visit)]" : "text-[var(--color-destructive)]"}`}>{note.text}</p> : null}
    </Panel>
  );
}

// --------------------------------------------------------------------------

function Learners({ onUnanswered }: { onUnanswered: (n: number) => void }) {
  const t = useTranslations("CourseStudio");
  const [questions, setQuestions] = useState<StudioQuestion[] | null>(null);
  const [reviews, setReviews] = useState<{ summary: { average: number | null; count: number }; reviews: CourseReview[] } | null>(null);

  useEffect(() => {
    getStudioQuestions()
      .then((reply) => {
        setQuestions(reply.questions);
        onUnanswered(reply.questions.filter((q) => !q.answered_at).length);
      })
      .catch(() => setQuestions([]));
    getStudioReviews().then(setReviews).catch(() => setReviews({ summary: { average: null, count: 0 }, reviews: [] }));
  }, [onUnanswered]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel icon={MessageCircleQuestion} title={t("questionsTitle")} lead={t("questionsLead")}>
        {questions === null ? (
          <Loader2 className="size-5 animate-spin" />
        ) : questions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("noQuestions")}</p>
        ) : (
          <ul className="space-y-3">
            {questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                onAnswered={(updated) => {
                  setQuestions((list) => {
                    const next = list?.map((q) => (q.id === updated.id ? updated : q)) ?? null;
                    onUnanswered(next?.filter((q) => !q.answered_at).length ?? 0);
                    return next;
                  });
                }}
              />
            ))}
          </ul>
        )}
      </Panel>
      <Panel icon={Award} title={t("reviewsTitle")} lead={t("reviewsLead")}>
        {reviews === null ? (
          <Loader2 className="size-5 animate-spin" />
        ) : reviews.reviews.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("noReviews")}</p>
        ) : (
          <>
            <p className="mb-3 flex items-center gap-2 text-sm">
              <Stars value={reviews.summary.average ?? 0} />
              <strong>{reviews.summary.average?.toFixed(1)}</strong>
              <span className="text-[var(--color-muted-foreground)]">{t("tileRatingSub", { count: reviews.summary.count })}</span>
            </p>
            <ul className="space-y-3">
              {reviews.reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </ul>
          </>
        )}
      </Panel>
      <p className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] lg:col-span-2">
        <GraduationCap aria-hidden="true" className="size-4" />
        {t("learnersNote")}
      </p>
    </div>
  );
}

function QuestionCard({ question, onAnswered }: { question: StudioQuestion; onAnswered: (q: StudioQuestion) => void }) {
  const t = useTranslations("CourseStudio");
  const [answer, setAnswer] = useState(question.answer);
  const [editing, setEditing] = useState(!question.answered_at);
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      onAnswered(await answerQuestion(question.id, answer));
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-xl border p-3 ${question.answered_at ? "border-[var(--color-border)]" : "border-[var(--color-coral)]/40 bg-[var(--color-coral)]/5"}`}>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        <strong className="text-[var(--color-foreground)]">{question.name}</strong> · {question.lesson.title}
        {question.at_seconds !== null ? ` · ${Math.floor(question.at_seconds / 60)}:${String(question.at_seconds % 60).padStart(2, "0")}` : ""}
      </p>
      <p className="mt-1 text-sm">{question.body}</p>
      {editing ? (
        <form onSubmit={send} className="mt-2 flex gap-2">
          <label htmlFor={`answer-${question.id}`} className="sr-only">{t("yourAnswer")}</label>
          <textarea id={`answer-${question.id}`} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder={t("yourAnswer")} className={`${field} py-2`} />
          <button type="submit" disabled={busy || answer.trim().length < 2} aria-label={t("sendAnswer")} className="grid size-11 shrink-0 place-items-center self-end rounded-xl bg-[var(--color-brand)] text-white disabled:opacity-50">
            {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
          </button>
        </form>
      ) : (
        <div className="mt-2 rounded-lg bg-[var(--color-brand-soft)]/60 p-2.5 text-sm">
          {question.answer}
          <button type="button" onClick={() => setEditing(true)} className="ml-2 text-xs font-semibold text-[var(--color-brand)] hover:underline">
            {t("edit")}
          </button>
        </div>
      )}
    </li>
  );
}

function ReviewCard({ review }: { review: CourseReview }) {
  const t = useTranslations("CourseStudio");
  const [reply, setReply] = useState(review.reply);
  const [saved, setSaved] = useState(review.reply);
  const [busy, setBusy] = useState(false);
  return (
    <li className="rounded-xl border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{review.name}</strong>
        <Stars value={review.rating} size="size-3.5" />
      </div>
      {review.body ? <p className="mt-1 text-sm">{review.body}</p> : null}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            setSaved((await replyToReview(review.id, reply)).reply);
          } finally {
            setBusy(false);
          }
        }}
        className="mt-2 flex gap-2"
      >
        <label htmlFor={`reply-${review.id}`} className="sr-only">{t("yourReply")}</label>
        <input id={`reply-${review.id}`} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("yourReply")} className={`${field} h-10`} />
        <button type="submit" disabled={busy || reply === saved} className="h-10 shrink-0 rounded-xl border border-[var(--color-border-strong)] px-3 text-sm font-semibold disabled:opacity-40">
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : t("reply")}
        </button>
      </form>
    </li>
  );
}
