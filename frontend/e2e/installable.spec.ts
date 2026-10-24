import {expect, test, type APIRequestContext, type Page} from "@playwright/test";

/**
 * The site can be installed on a phone, and opens with no signal.
 *
 * The manifest and icons are checked against any server. The offline half
 * needs a production build (`next build && next start`): development
 * deliberately registers no service worker. See public/sw.js.
 */

const publicSite = process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";
const OFFLINE_HEADING = "You're offline";

/** Width and height from a PNG's header, which is all a phone checks. */
async function pngSize(request: APIRequestContext, path: string) {
  const response = await request.get(`${publicSite}${path}`);
  expect(response.status(), path).toBe(200);
  expect(response.headers()["content-type"], path).toBe("image/png");
  const body = await response.body();
  return `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`;
}

test.describe("installing the site", () => {
  test("the manifest describes an app a phone will install", async ({request}) => {
    const response = await request.get(`${publicSite}/manifest.webmanifest`);
    expect(response.status()).toBe(200);
    const manifest = await response.json();

    expect(manifest).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
      short_name: "Skills Hub",
    });
    expect(manifest.name).toContain("Skills Hub");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);

    const purposes = manifest.icons.map((icon: {purpose: string}) => icon.purpose);
    expect(purposes).toEqual(expect.arrayContaining(["any", "maskable"]));
    for (const icon of manifest.icons) {
      expect(await pngSize(request, icon.src), icon.src).toBe(icon.sizes);
    }
  });

  test("every page links the manifest and its icons", async ({page, request}) => {
    await page.goto(publicSite);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);

    const favicon = await page.locator('link[rel="icon"]').first().getAttribute("href");
    const svg = await request.get(new URL(favicon!, publicSite).toString());
    expect(svg.headers()["content-type"]).toContain("image/svg+xml");

    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(await pngSize(request, new URL(apple!, publicSite).pathname)).toBe("180x180");
  });

  test("the offline page stands on its own", async ({page}) => {
    await page.goto(`${publicSite}/offline`);
    await expect(page.getByRole("heading", {name: OFFLINE_HEADING})).toBeVisible();
    await expect(page.getByRole("button", {name: "Try again"})).toBeVisible();
    // Nothing from the build: an offline phone may hold none of it.
    expect(await page.locator('script[src], link[rel="stylesheet"]').count()).toBe(0);
  });
});

/** Whether the layout's registration script is on the page, as in production. */
async function hasWorker(page: Page) {
  // Read from the DOM: a locator's hasText does not look inside <script>.
  return page.evaluate(() =>
    [...document.scripts].some((script) => script.textContent?.startsWith('if("serviceWorker"')),
  );
}

async function heading(page: Page) {
  return page.locator("h1").first().innerText();
}

test.describe("with no signal", () => {
  test.skip(({browserName}) => browserName !== "chromium", "Offline emulation needs Chromium.");
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

  test("pages already opened still open; personal ones and the back office do not", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await page.goto(publicSite);
    test.skip(!(await hasWorker(page)), "The worker is only registered in a production build.");
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The first visit installs the worker; from here it answers for the page.
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    const searchHeading = await heading(page);
    const listing = await page.evaluate(() =>
      [...document.links]
        .map((link) => new URL(link.href).pathname)
        .find(
          (path) =>
            /^\/[^/]+\/[^/]+$/.test(path) &&
            !/^\/(?:trainer|trainee|trades|dashboard|enquiry|join|language|icons)\//.test(path),
        ),
    );
    let listingHeading: string | undefined;
    if (listing) {
      await page.goto(`${publicSite}${listing}`);
      listingHeading = await heading(page);
    }
    await page.goto(`${publicSite}/trainee/sign-in`);
    expect(await heading(page)).not.toBe(OFFLINE_HEADING);

    await context.setOffline(true);
    try {
      await page.goto(publicSite);
      expect(await heading(page)).toBe(searchHeading);

      if (listing) {
        await page.goto(`${publicSite}${listing}`);
        expect(await heading(page)).toBe(listingHeading);
      }

      // Opened a moment ago, but personal: never kept.
      await page.goto(`${publicSite}/trainee/sign-in`);
      expect(await heading(page)).toBe(OFFLINE_HEADING);

      // Never opened: the offline page rather than the browser's error.
      await page.goto(`${publicSite}/privacy`);
      expect(await heading(page)).toBe(OFFLINE_HEADING);

      // Django's paths are not the worker's to answer, even with nothing else to show.
      await expect(page.goto(`${publicSite}/back-office/`)).rejects.toThrow();
    } finally {
      await context.setOffline(false);
    }
  });
});
