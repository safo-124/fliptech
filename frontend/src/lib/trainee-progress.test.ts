import {describe, expect, it} from "vitest";

import {
  activityFeed,
  awaitingReply,
  completeness,
  countByStatus,
  matchesQuery,
  profileTasks,
} from "./trainee-progress";
import type {
  TraineeAccount,
  TraineeEnquiry,
  TraineeEnquiryStatus,
  TraineeEnrolment,
} from "./types";

function account(overrides: Partial<TraineeAccount> = {}): TraineeAccount {
  return {
    phone: "+233201110002",
    email: null,
    display_name: "",
    preferred_channel: "whatsapp",
    education_level: "",
    institution_name: "",
    field_of_study: "",
    education_status: "",
    education_year: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function provider(name = "Accra Motors", id = 1) {
  return {id, name, slug: "accra-motors", area: "Accra", area_slug: "accra", is_listed: true};
}

function enquiry(overrides: Partial<TraineeEnquiry> = {}): TraineeEnquiry {
  return {
    reference_code: "ABC123",
    provider: provider(),
    programme_title: "Auto electrics",
    intake_start: null,
    message: "",
    status: "sent",
    whatsapp_url: "https://wa.me/233",
    created_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function enrolment(overrides: Partial<TraineeEnrolment> = {}): TraineeEnrolment {
  return {
    id: 1,
    provider: provider(),
    programme_title: "Auto electrics",
    started_on: "2026-02-01",
    completed_on: null,
    fee_paid: null,
    ...overrides,
  };
}

describe("profileTasks", () => {
  it("starts a fresh account with everything outstanding", () => {
    const tasks = profileTasks(account());
    expect(tasks.every((task) => !task.done)).toBe(true);
    expect(completeness(tasks)).toBe(0);
  });

  it("does not ask someone out of school to name an institution", () => {
    const keys = profileTasks(account({education_level: "not_in_school"})).map((t) => t.key);
    expect(keys).not.toContain("institution_name");
  });

  it("asks a student for their institution", () => {
    const keys = profileTasks(account({education_level: "university"})).map((t) => t.key);
    expect(keys).toContain("institution_name");
  });

  it("reaches 100 only when every applicable task is done", () => {
    const full = account({
      display_name: "Kofi Owusu",
      email: "kofi@example.com",
      education_level: "university",
      field_of_study: "Mechanical engineering",
      institution_name: "KNUST",
    });
    expect(completeness(profileTasks(full))).toBe(100);
  });

  it("treats whitespace as unfilled", () => {
    const tasks = profileTasks(account({display_name: "   "}));
    expect(tasks.find((task) => task.key === "name")?.done).toBe(false);
  });

  it("rounds down, so nearly-complete never reads as complete", () => {
    // Four of five done is 80; the guard that matters is that it never
    // rounds a missing task away into 100.
    const nearly = account({
      display_name: "Kofi",
      email: "kofi@example.com",
      education_level: "university",
      field_of_study: "Mechanical engineering",
    });
    expect(completeness(profileTasks(nearly))).toBe(80);
  });
});

describe("activityFeed", () => {
  it("is newest first across both kinds", () => {
    const feed = activityFeed(
      [enquiry({reference_code: "OLD", created_at: "2026-01-05T09:00:00Z"})],
      [enrolment({started_on: "2026-04-01"})],
    );
    expect(feed.map((item) => item.kind)).toEqual(["started", "enquiry"]);
  });

  it("gives a finished course its own entry on the day it finished", () => {
    const feed = activityFeed([], [enrolment({started_on: "2026-01-01", completed_on: "2026-06-01"})]);
    expect(feed.map((item) => item.kind)).toEqual(["completed", "started"]);
  });

  it("is empty for an account that has done nothing yet", () => {
    expect(activityFeed([], [])).toEqual([]);
  });
});

describe("counting", () => {
  it("counts every status, including the ones at zero", () => {
    const counts = countByStatus([enquiry(), enquiry({reference_code: "B", status: "replied"})]);
    expect(counts).toEqual({sent: 1, replied: 1, visited: 0, enrolled: 0, not_delivered: 0});
  });

  it("only 'sent' is still waiting on the workshop", () => {
    const statuses: TraineeEnquiryStatus[] = ["sent", "replied", "visited", "enrolled", "not_delivered"];
    const all = statuses.map((status, index) => enquiry({reference_code: `R${index}`, status}));
    expect(awaitingReply(all)).toBe(1);
  });
});

describe("matchesQuery", () => {
  it("matches any field, ignoring case", () => {
    expect(matchesQuery("motors", "Accra Motors", "Auto electrics")).toBe(true);
    expect(matchesQuery("WELD", "Accra Motors", "Welding")).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(matchesQuery("   ", "anything")).toBe(true);
  });

  it("survives a null field rather than throwing", () => {
    expect(matchesQuery("x", null, undefined)).toBe(false);
  });
});
