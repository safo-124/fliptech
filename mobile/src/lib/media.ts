import { API_URL, SITE_URL } from "./config";

const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/;

/**
 * A media address the phone can reach.
 *
 * In development Django builds photo and video addresses from its own
 * 127.0.0.1, which on a phone is the phone. Those are rewritten to the API
 * address the app was given; anything else passes through untouched.
 */
export function mediaUrl(url: string | null | undefined, api: string = API_URL): string | null {
  if (!url) return null;
  return LOOPBACK.test(url) ? url.replace(LOOPBACK, api) : url;
}

/**
 * Photos are fetched through the website's own image resizer (Next.js
 * /_next/image, on your server), at the size the screen needs: a card gets
 * a card-sized WebP, not the 2048px original. With data saver on, smaller
 * still and more compressed. Nothing leaves your servers.
 *
 * The resizer fetches the original itself, so it is given the address as
 * the API wrote it (before mediaUrl's development rewrite).
 */
let saving = false;

export function setPhotoSaving(value: boolean) {
  saving = value;
}

export function photoSaving() {
  return saving;
}

const WIDTHS = {
  card: { normal: 640, saver: 256 },
  full: { normal: 1080, saver: 640 },
} as const;

export function photoUrl(
  url: string | null | undefined,
  size: keyof typeof WIDTHS = "card",
  site: string = SITE_URL,
  saver: boolean = saving,
): string | null {
  if (!url) return null;
  if (!/^https?:\/\//.test(url)) return url;
  const width = saver ? WIDTHS[size].saver : WIDTHS[size].normal;
  const quality = saver ? 50 : 75;
  return `${site}/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${quality}`;
}
