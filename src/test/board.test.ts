import { describe, it, expect } from "vitest";
import { BOARD_COLUMNS, boardColumn, dropAction, mayDragCard, unmappedStatuses } from "@/lib/board";
import type { BugActor } from "@/lib/bug-workflow";

const actor = (over: Partial<BugActor> = {}): BugActor => ({
  userId: "dev-1",
  portalId: "p-1",
  name: "Dev",
  role: "developer",
  permissions: ["view", "progress", "recheck", "disposition"],
  ...over,
});
const admin = actor({ role: "admin", userId: "admin-1", permissions: [] });
const qa = actor({
  role: "qa",
  userId: "qa-1",
  permissions: ["view", "validate", "assign", "verify"],
});
const bug = (status: string, over: Partial<Parameters<typeof dropAction>[1]> = {}) => ({
  status: status as Parameters<typeof dropAction>[1]["status"],
  reporterId: "rep-1",
  assigneeId: "dev-1",
  ...over,
});

describe("board columns", () => {
  it("map every workflow status to exactly one column", () => {
    expect(unmappedStatuses()).toEqual([]);
    expect(boardColumn("NEW")).toBe("todo");
    expect(boardColumn("ASSIGNED")).toBe("assigned");
    expect(boardColumn("RECHECK")).toBe("retest");
    expect(boardColumn("WONT_FIX")).toBe("done");
  });
});

describe("dropAction", () => {
  it("lets the assignee developer move Assigned → In progress and In progress → Retest directly", () => {
    expect(dropAction(actor(), bug("ASSIGNED"), "progress")).toEqual({
      kind: "status",
      status: "IN_PROGRESS",
    });
    expect(dropAction(actor(), bug("IN_PROGRESS"), "retest")).toEqual({
      kind: "status",
      status: "RECHECK",
    });
  });
  it("never resolves by drag: Retest → Done opens the bug for a QA verdict", () => {
    expect(dropAction(qa, bug("RECHECK", { assigneeId: "dev-2" }), "done")).toMatchObject({
      kind: "open",
    });
    // The fixer cannot verify their own fix, so for them the drop is simply not allowed.
    expect(dropAction(qa, bug("RECHECK", { assigneeId: "qa-1" }), "done")).toBeNull();
  });
  it("drop into Assigned opens the bug so someone is actually assigned", () => {
    expect(dropAction(qa, bug("READY_FOR_ASSIGNMENT"), "assigned")).toMatchObject({
      kind: "open",
    });
    expect(dropAction(actor(), bug("READY_FOR_ASSIGNMENT"), "assigned")).toBeNull();
  });
  it("closing from In progress offers several statuses, so it opens the bug", () => {
    expect(dropAction(actor(), bug("IN_PROGRESS"), "done")).toMatchObject({ kind: "open" });
  });
  it("a drop onto the card's own column is a no-op", () => {
    expect(dropAction(admin, bug("NEW"), "todo")).toBeNull();
  });
  it("a reporter cannot drag at all; a non-assignee developer cannot move someone else's bug", () => {
    const reporter = actor({ role: "reporter", userId: "rep-1", permissions: ["view", "report"] });
    expect(mayDragCard(reporter, bug("IN_PROGRESS"))).toBe(false);
    expect(mayDragCard(actor({ userId: "dev-9" }), bug("IN_PROGRESS"))).toBe(false);
    expect(mayDragCard(actor(), bug("ASSIGNED"))).toBe(true);
  });
  it("admin reaches Assigned through the panel only once the bug is ready for assignment", () => {
    expect(dropAction(admin, bug("NEW"), "todo")).toBeNull(); // same column
    expect(BOARD_COLUMNS.find((c) => c.key === "todo")).toBeTruthy();
    expect(dropAction(admin, bug("READY_FOR_ASSIGNMENT"), "assigned")).toMatchObject({
      kind: "open",
    });
    // Triage still runs VALIDATED → READY first, so this drop stays off.
    expect(dropAction(admin, bug("VALIDATED"), "assigned")).toBeNull();
  });
});
