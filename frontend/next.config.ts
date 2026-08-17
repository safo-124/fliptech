import type { NextConfig } from "next";

const apiHost = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  images: {
    // Provider photographs come from Django in development and Cloudflare R2 in
    // production. next/image handles the WebP conversion and per-device sizing
    // that Section 10 asks for, which is why django-imagekit was dropped.
    remotePatterns: [
      { protocol: "http", hostname: "127.0.0.1", port: "8000", pathname: "/media/**" },
      { protocol: "http", hostname: "localhost", port: "8000", pathname: "/media/**" },
      ...(process.env.NEXT_PUBLIC_MEDIA_HOST
        ? [{ protocol: "https" as const, hostname: process.env.NEXT_PUBLIC_MEDIA_HOST }]
        : []),
    ],
    formats: ["image/webp"],
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
