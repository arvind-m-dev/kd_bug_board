import { describe, expect, it } from "vitest";
import { createSleighJourney, seasonalWind } from "@/lib/seasonal-choreography";

describe("seasonal choreography", () => {
  it("lands continuously, walks, grazes, and departs before returning", () => {
    const journey = createSleighJourney(() => 0.5);
    const phases = new Set<string>();
    let previous = journey(0);
    for (let i = 0; i < 8000; i++) {
      const pose = journey(0.02);
      phases.add(pose.phase);
      expect(pose.scale).toBeGreaterThan(0.3);
      expect(pose.scale).toBeLessThan(1.3);
      if (pose.phase === "walk" || pose.phase === "graze") expect(pose.y).toBe(0);
      if (pose.phase !== "approach" || previous.phase !== "away") {
        expect(Math.abs(pose.x - previous.x)).toBeLessThan(0.02);
        expect(Math.abs(pose.scale - previous.scale)).toBeLessThan(0.02);
      }
      previous = pose;
    }
    expect([...phases]).toEqual(["approach", "landing", "walk", "graze", "takeoff", "away"]);
  });
  it("returns through its departure edge and turns through depth on curved flights", () => {
    for (const seed of [0.1, 0.9]) {
      const journey = createSleighJourney(() => seed);
      let previous = journey(0),
        departure = 0,
        returned = false;
      let minYaw = Infinity,
        maxYaw = -Infinity;
      for (let i = 0; i < 6000; i++) {
        const pose = journey(0.02);
        expect(Number.isFinite(pose.pitch + pose.bank + pose.yaw)).toBe(true);
        if (pose.phase === "away") departure = pose.x;
        if (previous.phase === "away" && pose.phase === "approach") {
          expect(departure < 0 ? pose.x < 0 : pose.x > 1).toBe(true);
          expect(Math.abs(pose.x - departure)).toBeLessThan(0.01);
          returned = true;
        }
        minYaw = Math.min(minYaw, pose.yaw);
        maxYaw = Math.max(maxYaw, pose.yaw);
        previous = pose;
      }
      expect(returned).toBe(true);
      expect(maxYaw - minYaw).toBeGreaterThan(0.5);
    }
  });
  it("lands and walks along the selected UI ledge", () => {
    const journey = createSleighJourney(
      () => 0.4,
      () => ({ x: 0.4, y: 0.35, walkTo: 0.46 }),
    );
    let sawWalking = false;
    for (let i = 0; i < 2000; i++) {
      const pose = journey(0.02);
      if (pose.phase === "walk" || pose.phase === "graze") {
        expect(pose.y).toBe(0.35);
        expect(pose.x).toBeGreaterThanOrEqual(0.4);
        expect(pose.x).toBeLessThanOrEqual(0.46);
        sawWalking = true;
      }
    }
    expect(sawWalking).toBe(true);
  });
  it("freezes its pose when motion is paused and varies routes with its seed", () => {
    const a = createSleighJourney(() => 0.1),
      b = createSleighJourney(() => 0.9);
    a(12);
    b(12);
    expect(a(0)).toEqual(a(0));
    expect(a(2)).not.toEqual(b(2));
  });
  it("varies its itinerary: some visits only fly over, some hop between ledges", () => {
    let seed = 3;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const journey = createSleighJourney(random);
    let previous = journey(0).phase,
      flyovers = 0,
      hops = 0;
    for (let i = 0; i < 200000; i++) {
      const pose = journey(0.05);
      if (previous === "approach" && pose.phase === "takeoff") flyovers++;
      if (previous === "graze" && pose.phase === "landing") hops++;
      if (pose.phase === "walk" || pose.phase === "graze") expect(pose.y).toBe(0);
      previous = pose.phase;
    }
    expect(flyovers).toBeGreaterThan(0);
    expect(hops).toBeGreaterThan(0);
  });
  it("has smooth, bounded gusts with quiet intervals and stronger bursts", () => {
    const samples = Array.from({ length: 1000 }, (_, i) => seasonalWind(i * 0.05));
    expect(Math.min(...samples)).toBeLessThan(0);
    expect(Math.max(...samples)).toBeGreaterThan(60);
    samples.forEach((wind, i) => {
      expect(Math.abs(wind)).toBeLessThan(96);
      if (i) expect(Math.abs(wind - samples[i - 1]!)).toBeLessThan(5);
    });
  });
});
