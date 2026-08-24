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

test.describe("catalog operations", () => {
  test.beforeEach(async ({page}) => {
    await signIn(page);
  });

  test("renders the trade, programme and intake work queues", async ({page}) => {
    const workspaces = [
      ["trade", "Trade discovery readiness"],
      ["programme", "Programme readiness"],
      ["intake", "Intake availability"],
    ] as const;

    for (const [model, heading] of workspaces) {
      await page.goto(`/back-office/catalog/${model}/`);
      await expect(page.locator("[data-catalog-changelist]")).toBeVisible();
      await expect(page.getByRole("heading", {name: heading})).toBeVisible();
      await expect(page.getByRole("navigation", {name: "Catalog work queues"})).toBeVisible();
      await expect(page.locator("#changelist-form")).toBeVisible();
      await expect(page.locator("#searchbar")).toHaveAccessibleName(/search/i);
      await expectNoPageOverflow(page);
    }
  });

  test("preserves native catalog editors and related-record navigation", async ({page}) => {
    await page.goto("/back-office/catalog/trade/add/");
    await expect(page.locator("#trade_form")).toBeVisible();
    await expect(page.locator("[data-catalog-form-header]")).toBeVisible();
    await expect(page.getByLabel("Save catalog record")).toBeVisible();
    await page.locator("#id_name").pressSequentially("Industrial Pipe Fitting");
    await expect(page.locator("#id_slug")).toHaveValue("industrial-pipe-fitting");
    await expectNoPageOverflow(page);

    await page.goto("/back-office/catalog/programme/add/");
    await expect(page.locator("#programme_form")).toBeVisible();
    await expect(page.locator(".field-provider .admin-autocomplete")).toBeVisible();
    await expect(page.locator(".field-trade .admin-autocomplete")).toBeVisible();
    await expect(page.locator("#intakes-group")).toBeVisible();
    await expect(page.getByLabel("Save catalog record")).toBeVisible();
    await expectNoPageOverflow(page);

    await page.goto("/back-office/catalog/intake/add/");
    await expect(page.locator("#intake_form")).toBeVisible();
    await expect(page.locator(".field-programme .admin-autocomplete")).toBeVisible();
    await expect(page.getByLabel("Save catalog record")).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

test.describe("catalog operations on a phone", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("uses an accessible local filter drawer without page overflow", async ({page}) => {
    await signIn(page);
    await page.goto("/back-office/catalog/programme/");

    const toggle = page.locator("[data-catalog-filter-toggle]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-catalog-filter-panel]")).toBeVisible();
    expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expectNoPageOverflow(page);
  });
});
