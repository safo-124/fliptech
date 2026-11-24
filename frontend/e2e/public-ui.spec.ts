import {expect, test, type Page} from "@playwright/test";

const publicSite = process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";
/** Results moved off `/` when the landing page took it. */
const searchPage = `${publicSite}/training`;

async function expectNoPageOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBe(false);
}

async function expectMinimumTapHeight(page: Page, selector: string) {
  const height = await page.locator(selector).evaluate((element) =>
    Math.round(element.getBoundingClientRect().height),
  );
  expect(height).toBeGreaterThanOrEqual(44);
}

test.describe("public discovery UI", () => {
  test("keeps filters and comparison cards usable on a phone", async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 375, height: 812});
    await page.goto(searchPage);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /find training that fits your plans and your pocket/i,
      }),
    ).toBeVisible();
    await expect(page.getByLabel(/search a workshop or skill/i)).toBeVisible();
    await expect(page.getByLabel("Maximum fee")).toBeVisible();
    await expect(page.getByRole("checkbox", {name: /has visited/i})).toBeVisible();
    await expect(page.getByRole("button", {name: /show workshops/i})).toBeVisible();
    await expect(page.locator("article").first()).toBeVisible();
    await expect(page.locator("[data-provider-map]")).toHaveCount(0);

    await expectMinimumTapHeight(page, "#provider-search");
    // Each blank of the sentence is a searchable dropdown's button.
    const blanks = page.locator(".blank .picker-trigger");
    await expect(blanks).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      const height = await blanks.nth(index).evaluate((element) => element.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(44);
    }
    await expectMinimumTapHeight(page, 'button[type="submit"]');
    await expectNoPageOverflow(page);
  });

  test("searches by finishing the sentence, or by tapping a trade", async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 375, height: 812});
    await page.goto(searchPage);

    // Each blank opens a list (a sheet on a phone); pick, then submit.
    await page.getByRole("button", {name: /^Category:/}).click();
    await page.getByRole("option").nth(1).click();
    const firstCategory = await page.locator('input[type="hidden"][name="category"]').inputValue();
    expect(firstCategory).not.toBe("");
    await page.getByRole("button", {name: /^Maximum fee:/}).click();
    await page.getByRole("option", {name: /2,500/}).click();
    await page.getByRole("button", {name: /show workshops/i}).click();
    await expect(page).toHaveURL(new RegExp(`category=${firstCategory}`));
    await expect(page).toHaveURL(/max_fee=2500/);
    await expect(page.locator('input[type="hidden"][name="category"]')).toHaveValue(firstCategory);

    // A tile keeps the rest of the sentence and changes only the category.
    const tiles = page.getByRole("navigation", {name: "Categories"});
    await expect(tiles.locator('[aria-current="page"]')).toHaveCount(1);
    await tiles.getByRole("link", {name: /all categories/i}).click();
    await expect(page).not.toHaveURL(/category=/);
    await expect(page).toHaveURL(/max_fee=2500/);
    await expectNoPageOverflow(page);
  });

  test("uses the wider screen for comparison and preserves filters in the map link", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto(`${searchPage}?q=Accra&max_fee=2500&verified_only=true`);

    const viewSwitch = page.getByRole("navigation", {name: /choose results view/i});
    await expect(viewSwitch).toBeVisible();
    await expect(viewSwitch.getByRole("link", {name: "List", exact: true})).toHaveAttribute(
      "aria-current",
      "page",
    );

    const mapHref = await viewSwitch
      .getByRole("link", {name: "Map", exact: true})
      .getAttribute("href");
    expect(mapHref).toContain("/map?");
    expect(mapHref).toContain("q=Accra");
    expect(mapHref).toContain("max_fee=2500");
    expect(mapHref).toContain("verified_only=true");
    await expect(page.locator("article").first()).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test("stays balanced at the tablet breakpoint", async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 768, height: 1024});
    await page.goto(searchPage);

    await expect(page.locator("article").first()).toBeVisible();
    await expect(page.locator("[data-provider-map]")).toHaveCount(0);
    await expectNoPageOverflow(page);
  });

  test("keeps the provider and enquiry journey clear on a phone", async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(searchPage);

    const providerHref = await page.locator("article a").first().getAttribute("href");
    expect(providerHref).toBeTruthy();
    await page.goto(`${publicSite}${providerHref}`);

    await expect(page.getByRole("heading", {level: 1})).toBeVisible();
    // The brand is configurable (Fliptech, Fliiptech), so match either spelling.
    await expect(page.getByRole("heading", {name: /fli+ptech verification/i})).toBeVisible();
    await expect(page.getByRole("heading", {name: /government status/i})).toBeVisible();
    const enquire = page.getByRole("link", {name: /enquire about this course/i}).first();
    await expect(enquire).toBeVisible();
    await expectNoPageOverflow(page);

    await enquire.click();
    await expect(page.getByRole("heading", {level: 1, name: /send an enquiry/i})).toBeVisible();
    // Signed out, with the phone code switched off (the default while SMS
    // cannot be relied on): the form asks them to sign in or create an
    // account first, in the sign-in sheet.
    const signIn = page.getByRole("button", {name: /sign in or create an account/i});
    await expect(signIn).toBeVisible();
    const box = await signIn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await signIn.click();
    await expect(page.getByLabel(/phone number or email/i)).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

/** Every "Namespace.key" in the messages, to catch one shown raw. */
async function messageKeys() {
  const {readFile} = await import("node:fs/promises");
  const {join} = await import("node:path");
  // Playwright runs from the frontend folder (playwright.config.ts).
  const messages = JSON.parse(await readFile(join(process.cwd(), "messages", "en.json"), "utf8"));
  const keys: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) walk(value, path ? `${path}.${key}` : key);
    } else if (path.includes(".")) keys.push(path);
  };
  walk(messages, "");
  return new Set(keys);
}

test.describe("no raw message keys", () => {
  test("public pages show words, never a message key like VideoReport.open", async ({page}) => {
    test.setTimeout(90_000);
    const keys = await messageKeys();
    const pages = ["/", "/training", "/marketplace", "/learn", "/account"];
    // The first course, when the demo data has one with lessons.
    await page.goto(`${publicSite}/learn`);
    const course = await page.locator('a[href^="/learn/"]:not([href="/learn/mine"]):not([href="/learn/saved"])').first();
    if (await course.count()) pages.push((await course.getAttribute("href")) ?? "/learn");
    for (const path of pages) {
      await page.goto(`${publicSite}${path}`);
      await page.waitForLoadState("networkidle");
      const shown = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll("[aria-label],[placeholder],[title]")).flatMap((element) =>
          ["aria-label", "placeholder", "title"].map((name) => element.getAttribute(name) ?? ""),
        );
        return [document.body.innerText, ...labels].join("\n");
      });
      const raw = (shown.match(/\b[A-Z][A-Za-z]+(?:\.[A-Za-z0-9_]+)+\b/g) ?? []).filter((text) => keys.has(text));
      expect(raw, `raw message keys on ${path}`).toEqual([]);
    }
  });
});
