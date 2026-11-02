/**
 * POST /revalidate: Django asking for the marketplace's and the courses'
 * cached pages to be thrown away, because a seller or a trainer just changed
 * something (backend marketplace/page_refresh.py, courses/page_refresh.py).
 *
 * Not under /api, which Caddy sends to Django. Guarded by a shared secret,
 * REVALIDATE_SECRET, read on the server only; with none set the endpoint
 * refuses everything, and pages refresh on their five-minute timer as before.
 * The worst a leaked secret allows is an early cache refresh.
 */

import {revalidateTag} from "next/cache";
import {timingSafeEqual} from "node:crypto";

import {LEARN_TAG, MARKETPLACE_TAG} from "@/lib/api";

function allowed(given: string | null) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!allowed(request.headers.get("x-revalidate-secret"))) {
    return Response.json({revalidated: false}, {status: 401});
  }
  // Expired at once, not stale-while-revalidate: the next visitor sees the
  // change, which is the point of being asked.
  revalidateTag(MARKETPLACE_TAG, {expire: 0});
  revalidateTag(LEARN_TAG, {expire: 0});
  return Response.json({revalidated: true});
}
