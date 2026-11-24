"use client";

/**
 * A video's own shape, so a portrait phone video (9:16) is shown as one
 * rather than in a 16:9 frame with black bars. Read from the poster first
 * (made from the video at upload, so the same shape), then from the video
 * itself once it loads. 16:9 until either is known.
 */
import {useEffect, useState, type CSSProperties} from "react";

export const LANDSCAPE = 16 / 9;

export function useMediaAspect(poster?: string | null) {
  const [ratio, setRatio] = useState(LANDSCAPE);
  useEffect(() => {
    if (!poster) return;
    const image = new window.Image();
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight);
    };
    image.src = poster;
  }, [poster]);
  const fromVideo = (element: HTMLVideoElement) => {
    if (element.videoWidth && element.videoHeight) setRatio(element.videoWidth / element.videoHeight);
  };
  return {ratio, fromVideo};
}

/**
 * The frame for that shape. A portrait video is as tall as fits the screen
 * (80% of its height) and centred, not stretched to the full width.
 */
export function frameStyle(ratio: number): CSSProperties {
  if (ratio >= 1) return {aspectRatio: String(ratio)};
  return {
    aspectRatio: String(ratio),
    width: `min(100%, calc(80vh * ${ratio}))`,
    marginInline: "auto",
  };
}
