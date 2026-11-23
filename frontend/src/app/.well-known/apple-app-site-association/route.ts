/**
 * /.well-known/apple-app-site-association: tells an iPhone that links to
 * this site may open the Fliiptech app (Universal Links, mobile/app.config.ts),
 * as assetlinks.json does for Android. Apple fetches it, through its own
 * cache, when the app is installed, so a change can take a day to reach
 * phones.
 *
 * Set on the server, in frontend/.env.production:
 *   APPLE_TEAM_ID    the Apple Developer team ID, ten letters and digits
 *                    (developer.apple.com, Membership details)
 *   IOS_BUNDLE_ID    defaults to com.fliiptech.skillshub
 * Read when the request comes in, so changing it needs a restart, not a build.
 *
 * Every page opens the app except the ones that must stay in the browser:
 * the payment return (it is what sends the phone back to the app), and what
 * Django serves (the API, the back office, files).
 */

export const dynamic = "force-dynamic";

const STAY_IN_THE_BROWSER = ["/app-return*", "/api/*", "/back-office/*", "/media/*", "/static/*", "/healthz*"];

export function GET() {
  const team = (process.env.APPLE_TEAM_ID ?? "").trim().toUpperCase();
  const bundle = (process.env.IOS_BUNDLE_ID || "com.fliiptech.skillshub").trim();
  const details = /^[A-Z0-9]{10}$/.test(team)
    ? [
        {
          appIDs: [`${team}.${bundle}`],
          components: [...STAY_IN_THE_BROWSER.map((path) => ({ "/": path, exclude: true })), { "/": "*" }],
        },
      ]
    : [];
  return Response.json({ applinks: { details } }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
