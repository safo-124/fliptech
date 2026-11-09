import * as Network from "expo-network";

import { decide } from "./datasaver";
import { photoUrl } from "./media";

describe("data saver", () => {
  it("is on for mobile data when automatic, and as chosen otherwise", () => {
    expect(decide("auto", Network.NetworkStateType.CELLULAR)).toBe(true);
    expect(decide("auto", Network.NetworkStateType.WIFI)).toBe(false);
    expect(decide("on", Network.NetworkStateType.WIFI)).toBe(true);
    expect(decide("off", Network.NetworkStateType.CELLULAR)).toBe(false);
  });

  it("asks the site's own resizer for a smaller photo when saving", () => {
    const original = "https://skills.example/media/p.jpg";
    expect(photoUrl(original, "card", "https://skills.example", false)).toBe(
      "https://skills.example/_next/image?url=https%3A%2F%2Fskills.example%2Fmedia%2Fp.jpg&w=640&q=75",
    );
    expect(photoUrl(original, "card", "https://skills.example", true)).toContain("&w=256&q=50");
    expect(photoUrl(null)).toBeNull();
  });
});
