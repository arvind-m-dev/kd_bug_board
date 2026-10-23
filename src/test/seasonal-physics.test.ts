import { describe, expect, it } from "vitest";
import { perimeterPoint, stepSnow, type SnowBody } from "@/lib/seasonal-physics";
const snow = (values: Partial<SnowBody> = {}): SnowBody => ({
  x: 50,
  y: 95,
  vx: 0,
  vy: 60,
  radius: 2,
  bounces: 0,
  ignoreUntil: 0,
  ...values,
});
describe("snow interacting with UI ledges", () => {
  it("lands on the first crossed ledge and rebounds above it", () => {
    const body = snow();
    expect(stepSnow(body, 0.1, 1, [{ left: 0, right: 100, top: 100 }], 0)).toBe(true);
    expect(body.y).toBe(98);
    expect(body.vy).toBeLessThan(0);
  });
  it("falls freely outside an edge and does not collide from underneath", () => {
    const body = snow({ x: 150 });
    expect(stepSnow(body, 0.1, 1, [{ left: 0, right: 100, top: 100 }], 0)).toBe(false);
    expect(
      stepSnow(snow({ y: 104, vy: -60 }), 0.1, 1, [{ left: 0, right: 100, top: 100 }], 0),
    ).toBe(false);
  });
  it("tumbles through after two bounces instead of getting stuck forever", () => {
    const body = snow({ bounces: 1 });
    stepSnow(body, 0.1, 1, [{ left: 0, right: 100, top: 100 }], 0);
    expect(body.ignoreUntil).toBeGreaterThan(2);
    body.y = 96;
    body.vy = 60;
    expect(stepSnow(body, 0.1, 1.5, [{ left: 0, right: 100, top: 100 }], 0)).toBe(false);
    expect(body.y).toBeGreaterThan(100);
  });
});
it("keeps crawlers on the measured surface and wraps the path", () => {
  const r = { left: 10, top: 20, width: 100, height: 50 };
  expect(perimeterPoint(r, 125)).toMatchObject({ x: 110, y: 45 });
  expect(perimeterPoint(r, 310)).toEqual(perimeterPoint(r, 10));
});
