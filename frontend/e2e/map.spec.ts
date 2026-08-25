import {expect, test, type Page} from "@playwright/test";

const publicSite = process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

async function expectNoPageOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBe(false);
}

test.describe("public provider map", () => {
  test("loads the complete location set into an accessible fitted map", async ({page}) => {
    // A cold Next development server can spend over 30 seconds compiling the
    // Leaflet client chunk; production builds are much faster.
    test.setTimeout(60_000);
    await page.goto(`${publicSite}/map`);

    await expect(page.locator("[data-provider-map]")).toBeVisible();
    await expect(page.getByRole("heading", {name: /provider locations?$/i})).toBeVisible();
    await expect(page.getByRole("region", {name: /interactive map/i})).toBeVisible();
    await expect(page.getByText(/use arrow keys to pan/i)).toBeVisible();
    await expect(page.getByRole("button", {name: /show all providers/i})).toBeVisible();
    await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
    await expect(page.locator("main main")).toHaveCount(0);
    await expectNoPageOverflow(page);
  });

  test("builds the inventory sitemap from the running API", async ({request}) => {
    test.setTimeout(60_000);
    const response = await request.get(`${publicSite}/sitemap.xml`);

    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("application/xml");
    const xml = await response.text();
    expect(xml).toContain("<urlset");
    expect(xml).toMatch(/<loc>[^<]+\/trades\/[^<]+<\/loc>/);
  });
});

test.describe("public provider map on a phone", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("keeps the map usable while hiding the desktop comparison rail", async ({page}) => {
    test.setTimeout(60_000);
    await page.goto(`${publicSite}/map`);

    await expect(page.locator("[data-provider-map]")).toBeVisible();
    await expect(page.locator("ul.hidden.lg\\:block")).toBeHidden();
    const reset = page.getByRole("button", {name: /show all providers/i});
    await expect(reset).toBeVisible();
    expect((await reset.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expectNoPageOverflow(page);
  });
});
