import {beforeEach, describe, expect, it} from "vitest";

import {savedIds, toggleSaved} from "./bag";

// A window with storage, for the node test runner.
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

beforeEach(() => {
  const target = new EventTarget();
  Object.assign(globalThis, {
    window: Object.assign(target, {localStorage: new MemoryStorage()}),
  });
});

describe("saved for later", () => {
  it("toggles, newest first", () => {
    expect(toggleSaved(1)).toBe(true);
    expect(toggleSaved(2)).toBe(true);
    expect(savedIds()).toEqual([2, 1]);
    expect(toggleSaved(1)).toBe(false);
    expect(savedIds()).toEqual([2]);
  });
});
