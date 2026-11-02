"use client";

import { CheckCircle2, Download, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  removeLesson,
  saveLesson,
  useCanSaveOffline,
  useSavedLessons,
  type SavedLesson,
} from "@/lib/offline-lessons";
import type { ProviderVideo } from "@/lib/types";

/**
 * Keep this lesson on the phone, to watch again with no data. Only for a
 * lesson this viewer may play: the fetch passes the same lock as playing.
 */
export function SaveOffline({ video, course }: { video: ProviderVideo; course: SavedLesson["course"] }) {
  const t = useTranslations("Classroom");
  const ready = useCanSaveOffline();
  const saved = useSavedLessons()?.some((lesson) => lesson.id === video.id) ?? false;
  const [share, setShare] = useState<number | null>(null);
  const [problem, setProblem] = useState(false);

  if (!ready || video.kind !== "upload" || video.locked || !video.sources.length) return null;

  const mb = video.sources[0]?.bytes ? Math.max(1, Math.round(video.sources[0].bytes / 1024 ** 2)) : null;
  const base =
    "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors";

  if (saved) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`${base} border-transparent bg-[var(--color-visit-bg)] text-[var(--color-visit)]`}>
          <CheckCircle2 aria-hidden="true" className="size-4" />
          {t("savedOffline")}
        </span>
        <button
          type="button"
          onClick={() => void removeLesson(video.id)}
          aria-label={t("removeSaved")}
          title={t("removeSaved")}
          className="grid size-10 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-destructive)]"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={share !== null}
      onClick={async () => {
        setProblem(false);
        setShare(0);
        try {
          await saveLesson(video, course, setShare);
        } catch {
          setProblem(true);
        } finally {
          setShare(null);
        }
      }}
      className={`${base} relative overflow-hidden border-[var(--color-border-strong)] bg-[var(--color-card)] hover:bg-[var(--color-muted)] disabled:cursor-progress`}
    >
      {share !== null ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-[var(--color-brand-soft)] transition-[width]"
          style={{ width: `${share * 100}%` }}
        />
      ) : null}
      <span className="relative inline-flex items-center gap-2">
        {share !== null ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Download aria-hidden="true" className="size-4" />
        )}
        {share !== null
          ? t("saving", { percent: Math.round(share * 100) })
          : problem
            ? t("saveFailed")
            : mb
              ? t("saveOfflineSize", { mb })
              : t("saveOffline")}
      </span>
    </button>
  );
}
