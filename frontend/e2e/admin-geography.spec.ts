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

test.describe("geography operations", () => {
  test.beforeEach(async ({page}) => {
    await signIn(page);
  });

  test("keeps launch and area inventory controls inside the modern workspace", async ({page}) => {
    await page.goto("/back-office/geography/region/");

    await expect(page.locator("[data-geography-changelist]")).toBeVisible();
    await expect(page.getByRole("heading", {name: "Region launch readiness"})).toBeVisible();
    await expect(page.getByLabel("Filtered geography inventory")).toBeVisible();
    await expect(page.locator("#changelist-form")).toBeVisible();
    await expect(page.locator("#searchbar")).toHaveAccessibleName(/search/i);
    await expect(page.locator("#changelist-filter")).toHaveAttribute(
      "aria-labelledby",
      "changelist-filter-header",
    );
    await expectNoPageOverflow(page);

    await page.goto("/back-office/geography/area/");
    await expect(page.locator("[data-geography-changelist]")).toBeVisible();
    await expect(page.getByRole("heading", {name: "Area coverage"})).toBeVisible();
    await expect(page.getByLabel("Inventory readiness rule")).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test("preserves Django's GIS and save workflow on the area form", async ({page}) => {
    await page.goto("/back-office/geography/area/add/");

    await expect(page.locator("#area_form")).toBeVisible();
    await expect(page.locator("[data-geography-form-header]")).toBeVisible();
    await expect(page.getByLabel("Save geography record")).toBeVisible();
    await expect(page.locator(".dj_map_wrapper, .dj_map").first()).toBeVisible();
    await page.locator("#id_name").pressSequentially("North Ridge Skills District");
    await expect(page.locator("#id_slug")).toHaveValue("north-ridge-skills-district");
    await expectNoPageOverflow(page);
  });
});

test.describe("geography operations on a phone", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("uses an accessible local filter drawer without page overflow", async ({page}) => {
    await signIn(page);
    await page.goto("/back-office/geography/region/");

    const toggle = page.locator("[data-geography-filter-toggle]");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-geography-filter-panel]")).toBeVisible();
    expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expectNoPageOverflow(page);
  });
});
