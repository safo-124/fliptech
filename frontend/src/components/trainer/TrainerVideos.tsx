"use client";

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pause,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import Image from "next/image";
import {useTranslations} from "next-intl";
import {useCallback, useEffect, useRef, useState, type FormEvent} from "react";

import {Alert, AlertDescription} from "@/components/ui/alert";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Separator} from "@/components/ui/separator";
import {Skeleton} from "@/components/ui/skeleton";
import {BRAND} from "@/lib/brand";
import {deleteTrainerVideo, getTrainerVideos, startTrainerVideo} from "@/lib/trainer-api";
import {TrainerApiError} from "@/lib/trainer-fetch";
import type {TrainerVideo, TrainerVideoLimits, TrainerVideoStatus} from "@/lib/types";
import {UploadPaused, sameFile, sendFile} from "@/lib/video-upload";
import {thumbnailUrl} from "@/lib/youtube";

const STATUS_BADGE = {
  uploading: "secondary",
  queued: "secondary",
  processing: "secondary",
  failed: "warning",
  pending: "secondary",
  approved: "default",
  rejected: "warning",
} as const satisfies Record<TrainerVideoStatus, string>;

/** Statuses the server moves on by itself, so the page checks back. */
const MOVING: TrainerVideoStatus[] = ["queued", "processing"];
const POLL_MS = 15_000;

type FieldErrors = {file?: string; title?: string};

/** The upload this page is sending right now, if any. */
type Sending = {videoId: number; file: File; controller: AbortController};

