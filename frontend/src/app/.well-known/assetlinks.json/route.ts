/**
 * /.well-known/assetlinks.json: tells Android that links to this site may
 * open the Fliiptech app (App Links, mobile/app.config.ts). Android fetches
 * it when the app is installed and checks the app was signed with one of
 * these certificates.
 *
 * Set on the server, in frontend/.env.production:
 *   ANDROID_CERT_SHA256   the signing certificate's SHA-256 fingerprint,
 *                         "AB:CD:...", comma-separated for more than one
 *                         (your upload key and the Play Store's app
 *                         signing key both, once the app is on the store)
 *   ANDROID_PACKAGE       defaults to com.fliiptech.skillshub
 * Read when the request comes in, so changing it needs a restart, not a build.
 */

export const dynamic = "force-dynamic";

export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
  const body = fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: process.env.ANDROID_PACKAGE || "com.fliiptech.skillshub",
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ]
    : [];
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
