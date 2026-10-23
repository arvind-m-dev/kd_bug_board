import { describe, expect, it } from "vitest";
import { assignmentMessage, defaultTask } from "@/lib/bug-workflow";

describe("assignment message", () => {
  it("defaults the task from the role", () => {
    expect(defaultTask("developer")).toBe("fix");
    expect(defaultTask("qa")).toBe("revalidate");
    expect(defaultTask("reporter")).toBe("retest");
  });
  it("names each person, their role and what they are asked to do", () => {
    expect(assignmentMessage([{ name: "Krishna", role: "developer", task: "fix" }])).toBe(
      "Assigned to Krishna (Developer) to fix it.",
    );
    expect(
      assignmentMessage([
        { name: "Krishna", role: "developer", task: "fix" },
        { name: "John", role: "qa", task: "revalidate" },
        { name: "Asha", role: "reporter", task: "media" },
      ]),
    ).toBe(
      "Assigned to Krishna (Developer) to fix it, John (QA) to re-validate it, and Asha (Tester) to add screenshots or recordings.",
    );
  });
});
