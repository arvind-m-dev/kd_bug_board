import { describe, expect, it } from "vitest";
import { peopleReport, reportIssues } from "@/lib/jira/people";

const member = (name: string, accountId: string | null = null, links = 1) => ({
  userId: `u-${name}-${accountId}-${links}`,
  name,
  accountId,
  links,
});
const jira = (name: string, accountId: string, member: string | null = null) => ({
  accountId,
  name,
  member,
});

describe("people report", () => {
  it("counts who is linked and who is only on one side", () => {
    const r = peopleReport(
      [member("Ravi", "a1"), member("Meera")],
      [jira("ravi", "a1", "Ravi"), jira("Sam", "a2")],
    );
    expect(r).toMatchObject({ linked: 1, onlyInBugBoard: 1, onlyInJira: 1 });
    expect(reportIssues(r)).toBe(0);
  });

  it("flags the same name twice on either side, ignoring case and spaces", () => {
    const r = peopleReport(
      [member("Arvind  M"), member("arvind m", "a9")],
      [jira("Arvind M", "a9", "arvind m"), jira("arvind m", "a8")],
    );
    expect(r.sameNameMembers).toEqual([{ name: "Arvind  M", count: 2 }]);
    expect(r.sameNameInJira).toEqual([{ name: "Arvind M", count: 2 }]);
  });

  it("suggests linking only an unambiguous unlinked pair with the same name", () => {
    const one = peopleReport([member("Faisal Ahmed")], [jira("faisal ahmed", "a1")]);
    expect(one.likelySame).toEqual([
      {
        userId: expect.any(String),
        member: "Faisal Ahmed",
        accountId: "a1",
        jiraName: "faisal ahmed",
      },
    ]);
    const two = peopleReport(
      [member("Arvind M")],
      [jira("Arvind M", "a1"), jira("arvind m", "a2")],
    );
    expect(two.likelySame).toEqual([]);
    const taken = peopleReport([member("Ravi")], [jira("Ravi", "a1", "Someone")]);
    expect(taken.likelySame).toEqual([]);
  });

  it("reports a member with more than one working link", () => {
    const r = peopleReport([member("Meera", null, 3)], []);
    expect(r.extraLinks).toEqual([{ name: "Meera", links: 3 }]);
  });
});

describe("people report: names from Jira", () => {
  it("flags a linked member whose name is not their Jira name, using Jira's current name first", () => {
    const r = peopleReport(
      [
        { ...member("Arvind", "a1"), jiraName: "Old Name" },
        { ...member("Meera S", "a2"), jiraName: "Meera S" },
        { ...member("Sam", "a3"), jiraName: "Sam Rao" },
      ],
      [jira("Arvind M", "a1", "Arvind"), jira("meera  s", "a2", "Meera S")],
    );
    expect(r.nameDiffers).toEqual([
      { userId: "u-Arvind-a1-1", member: "Arvind", jiraName: "Arvind M" },
      { userId: "u-Sam-a3-1", member: "Sam", jiraName: "Sam Rao" },
    ]);
    expect(reportIssues(r)).toBe(2);
  });

  it("never flags unlinked members", () => {
    expect(peopleReport([member("Ravi")], [jira("Ravi K", "a1")]).nameDiffers).toEqual([]);
  });
});
