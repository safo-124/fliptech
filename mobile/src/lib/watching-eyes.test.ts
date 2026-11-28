import { EYE_RADIUS, EYES, GLANCE_BADGE, PUPIL_RADIUS, REACH, pupilOffset } from "./watching-eyes";

const box = { left: 0, top: 0, width: 48 };
const [left] = EYES;

describe("pupilOffset", () => {
  it("looks towards a tap and never leaves the eye", () => {
    const right = pupilOffset(left, { x: 500, y: left.cy }, box);
    expect(right.x).toBeCloseTo(REACH, 5);
    expect(Math.abs(right.y)).toBeLessThan(0.01);
    expect(REACH + PUPIL_RADIUS).toBeLessThan(EYE_RADIUS + 0.01);
  });

  it("looks less far when the tap is close, and ahead when it is on the eye", () => {
    const near = pupilOffset(left, { x: left.cx + 10, y: left.cy }, box);
    expect(near.x).toBeGreaterThan(0);
    expect(near.x).toBeLessThan(REACH);
    expect(pupilOffset(left, { x: left.cx, y: left.cy }, box)).toEqual({ x: 0, y: 0 });
  });

  it("glances up and right at the count", () => {
    expect(GLANCE_BADGE.x).toBeGreaterThan(0);
    expect(GLANCE_BADGE.y).toBeLessThan(0);
  });
});
