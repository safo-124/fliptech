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
    for (const blank of ["trade", "area", "max_fee", "places"]) {
      await expectMinimumTapHeight(page, `select[name="${blank}"]`);
    }
    await expectMinimumTapHeight(page, 'button[type="submit"]');
    await expectNoPageOverflow(page);
  });

  test("searches by finishing the sentence, or by tapping a trade", async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 375, height: 812});
    await page.goto(searchPage);

    // The phone's own picker, so a plain choice and a submit, with no script.
    const trade = page.getByLabel("Trade", {exact: true});
    const firstTrade = await trade.locator("option").nth(1).getAttribute("value");
    await trade.selectOption(firstTrade!);
    await page.getByLabel("Maximum fee").selectOption("2500");
    await page.getByRole("button", {name: /show workshops/i}).click();
    await expect(page).toHaveURL(new RegExp(`trade=${firstTrade}`));
    await expect(page).toHaveURL(/max_fee=2500/);
    await expect(page.getByLabel("Trade", {exact: true})).toHaveValue(firstTrade!);

    // A tile keeps the rest of the sentence and changes only the trade.
    const tiles = page.getByRole("navigation", {name: "Trades"});
    await expect(tiles.locator('[aria-current="page"]')).toHaveCount(1);
    await tiles.getByRole("link", {name: /all trades/i}).click();
    await expect(page).not.toHaveURL(/trade=/);
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
    await expect(page.getByLabel(/your phone number/i)).toBeVisible();
    await expect(page.getByRole("button", {name: /continue/i})).toBeVisible();
    await expectMinimumTapHeight(page, 'button[type="submit"]');
    await expectNoPageOverflow(page);
  });
});
