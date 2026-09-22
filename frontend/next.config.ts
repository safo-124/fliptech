import type { NextConfig } from "next";

const apiHost = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

/**
 * Allow next/image to load photographs from wherever the API serves them.
 *
 * The provider serializer returns an absolute URL built from the incoming
 * request, so in production that is the public origin — the same host the API
 * is on, because Caddy serves /media from there. Only 127.0.0.1:8000,
 * localhost:8000 and an optional separate MEDIA_HOST were listed, so the first
 * real photograph on any deployed domain would have thrown
 * "hostname is not configured under images" and taken the search page with it.
 * It had not bitten only because no provider had a photograph yet.
 *
 * Derived from NEXT_PUBLIC_API_URL rather than hardcoded, so moving to a real
 * domain needs no change here.
 */
type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number];

function mediaPatterns(): RemotePattern[] {
  // Annotated, because inferring the element type from the two http entries
  // below narrows `protocol` to "http" and rejects the https one.
  const patterns: RemotePattern[] = [
    { protocol: "http", hostname: "127.0.0.1", port: "8000", pathname: "/media/**" },
    { protocol: "http", hostname: "localhost", port: "8000", pathname: "/media/**" },
  ];

  try {
    const api = new URL(apiHost);
    patterns.push({
      protocol: api.protocol.replace(":", "") as "http" | "https",
      hostname: api.hostname,
      // An empty string means "the default port for this protocol", which is
      // what a public https origin uses.
      port: api.port,
      pathname: "/media/**",
    });
  } catch {
    // A malformed NEXT_PUBLIC_API_URL should not stop the build; the two
    // development entries above still apply.
  }

  // A separate bucket hostname, once photographs move off the app server.
  if (process.env.NEXT_PUBLIC_MEDIA_HOST) {
    patterns.push({
      protocol: "https",
      hostname: process.env.NEXT_PUBLIC_MEDIA_HOST,
      port: "",
      pathname: "/**",
    });
  }

  return patterns;
}

const nextConfig: NextConfig = {
  images: {
    // next/image handles the WebP conversion and per-device sizing Section 10
    // asks for, which is why django-imagekit was dropped. The stored original
    // is capped at 2048px by core/images.py so the optimiser is not re-reading
    // a 10 MB file for every size it emits.
    remotePatterns: mediaPatterns(),
    formats: ["image/webp"],
    /*
     * Next 16 refuses to fetch a source image whose hostname resolves to a
     * private address, as SSRF protection, and answers 400 instead. In
     * development the API genuinely is on 127.0.0.1:8000, so every workshop
     * photograph broke and the two loopback entries in mediaPatterns above
     * had quietly become dead letters.
     *
     * Development only. In production the API is a public origin, nothing
     * should be resolving to a private address, and the protection is doing
     * exactly the job its name says.
     */
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
  },
  // Standalone output is only needed for the Docker image, and the file tracing
  // it performs walks the whole of node_modules. On the Windows/exFAT dev
  // volume that intermittently exhausts system handles and fails the build with
  // os error 1450, so it is opt-in: the Dockerfile sets NEXT_OUTPUT and local
  // builds skip the tracing entirely.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  env: { API_URL: apiHost },
  poweredByHeader: false,
};

export default nextConfig;
