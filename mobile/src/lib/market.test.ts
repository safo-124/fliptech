import { activeCount, queryParams } from "./market";

describe("queryParams", () => {
  it("sends only what is on, with the API's names", () => {
    expect(queryParams({})).toEqual(
      Object.fromEntries(Object.keys(queryParams({})).map((key) => [key, undefined])),
    );
    const sent = queryParams({
      sold_by: "trainers",
      seller: { id: 7, name: "Tema Tailoring" },
      min_price: "50",
      max_price: "GH₵ 200",
      pay_online: true,
      in_stock: true,
      sort: "price",
    }, 2);
    expect(sent).toMatchObject({
      sold_by: "trainers",
      seller: "7",
      min_price: "50",
      max_price: "200",
      pay_online: "1",
      availability: "available",
      sort: "price",
      page: "2",
    });
    expect(sent.delivers).toBeUndefined();
  });

  it("drops a price that is not a number", () => {
    expect(queryParams({ min_price: "abc" }).min_price).toBeUndefined();
  });
});

describe("activeCount", () => {
  it("counts filters, not the search or the sort", () => {
    expect(activeCount({ q: "bag", sort: "newest" })).toBe(0);
    expect(activeCount({ sold_by: "makers", min_price: "10", max_price: "90", on_sale: true })).toBe(3);
  });
});
