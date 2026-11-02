"use client";

import {
  ArrowDown,
  ArrowUp,
  Captions,
  CheckCircle2,
  ChevronDown,
  Clock3,
  GripVertical,
  Loader2,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type DragEvent } from "react";

import { clock } from "@/components/learn/LessonPlayer";
import { deleteCaptions, getStudioLessons, saveCaptions, saveLesson, saveLessonOrder } from "@/lib/course-api";
import { TrainerApiError } from "@/lib/trainer-fetch";
import type { StudioLesson } from "@/lib/types";

/**
 * The lessons as a course: drag (or nudge with the arrows) into order, put
 * them under section headings, say what each covers, and add captions.
 */
export function StudioLessons() {
  const t = useTranslations("CourseStudio");
  const [lessons, setLessons] = useState<StudioLesson[] | null>(null);
  const [languages, setLanguages] = useState<{ value: string; label: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    getStudioLessons()
      .then((reply) => {
        setLessons(reply.lessons);
        setLanguages(reply.languages);
      })
      .catch(() => setProblem(t("loadFailed")));
  }, [t]);

  const sections = useMemo(
    () => Array.from(new Set((lessons ?? []).map((lesson) => lesson.section).filter(Boolean))),
    [lessons],
  );

  function move(from: number, to: number) {
    if (!lessons || to < 0 || to >= lessons.length || from === to) return;
    const next = [...lessons];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setLessons(next);
    setDirty(true);
    setSaved(false);
  }

  function setSection(id: number, section: string) {
    setLessons((list) => list?.map((lesson) => (lesson.id === id ? { ...lesson, section } : lesson)) ?? null);
    setDirty(true);
    setSaved(false);
  }

  async function saveOrder() {
    if (!lessons) return;
    setSaving(true);
    setProblem(null);
    try {
      const reply = await saveLessonOrder(lessons.map((lesson) => ({ id: lesson.id, section: lesson.section })));
      setLessons(reply.lessons);
      setDirty(false);
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof TrainerApiError ? error.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function replace(updated: StudioLesson) {
    setLessons((list) => list?.map((lesson) => (lesson.id === updated.id ? { ...lesson, ...updated, section: lesson.section } : lesson)) ?? null);
  }

  if (!lessons) {
    return problem ? (
      <p role="alert" className="text-sm text-[var(--color-destructive)]">{problem}</p>
    ) : (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-16 animate-pulse rounded-2xl bg-[var(--color-muted)]" />
        ))}
      </div>
    );
  }

  if (!lessons.length) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{t("noLessons")}</p>;
  }

  return (
    <div>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t("lessonsHelp")}</p>
      <datalist id="studio-sections">
        {sections.map((section) => (
          <option key={section} value={section} />
        ))}
      </datalist>
      <ol className="mt-4 space-y-2">
        {lessons.map((lesson, index) => {
          const startsSection = lesson.section && lesson.section !== lessons[index - 1]?.section;
          return (
            <li key={lesson.id}>
              {startsSection ? (
                <p className="mb-1 mt-4 px-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-brand)]">
                  {lesson.section}
                </p>
              ) : null}
              <div
                draggable
                onDragStart={(event: DragEvent) => {
                  setDragging(index);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dragging !== null && dragging !== index) {
                    move(dragging, index);
                    setDragging(index);
                  }
                }}
                onDragEnd={() => setDragging(null)}
                className={`rounded-2xl border bg-[var(--color-card)] transition-shadow ${
                  dragging === index
                    ? "border-[var(--color-brand)] shadow-[var(--shadow-lg)]"
                    : "border-[var(--color-border)] shadow-[var(--shadow-card)]"
                }`}
              >
                <div className="flex items-center gap-2 p-2.5 sm:gap-3">
                  <span
                    aria-hidden="true"
                    className="hidden cursor-grab text-[var(--color-muted-foreground)] active:cursor-grabbing sm:block"
                  >
                    <GripVertical className="size-5" />
                  </span>
                  <span className="relative grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--color-brand-deep)] text-xs font-bold text-white sm:w-24">
                    {lesson.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={lesson.poster} alt="" className="absolute inset-0 size-full object-cover" />
                    ) : null}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[11px]">{index + 1}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{lesson.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted-foreground)]">
                      {lesson.duration_seconds ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 aria-hidden="true" className="size-3" />
                          {clock(lesson.duration_seconds)}
                        </span>
                      ) : null}
                      <StatusChip status={lesson.status} />
                      {lesson.captions.length ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-visit)]">
                          <Captions aria-hidden="true" className="size-3" />
                          {lesson.captions.map((c) => c.label).join(", ")}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0}
                      aria-label={t("moveUp", { title: lesson.title })}
                      className="grid size-9 place-items-center rounded-full hover:bg-[var(--color-muted)] disabled:opacity-30"
                    >
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, index + 1)}
                      disabled={index === lessons.length - 1}
                      aria-label={t("moveDown", { title: lesson.title })}
                      className="grid size-9 place-items-center rounded-full hover:bg-[var(--color-muted)] disabled:opacity-30"
                    >
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(open === lesson.id ? null : lesson.id)}
                      aria-expanded={open === lesson.id}
                      aria-label={t("editLesson", { title: lesson.title })}
                      className="grid size-9 place-items-center rounded-full hover:bg-[var(--color-muted)]"
                    >
                      <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open === lesson.id ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                </div>
                {open === lesson.id ? (
                  <LessonEditor
                    lesson={lesson}
                    languages={languages}
                    onSection={(section) => setSection(lesson.id, section)}
                    onSaved={replace}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div
        className={`sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-[var(--color-card)]/95 p-3 shadow-[var(--shadow-lg)] backdrop-blur transition ${
          dirty ? "border-[var(--color-brand)]/40" : "border-[var(--color-border)]"
        }`}
      >
        <p className="text-sm" role="status">
          {saved ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-visit)]">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {t("orderSaved")}
            </span>
          ) : dirty ? (
            <span className="font-semibold">{t("unsavedOrder")}</span>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">{t("orderHint")}</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => void saveOrder()}
          disabled={!dirty || saving}
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
        >
          {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
          {t("saveOrder")}
        </button>
        {problem ? (
          <p role="alert" className="w-full text-sm text-[var(--color-destructive)]">{problem}</p>
        ) : null}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const t = useTranslations("CourseStudio");
  const tone =
    status === "approved"
      ? "bg-[var(--color-visit-bg)] text-[var(--color-visit)]"
      : status === "rejected" || status === "failed"
        ? "bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]"
        : "bg-[var(--color-warn-bg)] text-[var(--color-warn)]";
  const key = (["approved", "rejected", "failed", "pending"].includes(status) ? status : "preparing") as
    | "approved"
    | "rejected"
    | "failed"
    | "pending"
    | "preparing";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{t(`status.${key}`)}</span>;
}

function LessonEditor({
  lesson,
  languages,
  onSection,
  onSaved,
}: {
  lesson: StudioLesson;
  languages: { value: string; label: string }[];
  onSection: (section: string) => void;
  onSaved: (lesson: StudioLesson) => void;
}) {
  const t = useTranslations("CourseStudio");
  const [description, setDescription] = useState(lesson.description);
  const [savingText, setSavingText] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [language, setLanguage] = useState(languages[0]?.value ?? "en");
  const [captions, setCaptions] = useState("");
  const [captionBusy, setCaptionBusy] = useState(false);
  const [captionNote, setCaptionNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveText() {
    setSavingText(true);
    setNote(null);
    try {
      onSaved(await saveLesson(lesson.id, { description }));
      setNote(t("saved"));
    } catch (error) {
      setNote(error instanceof TrainerApiError ? error.message : t("saveFailed"));
    } finally {
      setSavingText(false);
    }
  }

  async function sendCaptions() {
    setCaptionBusy(true);
    setCaptionNote(null);
    try {
      onSaved(await saveCaptions(lesson.id, language, captions));
      setCaptions("");
      setCaptionNote({ ok: true, text: t("captionsSaved") });
    } catch (error) {
      setCaptionNote({ ok: false, text: error instanceof TrainerApiError ? error.message : t("saveFailed") });
    } finally {
      setCaptionBusy(false);
    }
  }

  return (
    <div className="grid gap-5 border-t border-[var(--color-border)] p-4 animate-[fade-in_0.2s_ease-out] md:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label htmlFor={`section-${lesson.id}`} className="text-sm font-bold">
            {t("sectionLabel")}
          </label>
          <input
            id={`section-${lesson.id}`}
            list="studio-sections"
            defaultValue={lesson.section}
            onChange={(event) => onSection(event.target.value)}
            maxLength={80}
            placeholder={t("sectionPlaceholder")}
            className="mt-1 h-11 w-full rounded-xl border border-[var(--color-input)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("sectionHelp")}</p>
        </div>
        <div>
          <label htmlFor={`about-${lesson.id}`} className="text-sm font-bold">
            {t("descriptionLabel")}
          </label>
          <textarea
            id={`about-${lesson.id}`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={t("descriptionPlaceholder")}
            className="mt-1 w-full rounded-xl border border-[var(--color-input)] p-3 text-sm outline-none focus:border-[var(--color-brand)]"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--color-muted-foreground)]" role="status">
              {note}
            </span>
            <button
              type="button"
              onClick={() => void saveText()}
              disabled={savingText || description === lesson.description}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] px-4 text-sm font-semibold hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              {savingText ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {t("saveDescription")}
            </button>
          </div>
        </div>
      </div>

      <div>
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Captions aria-hidden="true" className="size-4" />
          {t("captionsTitle")}
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{t("captionsHelp")}</p>
        {lesson.captions.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {lesson.captions.map((caption) => (
              <li
                key={caption.language}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-visit-bg)] py-0.5 pl-3 pr-1 text-xs font-bold text-[var(--color-visit)]"
              >
                {caption.label}
                <button
                  type="button"
                  onClick={async () => onSaved(await deleteCaptions(lesson.id, caption.language))}
                  aria-label={t("removeCaptions", { language: caption.label })}
                  className="grid size-6 place-items-center rounded-full hover:bg-white/60"
                >
                  <Trash2 aria-hidden="true" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex gap-2">
          <label htmlFor={`lang-${lesson.id}`} className="sr-only">
            {t("captionLanguage")}
          </label>
          <select
            id={`lang-${lesson.id}`}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="h-10 rounded-xl border border-[var(--color-input)] bg-[var(--color-card)] px-2 text-sm"
          >
            {languages.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-[var(--color-border-strong)] px-3 text-sm font-semibold hover:bg-[var(--color-muted)]">
            <Upload aria-hidden="true" className="size-4" />
            {t("chooseFile")}
            <input
              type="file"
              accept=".srt,.vtt,text/vtt"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setCaptions(await file.text());
              }}
            />
          </label>
        </div>
        <label htmlFor={`captions-${lesson.id}`} className="sr-only">
          {t("captionsTitle")}
        </label>
        <textarea
          id={`captions-${lesson.id}`}
          value={captions}
          onChange={(event) => setCaptions(event.target.value)}
          rows={4}
          placeholder={"00:00:01.000 --> 00:00:04.000\n" + t("captionsExample")}
          className="mt-2 w-full rounded-xl border border-[var(--color-input)] p-3 font-mono text-xs outline-none focus:border-[var(--color-brand)]"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span
            role="status"
            className={`text-xs ${captionNote?.ok ? "text-[var(--color-visit)]" : "text-[var(--color-destructive)]"}`}
          >
            {captionNote?.text}
          </span>
          <button
            type="button"
            onClick={() => void sendCaptions()}
            disabled={captionBusy || captions.trim().length < 10}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
          >
            {captionBusy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t("saveCaptions")}
          </button>
        </div>
      </div>
    </div>
  );
}
