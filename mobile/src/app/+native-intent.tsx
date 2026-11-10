import { appPath } from "@/lib/links";

/**
 * Where an incoming link goes. An https link to the site (App Links, from
 * WhatsApp or an SMS) is turned into the app's own screen; the app's own
 * fliiptech:// links (the payment return, for one) pass through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/^https?:\/\//.test(path)) {
      const url = new URL(path);
      return appPath(`${url.pathname}${url.search}`);
    }
    return path;
  } catch {
    return "/";
  }
}
