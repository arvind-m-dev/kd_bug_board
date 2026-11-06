import { describe, expect, it } from "vitest";
import { buildDescription, readDescription } from "@/lib/jira/adf";
import { JiraApiError, JiraAuthError } from "@/lib/jira/errors";
import { MappingError } from "@/lib/jira/mapping";
import {
  CREATE_SETTLE_MS,
  MAX_ATTEMPTS,
  type OutboxQueue,
  type OutboxRow,
  PAUSED_RECHECK_MS,
  SyncProblem,
  runOutbox,
  settle,
  syncBug,
} from "@/lib/jira/processor";
import { FakeJira, MAPPING, MemoryStore, bug, row } from "./jira-fixtures";

function world(b = bug()) {
  const store = new MemoryStore();
  const jira = new FakeJira();
  store.put(b);
  const run = (at = store.clock) => syncBug(row(), MAPPING, store, jira, () => at);
  return { store, jira, run };
}
/** A bug that already exists in Jira and is in sync. */
async function synced(b = bug()) {
  const w = world(b);
  await w.run();
  w.jira.calls = [];
  return { ...w, issue: w.jira.raw("20001") };
}
const description = (issue: { fields: Record<string, unknown> }) =>
  readDescription(issue.fields["description"]);

describe("BugFlow → Jira: create", () => {
  it("creates one issue, links it, and a repeat changes nothing", async () => {
    const { store, jira, run } = world();
    expect(await run()).toEqual({ kind: "done", note: "synced" });
    expect(jira.issues.size).toBe(1);
    expect(store.created).toEqual([{ bugId: "41", issue: { id: "20001", key: "BFT-1" } }]);
    expect(store.links.get("41")).toMatchObject({ state: "linked", jiraIssueId: "20001" });
    expect(jira.raw("20001").fields["summary"]).toBe("TRIAL-JIRA-Checkout button does nothing");

    jira.calls = [];
    expect(await run()).toEqual({ kind: "done", note: "synced" });
    expect(jira.calls).toEqual(["getIssue"]); // one read, no write
    expect(jira.issues.size).toBe(1);
  });

  it("moves a bug that is already past New to its Jira status right after creating it", async () => {
    const { jira, store, run } = world(bug({ status: "IN_PROGRESS" }));
    await run();
    expect(jira.raw("20001").fields["status"]).toEqual({ id: "2" });
    expect(store.saved.at(-1)?.exported).toEqual(["status"]);
  });

  it("adopts the issue when the reply to the create request was lost, instead of creating a second", async () => {
    const { store, jira, run } = world();
    jira.loseCreateReply = true;
    await expect(run()).rejects.toBeInstanceOf(JiraApiError);
    expect(jira.issues.size).toBe(1); // Jira has it; BugFlow does not know its id
    expect(store.links.get("41")).toMatchObject({ state: "creating", jiraIssueId: null });

    jira.loseCreateReply = false;
    // too soon: Jira's search may not show the issue yet, so nothing is sent
    expect(await run(store.clock + 5_000)).toEqual({
      kind: "defer",
      ms: CREATE_SETTLE_MS - 5_000,
      note: "create_settling",
    });
    expect(jira.count("createIssue")).toBe(1);

    store.clock += CREATE_SETTLE_MS;
    expect(await run()).toEqual({ kind: "done", note: "synced" });
    expect(jira.count("createIssue")).toBe(1);
    expect(jira.count("findByLabel")).toBe(1);
    expect(jira.issues.size).toBe(1);
    expect(store.links.get("41")).toMatchObject({ state: "linked", jiraIssueId: "20001" });
  });

  it("creates after a failed attempt that never reached Jira", async () => {
    const { store, jira, run } = world();
    jira.fail.createIssue = [new JiraApiError("transient", 503)];
    await expect(run()).rejects.toBeInstanceOf(JiraApiError);
    expect(jira.issues.size).toBe(0);
    store.clock += CREATE_SETTLE_MS;
    await run();
    expect(jira.issues.size).toBe(1);
  });

  it("lets only one worker take over a retried create", async () => {
    const { store, jira, run } = world();
    jira.fail.createIssue = [new JiraApiError("transient", 503)];
    await expect(run()).rejects.toBeInstanceOf(JiraApiError);
    store.clock += CREATE_SETTLE_MS;
    const stale = (await store.loadLink("41"))!;
    await store.touchCreate(stale); // another worker took the row first
    const original = store.loadLink.bind(store);
    store.loadLink = async () => stale;
    expect(await run()).toEqual({ kind: "defer", ms: CREATE_SETTLE_MS, note: "create_busy" });
    store.loadLink = original;
    expect(jira.issues.size).toBe(0);
  });

  it("stops when two issues carry the same label", async () => {
    const { store, jira, run } = world();
    jira.loseCreateReply = true;
    await run().catch(() => undefined);
    jira.issues.set("29999", { ...structuredClone(jira.raw("20001")), id: "29999", key: "BFT-99" });
    store.clock += CREATE_SETTLE_MS;
    await expect(run()).rejects.toBeInstanceOf(SyncProblem);
  });
});

