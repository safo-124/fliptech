/**
 * What the trainee dashboard derives from the three lists it already loads.
 *
 * Pure functions, kept out of the component so they can be tested without a
 * DOM and so the overview cannot quietly invent a number: everything here is
 * counted from data the API returned.
 */

import type {
  TraineeAccount,
  TraineeEnquiry,
  TraineeEnquiryStatus,
  TraineeEnrolment,
} from "./types";

export type ProfileTask = {
  key: string;
  label: string;
  /** Why it is worth doing. Shown so the list reads as help, not as nagging. */
  hint: string;
  done: boolean;
};

/**
 * The optional details, and what each one buys the trainee.
 *
 * Registration deliberately asks for nothing but a phone number, so every
 * account starts here incomplete. That is the point: these are suggestions,
 * never a gate, and the wording has to stay on the side of "this helps you"
 * rather than implying the account is broken without them.
 */
export function profileTasks(account: TraineeAccount): ProfileTask[] {
  const tasks: ProfileTask[] = [
    {
      key: "name",
      label: "Add your name",
      hint: "Workshops see it when you enquire, so a reply can greet you properly.",
      done: Boolean(account.display_name.trim()),
    },
    {
      key: "email",
      label: "Add an email address",
      hint: "A second way to sign in when an SMS does not arrive.",
      done: Boolean(account.email),
    },
    {
      key: "education_level",
      label: "Add your education background",
      hint: "Helps a workshop pitch a course at the right starting point.",
      done: Boolean(account.education_level),
    },
    {
      key: "field_of_study",
      label: "Add your field of study",
      hint: "Tells a trade workshop what you have already covered.",
      done: Boolean(account.field_of_study.trim()),
    },
  ];

  // Only worth asking of someone who named a school. "Not in school" has no
  // institution to give, and scoring them against a box they cannot tick
  // would leave their profile permanently short of complete.
  if (account.education_level && account.education_level !== "not_in_school") {
    tasks.push({
      key: "institution_name",
      label: "Add your school or institution",
      hint: "Useful when a workshop recognises the programme you came from.",
      done: Boolean(account.institution_name.trim()),
    });
  }

  return tasks;
}

/** Whole percent, rounded down so 100 means genuinely everything. */
export function completeness(tasks: ProfileTask[]): number {
  if (tasks.length === 0) return 100;
  return Math.floor((tasks.filter((task) => task.done).length / tasks.length) * 100);
}

export type ActivityItem = {
  id: string;
  kind: "enquiry" | "started" | "completed";
  at: string;
  title: string;
  providerName: string;
};

/**
 * Enquiries and training on one timeline, newest first.
 *
 * An enrolment contributes up to two entries, because starting a course and
 * finishing it are two things that happened on two different days, and a feed
 * that collapsed them would put a course finished last year at the top.
 */
export function activityFeed(
  enquiries: TraineeEnquiry[],
  enrolments: TraineeEnrolment[],
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const enquiry of enquiries) {
    items.push({
      id: `enquiry-${enquiry.reference_code}`,
      kind: "enquiry",
      at: enquiry.created_at,
      title: enquiry.programme_title || "Training enquiry",
      providerName: enquiry.provider.name,
    });
  }

  for (const enrolment of enrolments) {
    items.push({
      id: `started-${enrolment.id}`,
      kind: "started",
      at: enrolment.started_on,
      title: enrolment.programme_title,
      providerName: enrolment.provider.name,
    });
    if (enrolment.completed_on) {
      items.push({
        id: `completed-${enrolment.id}`,
        kind: "completed",
        at: enrolment.completed_on,
        title: enrolment.programme_title,
        providerName: enrolment.provider.name,
      });
    }
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function countByStatus(
  enquiries: TraineeEnquiry[],
): Record<TraineeEnquiryStatus, number> {
  const counts: Record<TraineeEnquiryStatus, number> = {
    sent: 0,
    replied: 0,
    visited: 0,
    enrolled: 0,
    not_delivered: 0,
  };
  for (const enquiry of enquiries) counts[enquiry.status] += 1;
  return counts;
}

/**
 * How many enquiries are still waiting on the workshop.
 *
 * "Replied", "visited" and "enrolled" have all moved on. "Not delivered" is
 * waiting on us, not on them, and is surfaced separately — counting it as
 * awaiting a reply would tell the trainee to be patient about a message that
 * never arrived.
 */
export function awaitingReply(enquiries: TraineeEnquiry[]): number {
  return enquiries.filter((enquiry) => enquiry.status === "sent").length;
}

/** Free-text match over the fields a trainee would actually type. */
export function matchesQuery(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}
