import {expect, test, type Page, type Route} from "@playwright/test";

const publicSite = process.env.PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
}

/**
 * The trainer API, faked in the browser, so the wizard can be walked end to
 * end without a phone code. It keeps every profile save so the test can see
 * what the wizard actually sent at each step.
 */
async function mockTrainerApi(page: Page) {
  let authenticated = false;
  let profile: Record<string, unknown> | null = null;
  const saves: Record<string, unknown>[] = [];

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
    const method = route.request().method();
    if (path.endsWith("/session/me/")) {
      return json(
        route,
        authenticated
          ? {authenticated: true, phone: "+233241234567", account_status: "pending", profile}
          : {authenticated: false, profile: null},
      );
    }
    if (path.endsWith("/auth/request-code/")) {
      return json(route, {challenge_id: "challenge-one", expires_in_seconds: 600});
    }
    if (path.endsWith("/auth/verify-code/")) {
      authenticated = true;
      return json(route, {authenticated: true, phone: "+233241234567", profile: null});
    }
    if (path.endsWith("/profile/submit/")) {
      profile = {
        ...profile,
        status: "pending_approval",
        status_label: "Pending approval",
        submitted_at: "2026-08-24T12:00:00Z",
        editable: false,
      };
      return json(route, {profile});
    }
    if (path.endsWith("/profile/") && method === "GET") {
      // The review step asks the server what is still missing.
      return json(route, {profile, blockers: []});
    }
    if (path.endsWith("/profile/") && method === "PUT") {
      const sent = route.request().postDataJSON() as Record<string, unknown>;
      saves.push(sent);
      const programme = sent.programme as Record<string, unknown> | null;
      profile = {
        id: 12,
        name: sent.name,
        owner_name: sent.owner_name,
        owner_phone: "+233241234567",
        contact_phone: sent.contact_phone,
        area: {id: 7, name: "Accra", slug: "accra", region: "Greater Accra"},
        address: sent.address,
        latitude: sent.latitude,
        longitude: sent.longitude,
        landmark: sent.landmark,
        year_established: null,
        premises_tenure: "",
        trainer_count: null,
        trainee_count: null,
        declared_accurate_at: sent.declared_accurate ? "2026-08-24T12:00:00Z" : null,
        site_visit_consent_at: sent.site_visit_consent ? "2026-08-24T12:00:00Z" : null,
        status: "draft",
        status_label: "Draft",
        review_note: "",
        submitted_at: null,
        editable: true,
        is_stale: false,
        last_confirmed_at: null,
        can_confirm: false,
        logo: null,
        photos: [],
        identity: {
          full_name: sent.full_name,
          role: sent.role,
          id_document_type: sent.id_document_type,
          id_document_number: "",
          has_document: false,
          data_consent_given: Boolean(sent.data_consent),
        },
        programme: programme
          ? {
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
              fee_includes_tools: false,
              fee_includes_materials: false,
              fee_includes_ppe: false,
              fee_includes_certificate: false,
              certificate_awarded: "",
              intake: null,
            }
          : null,
      };
      return json(route, {profile});
    }
    return json(route, {detail: `Unexpected mocked trainer request: ${method} ${path}`}, 500);
  });

  return {saves};
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
    test.setTimeout(60_000);
    const api = await mockTrainerApi(page);
    await page.goto(`${publicSite}/trainer/join?new=1`);

    await expect(page.getByRole("heading", {name: "List your workshop"})).toBeVisible();
    await page.getByLabel("Mobile number").fill("0241234567");
    const continueButton = page.getByRole("button", {name: "Continue", exact: true});
    expect((await continueButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await continueButton.click();

    await page.getByLabel("Enter your verification code").fill("123456");
    await page.getByRole("button", {name: "Verify and continue"}).click();

    // About you: what the confirming admin decides on, asked first.
    await expect(page.getByRole("heading", {name: "About you"})).toBeVisible();
    await page.getByLabel("Your full name").fill("Ama Mensah");
    await page.getByLabel("Your role here").selectOption("owner");
    await page.getByLabel("ID type").selectOption("ghana_card");
    await page.getByLabel("ID number").fill("GHA-000111222-3");
    await page.getByRole("button", {name: "Continue to workshop"}).click();

    await page.getByLabel("Workshop or training centre name").fill("Accra Welding Works");
    await page.getByLabel("Owner or lead trainer name").fill("Ama Mensah");
    await page.getByLabel("Area").selectOption("7");
    await page.getByLabel("Workshop address").fill("4 Community Road");
    await page.getByLabel("Nearest landmark").fill("Opposite the community market");
    await page.getByLabel("Latitude").fill("5.6037");
    await page.getByLabel("Longitude").fill("-0.1870");
    await page.getByRole("button", {name: "Continue to photos"}).click();

    // The workshop is saved on the way to the photos, before there is a
    // course to send. That save used to fail without a word on screen.
    await expect(page.getByRole("heading", {name: "Photos and ID"})).toBeVisible();
    expect(api.saves[0]).toMatchObject({name: "Accra Welding Works", area_id: 7, programme: null});
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
    // Never left on a borrowed handset.
    expect(storedDraft).not.toHaveProperty("id_document_number");

    await page.getByRole("button", {name: "Review profile"}).click();
    await expect(page.getByText("Nothing is public yet.")).toBeVisible();
    await page.locator('input[name="declared_accurate"]').check();
    await page.locator('input[name="site_visit_consent"]').check();
    await page.locator('input[name="data_consent"]').check();
    await page.getByRole("button", {name: "Submit for review"}).click();

    await expect(page.getByText("Pending approval")).toBeVisible();
    await expect(page.getByText(/not public until a reviewer approves it/i)).toBeVisible();
    expect(api.saves.at(-1)).toMatchObject({
      name: "Accra Welding Works",
      area_id: 7,
      landmark: "Opposite the community market",
      programme: {trade_id: 3, title: "Beginner arc welding", intake: null},
    });
    await expectNoPageOverflow(page);
  });
});
