import { describe, expect, it } from "vitest";
import { statusLabel, statusTone, initials, roleText, timeAgo, plural } from "@/lib/format";

describe("shared formatting", () => {
  it("labels statuses in plain words", () => {
    expect(statusLabel("RECHECK")).toBe("Ready for QA retest");
    expect(statusLabel("NEEDS_INFORMATION")).toBe("Needs information");
    expect(statusLabel("NEW")).toBe("New");
  });
  it("maps every status to one tone", () => {
    expect(statusTone("REOPENED")).toBe("danger");
    expect(statusTone("RESOLVED")).toBe("success");
    expect(statusTone("RECHECK")).toBe("warning");
    expect(statusTone("NEW")).toBe("info");
    expect(statusTone("DUPLICATE")).toBe("neutral");
  });
  it("builds initials and role names", () => {
    expect(initials("Lakshmi Venkat")).toBe("LV");
    expect(initials("stephen")).toBe("S");
    expect(initials("  ")).toBe("?");
    expect(roleText("qa")).toBe("QA");
    expect(roleText("other")).toBe("Member");
    expect(roleText("developer")).toBe("Developer");
  });
  it("describes recent times relatively and pluralises", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
    expect(timeAgo(new Date(Date.now() - 5 * 60000).toISOString())).toBe("5m ago");
    expect(timeAgo(new Date(Date.now() - 3 * 3600000).toISOString())).toBe("3h ago");
    expect(plural(1, "person", "people")).toBe("1 person");
    expect(plural(3, "person", "people")).toBe("3 people");
  });
});
