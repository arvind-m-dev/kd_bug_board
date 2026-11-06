import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "@/lib/bug-workflow";
import type { Status } from "@/lib/bugflow";
import { readDescription } from "@/lib/jira/adf";
import { derivedUuid } from "@/lib/jira/ids";
import { importDraft, planInbound } from "@/lib/jira/inbound";
import { localFields, remoteFields } from "@/lib/jira/mapping";
import { OWN_ISSUE_WAIT_MS, syncBug, syncIssue } from "@/lib/jira/processor";
import { issueSchema } from "@/lib/jira/schemas";
import type { SyncFields } from "@/lib/jira/types";
import {
  CONFIG,
  DIRECTORY,
  FakeJira,
  MAPPING,
  MemoryStore,
  bug,
  event,
  row,
} from "./jira-fixtures";

const RAVI = { userId: "aaaaaaaa-0000-4000-8000-0000000000b2", name: "Ravi", onProject: true };
const base = localFields(bug(), CONFIG);
const at = (status: Status, assigneeId: string | null = null) => ({
  status,
  reporterId: "r",
  assigneeId,
});
const ctx = (
  assignee: { userId: string; onProject: boolean } | null = null,
  sprint: { target: { sprintId: string; open: boolean } | null; elsewhere: boolean } = {
    target: null,
    elsewhere: false,
  },
) => ({ options: DEFAULT_OPTIONS, assignee, sprint });
const plan = (
  pull: (keyof SyncFields)[],
  remote: Partial<SyncFields>,
  b = at("NEW"),
  config = CONFIG,
  c = ctx(),
) => planInbound(pull, { ...base, ...remote }, b, config, c);
const withResolve = { ...CONFIG, inbound: { ...CONFIG.inbound, resolveFromRecheck: true } };

