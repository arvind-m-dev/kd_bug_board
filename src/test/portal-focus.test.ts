import { describe, expect, it } from "vitest";
import { matchesFilter, portalFocus, focusCounts } from "@/lib/bug-workflow";

const me = "u1";
const bugs = [
  { status: "IN_PROGRESS", assigneeId: "u1", reporterId: "r" },
  { status: "RECHECK", assigneeId: null, reporterId: "u1", assignees: [{ id: "u1" }] },
  { status: "RESOLVED", assigneeId: "u2", reporterId: "u1" },
  { status: "NEW", assigneeId: null, reporterId: "r" },
];
const count = (f: string) => bugs.filter((b) => matchesFilter(f, b, me)).length;

describe("portal focus filters", () => {
  it("owned matches the primary and any additional assignee", () => {
    expect(count("owned")).toBe(2);
  });
  it("compound filters combine a person with a status or group", () => {
    expect(count("owned:RECHECK")).toBe(1);
    expect(count("mine:RESOLVED")).toBe(1);
    expect(count("mine:open")).toBe(1);
    expect(count("g:new")).toBe(1);
    expect(count("mine:g:new")).toBe(0);
  });
  it("chooses cards by what the person does, not only their title", () => {
    expect(portalFocus("developer", []).map((c) => c.key)).toEqual([
      "owned",
      "progress",
      "qa",
      "reopened",
    ]);
    expect(portalFocus("other", ["progress"])[0]?.key).toBe("owned");
    expect(portalFocus("qa", [])[0]?.filter).toBe("g:new");
    expect(portalFocus("tester", ["view", "report"])[0]?.filter).toBe("mine");
  });
  it("counts each card over the bugs in view", () => {
    expect(focusCounts(portalFocus("developer", []), bugs, me).map((c) => c.count)).toEqual([
      2, 1, 1, 0,
    ]);
  });
});
