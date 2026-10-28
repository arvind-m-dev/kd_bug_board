import { describe, it, expect } from "vitest";
import { isOverdue, dueSoon, dueBadge } from "@/lib/bugflow";

const TODAY = "2026-10-28";

describe("isOverdue", () => {
  it("is overdue when the date is before today and the bug is open", () => {
    expect(isOverdue("IN_PROGRESS", "2026-10-27", TODAY)).toBe(true);
  });
  it("is not overdue on the due date itself", () => {
    expect(isOverdue("IN_PROGRESS", TODAY, TODAY)).toBe(false);
  });
  it("is not overdue with no due date", () => {
    expect(isOverdue("IN_PROGRESS", null, TODAY)).toBe(false);
  });
  it("is never overdue once closed, even with a past date", () => {
    for (const s of ["RESOLVED", "DUPLICATE", "NOT_A_BUG", "WONT_FIX"])
      expect(isOverdue(s, "2026-01-01", TODAY)).toBe(false);
  });
});

describe("dueSoon", () => {
  it("is due soon today and tomorrow, not later or earlier", () => {
    expect(dueSoon("NEW", TODAY, TODAY)).toBe(true);
    expect(dueSoon("NEW", "2026-10-29", TODAY)).toBe(true);
    expect(dueSoon("NEW", "2026-10-30", TODAY)).toBe(false);
    expect(dueSoon("NEW", "2026-10-27", TODAY)).toBe(false); // already overdue, not "soon"
  });
  it("crosses a month boundary correctly", () => {
    expect(dueSoon("NEW", "2026-11-01", "2026-10-31")).toBe(true);
  });
  it("is false once closed", () => {
    expect(dueSoon("RESOLVED", TODAY, TODAY)).toBe(false);
  });
});

describe("dueBadge", () => {
  it("labels overdue with whole days late", () => {
    expect(dueBadge("NEW", "2026-10-25", TODAY)).toEqual({ tone: "danger", text: "Overdue 3d" });
  });
  it("labels due today and tomorrow as warnings", () => {
    expect(dueBadge("NEW", TODAY, TODAY)).toEqual({ tone: "warning", text: "Due today" });
    expect(dueBadge("NEW", "2026-10-29", TODAY)).toEqual({
      tone: "warning",
      text: "Due tomorrow",
    });
  });
  it("shows nothing for a date more than a day out, or when closed/unset", () => {
    expect(dueBadge("NEW", "2026-11-05", TODAY)).toBeNull();
    expect(dueBadge("RESOLVED", "2026-01-01", TODAY)).toBeNull();
    expect(dueBadge("NEW", null, TODAY)).toBeNull();
  });
});
