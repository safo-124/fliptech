"use client";

import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
  Video,
} from "lucide-react";
import Image from "next/image";
import {useTranslations} from "next-intl";
import {useEffect, useState, type FormEvent} from "react";

import {Alert, AlertDescription} from "@/components/ui/alert";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Separator} from "@/components/ui/separator";
import {Skeleton} from "@/components/ui/skeleton";
import {BRAND} from "@/lib/brand";
import {
  addTrainerVideo,
  deleteTrainerVideo,
  getTrainerVideos,
  TrainerApiError,
} from "@/lib/trainer-api";
import type {TrainerVideo, TrainerVideoStatus} from "@/lib/types";
import {thumbnailUrl, watchUrl} from "@/lib/youtube";

// The server's MAX_VIDEOS_PER_PROVIDER, in backend/providers/videos.py. The
// server enforces it; this only stops the form being offered past it.
const MAX_VIDEOS = 6;

const STATUS_BADGE = {
  pending: "secondary",
  approved: "default",
  rejected: "warning",
} as const satisfies Record<TrainerVideoStatus, string>;

type FieldErrors = {url?: string; title?: string};

/**
 * The trainer's teaching videos.
 *
 * The video itself goes on YouTube, which stores it and streams it small
 * enough for a trainee on prepaid data; the trainer pastes its link here.
 * Every video is watched by staff before it shows, separately from the
 * listing, so a live listing stays live while a new video waits.
 */
export function TrainerVideos({listingLive}: {listingLive: boolean}) {
  const t = useTranslations("TrainerVideos");
  const [videos, setVideos] = useState<TrainerVideo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getTrainerVideos()
      .then((rows) => {
        if (active) setVideos(rows);
      })
      .catch(() => {
        if (active) setLoadError(t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing: FieldErrors = {
      url: link.trim() ? undefined : t("linkRequired"),
      title: title.trim() ? undefined : t("titleRequired"),
    };
    setFieldErrors(missing);
    if (missing.url || missing.title) return;

    setAdding(true);
    setError(null);
    try {
      const video = await addTrainerVideo(link.trim(), title.trim());
      setVideos((current) => [...(current ?? []), video]);
      setLink("");
      setTitle("");
    } catch (reason) {
      // The server words a refused link for the trainer, on the link field.
      if (reason instanceof TrainerApiError && (reason.fields.url || reason.fields.title)) {
        setFieldErrors({url: reason.fields.url, title: reason.fields.title});
      } else {
        setError(reason instanceof Error ? reason.message : t("addFailed"));
      }
    } finally {
      setAdding(false);
    }
  }

  async function remove(videoId: number) {
    setRemoving(videoId);
    setError(null);
    try {
      await deleteTrainerVideo(videoId);
      setVideos((current) => (current ?? []).filter((video) => video.id !== videoId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("removeFailed"));
    } finally {
      setRemoving(null);
    }
  }

  const full = (videos?.length ?? 0) >= MAX_VIDEOS;

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
              {(["short", "light", "own", "consent"] as const).map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-[var(--color-visit)]"
                  />
                  {t(`tips.${tip}`)}
                </li>
              ))}
            </ul>
          </div>

          {full ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {t("full", {max: MAX_VIDEOS})}
            </p>
          ) : (
            <form noValidate onSubmit={add} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="video-link">{t("linkLabel")}</Label>
                <Input
                  id="video-link"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="https://youtu.be/…"
                  aria-invalid={fieldErrors.url ? true : undefined}
                  aria-describedby={fieldErrors.url ? "video-link-error" : "video-link-help"}
                />
                {fieldErrors.url ? (
                  <p id="video-link-error" className="text-sm text-[var(--color-destructive)]">
                    {fieldErrors.url}
                  </p>
                ) : (
                  <p id="video-link-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                    {t("linkHelp")}
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
                <Button type="submit" variant="brand" disabled={adding} className="w-full sm:w-auto">
                  {adding ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                  {adding ? t("adding") : t("add")}
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
      ) : videos === null ? (
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
            {t("count", {count: videos.length, max: MAX_VIDEOS})}
            {listingLive ? null : ` ${t("notLive")}`}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {videos.map((video) => (
              <li key={video.id}>
                <Card className="h-full overflow-hidden">
                  <div className="relative aspect-video bg-black">
                    <Image
                      src={thumbnailUrl(video.youtube_id)}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, 400px"
                    />
                  </div>
                  <CardContent className="space-y-3 p-4">
                    <div className="space-y-2">
                      <Badge variant={STATUS_BADGE[video.status]}>{t(`status.${video.status}`)}</Badge>
                      <p className="break-words font-semibold leading-6">{video.title}</p>
                      <p className="text-sm leading-6 text-[var(--color-muted-foreground)]">
                        {video.status === "rejected" && video.review_note
                          ? t("reviewNote", {note: video.review_note})
                          : t(`statusNote.${video.status}`, {brand: BRAND})}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a href={watchUrl(video.youtube_id)} target="_blank" rel="noopener noreferrer">
                          <ExternalLink aria-hidden="true" />
                          {t("watch")}
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={removing === video.id}
                        onClick={() => remove(video.id)}
                        aria-label={t("removeLabel", {title: video.title})}
                      >
                        {removing === video.id ? (
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : (
                          <Trash2 aria-hidden="true" />
                        )}
                        {t("remove")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