describe("what a Jira change may do to a bug", () => {
  it("takes text that BugFlow itself would accept, and refuses what it would not", () => {
    const ok = plan(["title", "steps", "module"], {
      title: "New title",
      steps: ["One"],
      module: "Payments",
    });
    expect(ok.rejected).toEqual([]);
    expect(ok.change).toMatchObject({
      edit: { title: "New title", steps: ["One"], module: "Payments" },
      assign: null,
      status: null,
    });
    const bad = plan(["title", "description", "steps"], {
      title: "x".repeat(181),
      description: "",
      steps: Array(31).fill("s"),
    });
    expect(bad.change).toBeNull();
    expect(bad.rejected).toEqual([
      { field: "title", reason: "too_long_for_bugflow" },
      { field: "description", reason: "empty_in_jira" },
      { field: "steps", reason: "too_long_for_bugflow" },
    ]);
  });

  it("maps priority and severity onto BugFlow's own lists only", () => {
    expect(
      plan(["priority", "severity"], { priority: "5", severity: "critical" }).change!.edit,
    ).toEqual({ priority: "P5", severity: "Critical" });
    expect(
      plan(["priority", "severity", "dueOn"], {
        priority: "77",
        severity: "Catastrophic",
        dueOn: "2026-02-30",
      }).rejected,
    ).toEqual([
      { field: "priority", reason: "unmapped_priority" },
      { field: "severity", reason: "not_a_bugflow_option" },
      { field: "dueOn", reason: "invalid_date" },
    ]);
    expect(plan(["dueOn"], { dueOn: null }).change!.edit).toEqual({ dueOn: null });
  });

  it("moves status only along the workflow", () => {
    // a new bug cannot be started from Jira: it is neither validated nor assigned
    expect(plan(["status"], { status: "2" }).rejected).toEqual([
      { field: "status", reason: "not_allowed_in_bugflow" },
    ]);
    // an assigned bug can be started, and work in progress can be sent for retest
    expect(plan(["status"], { status: "3" }, at("IN_PROGRESS", "dev")).change!.status).toEqual({
      from: "IN_PROGRESS",
      target: "RECHECK",
      hops: [["IN_PROGRESS", "RECHECK"]],
      verify: false,
    });
    // Assigned and In progress share a Jira column here; the hidden first step is written to the history too
    expect(plan(["status"], { status: "3" }, at("ASSIGNED", "dev")).change!.status!.hops).toEqual([
      ["ASSIGNED", "IN_PROGRESS"],
      ["IN_PROGRESS", "RECHECK"],
    ]);
    // a resolved bug is not reopened from Jira
    expect(plan(["status"], { status: "2" }, at("RESOLVED", "dev")).rejected[0]!.reason).toBe(
      "not_allowed_in_bugflow",
    );
    expect(plan(["status"], { status: "99" }).rejected[0]!.reason).toBe("unmapped_status");
  });

  it("never lets Jira's Done stand in for a retest, unless the Admin allowed exactly that", () => {
    for (const status of ["NEW", "ASSIGNED", "IN_PROGRESS", "RECHECK"] as const)
      expect(plan(["status"], { status: "4" }, at(status, "dev")).rejected).toEqual([
        { field: "status", reason: "needs_qa_verification" },
      ]);
    expect(
      plan(["status"], { status: "4" }, at("RECHECK", "dev"), withResolve).change!.status,
    ).toEqual({
      from: "RECHECK",
      target: "RESOLVED",
      hops: [["RECHECK", "RESOLVED"]],
      verify: true,
    });
    // still only from "waiting for retest"
    expect(
      plan(["status"], { status: "4" }, at("IN_PROGRESS", "dev"), withResolve).rejected[0]!.reason,
    ).toBe("needs_qa_verification");
  });

  it("assigns only a confirmed member who is on the project, through triage", () => {
    const assigned = plan(["assignee"], { assignee: "acc-ravi" }, at("NEW"), CONFIG, ctx(RAVI));
    expect(assigned.change!.assign).toEqual({
      userId: RAVI.userId,
      status: "ASSIGNED",
      hops: [
        ["NEW", "VALIDATING"],
        ["VALIDATING", "VALIDATED"],
        ["VALIDATED", "READY_FOR_ASSIGNMENT"],
        ["READY_FOR_ASSIGNMENT", "ASSIGNED"],
      ],
    });
    expect(
      plan(["assignee"], { assignee: "acc-ravi" }, at("IN_PROGRESS", "x"), CONFIG, ctx(RAVI))
        .change!.assign,
    ).toMatchObject({ status: "IN_PROGRESS", hops: [] });
    expect(plan(["assignee"], { assignee: "acc-x" }).rejected[0]!.reason).toBe("unmapped_assignee");
    expect(
      plan(
        ["assignee"],
        { assignee: "acc-ravi" },
        at("NEW"),
        CONFIG,
        ctx({ ...RAVI, onProject: false }),
      ).rejected[0]!.reason,
    ).toBe("assignee_not_on_project");
    expect(plan(["assignee"], { assignee: null }, at("ASSIGNED", "dev")).rejected[0]!.reason).toBe(
      "unassign_not_supported",
    );
    expect(
      plan(["assignee"], { assignee: "acc-ravi" }, at("RESOLVED", "dev"), CONFIG, ctx(RAVI))
        .rejected[0]!.reason,
    ).toBe("not_allowed_in_bugflow");
  });

  it("works the status out from where the assignment leaves the bug", () => {
    const both = plan(
      ["assignee", "status"],
      { assignee: "acc-ravi", status: "2" },
      at("NEW"),
      CONFIG,
      ctx(RAVI),
    );
    // Assigned already sits in Jira's In Progress column here, so no further status step is needed
    expect(both.change).toMatchObject({
      assign: { status: "ASSIGNED" },
      status: null,
      fields: ["assignee", "status"],
    });
    expect(both.rejected).toEqual([]);
  });
});

