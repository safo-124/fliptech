"use client";

import {Play} from "lucide-react";
import Image from "next/image";
import {useState, type MouseEvent} from "react";

import {embedUrl, thumbnailUrl, watchUrl} from "@/lib/youtube";

/**
 * One teaching video on a listing: a still until it is tapped.
 *
 * YouTube's player is heavy — around a megabyte of script before a frame
 * plays — and a listing can carry several. So the page shows a still, fetched
 * through next/image, and swaps in the player only when the visitor asks for
 * it. Until then their phone has spent nothing on video and told YouTube
 * nothing.
 *
 * A link underneath, so it still works before this script has loaded, or if
 * it never does: it opens the video on YouTube, usually in the app. A
 * modified click (new tab, new window) is left to do just that.
 *
 * The label arrives as a prop rather than through next-intl, so the listing
 * page does not load the message formatter for one sentence.
 */
export function VideoLesson({
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
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
        <span className="grid size-14 place-items-center rounded-full bg-black/70 text-white shadow-lg ring-2 ring-white/80 transition-transform group-hover:scale-105">
          <Play className="ml-0.5 size-6 fill-current" />
        </span>
      </span>
    </a>
  );
}
