import { describe, it, expect } from "vitest";
import { counts, filterBugs, canTransition, exportMarkdown, type Bug } from "@/lib/bugflow";
const bug: Bug = {
  id: "BF-000001",
  title: "Checkout fails",
  status: "NEW",
  priority: "High",
  severity: "Critical",
  description: "Payment fails",
  steps: ["Open checkout", "Submit"],
  expected: "Order confirmed",
  actual: "Error",
  assigneeId: null,
  comments: ["Reproduced"],
  evidence: [{ name: "Screenshot", url: "https://example.test/private-evidence/1" }],
};
describe("Futurist Global Bug Board rules", () => {
  it("counts every record including resolved records", () =>
    expect(counts([bug, { ...bug, status: "RESOLVED" }]).total).toBe(2));
  it("open means new, validated, assigned and in progress", () =>
    expect(
      counts(
        ["NEW", "VALIDATED", "ASSIGNED", "IN_PROGRESS", "RECHECK", "RESOLVED", "VALIDATING"].map(
          (status) => ({ ...bug, status: status as Bug["status"] }),
        ),
      ).open,
    ).toBe(4));
  it("unassigned means no assignee", () =>
    expect(counts([bug, { ...bug, assigneeId: "dev-1" }]).unassigned).toBe(1));
  it("verification count includes only RECHECK", () =>
    expect(
      counts([bug, { ...bug, status: "RECHECK" }, { ...bug, status: "RESOLVED" }]).recheck,
    ).toBe(1));
  it("click-through open filter matches open count", () => {
    const rows: Bug[] = [bug, { ...bug, status: "RECHECK" }];
    expect(filterBugs(rows, "open")).toHaveLength(counts(rows).open);
  });
  it("developers cannot resolve their own fixes", () =>
    expect(canTransition("developer", "RECHECK", "RESOLVED", true)).toBe(false));
  it("only a passed QA retest resolves a bug", () => {
    expect(canTransition("qa", "RECHECK", "RESOLVED", false)).toBe(false);
    expect(canTransition("qa", "RECHECK", "RESOLVED", true)).toBe(true);
    expect(canTransition("admin", "RECHECK", "RESOLVED", true)).toBe(false);
  });
  it("failed retest may reopen", () =>
    expect(canTransition("qa", "RECHECK", "REOPENED")).toBe(true));
  it("reporters cannot assign bugs", () =>
    expect(canTransition("reporter", "READY_FOR_ASSIGNMENT", "ASSIGNED")).toBe(false));
  it("developers may request recheck but cannot skip validation", () => {
    expect(canTransition("developer", "IN_PROGRESS", "RECHECK")).toBe(true);
    expect(canTransition("developer", "NEW", "ASSIGNED")).toBe(false);
  });
  it("exports all records without truncation", () => {
    const result = exportMarkdown(
      Array.from({ length: 150 }, (_, i) => ({ ...bug, id: `BF-${i}` })),
    );
    expect(result).toContain("# BF-149: Checkout fails");
    expect(result.match(/## Steps to reproduce/g)).toHaveLength(150);
    expect(result).toContain("Reproduced");
    expect(result).toContain("https://example.test/private-evidence/1");
  });
});
