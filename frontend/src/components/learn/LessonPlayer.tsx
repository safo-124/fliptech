"use client";

import {
  Captions,
  Check,
  Gauge,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { countPlay } from "@/lib/course-api";
import { offlineUrl } from "@/lib/offline-lessons";
import type { ProviderVideo } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SPEED_KEY = "fliptech:lesson-speed";
const QUALITY_KEY = "fliptech:lesson-quality";
/** How often, while playing, the place is saved. */
const SAVE_EVERY_MS = 10_000;
/** Seconds before "up next" moves on by itself. */
const UP_NEXT_SECONDS = 6;

type HlsLike = {
  levels: { height: number; width: number }[];
  currentLevel: number;
  nextLevel: number;
  autoLevelEnabled: boolean;
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  destroy(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

export type PlayerReport = { position: number; duration: number; ended: boolean };

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window: the choice lasts until the page closes.
  }
}

export function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * One lesson, played with controls made for a phone in a workshop.
 *
 * A still until tapped, so scrolling past spends no data. Then: the
 * streaming copy (HLS) where there is one, so the picture follows the
 * signal; the 360p file otherwise; the copy saved on this phone before
 * either. Speed, ten seconds back and forward (or a double tap on either
 * side), captions, sharpness, full screen and the keyboard. It picks up
 * where the learner left off, tells the course where they are as they
 * watch, and offers the next lesson when this one ends.
 */
export function LessonPlayer({
  video,
  playLabel,
  startAt = 0,
  autoStart = false,
  seek,
  next,
  onReport,
  onNext,
}: {
  video: ProviderVideo;
  playLabel: string;
  /** Where this learner left off, in seconds. */
  startAt?: number;
  /** Start playing at once: moving on from the last lesson. */
  autoStart?: boolean;
  /** A place to jump to, from a question's time; `nonce` repeats a jump. */
  seek?: { seconds: number; nonce: number } | null;
  next?: { title: string } | null;
  onReport?: (report: PlayerReport) => void;
  onNext?: () => void;
}) {
  const t = useTranslations("Classroom");
  const [started, setStarted] = useState(autoStart);

  if (!started) {
    return (
      <button
        type="button"
        onClick={() => setStarted(true)}
        aria-label={playLabel}
        className="group relative block aspect-video w-full overflow-hidden bg-black focus-visible:outline-offset-2"
      >
        {video.poster ? (
          <Image
            src={video.poster}
            alt=""
            fill
            priority
            className="object-cover opacity-85 transition duration-500 group-hover:scale-[1.02] group-hover:opacity-100"
            sizes="(min-width: 1024px) 66vw, 100vw"
          />
        ) : null}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <span className="relative grid size-20 place-items-center rounded-full bg-white/95 text-[var(--color-brand)] shadow-2xl ring-8 ring-white/20 transition-transform duration-300 group-hover:scale-110">
            <span className="absolute inset-0 animate-ping rounded-full bg-white/30 [animation-duration:2.4s]" />
            <Play className="relative ml-1 size-8 fill-current" />
          </span>
        </span>
        {startAt > 5 ? (
          <span className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
            {t("resumeFrom", { time: clock(startAt) })}
          </span>
        ) : null}
        {video.duration_seconds ? (
          <span className="absolute bottom-4 right-4 rounded-md bg-black/60 px-2 py-0.5 text-xs font-bold tabular-nums text-white backdrop-blur">
            {clock(video.duration_seconds)}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <ActivePlayer
      video={video}
      startAt={startAt}
      seek={seek}
      next={next}
      onReport={onReport}
      onNext={onNext}
    />
  );
}

type Menu = null | "speed" | "quality";

function ActivePlayer({
  video,
  startAt,
  seek,
  next,
  onReport,
  onNext,
}: {
  video: ProviderVideo;
  startAt: number;
  seek?: { seconds: number; nonce: number } | null;
  next?: { title: string } | null;
  onReport?: (report: PlayerReport) => void;
  onNext?: () => void;
}) {
  const t = useTranslations("Classroom");
  const frame = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsLike | null>(null);
  const lastSave = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const lastTap = useRef<{ at: number; side: "left" | "right" } | null>(null);
  const report = useRef(onReport);
  useEffect(() => {
    report.current = onReport;
  }, [onReport]);

  const [source, setSource] = useState<{ kind: "offline" | "hls" | "file"; url: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.duration_seconds ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  // Only ever rendered in the browser, after a tap: localStorage is there.
  const [speed, setSpeed] = useState(() => {
    const saved = Number(read(SPEED_KEY));
    return SPEEDS.includes(saved) ? saved : 1;
  });
  const [menu, setMenu] = useState<Menu>(null);
  const [chrome, setChrome] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionUrl, setCaptionUrl] = useState<string | null>(null);
  const [levels, setLevels] = useState<{ index: number; label: string }[]>([]);
  // "auto", a level index for HLS, or a file's quality for MP4.
  const [quality, setQuality] = useState<string>("auto");
  const [ripple, setRipple] = useState<{ side: "left" | "right"; key: number } | null>(null);
  const [resumed, setResumed] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(UP_NEXT_SECONDS);
  const [failed, setFailed] = useState(false);

  // ------------------------------------------------------------ the source
  // The files by address, not by array: the course refreshes what this
  // viewer may watch (after a payment, at the end of the course) and hands
  // over new arrays of the same files, which must not restart the lesson.
  const files = useRef(video.sources);
  useEffect(() => {
    files.current = video.sources;
  }, [video.sources]);
  const fileKey = video.sources.map((file) => file.url).join(" ");

  useEffect(() => {
    let cancelled = false;
    let blob: string | null = null;
    (async () => {
      blob = await offlineUrl(video.id);
      if (cancelled) return;
      if (blob) {
        setSource({ kind: "offline", url: blob });
        return;
      }
      const element = document.createElement("video");
      const nativeHls = Boolean(element.canPlayType("application/vnd.apple.mpegurl"));
      const saved = read(QUALITY_KEY);
      if (video.stream && (nativeHls || "MediaSource" in window) && saved !== "360") {
        setSource({ kind: "hls", url: video.stream });
        return;
      }
      const file =
        files.current.find((candidate) => String(candidate.quality) === saved) ?? files.current[0];
      if (file) {
        setQuality(String(file.quality));
        setSource({ kind: "file", url: file.url });
      } else {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [video.id, video.stream, fileKey]);

  // hls.js wherever Media Source is there, which is every phone browser but
  // an iPhone's: it seeks reliably and lets the learner pick the picture.
  // The browser's own HLS only where hls.js cannot run (iPhone Safari).
  useEffect(() => {
    const element = media.current;
    if (!element || source?.kind !== "hls") return;
    let destroyed = false;
    void import("hls.js").then(({ default: Hls }) => {
      if (destroyed || !media.current) return;
      if (!Hls.isSupported()) {
        if (media.current.canPlayType("application/vnd.apple.mpegurl")) {
          media.current.src = source.url;
          return;
        }
        const file = files.current[0];
        if (file) setSource({ kind: "file", url: file.url });
        return;
      }
      const player = new Hls({
        // Start on the smallest copy: data is bought in bundles here.
        startLevel: 0,
        capLevelToPlayerSize: true,
        maxBufferLength: 30,
      }) as unknown as HlsLike;
      hls.current = player;
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(
          player.levels
            .map((level, index) => ({ index, label: `${Math.min(level.height, level.width)}p` }))
            .reverse(),
        );
      });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if ((data as { fatal?: boolean }).fatal) {
          player.destroy();
          hls.current = null;
          const file = files.current[0];
          if (file) setSource({ kind: "file", url: file.url });
        }
      });
      player.loadSource(source.url);
      player.attachMedia(media.current);
    });
    return () => {
      destroyed = true;
      hls.current?.destroy();
      hls.current = null;
    };
  }, [source]);

  // Captions arrive through the API, behind the lesson's lock, as a blob.
  const captionAddress = video.captions?.[0]?.url;
  useEffect(() => {
    if (!captionAddress) return;
    let url: string | null = null;
    let cancelled = false;
    fetch(captionAddress, { credentials: "include" })
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      .then((text) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        setCaptionUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [captionAddress]);

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    for (const track of Array.from(element.textTracks)) {
      track.mode = captionsOn ? "showing" : "hidden";
    }
  }, [captionsOn, captionUrl]);

  useEffect(() => {
    if (media.current) media.current.playbackRate = speed;
  }, [speed, source]);

  // ------------------------------------------------------------ reporting
  const send = useCallback((ended = false) => {
    const element = media.current;
    if (!element || !report.current) return;
    lastSave.current = Date.now();
    report.current({
      position: ended ? element.duration || element.currentTime : element.currentTime,
      duration: element.duration || 0,
      ended,
    });
  }, []);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") send();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      send();
    };
  }, [send]);

  useEffect(() => {
    if (seek && media.current) {
      media.current.currentTime = seek.seconds;
      void media.current.play();
      frame.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [seek]);

  // ------------------------------------------------------------ up next
  const advance = useRef(onNext);
  useEffect(() => {
    advance.current = onNext;
  }, [onNext]);

  useEffect(() => {
    if (!ended || !next) return;
    const timer = window.setInterval(() => {
      setCountdown((left) => {
        if (left <= 1) {
          window.clearInterval(timer);
          window.setTimeout(() => advance.current?.(), 0);
          return 0;
        }
        return left - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ended, next]);

  // ------------------------------------------------------------ controls
  const poke = useCallback(() => {
    setChrome(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (media.current && !media.current.paused) {
        setChrome(false);
        setMenu(null);
      }
    }, 2800);
  }, []);

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  function toggle() {
    const element = media.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
    poke();
  }

  function jump(by: number) {
    const element = media.current;
    if (!element) return;
    element.currentTime = Math.max(0, Math.min(element.duration || Infinity, element.currentTime + by));
    poke();
  }

  function chooseSpeed(value: number) {
    setSpeed(value);
    write(SPEED_KEY, String(value));
    setMenu(null);
  }

  function chooseQuality(value: string) {
    setMenu(null);
    setQuality(value);
    const element = media.current;
    if (source?.kind === "hls" && hls.current) {
      if (value === "auto") {
        hls.current.nextLevel = -1;
        write(QUALITY_KEY, "auto");
      } else {
        hls.current.nextLevel = Number(value);
      }
      return;
    }
    const file = video.sources.find((candidate) => String(candidate.quality) === value);
    if (!file || !element) return;
    write(QUALITY_KEY, value);
    const at = element.currentTime;
    const wasPlaying = !element.paused;
    setSource({ kind: "file", url: file.url });
    element.addEventListener(
      "loadedmetadata",
      () => {
        element.currentTime = at;
        if (wasPlaying) void element.play();
      },
      { once: true },
    );
  }

  function toggleFullscreen() {
    const element = frame.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (element.requestFullscreen) void element.requestFullscreen().catch(() => {});
    else (media.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
  }

  function onKey(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    const actions: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      arrowleft: () => jump(-5),
      arrowright: () => jump(5),
      j: () => jump(-10),
      l: () => jump(10),
      f: toggleFullscreen,
      m: () => {
        if (media.current) media.current.muted = !media.current.muted;
      },
      c: () => setCaptionsOn((on) => !on),
    };
    const action = actions[key];
    if (action && !(event.target instanceof HTMLButtonElement && (key === " " || key === "enter"))) {
      event.preventDefault();
      action();
    }
  }

  // A double tap on either side skips ten seconds, as phone players do.
  function onTap(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") {
      toggle();
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const side = event.clientX - box.left < box.width / 2 ? "left" : "right";
    const now = Date.now();
    if (lastTap.current && now - lastTap.current.at < 320 && lastTap.current.side === side) {
      jump(side === "left" ? -10 : 10);
      setRipple({ side, key: now });
      lastTap.current = null;
      return;
    }
    lastTap.current = { at: now, side };
    if (!chrome) poke();
    else window.setTimeout(() => {
      if (lastTap.current?.at === now) toggle();
    }, 330);
  }

  const shown = duration || video.duration_seconds || 0;
  const played = shown ? (time / shown) * 100 : 0;
  const loaded = shown ? (buffered / shown) * 100 : 0;
  const qualityLabel =
    quality === "auto"
      ? t("auto")
      : source?.kind === "hls"
        ? (levels.find((level) => String(level.index) === quality)?.label ?? t("auto"))
        : `${quality}p`;
  const qualityChoices =
    source?.kind === "hls"
      ? [{ value: "auto", label: t("auto") }, ...levels.map((l) => ({ value: String(l.index), label: l.label }))]
      : video.sources.map((s) => ({ value: String(s.quality), label: `${s.quality}p` }));

  if (failed) {
    return (
      <div className="grid aspect-video place-items-center bg-black text-sm text-white/80">{t("cannotPlay")}</div>
    );
  }

  return (
    <div
      ref={frame}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={poke}
      aria-label={video.title}
      role="region"
      className={`group/player relative aspect-video w-full select-none overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] ${
        chrome ? "" : "cursor-none"
      } ${fullscreen ? "!aspect-auto h-full" : ""}`}
    >
      <video
        ref={media}
        src={source && source.kind !== "hls" ? source.url : undefined}
        poster={video.poster ?? undefined}
        playsInline
        autoPlay
        preload="auto"
        className="absolute inset-0 size-full"
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          setDuration(element.duration);
          if (startAt > 5 && startAt < element.duration - 10 && element.currentTime < 1) {
            element.currentTime = startAt;
            setResumed(startAt);
            window.setTimeout(() => setResumed(null), 6000);
          }
        }}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          poke();
          if (!lastSave.current) countPlay(video.id);
          lastSave.current = lastSave.current || Date.now();
        }}
        onPause={() => {
          setPlaying(false);
          setChrome(true);
          send();
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          setTime(element.currentTime);
          if (element.buffered.length) setBuffered(element.buffered.end(element.buffered.length - 1));
          if (Date.now() - lastSave.current > SAVE_EVERY_MS) send();
        }}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
          setChrome(true);
          setCountdown(UP_NEXT_SECONDS);
          send(true);
        }}
        onError={() => {
          if (source?.kind === "file" && video.sources[0] && source.url !== video.sources[0].url) {
            setSource({ kind: "file", url: video.sources[0].url });
          }
        }}
      >
        {captionUrl && video.captions?.[0] ? (
          <track
            kind="subtitles"
            src={captionUrl}
            srcLang={video.captions[0].language}
            label={video.captions[0].label}
            default
          />
        ) : null}
      </video>

      {/* Tap surface: play and pause, and double taps to skip. */}
      <div className="absolute inset-0" onPointerUp={onTap} aria-hidden="true" />

      {ripple ? (
        <span
          key={ripple.key}
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 grid size-24 -translate-y-1/2 animate-[skip_0.6s_ease-out_forwards] place-items-center rounded-full bg-white/25 text-sm font-bold text-white ${
            ripple.side === "left" ? "left-[12%]" : "right-[12%]"
          }`}
        >
          {ripple.side === "left" ? "−10s" : "+10s"}
        </span>
      ) : null}

      {waiting && !ended ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-12 animate-spin text-white/90 drop-shadow" />
        </span>
      ) : null}

      {!playing && !waiting && !ended ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={t("play")}
          className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-[var(--color-brand)] shadow-2xl transition-transform hover:scale-110"
        >
          <Play className="ml-1 size-7 fill-current" />
        </button>
      ) : null}

      {resumed !== null ? (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 py-1 pl-3 pr-1 text-xs font-semibold text-white backdrop-blur animate-[fade-in_0.3s_ease-out]">
          {t("resumedAt", { time: clock(resumed) })}
          <button
            type="button"
            onClick={() => {
              if (media.current) media.current.currentTime = 0;
              setResumed(null);
            }}
            className="rounded-full bg-white/15 px-2.5 py-1 hover:bg-white/25"
          >
            {t("startOver")}
          </button>
        </div>
      ) : null}

      {source?.kind === "offline" ? (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-visit)]/90 px-2.5 py-1 text-[11px] font-bold text-white">
          <WifiOff aria-hidden="true" className="size-3.5" />
          {t("playingSaved")}
        </span>
      ) : null}

      {ended ? (
        <UpNext
          next={next}
          countdown={countdown}
          onNext={() => onNext?.()}
          onCancel={() => setEnded(false)}
          onReplay={() => {
            if (media.current) {
              media.current.currentTime = 0;
              void media.current.play();
            }
          }}
        />
      ) : null}

      {/* ---------------------------------------------------- the bar */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-2 pt-10 text-white transition-opacity duration-300 sm:px-4 ${
          chrome && !ended ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <Scrubber
          played={played}
          loaded={loaded}
          duration={shown}
          label={t("seek")}
          onSeek={(share) => {
            if (media.current && shown) media.current.currentTime = share * shown;
            poke();
          }}
        />
        <div className="mt-1.5 flex items-center gap-0.5 sm:gap-1">
          <Control label={playing ? t("pause") : t("play")} onClick={toggle}>
            {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
          </Control>
          <Control label={t("back10")} onClick={() => jump(-10)}>
            <RotateCcw className="size-5" />
          </Control>
          <Control label={t("forward10")} onClick={() => jump(10)}>
            <RotateCw className="size-5" />
          </Control>
          <Control
            label={muted ? t("unmute") : t("mute")}
            onClick={() => {
              if (media.current) media.current.muted = !media.current.muted;
            }}
            className="hidden sm:grid"
          >
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </Control>
          <span className="ml-1 text-xs font-semibold tabular-nums text-white/90">
            {clock(time)} <span className="text-white/50">/ {clock(shown)}</span>
          </span>
          <span className="flex-1" />
          <div className="relative">
            <Control label={t("speed")} onClick={() => setMenu(menu === "speed" ? null : "speed")}>
              {speed === 1 ? <Gauge className="size-5" /> : <span className="text-xs font-extrabold">{speed}×</span>}
            </Control>
            {menu === "speed" ? (
              <PopMenu
                title={t("speed")}
                choices={SPEEDS.map((value) => ({ value: String(value), label: value === 1 ? t("normal") : `${value}×` }))}
                chosen={String(speed)}
                onChoose={(value) => chooseSpeed(Number(value))}
              />
            ) : null}
          </div>
          {captionUrl ? (
            <Control
              label={captionsOn ? t("captionsOff") : t("captionsOn")}
              onClick={() => setCaptionsOn((on) => !on)}
              pressed={captionsOn}
            >
              <Captions className="size-5" />
            </Control>
          ) : null}
          {source?.kind !== "offline" && qualityChoices.length > 1 ? (
            <div className="relative">
              <Control label={t("quality")} onClick={() => setMenu(menu === "quality" ? null : "quality")}>
                <Settings2 className="size-5" />
                <span className="absolute -right-0.5 -top-0.5 rounded bg-[var(--color-brand)] px-1 text-[9px] font-extrabold leading-4">
                  {qualityLabel}
                </span>
              </Control>
              {menu === "quality" ? (
                <PopMenu
                  title={t("quality")}
                  hint={t("qualityHint")}
                  choices={qualityChoices}
                  chosen={quality}
                  onChoose={chooseQuality}
                />
              ) : null}
            </div>
          ) : null}
          <Control label={fullscreen ? t("exitFullscreen") : t("fullscreen")} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </Control>
        </div>
      </div>
    </div>
  );
}

function Control({
  label,
  onClick,
  children,
  pressed,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`relative grid size-10 place-items-center rounded-full transition-colors hover:bg-white/15 aria-pressed:text-[var(--color-peach)] ${className}`}
    >
      {children}
    </button>
  );
}

function PopMenu({
  title,
  hint,
  choices,
  chosen,
  onChoose,
}: {
  title: string;
  hint?: string;
  choices: { value: string; label: string }[];
  chosen: string;
  onChoose: (value: string) => void;
}) {
  return (
    <div
      role="menu"
      aria-label={title}
      className="absolute bottom-12 right-0 z-10 w-44 overflow-hidden rounded-xl bg-[oklch(0.2_0.03_290/0.96)] p-1.5 text-sm shadow-2xl ring-1 ring-white/10 backdrop-blur animate-[pop-in_0.15s_ease-out]"
    >
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-white/50">{title}</p>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="menuitemradio"
          aria-checked={choice.value === chosen}
          onClick={(event) => {
            event.stopPropagation();
            onChoose(choice.value);
          }}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left font-semibold hover:bg-white/10"
        >
          {choice.label}
          {choice.value === chosen ? <Check aria-hidden="true" className="size-4 text-[var(--color-peach)]" /> : null}
        </button>
      ))}
      {hint ? <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-white/55">{hint}</p> : null}
    </div>
  );
}

function Scrubber({
  played,
  loaded,
  duration,
  label,
  onSeek,
}: {
  played: number;
  loaded: number;
  duration: number;
  label: string;
  onSeek: (share: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  function share(clientX: number) {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  }

  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round((played / 100) * duration)}
      aria-valuetext={clock((played / 100) * duration)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.stopPropagation();
          event.preventDefault();
          const step = (event.key === "ArrowLeft" ? -5 : 5) / Math.max(duration, 1);
          onSeek(Math.min(1, Math.max(0, played / 100 + step)));
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onSeek(share(event.clientX));
      }}
      onPointerMove={(event) => {
        setHover(share(event.clientX));
        if (dragging) onSeek(share(event.clientX));
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        setDragging(false);
      }}
      onPointerLeave={() => setHover(null)}
      className="group/bar relative flex h-4 cursor-pointer touch-none items-center"
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover/bar:h-1.5">
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${loaded}%` }} />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--color-brand-violet)] to-[var(--color-brand-pink)]"
          style={{ width: `${played}%` }}
        />
      </div>
      <span
        aria-hidden="true"
        className="absolute size-3.5 -translate-x-1/2 rounded-full bg-white shadow ring-4 ring-[var(--color-brand-violet)]/40 transition-transform group-hover/bar:scale-110"
        style={{ left: `${played}%` }}
      />
      {hover !== null ? (
        <span
          aria-hidden="true"
          className="absolute -top-7 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
          style={{ left: `${hover * 100}%` }}
        >
          {clock(hover * duration)}
        </span>
      ) : null}
    </div>
  );
}

