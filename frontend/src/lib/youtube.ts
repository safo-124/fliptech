/**
 * Addresses for a workshop's teaching videos, built from the YouTube id alone.
 *
 * The API sends the id and nothing else (backend providers/videos.py), so
 * nothing a trainer typed reaches an href or an iframe. The id is checked
 * again here anyway: it is going into a URL.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(id: string) {
  return VIDEO_ID.test(id);
}

function checked(id: string) {
  if (!isVideoId(id)) throw new Error(`Not a YouTube video id: ${JSON.stringify(id)}`);
  return id;
}

/** A 480×360 still, about 15 KB. Fetched through next/image, not by the visitor. */
export function thumbnailUrl(id: string) {
  return `https://i.ytimg.com/vi/${checked(id)}/hqdefault.jpg`;
}

/**
 * The player, on YouTube's no-cookie domain: nothing is set in the visitor's
 * browser until they press play. Autoplay because it only loads after a tap.
 */
export function embedUrl(id: string) {
  return `https://www.youtube-nocookie.com/embed/${checked(id)}?autoplay=1&rel=0&playsinline=1`;
}

/** Where the video lives, for opening in the YouTube app instead. */
export function watchUrl(id: string) {
  return `https://www.youtube.com/watch?v=${checked(id)}`;
}