describe("BugFlow → Jira: update", () => {
  it("sends only what changed in BugFlow", async () => {
    const { store, jira, run } = await synced();
    store.put(
      bug({ title: "TRIAL-JIRA-Pay button dead", steps: ["Open the cart", "Click Pay", "Wait"] }),
    );
    await run();
    expect(Object.keys(jira.lastUpdate!).sort()).toEqual(["description", "summary"]);
    expect(jira.calls).toEqual(["getIssue", "updateIssue", "getIssue"]);
    expect(store.saved.at(-1)).toMatchObject({
      state: "linked",
      exported: ["title", "steps"],
      conflicts: [],
    });
  });

  it("merges when each side changed a different field, without overwriting Jira's change", async () => {
    const { store, jira, run, issue } = await synced();
    const parts = description(issue);
    issue.fields["description"] = buildDescription({ ...parts, expected: "Edited in Jira." });
    store.put(bug({ actual: "Edited in BugFlow." }));
    expect(await run()).toEqual({ kind: "done", note: "synced" });
    expect(description(issue)).toMatchObject({
      expected: "Edited in Jira.",
      actual: "Edited in BugFlow.",
    });
    // and Jira's change went into BugFlow in the same pass
    expect(store.bugs.get("41")!.bug).toMatchObject({
      expected: "Edited in Jira.",
      actual: "Edited in BugFlow.",
    });
    expect(store.links.get("41")!.baseRemote!.expected).toBe("Edited in Jira.");
  });

  it("records a conflict when both sides changed the same field, and still sends the rest", async () => {
    const { store, jira, run, issue } = await synced();
    issue.fields["summary"] = "Jira title";
    store.put(bug({ title: "BugFlow title", module: "Payments" }));
    expect(await run()).toEqual({ kind: "conflict" });
    expect(issue.fields["summary"]).toBe("Jira title"); // not overwritten
    expect(description(issue).details).toContain("Module: Payments");
    const saved = store.saved.at(-1)!;
    expect(saved.state).toBe("conflict");
    expect(saved.conflicts).toEqual([
      {
        field: "title",
        reason: "both_changed",
        base: "TRIAL-JIRA-Checkout button does nothing",
        local: "BugFlow title",
        remote: "Jira title",
      },
    ]);
    expect(saved.exported).toEqual(["module"]);
    // unchanged afterwards: the same conflict, no write
    jira.calls = [];
    expect(await run()).toEqual({ kind: "conflict" });
    expect(jira.calls).toEqual(["getIssue"]);
  });

  it("acknowledges the same change made on both sides without writing", async () => {
    const { store, jira, run, issue } = await synced();
    issue.fields["summary"] = "Same title";
    store.put(bug({ title: "Same title" }));
    expect(await run()).toEqual({ kind: "done", note: "synced" });
    expect(jira.count("updateIssue")).toBe(0);
    expect(store.links.get("41")!.baseLocal!.title).toBe("Same title");
  });

  it("does not rewrite a description that holds Jira formatting", async () => {
    const { store, jira, run, issue } = await synced();
    const doc = issue.fields["description"] as { content: { content: { marks?: unknown }[] }[] };
    doc.content[0]!.content[0]!.marks = [{ type: "strong" }];
    store.put(bug({ description: "Rewritten in BugFlow." }));
    expect(await run()).toEqual({ kind: "conflict" });
    expect(jira.count("updateIssue")).toBe(0);
    expect(store.saved.at(-1)!.conflicts[0]).toMatchObject({
      field: "description",
      reason: "jira_formatting",
    });
  });

  it("keeps a one-way field: Jira's priority edit is not a conflict and BugFlow's next change wins", async () => {
    const { store, jira, run, issue } = await synced();
    issue.fields["priority"] = { id: "5" };
    expect(await run()).toEqual({ kind: "done", note: "synced" });
    expect(jira.count("updateIssue")).toBe(0);
    store.put(bug({ priority: "P0" }));
    await run();
    expect(issue.fields["priority"]).toEqual({ id: "1" });
  });

  it("unassigns in Jira when the BugFlow assignee has no Jira account, and names them as text", async () => {
    const { store, run, issue } = await synced(
      bug({ assigneeAccountId: "acc-ravi", assigneeNames: ["Ravi"] }),
    );
    expect(issue.fields["assignee"]).toEqual({ accountId: "acc-ravi" });
    store.put(bug({ assigneeAccountId: null, assigneeNames: ["Meera"] }));
    await run();
    expect(issue.fields["assignee"]).toBeNull();
    expect(description(issue).details).toContain("Assigned to: Meera");
  });
});

