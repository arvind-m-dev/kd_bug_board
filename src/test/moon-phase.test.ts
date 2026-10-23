import { expect, it } from "vitest";
import { moonPhase } from "@/lib/moon-phase";
it("cycles through new, quarter and full moon from real elapsed time", () => {
  const epoch = Date.UTC(2000, 0, 6, 18, 14),
    month = 29.530588 * 86400000;
  expect(moonPhase(new Date(epoch))).toBe(0);
  expect(moonPhase(new Date(epoch + month / 4))).toBeCloseTo(0.25);
  expect(moonPhase(new Date(epoch + month / 2))).toBeCloseTo(0.5);
  expect(moonPhase(new Date(epoch - month / 4))).toBeCloseTo(0.75);
  expect(moonPhase(new Date(epoch + 100 * month + month / 2))).toBeCloseTo(0.5);
});
