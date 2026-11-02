"use client";

import { Award, BookOpen, GraduationCap, Loader2, Play, Search, Trophy } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getMyCourses } from "@/lib/course-api";
import type { MyCourse } from "@/lib/types";

import { clock } from "./LessonPlayer";
import { ProgressRing } from "./ProgressRing";

type Filter = "going" | "done";

/** A trainee's own learning: courses going, courses finished, certificates. */
export function MyCourses() {
  const t = useTranslations("MyLearning");
  const [rows, setRows] = useState<MyCourse[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [filter, setFilter] = useState<Filter>("going");

  useEffect(() => {
    getMyCourses()
      .then((reply) => {
        setSignedOut(!reply.signed_in);
        setRows(reply.results);
      })
      .catch(() => setRows([]));
  }, []);

  const going = rows?.filter((row) => row.done < row.total) ?? [];
  const done = rows?.filter((row) => row.total && row.done >= row.total) ?? [];
  const certificates = rows?.filter((row) => row.certificate).length ?? 0;
  const lessonsDone = rows?.reduce((sum, row) => sum + row.done, 0) ?? 0;
  const shown = filter === "going" ? going : done;

  return (
    <div className="pb-14">
      <section className="band relative isolate overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-[var(--color-brand-pink)]/25 blur-3xl" />
        <div className="app-shell relative py-8 sm:py-10">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-peach)]">{t("eyebrow")}</p>
          <h1 className="mt-2 text-[1.75rem] font-extrabold tracking-[-0.035em] text-white sm:text-4xl">{t("title")}</h1>
          {rows && !signedOut ? (
            <dl className="mt-6 grid max-w-xl grid-cols-3 gap-3">
              {[
                { icon: BookOpen, label: t("statGoing"), value: going.length },
                { icon: Trophy, label: t("statLessons"), value: lessonsDone },
                { icon: Award, label: t("statCertificates"), value: certificates },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-2xl bg-white/10 p-3 backdrop-blur">
                  <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/65">
                    <Icon aria-hidden="true" className="size-3.5" />
                    {label}
                  </dt>
                  <dd className="mt-1 text-2xl font-extrabold tabular-nums text-white">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      <section className="app-shell mt-8">
        {rows === null ? (
          <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {t("loading")}
          </p>
        ) : signedOut ? (
          <Empty
            title={t("signedOutTitle")}
            body={t("signedOutBody")}
            href={`/trainee/sign-in?next=${encodeURIComponent("/learn/mine")}`}
            action={t("signIn")}
          />
        ) : rows.length === 0 ? (
          <Empty title={t("noneTitle")} body={t("noneBody")} href="/learn" action={t("browse")} />
        ) : (
          <>
            <div role="tablist" aria-label={t("title")} className="inline-flex rounded-full bg-[var(--color-muted)] p-1">
              {(["going", "done"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-[var(--color-muted-foreground)] transition aria-selected:bg-[var(--color-card)] aria-selected:text-[var(--color-foreground)] aria-selected:shadow-sm"
                >
                  {key === "going" ? t("tabGoing", { count: going.length }) : t("tabDone", { count: done.length })}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="mt-6 text-sm text-[var(--color-muted-foreground)]">
                {filter === "going" ? t("noneGoing") : t("noneDone")}
              </p>
            ) : (
              <ul className="mt-6 grid gap-4 md:grid-cols-2">
                {shown.map((row) => (
                  <li key={row.course.id} className="animate-[rise-in_0.35s_ease-out]">
                    <CourseRow row={row} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function CourseRow({ row }: { row: MyCourse }) {
  const t = useTranslations("MyLearning");
  const base = `/learn/${row.course.area_slug}/${row.course.slug}`;
  const share = row.total ? (row.done / row.total) * 100 : 0;
  return (
    <article className="flex h-full gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
      <Link href={base} className="relative block aspect-square w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--color-brand-deep)] sm:w-28">
        {row.course.poster ? <Image src={row.course.poster} alt="" fill className="object-cover" sizes="112px" /> : null}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-brand)]">
          {row.course.trade?.name ?? row.course.area}
        </p>
        <h2 className="mt-0.5 font-bold leading-snug">
          <Link href={base} className="hover:text-[var(--color-brand)]">
            {row.course.name}
          </Link>
        </h2>
        <div className="mt-2 flex items-center gap-3">
          <ProgressRing value={share} size={40} stroke={5} />
          <span className="text-sm text-[var(--color-muted-foreground)]">
            {t("doneOf", { done: row.done, count: row.total })}
          </span>
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {row.certificate ? (
            <Link
              href={row.certificate.path}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--color-warn-bg)] px-4 text-sm font-bold text-[var(--color-warn)] hover:brightness-95"
            >
              <Award aria-hidden="true" className="size-4" />
              {t("certificate")}
            </Link>
          ) : null}
          {row.resume ? (
            <Link
              href={`${base}?lesson=${row.resume.id}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)]"
            >
              <Play aria-hidden="true" className="size-4 fill-current" />
              {row.resume.position > 5 ? t("resumeShort", { time: clock(row.resume.position) }) : t("continue")}
            </Link>
          ) : (
            <Link
              href={base}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] px-4 text-sm font-semibold hover:bg-[var(--color-muted)]"
            >
              {t("watchAgain")}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function Empty({ title, body, href, action }: { title: string; body: string; href: string; action: string }) {
  return (
    <div className="mx-auto max-w-md rounded-3xl border border-dashed border-[var(--color-border-strong)] p-8 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
        <GraduationCap aria-hidden="true" className="size-7" />
      </span>
      <h2 className="mt-4 text-lg font-extrabold">{title}</h2>
      <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">{body}</p>
      <Link
        href={href}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)]"
      >
        <Search aria-hidden="true" className="size-4" />
        {action}
      </Link>
    </div>
  );
}