function without<T>(record: Record<number, T>, id: number): Record<number, T> {
  const rest = {...record};
  delete rest[id];
  return rest;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The phone's screen stays on while a video sends. A phone that locks
 * itself pauses the page, and with it the upload. Not every browser offers
 * this, and nothing breaks without it.
 */
async function keepAwake(): Promise<{release: () => Promise<void>} | null> {
  try {
    return (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

/**
 * The trainer's teaching videos.
 *
 * The video is chosen from the phone and sent from here, a piece at a time
 * (lib/video-upload.ts), so a dropped connection loses one piece rather than
 * the whole file. The server then prepares it for phones on 3G, and staff
 * watch it before it shows, separately from the listing: a live listing
 * stays live while a new video waits.
 */
export function TrainerVideos({listingLive}: {listingLive: boolean}) {
  const t = useTranslations("TrainerVideos");
  const [videos, setVideos] = useState<TrainerVideo[] | null>(null);
  const [limits, setLimits] = useState<TrainerVideoLimits | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [sending, setSending] = useState<Sending | null>(null);
  // Uploads the network interrupted, by video id. Their files are still in
  // hand, so carrying on needs no second pick.
  const [paused, setPaused] = useState<Record<number, File>>({});
  const [resumeErrors, setResumeErrors] = useState<Record<number, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const list = await getTrainerVideos();
    setVideos(list.videos);
    setLimits(list.limits);
  }, []);

  useEffect(() => {
    let active = true;
    getTrainerVideos()
      .then((list) => {
        if (!active) return;
        setVideos(list.videos);
        setLimits(list.limits);
      })
      .catch(() => {
        if (active) setLoadError(t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  // While a video is being prepared the server moves it on by itself.
  const waiting = videos?.some((video) => MOVING.includes(video.status)) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  // Stop sending if the trainer leaves the tab; what was sent is kept.
  useEffect(() => () => sending?.controller.abort(), [sending]);

  function replace(video: TrainerVideo) {
    setVideos((current) =>
      (current ?? []).some((row) => row.id === video.id)
        ? (current ?? []).map((row) => (row.id === video.id ? video : row))
        : [...(current ?? []), video],
    );
  }

  async function send(video: TrainerVideo, chosen: File) {
    if (!limits) return;
    const controller = new AbortController();
    setSending({videoId: video.id, file: chosen, controller});
    setPaused((current) => without(current, video.id));
    setError(null);
    const lock = await keepAwake();
    try {
      const done = await sendFile(video, chosen, {
        chunkBytes: limits.chunk_bytes,
        signal: controller.signal,
        onProgress: (received) => replace({...video, upload_received: received}),
      });
      replace(done);
    } catch (reason) {
      if (reason instanceof UploadPaused) {
        replace({...video, upload_received: reason.received});
        setPaused((current) => ({...current, [video.id]: chosen}));
      } else {
        setError(reason instanceof Error ? reason.message : t("addFailed"));
        await reload().catch(() => {});
      }
    } finally {
      await lock?.release().catch(() => {});
      setSending(null);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!limits) return;
    const missing: FieldErrors = {
      file: file ? undefined : t("fileRequired"),
      title: title.trim() ? undefined : t("titleRequired"),
    };
    if (file && file.size > limits.max_upload_bytes) {
      missing.file = t("tooLarge", {
        size: formatBytes(file.size),
        max: formatBytes(limits.max_upload_bytes),
      });
    }
    setFieldErrors(missing);
    if (missing.file || missing.title || !file) return;

    setStarting(true);
    setError(null);
    let video: TrainerVideo;
    try {
      video = await startTrainerVideo(title.trim(), file);
    } catch (reason) {
      if (reason instanceof TrainerApiError && reason.fields.title) {
        setFieldErrors({title: reason.fields.title});
      } else {
        setError(reason instanceof Error ? reason.message : t("addFailed"));
      }
      return;
    } finally {
      setStarting(false);
    }
    replace(video);
    setFile(null);
    setTitle("");
    if (fileInput.current) fileInput.current.value = "";
    await send(video, file);
  }

  function resumeWith(video: TrainerVideo, chosen: File | undefined) {
    if (!chosen) return;
    if (!sameFile(video, chosen)) {
      setResumeErrors((current) => ({
        ...current,
        [video.id]: t("wrongFile", {name: video.upload_name}),
      }));
      return;
    }
    setResumeErrors((current) => without(current, video.id));
    void send(video, chosen);
  }

  async function remove(videoId: number) {
    if (sending?.videoId === videoId) sending.controller.abort();
    setRemoving(videoId);
    setError(null);
    try {
      await deleteTrainerVideo(videoId);
      setVideos((current) => (current ?? []).filter((video) => video.id !== videoId));
      await reload().catch(() => {});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("removeFailed"));
    } finally {
      setRemoving(null);
    }
  }

  const full =
    limits !== null &&
    videos !== null &&
    (videos.length >= limits.max_videos || limits.seconds_used >= limits.max_hours * 3600);

  return (
    <section aria-labelledby="videos-heading" className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-start gap-3 sm:px-6">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
            <Video aria-hidden="true" className="size-4" />
          </div>
          <div>
            <h2 id="videos-heading" className="font-semibold">
              {t("title")}
            </h2>
            <CardDescription className="mt-1 leading-6">{t("lead", {brand: BRAND})}</CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-5 pt-5 sm:px-6">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4">
            <p className="text-sm font-semibold">{t("tipsTitle")}</p>
            <ul className="mt-2 space-y-1.5 text-sm leading-6 text-[var(--color-muted-foreground)]">
              {(["short", "quality", "light", "own", "consent", "wifi"] as const).map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-[var(--color-visit)]"
                  />
                  {t(`tips.${tip}`, {minutes: limits?.max_minutes ?? 60})}
                </li>
              ))}
            </ul>
          </div>

          {limits === null ? null : full ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("full")}</p>
          ) : (
            <form noValidate onSubmit={add} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="video-file">{t("fileLabel")}</Label>
                <Input
                  ref={fileInput}
                  id="video-file"
                  type="file"
                  accept="video/*"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  aria-invalid={fieldErrors.file ? true : undefined}
                  aria-describedby={fieldErrors.file ? "video-file-error" : "video-file-help"}
                />
                {fieldErrors.file ? (
                  <p id="video-file-error" className="text-sm text-[var(--color-destructive)]">
                    {fieldErrors.file}
                  </p>
                ) : (
                  <p id="video-file-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                    {t("fileHelp", {size: formatBytes(limits.max_upload_bytes)})}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="video-title">{t("titleLabel")}</Label>
                <Input
                  id="video-title"
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("titlePlaceholder")}
                  aria-invalid={fieldErrors.title ? true : undefined}
                  aria-describedby={fieldErrors.title ? "video-title-error" : undefined}
                />
                {fieldErrors.title ? (
                  <p id="video-title-error" className="text-sm text-[var(--color-destructive)]">
                    {fieldErrors.title}
                  </p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Button
                  type="submit"
                  variant="brand"
                  // One upload at a time: two would share one phone's signal
                  // and both would crawl.
                  disabled={starting || sending !== null}
                  className="w-full sm:w-auto"
                >
                  {starting ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Upload aria-hidden="true" />
                  )}
                  {starting ? t("adding") : t("add")}
                </Button>
              </div>
            </form>
          )}

          {error ? (
            <Alert variant="warning">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>
                <p>{error}</p>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {loadError ? (
        <Alert variant="warning">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            <p>{loadError}</p>
          </AlertDescription>
        </Alert>
      ) : videos === null || limits === null ? (
        <div role="status" aria-busy="true" className="grid gap-4 sm:grid-cols-2">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="aspect-video rounded-2xl" />
          <Skeleton className="aspect-video rounded-2xl" />
        </div>
      ) : videos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-border-strong)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {t("empty", {brand: BRAND})}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-muted-foreground)]" aria-live="polite">
            {t("count", {
              count: videos.length,
              max: limits.max_videos,
              used: (limits.seconds_used / 3600).toFixed(1),
              hours: limits.max_hours,
            })}
            {listingLive ? null : ` ${t("notLive")}`}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {videos.map((video) => (
              <li key={video.id}>
                <VideoCard
                  video={video}
                  isSending={sending?.videoId === video.id}
                  pausedFile={paused[video.id]}
                  resumeError={resumeErrors[video.id]}
                  removing={removing === video.id}
                  onPause={() => sending?.controller.abort()}
                  onResume={(chosen) => resumeWith(video, chosen)}
                  onRemove={() => remove(video.id)}
                  busy={sending !== null}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function VideoCard({
  video,
  isSending,
  pausedFile,
  resumeError,
  removing,
  busy,
  onPause,
  onResume,
  onRemove,
}: {
  video: TrainerVideo;
  isSending: boolean;
  pausedFile: File | undefined;
  resumeError: string | undefined;
  removing: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("TrainerVideos");
  const still = video.kind === "youtube" ? thumbnailUrl(video.youtube_id) : video.poster;
  const total = video.upload_size ?? 0;
  const percent = total ? Math.floor((video.upload_received / total) * 100) : 0;
  const uploading = video.status === "uploading";

  let note = t(`statusNote.${video.status}`, {brand: BRAND});
  if (video.status === "rejected" && video.review_note) {
    note = t("reviewNote", {note: video.review_note});
  } else if (video.status === "failed" && video.failure_reason) {
    note = t("failureNote", {reason: video.failure_reason});
  }

  return (
    <Card className="h-full overflow-hidden">
      <div className="relative grid aspect-video place-items-center bg-black text-white/70">
        {still ? (
          <Image src={still} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 400px" />
        ) : MOVING.includes(video.status) ? (
          <Loader2 aria-hidden="true" className="size-8 animate-spin" />
        ) : (
          <Video aria-hidden="true" className="size-8" />
        )}
      </div>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-2">
          <Badge variant={STATUS_BADGE[video.status]}>{t(`status.${video.status}`)}</Badge>
          <p className="break-words font-semibold leading-6">{video.title}</p>
          {video.duration_seconds ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {t("length", {minutes: Math.max(1, Math.round(video.duration_seconds / 60))})}
            </p>
          ) : null}
          {uploading ? (
            <div className="space-y-1.5">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-2 overflow-hidden rounded-full bg-[var(--color-muted)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--color-brand)] transition-[width]"
                  style={{width: `${percent}%`}}
                />
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]" aria-live="polite">
                {t("progress", {
                  sent: formatBytes(video.upload_received),
                  total: formatBytes(total),
                  percent,
                })}
              </p>
            </div>
          ) : null}
          <p className="text-sm leading-6 text-[var(--color-muted-foreground)]">
            {uploading && pausedFile ? t("paused") : uploading && !isSending ? t("resumePick") : note}
          </p>
          {resumeError ? (
            <p className="text-sm text-[var(--color-destructive)]">{resumeError}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {uploading && isSending ? (
            <Button type="button" variant="outline" size="sm" onClick={onPause}>
              <Pause aria-hidden="true" />
              {t("pause")}
            </Button>
          ) : null}
          {uploading && !isSending && pausedFile ? (
            <Button
              type="button"
              variant="brand"
              size="sm"
              disabled={busy}
              onClick={() => onResume(pausedFile)}
            >
              <Upload aria-hidden="true" />
              {t("resume")}
            </Button>
          ) : null}
          {uploading && !isSending && !pausedFile ? (
            // After a reload the file is no longer in hand: the trainer picks
            // it again, and only the part not yet sent goes.
            <Button asChild variant="brand" size="sm" aria-disabled={busy}>
              <label>
                <Upload aria-hidden="true" />
                {t("resumeLabel", {name: video.upload_name || video.title})}
                <input
                  type="file"
                  accept="video/*"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => onResume(event.target.files?.[0])}
                />
              </label>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={onRemove}
            aria-label={t("removeLabel", {title: video.title})}
          >
            {removing ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            {uploading ? t("cancel") : t("remove")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
