import { describe, expect, it } from "vitest";
import {
  emptyReportDraft,
  parseReportDraft,
  reportDraftHasContent,
  sameReportDraft,
} from "@/lib/report-draft";

describe("report drafts", () => {
  it("treats a blank report, including default priority and severity, as unchanged", () => {
    expect(reportDraftHasContent(emptyReportDraft())).toBe(false);
    expect(reportDraftHasContent({ ...emptyReportDraft(), projectId: "p1" })).toBe(false);
    expect(reportDraftHasContent({ ...emptyReportDraft(), projectId: "p1" }, true)).toBe(true);
  });

  it("treats typed text, a link, or a non-default priority as a change", () => {
    expect(reportDraftHasContent({ ...emptyReportDraft(), title: "  login  " })).toBe(true);
    expect(reportDraftHasContent({ ...emptyReportDraft(), links: ["", "https://drive.google.com/x"] })).toBe(
      true,
    );
    expect(reportDraftHasContent({ ...emptyReportDraft(), priority: "P1" })).toBe(true);
    expect(reportDraftHasContent({ ...emptyReportDraft(), links: ["", "  "] })).toBe(false);
  });

  it("ignores a broken or empty saved draft", () => {
    expect(parseReportDraft(null)).toBeNull();
    expect(parseReportDraft("{")).toBeNull();
    expect(parseReportDraft("[]")).toBeNull();
    const d = parseReportDraft(JSON.stringify({ title: "Saved", links: ["https://a", 1] }));
    expect(d?.title).toBe("Saved");
    expect(d?.links).toEqual(["https://a"]);
    expect(d?.priority).toBe("P3");
  });

  it("treats the same text with different whitespace as unchanged", () => {
    const a = { ...emptyReportDraft(), description: "Login fails" };
    expect(sameReportDraft(a, { ...a, description: "  Login fails  " })).toBe(true);
    expect(sameReportDraft(a, { ...a, title: "Login" })).toBe(false);
  });
});