describe("BugFlow → Jira: status", () => {
  it("uses the one transition Jira offers and confirms the result", async () => {
    const { store, jira, run, issue } = await synced();
    store.put(bug({ status: "RECHECK" }));
    expect(await run()).toEqual({ kind: "done", note: "synced" });
    expect(jira.calls).toEqual(["getIssue", "transitions", "transition", "getIssue"]);
    expect(issue.fields["status"]).toEqual({ id: "3" });
    expect(jira.count("updateIssue")).toBe(0); // never as a field
  });

  it("does nothing in Jira for a move between BugFlow statuses that share a Jira status", async () => {
    const { store, jira, run } = await synced();
    store.put(bug({ status: "VALIDATED" }));
    await run();
    expect(jira.calls).toEqual(["getIssue"]);
  });

  it("records a conflict when Jira offers no transition, or more than one, to the target", async () => {
    const none = await synced();
    none.jira.workflow = { "1": [{ id: "t2", to: "2" }] };
    none.store.put(bug({ status: "RESOLVED" }));
    expect(await none.run()).toEqual({ kind: "conflict" });
    expect(none.store.saved.at(-1)!.conflicts[0]).toMatchObject({
      field: "status",
      reason: "no_transition",
      local: "4",
      remote: "1",
    });
    expect(none.jira.count("transition")).toBe(0);

    const two = await synced();
    two.jira.workflow = {
      "1": [
        { id: "t4", to: "4" },
        { id: "t4b", to: "4" },
      ],
    };
    two.store.put(bug({ status: "RESOLVED" }));
    expect(await two.run()).toEqual({ kind: "conflict" });
    expect(two.store.saved.at(-1)!.conflicts[0]).toMatchObject({ reason: "ambiguous_transition" });
    expect(two.jira.count("transition")).toBe(0);
  });

  it("does not advance the snapshot when Jira did not land on the target status", async () => {
    const { store, jira, run } = await synced();
    jira.workflow = { "1": [{ id: "x2", to: "3" }] }; // says it goes to 3, lands on 2
    store.put(bug({ status: "RECHECK" }));
    expect(await run()).toEqual({ kind: "conflict" });
    expect(store.saved.at(-1)!.conflicts[0]).toMatchObject({
      reason: "transition_not_applied",
      remote: "2",
    });
    expect(store.links.get("41")!.baseLocal!.status).toBe("1");
  });
});

describe("BugFlow → Jira: records that are gone or moved", () => {
  it("never deletes in Jira for a trashed bug, and never sends one that was not sent before", async () => {
    const a = await synced();
    a.store.put(bug(), true);
    expect(await a.run()).toEqual({ kind: "done", note: "trashed" });
    expect(a.jira.calls).toEqual([]);
    expect(a.store.links.get("41")!.state).toBe("local_trashed");
    // restored: syncing resumes
    a.store.put(bug({ title: "TRIAL-JIRA-Restored" }));
    await a.run();
    expect(a.store.links.get("41")!.state).toBe("linked");
    expect(a.issue.fields["summary"]).toBe("TRIAL-JIRA-Restored");

    const b = world();
    b.store.put(bug(), true);
    expect(await b.run()).toEqual({ kind: "done", note: "trashed" });
    expect(b.jira.calls).toEqual([]);
  });

  it("marks the link when the Jira issue is gone and stops there", async () => {
    const { store, jira, run } = await synced();
    jira.issues.clear();
    expect(await run()).toEqual({ kind: "done", note: "remote_missing" });
    expect(store.links.get("41")!.state).toBe("remote_missing");
    jira.calls = [];
    expect(await run()).toEqual({ kind: "done", note: "remote_missing" });
    expect(jira.calls).toEqual([]);
  });

  it("stops syncing an issue that was moved to another Jira project", async () => {
    const { store, jira, run, issue } = await synced();
    issue.fields["project"] = { id: "10099" };
    store.put(bug({ title: "TRIAL-JIRA-Should not be sent" }));
    expect(await run()).toEqual({ kind: "conflict" });
    expect(jira.count("updateIssue")).toBe(0);
    expect(store.saved.at(-1)!.conflicts[0]).toMatchObject({
      field: "link",
      reason: "moved_out_of_project",
    });
  });

  it("skips a row whose bug no longer exists as a bug", async () => {
    const { jira } = world();
    expect(await syncBug(row({ bugId: "999" }), MAPPING, new MemoryStore(), jira)).toEqual({
      kind: "done",
      note: "not_a_bug",
    });
  });
});

