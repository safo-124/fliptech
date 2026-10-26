import {expect, test, type Page} from "@playwright/test";

/**
 * Section 10's budgets for the search page: under 200 KB, and first paint
 * under three seconds on 3G.
 *
 * Measured the way SETUP.md first measured them: what crossed the wire,
 * compressed, for the HTML, CSS and JavaScript. Images and fonts are left
 * out, as they were then. Link prefetches for pages the visitor has not asked
 * for (Next's `?_rsc=` requests) are left out too: they are speculative, and
 * a slow phone gets them only after the page is already usable.
 *
 * Only meaningful against a production build (`next build && next start`).
 * The dev server ships unminified code with a hot-reload client, and would
 * fail both budgets by a mile while saying nothing about what trainees get.
 */

const publicSite = process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";
// `/` is the landing page; the budget is the results page's, so it is
// requested directly rather than through the redirect, which would add a
// round trip to the 3G paint measurement and measure the wrong thing.
const searchPage = `${publicSite}/training`;

const BUDGET_BYTES = 200 * 1024;
const FIRST_PAINT_MS = 3_000;

// WebPageTest's "3G" profile: 1.6 Mbps down, 768 kbps up, 300 ms round trip.
const THREE_G = {
  offline: false,
  latency: 300,
  downloadThroughput: (1.6 * 1_000_000) / 8,
  uploadThroughput: (768 * 1_000) / 8,
};

const NOT_COUNTED = /\.(?:woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico)(?:\?|$)|\/_next\/image|[?&]_rsc=/;

type Weighed = {url: string; type: string; bytes: number};

async function isDevServer(page: Page) {
  return page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => /hmr-client|webpack-hmr|turbopack.*dev/.test(entry.name)),
  );
}

async function weigh(page: Page): Promise<Weighed[]> {
  return page.evaluate((pattern) => {
    const skip = new RegExp(pattern);
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return [
      {url: navigation.name, type: "document", bytes: navigation.encodedBodySize},
      ...resources
        .filter((entry) => entry.initiatorType !== "img" && !skip.test(entry.name))
        .map((entry) => ({url: entry.name, type: entry.initiatorType, bytes: entry.encodedBodySize})),
    ];
  }, NOT_COUNTED.source);
}

function report(entries: Weighed[]) {
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  return [...entries]
    .sort((a, b) => b.bytes - a.bytes)
    .map((entry) => `${kb(entry.bytes).padStart(9)}  ${entry.type.padEnd(8)}  ${entry.url}`)
    .join("\n");
}

test.describe("search page budgets", () => {
  test.skip(({browserName}) => browserName !== "chromium", "Network throttling needs Chromium.");
  // A phone, because that is who the budget is for. A desktop also loads the
  // map beside the results, on purpose and lazily; see SearchMapPanel.
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

  test("stays under 200 KB of HTML, CSS and JavaScript", async ({page}) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", {cacheDisabled: true});

    await page.goto(searchPage, {waitUntil: "load"});
    test.skip(await isDevServer(page), "Budgets only mean something against a production build.");

    const entries = await weigh(page);
    const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    test.info().annotations.push({
      type: "weight",
      description: `${(total / 1024).toFixed(1)} KB of ${BUDGET_BYTES / 1024} KB`,
    });

    expect(total, `Search page weighs more than the budget:\n${report(entries)}`).toBeLessThanOrEqual(
      BUDGET_BYTES,
    );
  });

  test("paints within three seconds on 3G", async ({page}) => {
    test.setTimeout(60_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", {cacheDisabled: true});
    await cdp.send("Network.emulateNetworkConditions", THREE_G);

    await page.goto(searchPage, {waitUntil: "load"});
    test.skip(await isDevServer(page), "Budgets only mean something against a production build.");

    const firstPaint = await page.evaluate(
      () => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? Infinity,
    );
    test.info().annotations.push({
      type: "first paint",
      description: `${Math.round(firstPaint)} ms of ${FIRST_PAINT_MS} ms on 3G`,
    });

    expect(firstPaint).toBeLessThan(FIRST_PAINT_MS);
  });
});