function UpNext({
  next,
  countdown,
  onNext,
  onCancel,
  onReplay,
}: {
  next?: { title: string } | null;
  countdown: number;
  onNext: () => void;
  onCancel: () => void;
  onReplay: () => void;
}) {
  const t = useTranslations("Classroom");
  const ring = 2 * Math.PI * 26;
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/75 p-4 text-center text-white backdrop-blur-sm animate-[fade-in_0.3s_ease-out]">
      {next ? (
        <div className="max-w-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/60">{t("upNext")}</p>
          <p className="mt-2 text-lg font-extrabold leading-snug sm:text-xl">{next.title}</p>
          <button
            type="button"
            onClick={onNext}
            aria-label={t("playNext")}
            className="relative mx-auto mt-4 grid size-16 place-items-center rounded-full bg-white text-[var(--color-brand)] transition-transform hover:scale-105"
          >
            <svg aria-hidden="true" viewBox="0 0 60 60" className="absolute inset-0 -rotate-90">
              <circle
                cx="30"
                cy="30"
                r="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray={ring}
                strokeDashoffset={ring * (countdown / UP_NEXT_SECONDS)}
                className="transition-[stroke-dashoffset] duration-1000 ease-linear"
              />
            </svg>
            <Play className="ml-1 size-6 fill-current" />
          </button>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25"
            >
              <X aria-hidden="true" className="size-4" />
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={onReplay}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              {t("replay")}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-lg font-extrabold">{t("lessonDone")}</p>
          <button
            type="button"
            onClick={onReplay}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {t("replay")}
          </button>
        </div>
      )}
    </div>
  );
}
