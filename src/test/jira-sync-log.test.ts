import { describe, expect, it } from "vitest";
import { describeSyncLog, type SyncLogRaw } from "@/lib/jira/log";

const raw = (over: Partial<SyncLogRaw>): SyncLogRaw => ({
  id: "1",
  at: "2026-11-13T08:00:00.000Z",
  action: "jira.exported",
  detail: {},
  actor: "jira-sync",
  bugId: "59",
  bugCode: "BF-000059",
  ...over,
});

describe("sync log wording", () => {
  it("names the person whose Bug Board change was sent to Jira", () => {
    const e = describeSyncLog(
      raw({
        detail: { fields: ["title", "priority"], issueKey: "SCRUM-36" },
        changedBy: "Rohan Mehta",
      }),
    );
    expect(e).toMatchObject({ kind: "to_jira", who: "Rohan Mehta", issueKey: "SCRUM-36" });
    expect(e.text).toBe("Sent title, priority to Jira");
  });

  it("never names the Admin as a person", () => {
    const sent = describeSyncLog(raw({ detail: { fields: ["dueOn"] }, changedBy: "admin" }));
    expect(sent.who).toBe("Bug Board Admin");
    const decided = describeSyncLog(
      raw({
        action: "jira.conflict_resolved",
        actor: "admin",
        detail: { field: "assignee", resolution: "use_jira" },
      }),
    );
    expect(decided).toMatchObject({ kind: "decision", who: "Bug Board Admin" });
    expect(decided.text).toMatch(/use Jira's/);
  });

  it("a refresh of the who-raised note is Bug Board's own, not a person's", () => {
    const e = describeSyncLog(raw({ detail: { fields: ["note"] }, changedBy: "Rohan Mehta" }));
    expect(e.who).toBe("Bug Board");
    expect(e.text).toBe("Sent who raised it to Jira");
  });

  it("changes made by the Jira Sync actor read as coming from Jira", () => {
    const status = describeSyncLog(
      raw({
        action: "bug.status",
        detail: {
          source: "jira",
          status: "RECHECK",
          previousStatus: "IN_PROGRESS",
          issueKey: "SCRUM-5",
        },
      }),
    );
    expect(status.kind).toBe("from_jira");
    expect(status.who).toBe("Jira");
    expect(status.text).toMatch(/→ .* from Jira$/);
    const created = describeSyncLog(
      raw({
        action: "bug.created",
        detail: { source: "jira", jiraReporter: "Arvind M", issueKey: "SCRUM-6" },
      }),
    );
    expect(created).toMatchObject({
      kind: "from_jira",
      who: "Arvind M",
      text: "Created in Bug Board from Jira",
    });
    const assigned = describeSyncLog(
      raw({ action: "bug.assign", detail: { assignee: "u1" }, assigneeName: "Priya" }),
    );
    expect(assigned.text).toBe("Assigned to Priya from Jira");
  });

  it("errors say which way, why, and whether they retry by themselves", () => {
    const waiting = describeSyncLog(
      raw({
        action: "queue.error",
        detail: { direction: "to_jira", state: "retry", error: "Jira is busy" },
      }),
    );
    expect(waiting).toMatchObject({ kind: "error", who: "Bug Board → Jira" });
    expect(waiting.text).toMatch(/will retry by itself/);
    const stopped = describeSyncLog(
      raw({
        action: "queue.error",
        detail: { direction: "from_jira", state: "dead", error: null },
      }),
    );
    expect(stopped.text).toMatch(
      /^Could not take from Jira: no reason recorded \(stopped — use Retry\)$/,
    );
  });

  it("people links say when they were made automatically", () => {
    const e = describeSyncLog(
      raw({
        action: "jira.person_linked",
        actor: "admin",
        detail: { jiraName: "Arvind M", by: "email" },
      }),
    );
    expect(e).toMatchObject({
      kind: "setup",
      who: "Automatic (same email)",
      text: "Linked Arvind M to their Jira account",
    });
  });

  it("unknown setup actions still read as words", () => {
    expect(describeSyncLog(raw({ action: "jira.something_new", actor: "admin" })).text).toBe(
      "something new",
    );
    expect(describeSyncLog(raw({ action: "jira.connected", actor: "admin" })).text).toBe(
      "Connected to Jira",
    );
  });
});

describe("sync log: names", () => {
  it("a rename to the Jira name is logged as setup by the Admin", () => {
    const e = describeSyncLog(
      raw({
        action: "member.updated",
        actor: "admin",
        detail: { previousName: "Arvind", name: "Arvind M", source: "jira" },
      }),
    );
    expect(e).toMatchObject({
      kind: "setup",
      who: "Bug Board Admin",
      text: "Renamed Arvind to Arvind M (name from Jira)",
    });
  });
});

describe("sync log: duplicates", () => {
  it("linking and ignoring a possible duplicate are the Admin's decisions", () => {
    expect(
      describeSyncLog(
        raw({ action: "jira.duplicate_linked", actor: "admin", detail: { issueKey: "SCRUM-60" } }),
      ),
    ).toMatchObject({
      kind: "decision",
      who: "Bug Board Admin",
      text: "Linked to Jira issue SCRUM-60 (the same bug was entered in both)",
    });
    expect(describeSyncLog(raw({ action: "jira.duplicate_ignored", actor: "admin" })).kind).toBe(
      "decision",
    );
  });
});
