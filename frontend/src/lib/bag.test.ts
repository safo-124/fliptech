import {beforeEach, describe, expect, it} from "vitest";

import {addToBag, bagCount, bagFor, savedIds, setBagLines, toggleSaved} from "./bag";

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

const bag = {product: 1, option: null, quantity: 1, name: "Bag", optionLabel: ""};

describe("the bag", () => {
  it("adds the same thing twice as one line, never above 20", () => {
    addToBag(7, "Ama Crafts", bag);
    addToBag(7, "Ama Crafts", {...bag, quantity: 25});

    expect(bagFor(7)?.items).toEqual([{...bag, quantity: 20}]);
  });

  it("keeps different options apart and counts every bag", () => {
    addToBag(7, "Ama Crafts", bag);
    addToBag(7, "Ama Crafts", {...bag, option: 3, optionLabel: "Red"});
    addToBag(8, "Kofi Wood", {...bag, product: 9, quantity: 2});

    expect(bagFor(7)?.items).toHaveLength(2);
    expect(bagCount()).toBe(4);
  });

  it("forgets a bag once it is empty", () => {
    addToBag(7, "Ama Crafts", bag);
    setBagLines(7, []);

    expect(bagFor(7)).toBeNull();
  });

  it("works without storage", () => {
    Object.assign(globalThis, {window: new EventTarget()});

    expect(bagFor(7)).toBeNull();
    expect(() => addToBag(7, "Ama Crafts", bag)).not.toThrow();
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
