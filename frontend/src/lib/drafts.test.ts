import {beforeEach, describe, expect, it, vi} from "vitest";

import {
  ANONYMOUS,
  claimDrafts,
  clearAllDrafts,
  ENQUIRY_DRAFT,
  ownerOf,
  readDraft,
  TRAINER_PROFILE_DRAFT,
  writeDraft,
} from "./drafts";

// sessionStorage for the node test runner, with the key()/length the real
// one has, since clearAllDrafts walks every key.
class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  // The API modules read window.location at import to choose the API host.
  Object.assign(globalThis, {
    window: {sessionStorage: store, location: new URL("http://localhost:3000/")},
    document: {cookie: ""},
  });
});

const samuel = ownerOf({user_id: 7});
const ama = ownerOf({user_id: 12});

describe("form drafts belong to the person who typed them", () => {
  it("gives a draft back to its owner", () => {
    writeDraft(TRAINER_PROFILE_DRAFT, samuel, {full_name: "Samuel Osei Bonsu"});

    expect(readDraft(TRAINER_PROFILE_DRAFT, samuel)).toEqual({full_name: "Samuel Osei Bonsu"});
  });

  it("never shows one person's draft to another, and drops it", () => {
    writeDraft(TRAINER_PROFILE_DRAFT, samuel, {full_name: "Samuel Osei Bonsu"});

    expect(readDraft(TRAINER_PROFILE_DRAFT, ama)).toBeNull();
    // Gone, not just hidden: Samuel coming back does not get it either.
    expect(readDraft(TRAINER_PROFILE_DRAFT, samuel)).toBeNull();
  });

  it("keeps a visitor's draft from a person who signs in later", () => {
    writeDraft(ENQUIRY_DRAFT, ANONYMOUS, {phone: "0241234567", message: "Hello"});

    expect(readDraft(ENQUIRY_DRAFT, ama)).toBeNull();
  });

  it("clears every draft, including the old unowned keys, on sign-out", () => {
    writeDraft(TRAINER_PROFILE_DRAFT, samuel, {full_name: "Samuel"});
    writeDraft(ENQUIRY_DRAFT, samuel, {message: "Hello"});
    store.setItem("skillshub.trainer.public-profile-draft", '{"full_name":"Old"}');
    store.setItem("skillshub.enquiry.draft", '{"message":"Old"}');
    store.setItem("skillshub.unrelated", "kept");

    clearAllDrafts();

    expect(readDraft(TRAINER_PROFILE_DRAFT, samuel)).toBeNull();
    expect(readDraft(ENQUIRY_DRAFT, samuel)).toBeNull();
    expect(store.getItem("skillshub.trainer.public-profile-draft")).toBeNull();
    expect(store.getItem("skillshub.enquiry.draft")).toBeNull();
    expect(store.getItem("skillshub.unrelated")).toBe("kept");
  });

  it("clears the drafts when a different number signs in on the same tab", () => {
    claimDrafts(samuel);
    writeDraft(TRAINER_PROFILE_DRAFT, samuel, {full_name: "Samuel"});

    claimDrafts(ama);

    expect(store.length).toBe(1); // only the record of who owns the tab now
    expect(readDraft(TRAINER_PROFILE_DRAFT, samuel)).toBeNull();
  });

  it("keeps the drafts when the same person is seen again", () => {
    claimDrafts(samuel);
    writeDraft(TRAINER_PROFILE_DRAFT, samuel, {full_name: "Samuel"});

    claimDrafts(samuel);

    expect(readDraft(TRAINER_PROFILE_DRAFT, samuel)).toEqual({full_name: "Samuel"});
  });
});

describe("signing out", () => {
  it("clears the drafts from every logout helper", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", {status: 200}));
    Object.assign(globalThis, {fetch: fetchMock});
    const {signOutAccount} = await import("./account-api");
    const {logoutTrainer} = await import("./trainer-api");
    const {logoutTrainee} = await import("./trainee-api");
    const {signOutSeller} = await import("./seller-api");

    for (const signOut of [signOutAccount, logoutTrainer, logoutTrainee, signOutSeller]) {
      writeDraft(TRAINER_PROFILE_DRAFT, samuel, {full_name: "Samuel"});
      await signOut().catch(() => {});
      expect(readDraft(TRAINER_PROFILE_DRAFT, samuel)).toBeNull();
    }
  });
});
