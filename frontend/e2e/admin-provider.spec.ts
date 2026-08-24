import {expect, test, type Page} from "@playwright/test";

const username = process.env.ADMIN_E2E_USERNAME;
const password = process.env.ADMIN_E2E_PASSWORD;

test.skip(
  !username || !password,
  "Set ADMIN_E2E_USERNAME and ADMIN_E2E_PASSWORD for a local staff account.",
);

async function signIn(page: Page) {
  await page.goto("/back-office/");

  if (page.url().includes("/login/")) {
    await page.locator("#id_username").fill(username ?? "");
    await page.locator("#id_password").fill(password ?? "");
    await Promise.all([
      page.waitForURL(/\/back-office\/(?!login)/),
      page.getByRole("button", {name: "Log in"}).click(),
    ]);
  }
}

async function expectNoPageOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBe(false);
}

test.describe("provider back-office workflow", () => {
  test.beforeEach(async ({page}) => {
    await signIn(page);
  });

  test("keeps Django's native changelist controls inside the modern workbench", async ({page}) => {
    await page.goto("/back-office/providers/provider/?queue=never_visited");

    await expect(page.locator("[data-provider-workbench]")).toBeVisible();
    await expect(page.locator("#changelist-form")).toBeVisible();
    await expect(page.locator("table#result_list")).toBeVisible();
    await expect(page.locator("#searchbar")).toHaveAccessibleName(/search/i);
    await expect(page.locator("#changelist-filter")).toHaveAttribute(
      "aria-labelledby",
      "changelist-filter-header",
    );
    await expect(page.getByRole("navigation", {name: /back-office navigation/i})).toBeVisible();
    await expectNoPageOverflow(page);

    const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.evaluate(() => {
      localStorage.setItem("theme", "dark");
      document.documentElement.dataset.theme = "dark";
    });
    const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBackground).not.toBe(lightBackground);
    await expect(page.locator("[data-provider-workbench]")).toBeVisible();
  });

  test("keeps the add and edit forms accessible", async ({page}) => {
    await page.goto("/back-office/providers/provider/add/");

    await expect(page.locator("#provider_form")).toBeVisible();
    await expect(page.locator("[data-provider-form-header]")).toBeVisible();
    await expect(page.locator("[data-photo-uploader]")).toHaveCount(0);
    await expect(page.getByText(/save the provider first/i)).toBeVisible();

    await page.goto("/back-office/providers/provider/");
    const firstProvider = page.locator("#result_list tbody th a").first();
    test.skip((await firstProvider.count()) === 0, "The local database has no provider fixture.");
    await firstProvider.click();

    await expect(page.locator("#provider_form")).toBeVisible();
    const formHeader = page.locator("[data-provider-form-header]");
    await expect(formHeader).toBeVisible();
    expect((await formHeader.boundingBox())?.y).toBeLessThan(300);
    await expect(page.locator("#content > h2")).toHaveCount(0);
    await expect(page.locator("[data-photo-uploader]")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".shp-status")).toHaveAttribute("role", "status");
    await expect(page.locator(".shp-status")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(".shp-input")).toHaveAccessibleName(/photograph/i);
    await expectNoPageOverflow(page);
  });
});

test.describe("provider workbench on a phone", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("uses a keyboard-operable filter drawer and local table scrolling", async ({page}) => {
    await signIn(page);
    await page.goto("/back-office/providers/provider/");

    const toggle = page.locator("[data-provider-filter-toggle]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-provider-filter-panel]")).toBeVisible();
    expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator(".pc-filter-close").boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expectNoPageOverflow(page);
  });
});
