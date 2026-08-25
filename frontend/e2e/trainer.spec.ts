import {expect, test, type Page, type Route} from "@playwright/test";

const publicSite = process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
}

async function mockTrainerApi(page: Page) {
  let authenticated = false;
  let profile: Record<string, unknown> | null = null;
  let submittedPayload: Record<string, unknown> | null = null;

  await page.route("**/api/areas/**", (route) =>
    json(route, {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 7,
          name: "Accra",
          slug: "accra",
          region_slug: "greater-accra",
          provider_count: 4,
          centroid_lat: 5.6037,
          centroid_lng: -0.187,
        },
      ],
    }),
  );
  await page.route("**/api/trades/**", (route) =>
    json(route, {
      count: 1,
      next: null,
      previous: null,
      results: [{id: 3, name: "Welding", slug: "welding", description: "", provider_count: 4}],
    }),
  );
  await page.route("**/api/trainer/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/session/me/")) {
      return json(route, authenticated ? {authenticated: true, phone: "+233241234567", profile} : {authenticated: false, profile: null});
    }
    if (path.endsWith("/auth/request-code/")) {
      return json(route, {challenge_id: "challenge-one", expires_in_seconds: 600});
    }
    if (path.endsWith("/auth/verify-code/")) {
      authenticated = true;
      return json(route, {authenticated: true, phone: "+233241234567", profile: null});
    }
    if (path.endsWith("/profile/submit/")) {
      profile = {...profile, status: "pending_approval", status_label: "Pending approval", submitted_at: "2026-08-24T12:00:00Z", editable: false};
      return json(route, {profile});
    }
    if (path.endsWith("/profile/") && route.request().method() === "PUT") {
      submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
      const programme = submittedPayload.programme as Record<string, unknown>;
      profile = {
        id: 12,
        name: submittedPayload.name,
        owner_name: submittedPayload.owner_name,
        owner_phone: "+233241234567",
        contact_phone: submittedPayload.contact_phone,
        area: {id: 7, name: "Accra", slug: "accra", region: "Greater Accra"},
        address: submittedPayload.address,
        latitude: submittedPayload.latitude,
        longitude: submittedPayload.longitude,
        status: "draft",
        status_label: "Draft",
        review_note: "",
        submitted_at: null,
        editable: true,
        programme: {
          id: 22,
          trade: {id: 3, name: "Welding", slug: "welding"},
          title: programme.title,
          fee: programme.fee,
          instalments_allowed: false,
          instalment_note: "",
          duration_weeks: programme.duration_weeks,
          hours_per_week: null,
          weekly_schedule: "",
          capacity: null,
          intake: null,
        },
      };
      return json(route, {profile});
    }
    return json(route, {detail: "Unexpected mocked trainer request"}, 500);
  });

  return {getSubmittedPayload: () => submittedPayload};
}

async function expectNoPageOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBe(false);
}

test.describe("trainer self-registration on a phone", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("creates a complete approval-bound profile without retaining auth secrets", async ({page}) => {
    const api = await mockTrainerApi(page);
    await page.goto(`${publicSite}/trainer/join`);

    await expect(page.getByRole("heading", {name: "List your workshop"})).toBeVisible();
    await page.getByLabel("Mobile number").fill("0241234567");
    const continueButton = page.getByRole("button", {name: "Continue"});
    expect((await continueButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await continueButton.click();

    await page.getByLabel("Enter your verification code").fill("123456");
    await page.getByRole("button", {name: "Verify and continue"}).click();

    await page.getByLabel("Workshop or training centre name").fill("Accra Welding Works");
    await page.getByLabel("Owner or lead trainer name").fill("Ama Mensah");
    await page.getByLabel("Area").selectOption("7");
    await page.getByLabel("Workshop address or landmark").fill("Opposite the community market");
    await page.getByLabel("Latitude").fill("5.6037");
    await page.getByLabel("Longitude").fill("-0.1870");
    await page.getByRole("button", {name: "Continue to course"}).click();

    await page.getByLabel("Trade").selectOption("3");
    await page.getByLabel("Course title").fill("Beginner arc welding");
    await page.getByLabel("Full fee (GH₵)").fill("1200");
    await page.getByLabel("Duration in weeks").fill("12");

    const storedDraft = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("skillshub.trainer.public-profile-draft") ?? "{}"),
    );
    expect(storedDraft).not.toHaveProperty("phone");
    expect(storedDraft).not.toHaveProperty("code");
    expect(storedDraft).not.toHaveProperty("challenge_id");

    await page.getByRole("button", {name: "Review profile"}).click();
    await expect(page.getByText("Nothing is public yet.")).toBeVisible();
    await page.getByRole("button", {name: "Submit for review"}).click();

    await expect(page.getByText("Pending approval")).toBeVisible();
    await expect(page.getByText(/not public until a reviewer approves it/i)).toBeVisible();
    expect(api.getSubmittedPayload()).toMatchObject({
      name: "Accra Welding Works",
      area_id: 7,
      programme: {trade_id: 3, title: "Beginner arc welding", intake: null},
    });
    await expectNoPageOverflow(page);
  });
});
