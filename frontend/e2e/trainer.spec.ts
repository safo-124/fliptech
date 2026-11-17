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
async function mockTrainerApi(
  page: Page,
  {
    signedInAs,
    refusePinOnSubmit = false,
  }: {signedInAs?: {userId: number; name: string}; refusePinOnSubmit?: boolean} = {},
) {
  let authenticated = false;
  // Signed in on the main site already, as a buyer or learner: a login with
  // no trainer role until /api/account/roles/trainer/ adds one.
  let signedIn = Boolean(signedInAs);
  let profile: Record<string, unknown> | null = null;
  const saves: Record<string, unknown>[] = [];
  const calls: string[] = [];

  await page.route("**/api/session/whoami/**", (route) =>
    json(
      route,
      signedIn || authenticated
        ? {
            user_id: signedInAs?.userId ?? 5,
            customer: {name: signedInAs?.name ?? "+233241234567", avatar: null},
            trainer: authenticated ? {name: "Trainer"} : null,
            trainee: null,
            seller: null,
          }
        : {user_id: null, customer: null, trainer: null, trainee: null, seller: null},
    ),
  );
  // The account check in front of the wizard (SignInGate): these tests walk
  // the phone-code sign-up, so the code is switched on here.
  await page.route(/\/api\/account\/$/, (route) =>
    json(
      route,
      signedIn || authenticated
        ? {
            authenticated: true,
            account: {phone: "+233241234567", display_name: signedInAs?.name ?? "", email: null},
            roles: {trainee: null, trainer: authenticated ? {status: "pending"} : null, seller: null},
            sign_in: {code: true},
          }
        : {authenticated: false, account: null, roles: null, sign_in: {code: true}},
    ),
  );
  await page.route("**/api/account/roles/trainer/**", (route) => {
    calls.push("add-trainer-role");
    authenticated = true;
    return json(route, {authenticated: true, account: {}, roles: {trainer: "pending"}});
  });

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
    if (path.endsWith("/auth/request-code/")) calls.push("request-code");
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
      signedIn = true;
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
      // The final save, with the ticks: the server refuses the pin, as it
      // does one too far from the chosen area.
      if (refusePinOnSubmit && sent.declared_accurate) {
        const problem = "That pin is more than 25 km from Accra.";
        return json(route, {latitude: [problem], longitude: [problem]}, 400);
      }
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

  return {saves, calls};
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
    // The pin has to be confirmed before moving on.
    await page.getByRole("button", {name: "Continue to photos"}).click();
    await expect(page.getByText(/tick the box to say the pin is on your workshop/i)).toBeVisible();
    await page.getByLabel(/the pin is on my workshop/i).check();
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

    const stored = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("skillshub.draft.trainer-profile") ?? "{}"),
    );
    // Kept with the person who typed it, so nobody else is shown it.
    expect(stored.owner).toBe("user-5");
    const storedDraft = stored.value;
    expect(storedDraft).toMatchObject({full_name: "Ama Mensah"});
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

test.describe("trainer sign-up and the rest of the site share one login", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("a signed-in visitor goes straight to the profile, with their name filled in", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const api = await mockTrainerApi(page, {signedInAs: {userId: 9, name: "Kwabena Owusu"}});

    await page.goto(`${publicSite}/trainer/join`);

    await expect(page.getByRole("heading", {name: "About you"})).toBeVisible();
    await expect(page.getByLabel("Mobile number")).toHaveCount(0);
    await expect(page.getByLabel("Your full name")).toHaveValue("Kwabena Owusu");
    expect(api.calls).toContain("add-trainer-role");
    expect(api.calls).not.toContain("request-code");
  });

  test("never shows the last person's draft to the next one", async ({page}) => {
    test.setTimeout(60_000);
    await mockTrainerApi(page, {signedInAs: {userId: 9, name: "Kwabena Owusu"}});
    // Samuel used this tab before, and left a draft behind.
    await page.goto(`${publicSite}/offline`);
    await page.evaluate(() => {
      sessionStorage.setItem("skillshub.draft-owner", "user-4");
      sessionStorage.setItem(
        "skillshub.draft.trainer-profile",
        JSON.stringify({owner: "user-4", value: {full_name: "Samuel Osei Bonsu"}}),
      );
      // And the old, ownerless key from before drafts had owners.
      sessionStorage.setItem(
        "skillshub.trainer.public-profile-draft",
        JSON.stringify({full_name: "Samuel Osei Bonsu"}),
      );
    });

    await page.goto(`${publicSite}/trainer/join`);

    await expect(page.getByRole("heading", {name: "About you"})).toBeVisible();
    await expect(page.getByLabel("Your full name")).toHaveValue("Kwabena Owusu");
    const left = await page.evaluate(() => ({
      owned: sessionStorage.getItem("skillshub.draft.trainer-profile"),
      legacy: sessionStorage.getItem("skillshub.trainer.public-profile-draft"),
    }));
    expect(left.legacy).toBeNull();
    expect(left.owned ?? "").not.toContain("Samuel");
  });
});

test.describe("sent back from review", () => {
  test.use({viewport: {width: 375, height: 812}});

  test("says at the top of the step why the trainer is back there", async ({page}) => {
    test.setTimeout(60_000);
    await mockTrainerApi(page, {signedInAs: {userId: 9, name: "Kwabena Owusu"}, refusePinOnSubmit: true});
    await page.goto(`${publicSite}/trainer/join`);

    await page.getByLabel("Your role here").selectOption("owner");
    await page.getByLabel("ID type").selectOption("ghana_card");
    await page.getByLabel("ID number").fill("GHA-000111222-3");
    await page.getByRole("button", {name: "Continue to workshop"}).click();
    await page.getByLabel("Workshop or training centre name").fill("Accra Welding Works");
    await page.getByLabel("Owner or lead trainer name").fill("Kwabena Owusu");
    await page.getByLabel("Area").selectOption("7");
    await page.getByLabel("Workshop address").fill("4 Community Road");
    await page.getByLabel("Nearest landmark").fill("Opposite the market");
    await page.getByLabel(/the pin is on my workshop/i).check();
    await page.getByRole("button", {name: "Continue to photos"}).click();
    await page.getByRole("button", {name: "Continue to course"}).click();
    await page.getByLabel("Trade").selectOption("3");
    await page.getByLabel("Course title").fill("Beginner arc welding");
    await page.getByLabel("Full fee (GH₵)").fill("1,200");
    await page.getByLabel("Duration in weeks").fill("12");
    await page.getByRole("button", {name: "Review profile"}).click();
    await page.locator("#declared_accurate").check();
    await page.locator("#site_visit_consent").check();
    await page.locator("#data_consent").check();
    await page.getByRole("button", {name: "Submit for review"}).click();

    const banner = page.getByRole("alert").filter({hasText: "Sent back from Review"});
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("25 km");
    await expect(page.getByLabel("Workshop address")).toBeVisible();
  });
});

