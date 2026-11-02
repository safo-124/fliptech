import { mediaUrl } from "./media";

const PHONE_CAN_REACH = "http://192.168.1.20:8000";

describe("mediaUrl", () => {
  it("points Django's own loopback addresses at the API the phone can reach", () => {
    expect(mediaUrl("http://127.0.0.1:8000/media/p.jpg", PHONE_CAN_REACH)).toBe(
      "http://192.168.1.20:8000/media/p.jpg",
    );
    expect(mediaUrl("http://localhost:8000/media/p.jpg", PHONE_CAN_REACH)).toBe(
      "http://192.168.1.20:8000/media/p.jpg",
    );
  });

  it("leaves real addresses and empty ones alone", () => {
    expect(mediaUrl("https://skills.example/media/p.jpg", PHONE_CAN_REACH)).toBe(
      "https://skills.example/media/p.jpg",
    );
    expect(mediaUrl(null)).toBeNull();
  });
});
