/*
 * The service worker: what lets the site open on a phone with no signal.
 *
 * Registered by app/layout.tsx, in production only. It does three things and
 * deliberately nothing more:
 *
 *   Pages        Network first, always: a visitor with signal gets today's
 *                fees and intakes, never a kept copy. Public pages they open
 *                (the search page, a listing, a trade, the map) are kept, so
 *                with no signal they still open. Anything signed in or
 *                personal (trainee and trainer accounts, owner dashboards,
 *                enquiry and report forms) is never kept: on a shared phone,
 *                the next person must not find it.
 *   Built files  Cache first for /_next/static, whose names change with their
 *                content, and for listing photos the page has already shown.
 *   No signal    /offline, kept at install, for any page with no kept copy.
 *
 * Django's paths (the API, the back office, /static, /media) are never
 * answered from here. The worker steps aside and the browser fetches them as
 * if it did not exist.
 *
 * Keepable pages are an allow list on purpose: a new section of the site is
 * not kept until it is added to keepable() below, so a personal page cannot
 * end up cached because someone forgot to exclude it.
 *
 * To switch the worker off on a live site, replace this file's contents with
 *
 *   self.addEventListener("install", () => self.skipWaiting());
 *   self.addEventListener("activate", () => self.registration.unregister());
 *
 * and deploy. Each phone drops it the next time it opens the site.
 *
 * Bump VERSION when this file changes what it keeps or how; the old caches are
 * deleted when the new worker takes over.
 */

const VERSION = 1;
const PAGES = `pages-v${VERSION}`;
const FILES = `files-v${VERSION}`;
const PHOTOS = `photos-v${VERSION}`;
const SHELL = `shell-v${VERSION}`;
const OFFLINE_URL = "/offline";

// How many of each are kept, newest first. Pages and photos are what a phone
// short of storage would notice; built files are small and shared by every page.
const LIMITS = { [PAGES]: 40, [FILES]: 150, [PHOTOS]: 80 };

// Served by Django rather than the site; see deploy/Caddyfile.
const DJANGO = /^\/(?:api|back-office|static|media|healthz)(?:\/|$)/;

// First path segments that are the site's own sections, not an area.
const SECTIONS = new Set([
  "_next",
  "dashboard",
  "enquiry",
  "icons",
  "join",
  "language",
  "offline",
  "trades",
  "trainee",
  "trainer",
]);

function keepable(path) {
  if (path === "/" || path === "/map" || path === "/privacy") return true;
  if (/^\/trades\/[^/]+\/?$/.test(path)) return true;
  // A listing, /<area>/<workshop>. Not its "report a problem" form, which is
  // a third segment and so never matches.
  const listing = /^\/([^/]+)\/[^/]+\/?$/.exec(path);
  return listing !== null && !SECTIONS.has(listing[1]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const current = new Set([PAGES, FILES, PHOTOS, SHELL]);
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (!current.has(name)) await caches.delete(name);
      }
      // Starts a page's request while the worker is still waking up, so
      // having a worker never makes a page slower to arrive.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || DJANGO.test(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(page(event, url));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, FILES));
  } else if (url.pathname === "/_next/image") {
    event.respondWith(cacheFirst(event, PHOTOS));
  }
  // Anything else, such as the data Next fetches when moving between pages,
  // goes to the network untouched. With no signal that fetch fails, Next loads
  // the page in full instead, and that comes back through page().
});

async function page(event, url) {
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    if (response.ok && response.type === "basic" && keepable(url.pathname)) {
      event.waitUntil(keep(PAGES, event.request, response.clone()));
    }
    return response;
  } catch {
    const kept =
      keepable(url.pathname) &&
      (await caches.match(event.request, { cacheName: PAGES, ignoreVary: true }));
    return kept || (await caches.match(OFFLINE_URL, { cacheName: SHELL })) || Response.error();
  }
}

async function cacheFirst(event, cacheName) {
  const kept = await caches.match(event.request, { cacheName });
  if (kept) return kept;
  const response = await fetch(event.request);
  if (response.ok) event.waitUntil(keep(cacheName, event.request, response.clone()));
  return response;
}

async function keep(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  // Keys come back oldest first, so trimming the front keeps the most recent.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - LIMITS[cacheName]))) {
    await cache.delete(key);
  }
}
