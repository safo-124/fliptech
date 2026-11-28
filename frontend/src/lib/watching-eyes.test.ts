import { describe, expect, it } from "vitest";

import { EYE_RADIUS, EYES, GLANCE, PUPIL_RADIUS, REACH, pupilOffset } from "./watching-eyes";

// A 48-pixel mark at the top left of the screen: one grid unit per pixel.
const box = { left: 0, top: 0, width: 48 };
const [left] = EYES;

describe("pupilOffset", () => {
  it("looks towards the pointer", () => {
    const right = pupilOffset(left, { x: 500, y: left.cy }, box);
    expect(right.x).toBeGreaterThan(0);
    expect(Math.abs(right.y)).toBeLessThan(0.01);
    const above = pupilOffset(left, { x: left.cx, y: -500 }, box);
    expect(above.y).toBeLessThan(0);
  });

  it("never leaves the eye, however far the pointer is", () => {
    const far = pupilOffset(left, { x: 5000, y: 5000 }, box);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(REACH, 5);
    expect(REACH + PUPIL_RADIUS).toBeLessThan(EYE_RADIUS + 0.01);
  });

  it("looks less far when the pointer is close, and straight ahead on the eye", () => {
    const near = pupilOffset(left, { x: left.cx + 10, y: left.cy }, box);
    expect(near.x).toBeGreaterThan(0);
    expect(near.x).toBeLessThan(REACH);
    expect(pupilOffset(left, { x: left.cx, y: left.cy }, box)).toEqual({ x: 0, y: 0 });
  });

  it("scales with the button's size on the screen", () => {
    const big = { left: 100, top: 100, width: 96 };
    const point = { x: 100 + left.cx * 2 + 1000, y: 100 + left.cy * 2 };
    expect(pupilOffset(left, point, big).x).toBeCloseTo(REACH, 5);
  });
});

describe("GLANCE", () => {
  it("looks up and left into the panel, up and right at the count", () => {
    expect(GLANCE.panel.x).toBeLessThan(0);
    expect(GLANCE.panel.y).toBeLessThan(0);
    expect(GLANCE.badge.x).toBeGreaterThan(0);
    expect(Math.hypot(GLANCE.badge.x, GLANCE.badge.y)).toBeLessThanOrEqual(REACH + 0.01);
  });
});
