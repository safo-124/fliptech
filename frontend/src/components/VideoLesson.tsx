"use client";

import {Play} from "lucide-react";
import Image from "next/image";
import {useRef, useState, type MouseEvent} from "react";

import type {ProviderVideo} from "@/lib/types";
import {embedUrl, thumbnailUrl, watchUrl} from "@/lib/youtube";

/**
 * One teaching video on a listing: a still until it is tapped.
 *
 * Nothing about the video downloads before the tap, poster aside: the player
 * is not even on the page until then, so a trainee scrolling past spends no
 * data on it. That matters more for an uploaded video than it did for
 * YouTube, because it is the site's own bandwidth as well as theirs.
 *
 * Uploads play from the site's own files, smallest first. A trainee on a
 * good connection can switch to the sharper copy, and the switch keeps their
 * place. Videos added from YouTube before uploads existed still play there.
 *
 * Labels arrive as props rather than through next-intl, so the listing page
 * does not load the message formatter for a few words.
 */
export function VideoLesson({
  video,
  playLabel,
  qualityLabel,
}: {
  video: ProviderVideo;
  playLabel: string;
  qualityLabel: string;
}) {
  if (video.kind === "youtube") {
    return <YouTubeLesson youtubeId={video.youtube_id} title={video.title} playLabel={playLabel} />;
  }
  return <UploadedLesson video={video} playLabel={playLabel} qualityLabel={qualityLabel} />;
}

function UploadedLesson({
  video,
  playLabel,
  qualityLabel,
}: {
  video: ProviderVideo;
  playLabel: string;
  qualityLabel: string;
}) {
  const [playing, setPlaying] = useState(false);
  // The smallest copy unless the trainee asks: they pay for data in bundles.
  const [quality, setQuality] = useState(video.sources[0]?.quality);
  const player = useRef<HTMLVideoElement>(null);
  const source = video.sources.find((candidate) => candidate.quality === quality);
  if (!source) return null;

  function switchTo(next: number) {
    const element = player.current;
    const at = element?.currentTime ?? 0;
    const wasPlaying = element ? !element.paused : true;
    setQuality(next);
    // The src changes on the next render; pick up where they were once the
    // new copy knows how long it is.
    element?.addEventListener(
      "loadedmetadata",
      () => {
        element.currentTime = at;
        if (wasPlaying) void element.play();
      },
      {once: true},
    );
  }

  if (playing) {
    return (
      <div className="space-y-2">
        <video
          ref={player}
          src={source.url}
          poster={video.poster ?? undefined}
          title={video.title}
          controls
          autoPlay
          playsInline
          preload="auto"
          className="aspect-video w-full rounded-xl bg-black"
        />
        {video.sources.length > 1 ? (
          <div role="group" aria-label={qualityLabel} className="flex gap-1.5">
            {video.sources.map((candidate) => (
              <button
                key={candidate.quality}
                type="button"
                onClick={() => switchTo(candidate.quality)}
                aria-pressed={candidate.quality === quality}
                className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs font-medium aria-pressed:border-transparent aria-pressed:bg-[var(--color-foreground)] aria-pressed:text-[var(--color-background)]"
              >
                {candidate.quality}p
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={playLabel}
      className="group relative block aspect-video w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-black focus-visible:outline-offset-2"
    >
      {video.poster ? (
        <Image
          src={video.poster}
          alt=""
          fill
          className="object-cover opacity-90 transition-opacity group-hover:opacity-100"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
          loading="lazy"
        />
      ) : null}
      <PlayBadge />
    </button>
  );
}

/**
 * A video linked from YouTube before uploads existed.
 *
 * YouTube's player is heavy, around a megabyte of script before a frame
 * plays, so the page shows a still and swaps in the player only when asked.
 * The link underneath works before this script has loaded, or if it never
 * does; a modified click (new tab, new window) is left to do just that.
 */
function YouTubeLesson({
  youtubeId,
  title,
  playLabel,
}: {
  youtubeId: string;
  title: string;
  playLabel: string;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <iframe
        src={embedUrl(youtubeId)}
        title={title}
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-video w-full rounded-xl border-0 bg-black"
      />
    );
  }

  function play(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    setPlaying(true);
  }

  return (
    <a
      href={watchUrl(youtubeId)}
      onClick={play}
      aria-label={playLabel}
      className="group relative block aspect-video overflow-hidden rounded-xl border border-[var(--color-border)] bg-black focus-visible:outline-offset-2"
    >
      <Image
        src={thumbnailUrl(youtubeId)}
        alt=""
        fill
        // hqdefault is 4:3 with bars above and below a 16:9 video; covering
        // the frame crops them away.
        className="object-cover opacity-90 transition-opacity group-hover:opacity-100"
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
        loading="lazy"
      />
      <PlayBadge />
    </a>
  );
}

function PlayBadge() {
  return (
    <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
      <span className="grid size-14 place-items-center rounded-full bg-black/70 text-white shadow-lg ring-2 ring-white/80 transition-transform group-hover:scale-105">
        <Play className="ml-0.5 size-6 fill-current" />
      </span>
    </span>
  );
}
