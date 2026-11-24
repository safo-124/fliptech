import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SelectChip, areaOptions, pickerRows } from "@/components/PickerSheet";

const regions = [
  {
    name: "Greater Accra",
    areas: [
      { slug: "tema", name: "Tema", provider_count: 3 },
      { slug: "adenta", name: "Adenta", provider_count: 0 },
    ],
  },
  { name: "Ashanti", areas: [{ slug: "kumasi", name: "Kumasi", provider_count: 1 }] },
];

describe("areaOptions", () => {
  it("puts towns under their regions, in order, with a workshop count", () => {
    const options = areaOptions(regions);
    expect(options.map((option) => option.label)).toEqual(["Kumasi", "Adenta", "Tema"]);
    expect(options[0]).toMatchObject({ group: "Ashanti", hint: "1 workshop" });
  });

  it("can keep only towns with a workshop", () => {
    expect(areaOptions(regions, { onlyWithWorkshops: true }).map((option) => option.value)).toEqual(["kumasi", "tema"]);
  });
});

describe("pickerRows", () => {
  it("adds a heading where the region changes, and filters by town or region", () => {
    const options = [{ value: "", label: "Anywhere" }, ...areaOptions(regions)];
    expect(pickerRows(options, "").map((row) => (row.kind === "group" ? `#${row.label}` : row.option.label))).toEqual([
      "Anywhere",
      "#Ashanti",
      "Kumasi",
      "#Greater Accra",
      "Adenta",
      "Tema",
    ]);
    expect(pickerRows(options, "ashan").filter((row) => row.kind === "option")).toHaveLength(1);
  });
});

describe("SelectChip", () => {
  it("shows the choice, opens the sheet and reports the pick", async () => {
    const onPick = jest.fn();
    await render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
      >
        <SelectChip
        label="Sort"
        title="Sort workshops"
        options={[
          { value: "", label: "Best match" },
          { value: "cheapest", label: "Cheapest" },
        ]}
        value=""
        onPick={onPick}
        />
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Sort workshops: Best match" }));
    await fireEvent.press(screen.getByText("Cheapest"));
    expect(onPick).toHaveBeenCalledWith("cheapest");
  });
});
