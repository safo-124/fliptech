/**
 * Development convenience: keep the page and the API on the same loopback name.
 *
 * Browsers treat http://localhost and http://127.0.0.1 as different sites, so a
 * page opened on one cannot send the Django session cookie to an API on the
 * other. Sign-in then appears to work and the next request is anonymous. When
 * both the page and the configured API are loopback addresses, the API host is
 * rewritten to match whichever name the page was opened with. Any other
 * configuration, including production, is returned unchanged.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function alignLoopbackHost(configured: string, pageHostname: string | undefined): string {
  if (!pageHostname || !LOOPBACK_HOSTS.has(pageHostname)) return configured;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return configured;
  }
  if (!LOOPBACK_HOSTS.has(url.hostname) || url.hostname === pageHostname) return configured;
  url.hostname = pageHostname;
  return url.toString().replace(/\/$/, "");
}

/** The API origin as the browser should use it. */
export function browserApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
  if (typeof window === "undefined") return configured;
  return alignLoopbackHost(configured, window.location.hostname);
}
