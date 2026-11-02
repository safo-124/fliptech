import { API_URL } from "./config";

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
