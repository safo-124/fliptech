import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { categoriesFor } from "../../lib/categories";
import type { TradeCategory } from "../../lib/types";
import { CategoryChips } from "../CategoryRow";

// The first render pulls in the icons on a cold runner.
jest.setTimeout(30_000);

function category(slug: string, name: string, counts: Partial<TradeCategory> = {}): TradeCategory {
  return {
    id: slug.length,
    slug,
    name,
    description: "",
    icon: "cog",
    provider_count: 0,
    course_count: 0,
    product_count: 0,
    live: true,
    trades: [],
    ...counts,
  };
}

const ENGINEERING = category("engineering-technical", "Engineering & Technical Trades", {
  provider_count: 2,
  product_count: 1,
});
const FASHION = category("fashion-beauty-leather", "Fashion, Beauty & Leather Craft", {
  provider_count: 3,
  course_count: 1,
});
const DIGITAL = category("digital-creative", "Digital & Creative Skills", { live: false });

describe("which categories each list offers", () => {
  it("offers only those with something in that list, in order", () => {
    const all = [ENGINEERING, FASHION, DIGITAL];
    expect(categoriesFor(all, "training").map((c) => c.slug)).toEqual(["engineering-technical", "fashion-beauty-leather"]);
    expect(categoriesFor(all, "courses").map((c) => c.slug)).toEqual(["fashion-beauty-leather"]);
    expect(categoriesFor(all, "shop").map((c) => c.slug)).toEqual(["engineering-technical"]);
    expect(categoriesFor(undefined, "shop")).toEqual([]);
  });
});

describe("the category row", () => {
  it("lets you pick a category, and tap it again for all", async () => {
    const onSelect = jest.fn();
    await render(<CategoryChips categories={[ENGINEERING, FASHION]} onSelect={onSelect} />);

    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Fashion, Beauty & Leather Craft"));
    });
    expect(onSelect).toHaveBeenLastCalledWith("fashion-beauty-leather");
  });

  it("clears the choice from All or from the chosen chip", async () => {
    const onSelect = jest.fn();
    await render(<CategoryChips categories={[ENGINEERING, FASHION]} selected="engineering-technical" onSelect={onSelect} />);

    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Engineering & Technical Trades"));
    });
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("All"));
    });
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("is left out while there is only one category to choose", async () => {
    await render(<CategoryChips categories={[FASHION]} onSelect={jest.fn()} />);

    expect(screen.queryByLabelText("All")).toBeNull();
  });
});
