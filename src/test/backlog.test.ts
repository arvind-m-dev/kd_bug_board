import { describe, it, expect } from "vitest";
import {
  mayManageBacklog,
  validParent,
  wouldCycle,
  rankBetween,
  epicProgress,
} from "@/lib/backlog";

describe("mayManageBacklog", () => {
  it("admin and plan holders only", () => {
    expect(mayManageBacklog({ role: "admin", permissions: [] })).toBe(true);
    expect(mayManageBacklog({ role: "qa", permissions: ["plan"] })).toBe(true);
    expect(mayManageBacklog({ role: "reporter", permissions: ["report"] })).toBe(false);
  });
});

describe("validParent", () => {
  it("epics contain anything; stories contain tasks; epics have no parent", () => {
    expect(validParent("story", "epic")).toBe(true);
    expect(validParent("task", "epic")).toBe(true);
    expect(validParent("bug", "epic")).toBe(true);
    expect(validParent("task", "story")).toBe(true);
    expect(validParent("story", "story")).toBe(false);
    expect(validParent("epic", "epic")).toBe(false);
    expect(validParent("bug", "story")).toBe(false);
  });
});

describe("wouldCycle", () => {
  const items = [
    { id: "1", parentId: null },
    { id: "2", parentId: "1" },
    { id: "3", parentId: "2" },
  ];
  it("refuses self, direct and transitive loops", () => {
    expect(wouldCycle(items, "1", "1")).toBe(true);
    expect(wouldCycle(items, "1", "3")).toBe(true); // 3 already descends from 1
    expect(wouldCycle(items, "3", "1")).toBe(false); // deepening is fine
  });
});

describe("rankBetween", () => {
  it("always lands strictly between its neighbours", () => {
    const m = rankBetween(null, null);
    expect(rankBetween(null, m) < m).toBe(true);
    expect(rankBetween(m, null) > m).toBe(true);
    const a = "a",
      b = "b";
    const mid = rankBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
  });
  it("survives repeated squeezing between the same pair", () => {
    let lo = "a";
    const hi = "b";
    for (let i = 0; i < 50; i++) {
      const mid = rankBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      lo = mid;
    }
    expect(lo.length).toBeLessThan(60); // grows, but boundedly
  });
  it("orders a freshly built list", () => {
    const first = rankBetween(null, null);
    const second = rankBetween(first, null);
    const between = rankBetween(first, second);
    expect([first, between, second]).toEqual([first, between, second].slice().sort());
  });
});

describe("epicProgress", () => {
  it("uses counts when any estimate is missing, estimates when all present", () => {
    expect(
      epicProgress([
        { status: "RESOLVED", estimate: null },
        { status: "NEW", estimate: 5 },
      ]),
    ).toEqual({ done: 1, total: 2 });
    expect(
      epicProgress([
        { status: "RESOLVED", estimate: 3 },
        { status: "NEW", estimate: 5 },
      ]),
    ).toEqual({ done: 3, total: 8 });
  });
  it("closed-without-fix counts as done (the epic no longer waits on it)", () => {
    expect(epicProgress([{ status: "WONT_FIX", estimate: null }])).toEqual({ done: 1, total: 1 });
  });
});
