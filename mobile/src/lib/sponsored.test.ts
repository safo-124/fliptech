import { sponsoredFirst } from "./sponsored";

const item = (id: number, sponsored = false) => ({ id, sponsored });

describe("sponsoredFirst", () => {
  it("puts the chosen sponsored items first and never repeats one", () => {
    const shelf = sponsoredFirst([item(7, true)], [item(1), item(7, true), item(2)], 10);
    expect(shelf.map((entry) => entry.id)).toEqual([7, 1, 2]);
  });

  it("drops sponsored items the server did not choose, so paid places stay at two", () => {
    const shelf = sponsoredFirst([item(7, true), item(8, true)], [item(9, true), item(1), item(2)], 10);
    expect(shelf.map((entry) => entry.id)).toEqual([7, 8, 1, 2]);
  });

  it("keeps to the shelf's length", () => {
    expect(sponsoredFirst([], [item(1), item(2), item(3)], 2)).toHaveLength(2);
  });
});
