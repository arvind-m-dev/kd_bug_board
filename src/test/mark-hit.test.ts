import { describe, expect, it } from "vitest";
import { hitShape } from "@/lib/mark-hit";

const id = (v: number) => v;
describe("eraser hit-testing", () => {
  it("hits strokes, arrows and box outlines near the line, not far away", () => {
    const pen = { type: "pen" as const, points: [0, 0, 100, 0] };
    expect(hitShape(pen, { x: 50, y: 6 }, id, id, 20, 8)).toBe(true);
    expect(hitShape(pen, { x: 50, y: 30 }, id, id, 20, 8)).toBe(false);
    const arrow = { type: "arrow" as const, x1: 0, y1: 0, x2: 100, y2: 100 };
    expect(hitShape(arrow, { x: 52, y: 48 }, id, id, 20, 8)).toBe(true);
    const box = { type: "rect" as const, x1: 10, y1: 10, x2: 110, y2: 60 };
    expect(hitShape(box, { x: 60, y: 12 }, id, id, 20, 8)).toBe(true);
    expect(hitShape(box, { x: 60, y: 35 }, id, id, 20, 8)).toBe(false);
  });
  it("hits text inside its box and maps fractional coordinates", () => {
    const text = { type: "text" as const, x: 0.1, y: 0.5, text: "Bug here" };
    const X = (v: number) => v * 1000,
      Y = (v: number) => v * 500;
    expect(hitShape(text, { x: 130, y: 240 }, X, Y, 22, 4)).toBe(true);
    expect(hitShape(text, { x: 500, y: 240 }, X, Y, 22, 4)).toBe(false);
  });
});