describe("failed rows", () => {
  const fixed = () => 0.5;
  it("retries what can heal, with a growing delay, and gives up after the last attempt", () => {
    expect(settle(new JiraApiError("transient", 503), 0, fixed)).toMatchObject({
      state: "retry",
      delayMs: 30_000,
      counts: true,
      stop: false,
    });
    expect(settle(new JiraApiError("transient", 503), 3, fixed).delayMs).toBe(240_000);
    expect(settle(new JiraApiError("conflict", 409), 20, fixed).state).toBe("dead");
    expect(settle(new JiraApiError("transient", 0), MAX_ATTEMPTS - 1, fixed).state).toBe("dead");
    expect(settle(new Error("database hiccup"), 0, fixed)).toMatchObject({
      state: "retry",
      counts: true,
    });
  });

  it("waits at least as long as Jira asks and stops the run on a rate limit", () => {
    expect(settle(new JiraApiError("rate_limited", 429, 120_000), 0, fixed)).toMatchObject({
      state: "retry",
      delayMs: 120_000,
      counts: false,
      stop: true,
    });
  });

  it("does not spend attempts while Jira needs a new sign-in", () => {
    for (const error of [
      new JiraAuthError("reauthorization_required"),
      new JiraApiError("auth", 401),
    ])
      expect(settle(error, 5, fixed)).toMatchObject({ state: "retry", counts: false, stop: true });
  });

  it("does not retry what a person has to fix", () => {
    for (const error of [
      new JiraApiError("validation", 400),
      new JiraApiError("forbidden", 403),
      new MappingError("BugFlow status NEW has no Jira status."),
      new SyncProblem("More than one Jira issue carries this bug's label."),
    ])
      expect(settle(error, 0, fixed)).toMatchObject({ state: "dead", stop: false });
  });

  it("never puts a database or program error text in front of the Admin", () => {
    expect(settle(new Error('relation "secret_table" does not exist'), 0, fixed).error).not.toMatch(
      /secret_table/,
    );
  });
});

describe("one bounded run", () => {
  function queue(rows: OutboxRow[], live = true) {
    const log: string[] = [];
    const q: OutboxQueue = {
      claim: async () => rows,
      mapping: async () => ({ ...MAPPING, live }),
      finish: async (r, _o, state) => void log.push(`${r.id}:${state}`),
      later: async (r, _o, ms, counts) => void log.push(`${r.id}:later:${ms}:${counts}`),
    };
    return { q, log };
  }

  it("processes rows and reports what happened", async () => {
    const { store, jira } = world();
    store.put(bug({ id: "42", code: "BF-42" }));
    const { q, log } = queue([row(), row({ id: "row-2", bugId: "42" })]);
    const summary = await runOutbox({ queue: q, store, jira: () => jira, owner: "w1" });
    expect(summary).toEqual({ claimed: 2, done: 2, conflict: 0, retry: 0, dead: 0, waiting: 0 });
    expect(log).toEqual(["row-1:done", "row-2:done"]);
    expect(jira.issues.size).toBe(2);
  });

  it("stops at a rate limit and hands the untouched rows straight back", async () => {
    const { store, jira } = world();
    store.put(bug({ id: "42", code: "BF-42" }));
    jira.fail.createIssue = [new JiraApiError("rate_limited", 429, 60_000)];
    const { q, log } = queue([row(), row({ id: "row-2", bugId: "42" })]);
    const summary = await runOutbox({ queue: q, store, jira: () => jira, owner: "w1" });
    expect(summary).toMatchObject({ retry: 1, waiting: 1, done: 0 });
    expect(log[0]).toMatch(/^row-1:later:\d+:false$/);
    expect(log[1]).toBe("row-2:later:0:false");
    expect(jira.count("createIssue")).toBe(1);
  });

  it("leaves work waiting while the mapping or connection is paused", async () => {
    const { store, jira } = world();
    const { q, log } = queue([row()], false);
    expect(await runOutbox({ queue: q, store, jira: () => jira, owner: "w1" })).toMatchObject({
      waiting: 1,
    });
    expect(log).toEqual([`row-1:later:${PAUSED_RECHECK_MS}:false`]);
    expect(jira.calls).toEqual([]);
  });

  it("starts no new row after its time budget", async () => {
    const { store, jira } = world();
    const { q, log } = queue([row(), row({ id: "row-2" })]);
    let t = 0;
    await runOutbox({
      queue: q,
      store,
      jira: () => jira,
      owner: "w1",
      budgetMs: 10,
      now: () => (t += 6),
    });
    expect(log).toEqual(["row-1:done", "row-2:later:0:false"]);
  });
});
