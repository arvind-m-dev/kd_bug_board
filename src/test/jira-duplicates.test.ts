import { describe, expect, it } from "vitest";
import { bugDuplicates, duplicateCount, titleKey } from "@/lib/jira/duplicates";

const b = (bugId: string, title: string, issueKey: string | null = null) => ({
  bugId,
  code: `BF-${bugId}`,
  title,
  issueKey,
});
const j = (issueId: string, title: string, linked = false) => ({
  issueId,
  key: `SCRUM-${issueId}`,
  title,
  linked,
});

describe("bug duplicates between Bug Board and Jira", () => {
  it("compares titles ignoring case, punctuation and spacing", () => {
    expect(titleKey("  Login  button: does NOTHING! ")).toBe(titleKey("login button does nothing"));
  });

  it("offers one unlinked bug and one unlinked issue with the same title as a pair to link", () => {
    const d = bugDuplicates(
      [b("1", "Login fails"), b("2", "Other", "SCRUM-9")],
      [j("10", "login fails."), j("9", "Other", true)],
    );
    expect(d.pairs).toEqual([
      {
        key: "pair:1:10",
        bugId: "1",
        code: "BF-1",
        issueId: "10",
        issueKey: "SCRUM-10",
        title: "Login fails",
      },
    ]);
    expect(d.inBugBoard).toEqual([]);
    expect(d.inJira).toEqual([]);
  });

  it("does not offer linked items, and lists same titles on one side instead of guessing a pair", () => {
    const d = bugDuplicates(
      [b("1", "Crash"), b("2", "crash"), b("3", "Linked", "SCRUM-5")],
      [j("10", "Crash"), j("5", "Linked", true), j("6", "linked")],
    );
    expect(d.pairs).toEqual([]);
    expect(d.inBugBoard).toEqual([
      {
        key: "bb:1,2",
        title: "Crash",
        bugs: [
          { bugId: "1", code: "BF-1", issueKey: null },
          { bugId: "2", code: "BF-2", issueKey: null },
        ],
      },
    ]);
    expect(d.inJira.map((g) => g.key)).toEqual(["jira:5,6"]);
    expect(duplicateCount(d)).toBe(2);
  });

  it("leaves out what an Admin marked as not a duplicate", () => {
    const d = bugDuplicates(
      [b("1", "A"), b("2", "a")],
      [j("10", "B"), j("11", "b")],
      new Set(["bb:1,2", "jira:10,11"]),
    );
    expect(duplicateCount(d)).toBe(0);
  });
});

describe("bug duplicates: one finding shown once", () => {
  it("does not repeat a Bug Board group as a Jira group when they are the same linked issues", () => {
    const d = bugDuplicates(
      [b("1", "Solo QA bug", "SCRUM-14"), b("2", "solo qa bug", "SCRUM-50")],
      [j("14", "Solo QA bug", true), j("50", "solo QA bug", true)].map((x) => ({
        ...x,
        key: `SCRUM-${x.issueId}`,
      })),
    );
    expect(d.inBugBoard).toHaveLength(1);
    expect(d.inJira).toEqual([]);
  });
});