describe("sprint and estimate from Jira", () => {
  const open = { target: { sprintId: "sprint-7", open: true }, elsewhere: false };

  it("moves the bug into the mirrored sprint, or out of its sprint", () => {
    expect(
      plan(["sprint"], { sprint: "7" }, at("NEW"), CONFIG, ctx(null, open)).change!.sprint,
    ).toEqual({ to: "sprint-7" });
    expect(
      plan(["sprint"], { sprint: null }, at("NEW"), CONFIG, ctx(null, open)).change!.sprint,
    ).toEqual({ to: null });
  });

  it("keeps one open sprint per bug and never plans into a closed or unknown sprint", () => {
    const reason = (c: ReturnType<typeof ctx>) =>
      plan(["sprint"], { sprint: "7" }, at("NEW"), CONFIG, c).rejected[0]!.reason;
    expect(reason(ctx(null, { ...open, elsewhere: true }))).toBe("in_another_sprint");
    expect(
      reason(ctx(null, { target: { sprintId: "sprint-7", open: false }, elsewhere: false })),
    ).toBe("sprint_not_open");
    expect(reason(ctx())).toBe("unknown_sprint");
  });

  it("takes whole estimates only", () => {
    expect(plan(["estimate"], { estimate: 5 }).change!.edit).toEqual({ estimate: 5 });
    expect(plan(["estimate"], { estimate: null }).change!.edit).toEqual({ estimate: null });
    expect(plan(["estimate"], { estimate: 2.5 }).rejected).toEqual([
      { field: "estimate", reason: "not_a_bugflow_estimate" },
    ]);
    expect(plan(["estimate"], { estimate: 5000 }).rejected[0]!.reason).toBe(
      "not_a_bugflow_estimate",
    );
  });
});

describe("a Jira issue as a new bug", () => {
  const remote = (fields: Record<string, unknown>) =>
    remoteFields(
      issueSchema.parse({
        id: "20001",
        key: "BFT-1",
        fields: {
          status: { id: "1" },
          project: { id: "10000" },
          issuetype: { id: "10004" },
          ...fields,
        },
      }),
      CONFIG,
    );

  it("copies what fits and fills what BugFlow needs", () => {
    const draft = importDraft(
      remote({ summary: "Login page is blank", priority: { id: "2" }, duedate: "2026-12-01" }),
      CONFIG,
      DEFAULT_OPTIONS,
    );
    expect(draft).toMatchObject({
      title: "Login page is blank",
      description: "Login page is blank", // Jira had none; BugFlow requires one
      steps: [],
      priority: "P2",
      severity: "Medium",
      dueOn: "2026-12-01",
      misfits: [],
    });
  });

  it("cuts what is too long and remembers that it did", () => {
    const draft = importDraft(remote({ summary: "t".repeat(200) }), CONFIG, DEFAULT_OPTIONS);
    expect(draft.title).toHaveLength(180);
    expect(draft.misfits).toEqual(["title"]);
  });
});

