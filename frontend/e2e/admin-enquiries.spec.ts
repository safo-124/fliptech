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

test.describe("enquiry and enrolment operations", () => {
  test.beforeEach(async ({page}) => {
    await signIn(page);
  });

  test("keeps the enquiry inbox and outcome form operational", async ({page}) => {
    await page.goto("/back-office/enquiries/enquiry/?queue=sent_awaiting_reply");

    await expect(page.locator("[data-enquiry-workbench]")).toBeVisible();
    await expect(page.getByRole("navigation", {name: "Enquiry work queues"})).toBeVisible();
    await expect(page.locator("#changelist-form")).toBeVisible();
    await expect(page.locator("#searchbar")).toHaveAccessibleName(/search/i);
    await expect(page.locator("#changelist-filter")).toHaveAttribute(
      "aria-labelledby",
      "changelist-filter-header",
    );
    await expectNoPageOverflow(page);

    const firstEnquiry = page.locator("#result_list tbody th a").first();
    test.skip((await firstEnquiry.count()) === 0, "The local database has no waiting enquiry.");
    await firstEnquiry.click();

    await expect(page.locator("#enquiry_form")).toBeVisible();
    await expect(page.locator("[data-enquiry-lifecycle]")).toBeVisible();
    await expect(page.locator("[data-enquiry-source]")).toBeVisible();
    await expect(page.locator("[data-enquiry-outcome]")).toBeVisible();
    await expect(page.locator("[data-enquiry-save-dock]")).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test("renders enrolment reporting and the monthly record form", async ({page}) => {
    await page.goto("/back-office/enquiries/enrolment/");

    await expect(page.locator("[data-enrolment-changelist]")).toBeVisible();
    await expect(page.getByLabel("Enrolment reporting summary")).toBeVisible();
    await expect(page.locator("#changelist-form")).toBeVisible();
    await expectNoPageOverflow(page);

    await page.goto("/back-office/enquiries/enrolment/add/");
    await expect(page.locator("#enrolment_form")).toBeVisible();
    await expect(page.locator("[data-enrolment-form-signals]")).toBeVisible();
    await expect(page.getByLabel("Save enrolment")).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

test.describe("outcome operations on a phone", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("uses accessible local filter drawers without page overflow", async ({page}) => {
    await signIn(page);
    await page.goto("/back-office/enquiries/enquiry/");

    const enquiryToggle = page.locator("[data-enquiry-filter-toggle]");
    await expect(enquiryToggle).toBeVisible();
    await enquiryToggle.click();
    await expect(enquiryToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-enquiry-filter-panel]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(enquiryToggle).toHaveAttribute("aria-expanded", "false");
    await expect(enquiryToggle).toBeFocused();
    await expectNoPageOverflow(page);

    await page.goto("/back-office/enquiries/enrolment/");
    const enrolmentToggle = page.locator("[data-enrolment-filter-toggle]");
    await expect(enrolmentToggle).toBeVisible();
    await enrolmentToggle.click();
    await expect(enrolmentToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-enrolment-filter-panel]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(enrolmentToggle).toHaveAttribute("aria-expanded", "false");
    await expect(enrolmentToggle).toBeFocused();
    await expectNoPageOverflow(page);
  });
});
