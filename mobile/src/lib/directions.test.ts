import { mapsUrl, webMapUrl } from "./directions";
import { sellsCourses } from "./store-rules";

const place = { lat: 5.6037, lng: -0.187, name: "Ama's Sewing & Tailoring" };

describe("directions", () => {
  it("uses geo: on Android, which opens whichever maps app the phone has", () => {
    expect(mapsUrl(place, "android")).toBe("geo:5.6037,-0.187?q=5.6037,-0.187(Ama's%20Sewing%20%26%20Tailoring)");
  });

  it("uses Apple Maps on an iPhone, which has no geo:", () => {
    expect(mapsUrl(place, "ios")).toBe("https://maps.apple.com/?ll=5.6037,-0.187&q=Ama's%20Sewing%20%26%20Tailoring");
  });

  it("falls back to OpenStreetMap", () => {
    expect(webMapUrl(place)).toBe("https://www.openstreetmap.org/?mlat=5.6037&mlon=-0.187#map=17/5.6037/-0.187");
  });
});

describe("store rules", () => {
  it("sells courses on Android but not on an iPhone", () => {
    expect(sellsCourses("android")).toBe(true);
    expect(sellsCourses("ios")).toBe(false);
  });
});