describe("request ids for integration writes", () => {
  it("are stable for the same change and different for any other", async () => {
    const a = await derivedUuid("link", "edit", "v1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await derivedUuid("link", "edit", "v1")).toBe(a);
    expect(await derivedUuid("link", "edit", "v2")).not.toBe(a);
    expect(await derivedUuid("lin", "kedit", "v1")).not.toBe(a);
  });
});

function world() {
  const store = new MemoryStore();
  const jira = new FakeJira();
  store.members.set("acc-ravi", RAVI);
  const arrive = (over = {}, now = 1_000_000) =>
    syncIssue(
      event(over),
      DIRECTORY,
      store,
      () => jira,
      () => now,
    );
  return { store, jira, arrive };
}
const details = (issue: { fields: Record<string, unknown> }) =>
  readDescription(issue.fields["description"]).details;

describe("Jira → BugFlow: a bug created in Jira", () => {
  it("becomes exactly one BugFlow bug, however often the event arrives", async () => {
    const { store, jira, arrive } = world();
    const issue = jira.written();
    expect(await arrive({ issueId: issue.id })).toEqual({ kind: "done", note: "synced" });
    expect(await arrive({ id: "event-2", issueId: issue.id })).toEqual({
      kind: "done",
      note: "synced",
    });
    expect(store.imported).toEqual(["900"]);
    const created = store.bugs.get("900")!.bug;
    expect(created).toMatchObject({
      title: "TRIAL-JIRA-Login page is blank",
      description: "Nothing renders after sign-in.",
      priority: "P2",
      status: "NEW",
      reporterName: "Jira Sync",
    });
    expect(store.links.get("900")).toMatchObject({ state: "linked", jiraIssueId: issue.id });
  });

  it("gets its Bug Board link and defaults written back, without touching Jira's own text", async () => {
    const { jira, arrive } = world();
    const issue = jira.written();
    await arrive({ issueId: issue.id });
    expect(details(issue)).toEqual([
      "Severity: Medium",
      "Reported by: Jira Sync",
      "Bug Board: BF-900 https://bugs.example.test/admin/bugs?bug=900",
    ]);
    expect(readDescription(issue.fields["description"]).description).toBe(
      "Nothing renders after sign-in.",
    );
    expect(issue.fields["summary"]).toBe("TRIAL-JIRA-Login page is blank");
    expect(jira.count("transition")).toBe(0);
  });

  it("names the BugFlow member as reporter when the Jira reporter is a confirmed member", async () => {
    const { store, jira, arrive } = world();
    const issue = jira.written({ reporter: { accountId: "acc-ravi", displayName: "Ravi K" } });
    await arrive({ issueId: issue.id });
    expect(store.bugs.get("900")!.bug.reporterName).toBe("Ravi");
  });

  it("does not drag the bug past the workflow: a Jira issue already In Progress waits for a person", async () => {
    const { store, jira, arrive } = world();
    const issue = jira.written({ status: { id: "2" } });
    expect(await arrive({ issueId: issue.id })).toEqual({ kind: "conflict" });
    expect(store.bugs.get("900")!.bug.status).toBe("NEW");
    expect(issue.fields["status"]).toEqual({ id: "2" }); // and Jira is not pushed back to To Do
    expect(store.saved.at(-1)!.conflicts).toMatchObject([
      { field: "status", reason: "not_allowed_in_bugflow", remote: "2" },
    ]);
  });

  it("ignores issues outside the mapped project or type, and its own issues", async () => {
    const { store, jira, arrive } = world();
    const other = jira.written({ issuetype: { id: "10001" } });
    expect(await arrive({ issueId: other.id })).toEqual({ kind: "done", note: "not_a_mapped_bug" });
    expect(await arrive({ issueId: other.id, projectId: "10099" })).toEqual({
      kind: "done",
      note: "not_mapped",
    });
    expect(await arrive({ issueId: "29999" })).toEqual({ kind: "done", note: "gone" });
    const own = jira.written({ labels: ["bf-41-0a1b2c3d"] });
    expect(await arrive({ issueId: own.id })).toEqual({
      kind: "defer",
      ms: 60_000,
      note: "own_issue",
    });
    expect(await arrive({ issueId: own.id }, 1_000_000 + OWN_ISSUE_WAIT_MS)).toEqual({
      kind: "done",
      note: "own_issue",
    });
    expect(store.imported).toEqual([]);
  });

  it("imports text that is too long cut short, flags it, and never writes the cut text back", async () => {
    const { store, jira, arrive } = world();
    const issue = jira.written({ summary: "t".repeat(200) });
    expect(await arrive({ issueId: issue.id })).toEqual({ kind: "conflict" });
    expect(store.bugs.get("900")!.bug.title).toHaveLength(180);
    expect(issue.fields["summary"]).toHaveLength(200);
    expect(store.saved.at(-1)!.conflicts).toMatchObject([
      { field: "title", reason: "too_long_for_bugflow" },
    ]);
  });
});

describe("Jira → BugFlow: a linked bug", () => {
  async function linked(b = bug()) {
    const w = world();
    w.store.put(b);
    await syncBug(row(), MAPPING, w.store, w.jira);
    w.jira.calls = [];
    return { ...w, issue: w.jira.raw("20001") };
  }

  it("takes a Jira edit as the Jira integration, with who did it kept for the Admin", async () => {
    const { store, jira, arrive, issue } = await linked();
    issue.fields["summary"] = "Edited in Jira";
    expect(await arrive()).toEqual({ kind: "done", note: "synced" });
    expect(store.bugs.get("41")!.bug.title).toBe("Edited in Jira");
    expect(store.inbound).toMatchObject([
      {
        bugId: "41",
        change: { edit: { title: "Edited in Jira" } },
        meta: { issueKey: "BFT-1", actor: { displayName: "Jordan (Jira)" } },
      },
    ]);
    expect(jira.count("updateIssue")).toBe(0); // nothing is echoed back
  });

  it("treats the echo of BugFlow's own change as nothing to do", async () => {
    const { store, jira, arrive } = await linked();
    store.put(bug({ title: "TRIAL-JIRA-Changed in BugFlow" }));
    await syncBug(row(), MAPPING, store, jira);
    jira.calls = [];
    expect(await arrive()).toEqual({ kind: "done", note: "synced" });
    expect(jira.calls).toEqual(["getIssue"]);
    expect(store.inbound).toEqual([]);
  });

  it("applies a change from each side in one pass when they touch different fields", async () => {
    const { store, arrive, issue } = await linked();
    issue.fields["summary"] = "Jira title";
    store.put(bug({ severity: "Low" }));
    expect(await arrive()).toEqual({ kind: "done", note: "synced" });
    expect(store.bugs.get("41")!.bug).toMatchObject({ title: "Jira title", severity: "Low" });
    expect(issue.fields["summary"]).toBe("Jira title");
    expect(details(issue)).toContain("Severity: Low");
  });

  it("keeps both values and asks a person when both changed the same field", async () => {
    const { store, arrive, issue } = await linked();
    issue.fields["summary"] = "Jira title";
    store.put(bug({ title: "BugFlow title" }));
    expect(await arrive()).toEqual({ kind: "conflict" });
    expect(store.bugs.get("41")!.bug.title).toBe("BugFlow title");
    expect(issue.fields["summary"]).toBe("Jira title");
    expect(store.inbound).toEqual([]);
  });

  it("carries out the Admin's decision on a conflict, either way", async () => {
    const a = await linked();
    a.issue.fields["summary"] = "Jira title";
    a.store.put(bug({ title: "BugFlow title" }));
    await a.arrive();
    a.store.links.get("41")!.overrides = { push: [], pull: ["title"], held: [] }; // "use Jira's"
    expect(await a.arrive()).toEqual({ kind: "done", note: "synced" });
    expect(a.store.bugs.get("41")!.bug.title).toBe("Jira title");
    expect(a.store.links.get("41")!.overrides).toEqual({ push: [], pull: [], held: [] });

    const b = await linked();
    b.issue.fields["summary"] = "Jira title";
    b.store.put(bug({ title: "BugFlow title" }));
    await b.arrive();
    b.store.links.get("41")!.overrides = { push: ["title"], pull: [], held: [] }; // "use BugFlow's"
    expect(await b.arrive()).toEqual({ kind: "done", note: "synced" });
    expect(b.issue.fields["summary"]).toBe("BugFlow title");
    expect(b.store.links.get("41")!.state).toBe("linked");
  });

  it("lets the Admin send BugFlow's text over Jira formatting on purpose", async () => {
    const { store, jira, arrive, issue } = await linked();
    const doc = issue.fields["description"] as { content: { content: { marks?: unknown }[] }[] };
    doc.content[0]!.content[0]!.marks = [{ type: "strong" }];
    store.put(bug({ description: "Rewritten in BugFlow." }));
    expect(await arrive()).toEqual({ kind: "conflict" });
    expect(jira.count("updateIssue")).toBe(0);
    store.links.get("41")!.overrides = { push: ["description"], pull: [], held: [] };
    expect(await arrive()).toEqual({ kind: "done", note: "synced" });
    expect(readDescription(issue.fields["description"]).description).toBe("Rewritten in BugFlow.");
  });

  it("assigns the confirmed member, then tells Jira the status that came with it", async () => {
    const { store, jira, arrive, issue } = await linked(bug({ status: "VALIDATED" }));
    issue.fields["assignee"] = { accountId: "acc-ravi" };
    expect(await arrive()).toEqual({ kind: "done", note: "synced" });
    expect(store.bugs.get("41")!.bug).toMatchObject({
      assigneeId: RAVI.userId,
      status: "ASSIGNED",
    });
    // Assigned sits in Jira's In Progress column on this board: a second pass moved the issue there
    expect(issue.fields["status"]).toEqual({ id: "2" });
    expect(jira.count("transition")).toBe(1);
    expect(details(issue)).toContain("Assigned to: Ravi");
  });

  it("leaves an unconfirmed Jira assignee as a question for the Admin", async () => {
    const { store, arrive, issue } = await linked(bug({ status: "VALIDATED" }));
    issue.fields["assignee"] = { accountId: "acc-stranger" };
    expect(await arrive()).toEqual({ kind: "conflict" });
    expect(store.bugs.get("41")!.bug.assigneeId).toBeNull();
    expect(store.saved.at(-1)!.conflicts).toMatchObject([
      { field: "assignee", reason: "unmapped_assignee" },
    ]);
  });

  it("resolves a bug waiting for retest from Jira's Done only when allowed, as a recorded verification", async () => {
    const strict = await linked(bug({ status: "RECHECK", assigneeAccountId: null }));
    strict.issue.fields["status"] = { id: "4" };
    expect(await strict.arrive()).toEqual({ kind: "conflict" });
    expect(strict.store.bugs.get("41")!.bug.status).toBe("RECHECK");
    expect(strict.store.saved.at(-1)!.conflicts).toMatchObject([
      { field: "status", reason: "needs_qa_verification" },
    ]);

    const allowed = { ...MAPPING, config: withResolve };
    const w = world();
    w.store.put(bug({ status: "RECHECK" }));
    await syncBug(row(), allowed, w.store, w.jira);
    w.jira.raw("20001").fields["status"] = { id: "4" };
    const directory = { ...DIRECTORY, mappingById: async () => allowed };
    expect(await syncIssue(event(), directory, w.store, () => w.jira)).toEqual({
      kind: "done",
      note: "synced",
    });
    expect(w.store.bugs.get("41")!.bug.status).toBe("RESOLVED");
    expect(w.store.inbound.at(-1)!.change.status).toMatchObject({
      verify: true,
      target: "RESOLVED",
    });
  });

  it("writes nothing when someone changed the bug in BugFlow at the same moment, and looks again", async () => {
    const { store, arrive, issue } = await linked();
    issue.fields["summary"] = "Edited in Jira";
    store.staleOnce = true;
    expect(await arrive()).toEqual({ kind: "defer", ms: 5_000, note: "bug_changed" });
    expect(store.bugs.get("41")!.bug.title).toBe("TRIAL-JIRA-Checkout button does nothing");
    expect(await arrive()).toEqual({ kind: "done", note: "synced" });
    expect(store.bugs.get("41")!.bug.title).toBe("Edited in Jira");
  });

  it("takes nothing from Jira for a bug in the Trash, and marks a deleted issue", async () => {
    const a = await linked();
    a.issue.fields["summary"] = "Edited in Jira";
    a.store.put(bug(), true);
    expect(await a.arrive()).toEqual({ kind: "done", note: "trashed" });
    expect(a.store.inbound).toEqual([]);

    const b = await linked();
    b.jira.issues.clear();
    expect(await b.arrive()).toEqual({ kind: "done", note: "remote_missing" });
    expect(b.store.links.get("41")!.state).toBe("remote_missing");
  });
});

describe("an unlinked pair", () => {
  it("stays unlinked: BugFlow changes create no new issue and Jira events import no second bug", async () => {
    const store = new MemoryStore();
    const jira = new FakeJira();
    store.put(bug());
    await syncBug(row(), MAPPING, store, jira);
    store.links.get("41")!.state = "disabled";
    jira.calls = [];
    store.put(bug({ title: "TRIAL-JIRA-Changed after unlinking" }));
    expect(await syncBug(row(), MAPPING, store, jira)).toEqual({ kind: "done", note: "unlinked" });
    jira.raw("20001").fields["summary"] = "Changed in Jira after unlinking";
    expect(await syncIssue(event(), DIRECTORY, store, () => jira)).toEqual({
      kind: "done",
      note: "unlinked",
    });
    expect(jira.calls).toEqual([]);
    expect(jira.issues.size).toBe(1);
    expect(store.imported).toEqual([]);
    expect(store.bugs.get("41")!.bug.title).toBe("TRIAL-JIRA-Changed after unlinking");
  });
});

describe("sprints across both tools", () => {
  const SPRINT = "customfield_10020";
  const POINTS = "customfield_10016";
  const config = { ...CONFIG, sprintField: SPRINT, estimateField: POINTS };
  const mapping = { ...MAPPING, config };
  const directory = {
    ...DIRECTORY,
    mappingById: async () => mapping,
    mappingForProject: async () => mapping,
  };
  const jiraSprint = (id: number, state: string, name = `Sprint ${id}`) => ({
    id,
    name,
    state,
    boardId: 3,
    startDate: "2026-11-02T04:00:00.000Z",
    endDate: "2026-11-16T04:00:00.000Z",
    goal: "",
  });
  function sprintWorld(b = bug()) {
    const store = new MemoryStore();
    const jira = new FakeJira(config);
    store.put(b);
    const arrive = (over = {}) => syncIssue(event(over), directory, store, () => jira);
    const send = () => syncBug(row(), mapping, store, jira);
    return { store, jira, arrive, send };
  }

  it("mirrors a Jira sprint and puts the bug in it when Jira does", async () => {
    const { store, jira, arrive, send } = sprintWorld();
    await send();
    const issue = jira.raw("20001");
    issue.fields[SPRINT] = [jiraSprint(6, "closed"), jiraSprint(7, "active")];
    issue.fields[POINTS] = 3;
    expect(await arrive()).toEqual({ kind: "done", note: "synced" });
    expect([...store.mirrors.keys()]).toEqual(["7"]); // the finished sprint is history, not brought in
    expect(store.bugs.get("41")!.bug).toMatchObject({ sprintJiraId: "7", estimate: 3 });
    expect(store.inbound.at(-1)!.change).toMatchObject({
      sprint: { to: "sprint-7" },
      edit: { estimate: 3 },
    });
  });

  it("tells Jira when BugFlow moves the bug into a mirrored sprint, or out, and sends the estimate", async () => {
    const { store, jira, send } = sprintWorld();
    await send();
    const issue = jira.raw("20001");
    store.put(bug({ sprintJiraId: "7", estimate: 8 }));
    await send();
    expect(jira.lastUpdate).toMatchObject({ [SPRINT]: 7, [POINTS]: 8 }); // the Sprint field takes the number
    expect(issue.fields[SPRINT]).toMatchObject([{ id: 7 }]);
    store.put(bug({ sprintJiraId: null, estimate: 8 }));
    await send();
    expect(issue.fields[SPRINT]).toBeNull();
  });

  it("leaves a bug that sits in a BugFlow-only sprint where it is, as a question for the Admin", async () => {
    const { store, jira, arrive, send } = sprintWorld();
    await send();
    store.elsewhere = true;
    jira.raw("20001").fields[SPRINT] = [jiraSprint(7, "active")];
    expect(await arrive()).toEqual({ kind: "conflict" });
    expect(store.saved.at(-1)!.conflicts).toMatchObject([
      { field: "sprint", reason: "in_another_sprint" },
    ]);
    expect(store.bugs.get("41")!.bug.sprintJiraId).toBeNull();
  });

  it("does not send sprint or estimate when the mapping does not synchronize them", async () => {
    const store = new MemoryStore();
    const jira = new FakeJira();
    store.put(bug({ sprintJiraId: "7", estimate: 8 }));
    await syncBug(row(), MAPPING, store, jira);
    expect(
      Object.keys(jira.raw("20001").fields).filter((k) => k.startsWith("customfield_")),
    ).toEqual([]);
  });
});
