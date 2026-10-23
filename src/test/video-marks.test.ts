import { describe, expect, it } from "vitest";
import { marksAt, readMarks, saveMarksSchema, type VideoMark } from "@/lib/bug-media";

const shape = {
  type: "rect",
  x1: 0.1,
  y1: 0.1,
  x2: 0.4,
  y2: 0.3,
  color: "#ef4444",
  width: 0.004,
} as const;
const mark = (start: number, end: number | null): VideoMark => ({
  id: crypto.randomUUID(),
  start,
  end,
  shapes: [shape],
});

describe("timed video marks", () => {
  it("shows a mark from its start until (not including) its end, or to the end of the video", () => {
    const a = mark(2, 5),
      b = mark(4, null);
    expect(marksAt([a, b], 1.9)).toEqual([]);
    expect(marksAt([a, b], 2)).toEqual([a]);
    expect(marksAt([a, b], 4.5)).toEqual([a, b]);
    expect(marksAt([a, b], 5)).toEqual([b]);
    expect(marksAt([a, b], 999)).toEqual([b]);
  });
  it("validates frame-relative drawings, ordered times and a size budget", () => {
    const ok = { id: crypto.randomUUID(), version: 0, marks: [mark(1, 3)] };
    expect(saveMarksSchema.safeParse(ok).success).toBe(true);
    expect(saveMarksSchema.safeParse({ ...ok, marks: [mark(3, 1)] }).success).toBe(false);
    expect(
      saveMarksSchema.safeParse({
        ...ok,
        marks: [{ ...mark(0, null), shapes: [{ ...shape, x2: 1.5 }] }],
      }).success,
    ).toBe(false);
    const heavy = Array.from({ length: 150 }, () => ({
      ...mark(0, null),
      shapes: Array.from({ length: 10 }, () => ({
        type: "pen" as const,
        points: Array.from({ length: 400 }, () => 0.123456),
        color: "#ef4444",
        width: 0.004,
      })),
    }));
    expect(saveMarksSchema.safeParse({ ...ok, marks: heavy }).success).toBe(false);
  });
  it("reads stored marks defensively", () => {
    const good = mark(1, null);
    expect(readMarks(null)).toEqual([]);
    expect(readMarks([good, { nonsense: true }])).toEqual([good]);
  });
});
