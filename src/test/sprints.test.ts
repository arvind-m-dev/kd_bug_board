import { describe, it, expect } from "vitest";
import {
  maySprint,
  canChangeSprintState,
  summarizeSprint,
  carryCandidates,
  type SprintItem,
} from "@/lib/sprints";

const item = (over: Partial<SprintItem> = {}): SprintItem => ({
  bugId: "1",
  code: "BUG-1",
  title: "x",
  status: "NEW",
  priority: "P3",
  assignee: "Unassigned",
  dueOn: null,
  addedAt: "2026-10-01T00:00:00.000Z",
  removedAt: null,
  carriedFromSprintId: null,
  ...over,
});

describe("maySprint", () => {
  it("allows admin and plan holders only", () => {
    expect(maySprint({ role: "admin", permissions: [] })).toBe(true);
    expect(maySprint({ role: "qa", permissions: ["plan"] })).toBe(true);
    expect(maySprint({ role: "developer", permissions: ["progress"] })).toBe(false);
  });
});

describe("canChangeSprintState", () => {
  it("only plan→active and active→closed", () => {
    expect(canChangeSprintState("planned", "active")).toBe(true);
    expect(canChangeSprintState("active", "closed")).toBe(true);
    expect(canChangeSprintState("closed", "active")).toBe(false);
    expect(canChangeSprintState("planned", "closed")).toBe(false);
    expect(canChangeSprintState("active", "planned")).toBe(false);
  });
});

describe("summarizeSprint", () => {
  const started = "2026-10-05T00:00:00.000Z";
  it("splits committed vs added by the start time and ignores removed items", () => {
    const items = [
      item({ bugId: "1", addedAt: "2026-10-01T00:00:00.000Z" }), // committed
      item({ bugId: "2", addedAt: "2026-10-06T00:00:00.000Z" }), // added after start
      item({
        bugId: "3",
        addedAt: "2026-10-02T00:00:00.000Z",
        removedAt: "2026-10-07T00:00:00.000Z",
      }), // removed
      item({ bugId: "4", addedAt: "2026-10-03T00:00:00.000Z", status: "RESOLVED" }), // done
    ];
    const s = summarizeSprint(items, started);
    expect(s.total).toBe(3); // removed excluded
    expect(s.added).toBe(1);
    expect(s.committed).toBe(2);
    expect(s.done).toBe(1);
    expect(s.open).toBe(2); // 1 and 2 open; 4 is resolved (closed)
  });
  it("before start, everything is committed and nothing is added", () => {
    const s = summarizeSprint([item({ bugId: "1" }), item({ bugId: "2" })], null);
    expect(s).toMatchObject({ total: 2, committed: 2, added: 0 });
  });
  it("counts carried-over items", () => {
    const s = summarizeSprint(
      [item({ carriedFromSprintId: "old" }), item({ bugId: "2" })],
      started,
    );
    expect(s.carried).toBe(1);
  });
});

describe("carryCandidates", () => {
  it("is the live, still-open items", () => {
    const items = [
      item({ bugId: "1", status: "IN_PROGRESS" }),
      item({ bugId: "2", status: "RESOLVED" }),
      item({ bugId: "3", status: "NEW", removedAt: "2026-10-09T00:00:00.000Z" }),
    ];
    expect(carryCandidates(items).map((i) => i.bugId)).toEqual(["1"]);
  });
});
