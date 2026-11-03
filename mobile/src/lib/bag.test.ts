import { addTo, bySeller, MAX_QUANTITY, type BagItem } from "./bag";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

const item = (over: Partial<BagItem> = {}): BagItem => ({
  product: 1,
  option: null,
  optionLabel: "",
  quantity: 1,
  name: "Hammer",
  photo: null,
  price: "50.00",
  seller: { id: 7, business_name: "Kofi Tools" },
  ...over,
});

describe("addTo", () => {
  it("adds up the same thing rather than listing it twice", () => {
    const bag = addTo(addTo([], item({ quantity: 2 })), item({ quantity: 3 }));
    expect(bag).toHaveLength(1);
    expect(bag[0].quantity).toBe(5);
  });

  it("keeps each option on its own line", () => {
    const bag = addTo(addTo([], item({ option: 1 })), item({ option: 2 }));
    expect(bag).toHaveLength(2);
  });

  it("never goes past what the API takes", () => {
    const bag = addTo(addTo([], item({ quantity: 15 })), item({ quantity: 15 }));
    expect(bag[0].quantity).toBe(MAX_QUANTITY);
  });
});

describe("bySeller", () => {
  it("groups the bag by who is paid", () => {
    const groups = bySeller([
      item(),
      item({ product: 2, seller: { id: 9, business_name: "Ama Fabrics" } }),
      item({ product: 3 }),
    ]);
    expect(groups.map((group) => [group.seller.id, group.items.length])).toEqual([
      [7, 2],
      [9, 1],
    ]);
  });
});
