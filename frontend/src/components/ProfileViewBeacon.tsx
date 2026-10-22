"use client";

import { useEffect } from "react";

import { browserApiUrl } from "@/lib/api-origin";

/**
 * Tells the API this profile was opened, for the owner's "profile views".
 *
 * The profile is server-rendered and cached, so most page loads never reach
 * Django and the server cannot count them itself. A beacon from the browser
 * can. It renders nothing, waits for nothing and retries nothing: a view that
 * fails to report is one fewer on a dashboard, never a broken page. The server
 * counts each visitor once a day, so React running this effect twice in
 * development does not double the number.
 */
export function ProfileViewBeacon({ providerId }: { providerId: number }) {
  useEffect(() => {
    const url = `${browserApiUrl()}/api/providers/${providerId}/viewed/`;
    try {
      if (navigator.sendBeacon?.(url)) return;
    } catch {
      // Some browsers throw on a cross-origin beacon; fall through to fetch.
    }
    fetch(url, { method: "POST", credentials: "include", keepalive: true }).catch(() => {});
  }, [providerId]);

  return null;
}
