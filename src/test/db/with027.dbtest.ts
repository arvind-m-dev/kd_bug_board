import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/neon.server", async () => (await import("./local")).neon);
vi.mock("@/lib/portal-access.server", async () => (await import("./local")).session);
import { reportBug, bugDetail, deleteBugReport } from "@/lib/bug-workflow.server";
import { formatBugCode } from "@/lib/bug-workflow";
import { readDescription } from "@/lib/jira/adf";
import { JiraApiError } from "@/lib/jira/errors";
import { neonQueue, neonStore } from "@/lib/jira/outbox.server";
import { runOutbox } from "@/lib/jira/processor";
import { JIRA_SYNC_USER_ID } from "@/lib/jira/types";
import { restoreTrashItem } from "@/lib/trash.server";
import { CONFIG, FakeJira } from "@/test/jira-fixtures";
import { admin, change, create, edit, report } from "./common";
import { MAP, pool, q, seed } from "./local";

const jira = new FakeJira();
const run = () =>
  runOutbox({ queue: neonQueue, store: neonStore, jira: () => jira, owner: crypto.randomUUID() });
const outbox = (id: string, where = "true") =>
  q(
    `select id,op,state,attempts,last_error,(next_attempt_at>now()+interval '5 seconds') as later from bugflow.jira_outbox where bug_id=$1 and ${where} order by created_at`,
    [id],
  );
const waiting = (id: string) => outbox(id, "state in ('pending','retry')");
const link = async (id: string) =>
  (await q("select * from bugflow.jira_issue_links where bug_id=$1", [id]))[0]!;
const activity = (id: string, action: string) =>
  q(
    "select actor_id,detail from bugflow.activity where bug_id=$1 and action=$2 order by created_at",
    [id, action],
  );
const dueNow = (id: string) =>
  q(
    "update bugflow.jira_outbox set next_attempt_at=now() where bug_id=$1 and state in ('pending','retry')",
    [id],
  );
const settleCreate = (id: string) =>
  q("update bugflow.jira_issue_links set updated_at=now()-interval '2 minutes' where bug_id=$1", [
    id,
  ]);
const details = (issueId: string) =>
  readDescription(jira.raw(issueId).fields["description"]).details;

beforeAll(() => seed(true, CONFIG));
afterAll(() => pool.end());

describe("one bug, start to finish", () => {
  let id = "";
  let issueId = "";

  it("reporting writes one create entry in the same statement; a replayed request adds nothing", async () => {
    const data = report();
    id = (await reportBug(admin, data)).id;
    expect(await outbox(id)).toMatchObject([{ op: "create", state: "pending", attempts: 0 }]);
    expect((await reportBug(admin, data)).id).toBe(id);
    expect(await outbox(id)).toHaveLength(1);
  });

  it("a run creates the Jira issue once, links it by issue id, and records it", async () => {
    expect(await run()).toMatchObject({ claimed: 1, done: 1 });
    expect(jira.issues.size).toBe(1);
    const l = await link(id);
    issueId = l["jira_issue_id"];
    expect(l).toMatchObject({ state: "linked", jira_issue_key: "BFT-1", origin: "bugflow" });
    expect(l["bugflow_snapshot"]).toMatchObject({
      title: "TRIAL-JIRA-Checkout button does nothing",
      status: "1",
      priority: "2",
    });
    expect(l["jira_snapshot"]).toEqual(l["bugflow_snapshot"]);
    expect(l["bugflow_version"]).not.toBeNull();
    expect(l["jira_updated_at"]).not.toBeNull();
    expect(await activity(id, "jira.created")).toMatchObject([
      { actor_id: JIRA_SYNC_USER_ID, detail: { issueKey: "BFT-1" } },
    ]);
    expect(await outbox(id)).toMatchObject([{ state: "done", attempts: 1 }]);
    expect(details(issueId)).toContain(
      `Bug Board: ${formatBugCode(id, "BF")} /admin/bugs?bug=${id}`,
    );
    expect(await run()).toMatchObject({ claimed: 0 });
  });

  it("several changes before a run wait as one entry; a comment adds none", async () => {
    await change(id, { action: "status", status: "VALIDATING" });
    await change(id, { action: "priority", priority: "P0" });
    await edit(id, { title: "TRIAL-JIRA-Pay button dead" });
    expect(await waiting(id)).toMatchObject([{ op: "sync", state: "pending" }]);
    jira.calls = [];
    expect(await run()).toMatchObject({ claimed: 1, done: 1 });
    expect(jira.raw(issueId).fields).toMatchObject({
      summary: "TRIAL-JIRA-Pay button dead",
      priority: { id: "1" },
      status: { id: "1" },
    });
    expect(jira.count("transition")).toBe(0); // New → Validating is the same Jira status
    expect((await activity(id, "jira.exported")).at(-1)!["detail"]).toEqual({
      issueKey: "BFT-1",
      fields: ["title", "priority"],
    });

    await change(id, { action: "comment", notes: "TRIAL-JIRA comment" });
    expect(await waiting(id)).toEqual([]);
  });

  it("sync bookkeeping is not shown as the bug's last change", async () => {
    const { bug, events } = await bugDetail(admin, id);
    expect(bug.lastChange?.action).toBe("bug.comment");
    expect(events.some((e) => e.action === "jira.exported")).toBe(true); // Admin history keeps it
  });

  it("a same-field edit on both sides is stored as one conflict and closes when they agree", async () => {
    jira.raw(issueId).fields["summary"] = "Jira title";
    await edit(id, { title: "BugFlow title" });
    expect(await run()).toMatchObject({ conflict: 1 });
    const open = () =>
      q(
        "select field,reason,local_value,remote_value,state,resolution from bugflow.jira_conflicts where link_id=$1 order by created_at",
        [linkId],
      );
    const linkId = (await link(id))["id"];
    expect(await open()).toMatchObject([
      {
        field: "title",
        reason: "both_changed",
        local_value: "BugFlow title",
        remote_value: "Jira title",
        state: "open",
      },
    ]);
    expect((await link(id))["state"]).toBe("conflict");
    expect((await outbox(id)).at(-1)).toMatchObject({ state: "conflict" });
    expect(jira.raw(issueId).fields["summary"]).toBe("Jira title");

    await edit(id, { module: "Payments" });
    expect(await run()).toMatchObject({ conflict: 1 });
    expect(await open()).toHaveLength(1); // still one
    expect(details(issueId)).toContain("Module: Payments"); // the other field went through

    jira.raw(issueId).fields["summary"] = "BugFlow title";
    await edit(id, { environment: "Production" });
    expect(await run()).toMatchObject({ done: 1 });
    expect(await open()).toMatchObject([{ state: "resolved", resolution: "merged" }]);
    expect((await link(id))["state"]).toBe("linked");
  });

  it("Trash marks the link and deletes nothing in Jira; restore resumes", async () => {
    await deleteBugReport(id, "TRIAL-JIRA cleanup");
    expect(await waiting(id)).toHaveLength(1);
    await run();
    expect((await link(id))["state"]).toBe("local_trashed");
    expect(jira.issues.has(issueId)).toBe(true);
    await restoreTrashItem({ kind: "bug", id });
    expect(await waiting(id)).toHaveLength(1);
    await run();
    expect((await link(id))["state"]).toBe("linked");
  });

  it("a status change moves Jira through a transition", async () => {
    await change(id, { action: "status", status: "NOT_A_BUG" });
    jira.calls = [];
    expect(await run()).toMatchObject({ done: 1 });
    expect(jira.count("transition")).toBe(1);
    expect(jira.raw(issueId).fields["status"]).toEqual({ id: "4" });
    expect((await link(id))["jira_snapshot"]["status"]).toBe("4");
  });
});

describe("the queue", () => {
  it("gives a row to one worker only, and keeps a bug with one worker", async () => {
    const id = await create();
    const [a, b] = await Promise.all([
      neonQueue.claim(crypto.randomUUID(), 10),
      neonQueue.claim(crypto.randomUUID(), 10),
    ]);
    expect(a.length + b.length).toBe(1);
    await change(id, { action: "priority", priority: "P1" }); // arrives while the first entry is being worked on
    expect(await waiting(id)).toHaveLength(1);
    expect(await neonQueue.claim(crypto.randomUUID(), 10)).toEqual([]);

    // the worker died: its lease runs out and the work is taken again, still one entry at a time for the bug
    await q(
      "update bugflow.jira_outbox set lease_until=now()-interval '1 second' where bug_id=$1 and state='processing'",
      [id],
    );
    const owner = crypto.randomUUID();
    const again = await neonQueue.claim(owner, 10);
    expect(again).toHaveLength(1);
    expect(await neonQueue.claim(crypto.randomUUID(), 10)).toEqual([]);

    // only the lease holder can settle a row
    await neonQueue.later(again[0]!, crypto.randomUUID(), 60_000, true, "not mine");
    expect(await outbox(id, "state='processing'")).toHaveLength(1);
    await neonQueue.later(
      again[0]!,
      owner,
      60_000,
      true,
      "Jira could not be reached. It will be tried again.",
    );
    expect(await outbox(id, `id='${again[0]!.id}'`)).toMatchObject([
      { state: "retry", attempts: 1, later: true },
    ]);
    await q("update bugflow.jira_outbox set state='done' where bug_id=$1", [id]);
  });

  it("closes a retried entry when a newer one for the same bug is already waiting, and passes the delay on", async () => {
    const id = await create();
    await q("update bugflow.jira_outbox set op='sync',dedup_key='t:'||id where bug_id=$1", [id]);
    const owner = crypto.randomUUID();
    const [row] = await neonQueue.claim(owner, 10);
    await change(id, { action: "priority", priority: "P1" });
    await neonQueue.later(row!, owner, 120_000, false, null);
    const rows = await outbox(id);
    expect(rows).toMatchObject([{ state: "done" }, { state: "pending", later: true }]);
    await q("update bugflow.jira_outbox set state='done' where bug_id=$1", [id]);
  });
});

describe("failures against the real queue", () => {
  it("a rate limit waits without using an attempt; a create that may have happened is not repeated", async () => {
    const before = jira.issues.size;
    const id = await create();
    jira.fail.createIssue = [new JiraApiError("rate_limited", 429, 60_000)];
    expect(await run()).toMatchObject({ retry: 1 });
    expect(await waiting(id)).toMatchObject([
      {
        state: "retry",
        attempts: 0,
        later: true,
        last_error: "Jira is limiting requests right now. It will be tried again shortly.",
      },
    ]);
    expect((await link(id))["state"]).toBe("creating");

    // due again straight away: still too soon after the last attempt, so nothing is sent to Jira
    await dueNow(id);
    jira.calls = [];
    expect(await run()).toMatchObject({ waiting: 1 });
    expect(jira.calls).toEqual([]);
    expect(await waiting(id)).toMatchObject([{ later: true, attempts: 0 }]);

    await settleCreate(id);
    await dueNow(id);
    expect(await run()).toMatchObject({ done: 1 });
    expect(jira.issues.size).toBe(before + 1);
    expect(jira.calls.slice(0, 2)).toEqual(["findByLabel", "createIssue"]);
  });

  it("a lost create reply ends with one issue, adopted by its label", async () => {
    const before = jira.issues.size;
    const id = await create();
    jira.loseCreateReply = true;
    expect(await run()).toMatchObject({ retry: 1 });
    jira.loseCreateReply = false;
    expect(jira.issues.size).toBe(before + 1);
    expect(await waiting(id)).toMatchObject([{ state: "retry", attempts: 1 }]);
    await settleCreate(id);
    await dueNow(id);
    expect(await run()).toMatchObject({ done: 1 });
    expect(jira.issues.size).toBe(before + 1);
    expect(jira.count("createIssue")).toBeGreaterThan(0);
    const l = await link(id);
    expect(l["state"]).toBe("linked");
    expect((jira.raw(l["jira_issue_id"]).fields["labels"] as string[])[0]).toMatch(
      new RegExp(`^bf-${id}-[0-9a-f]{8}$`),
    );
    expect(await activity(id, "jira.created")).toHaveLength(1);
  });

  it("a request Jira rejects is parked with a safe message, not retried", async () => {
    const id = await create();
    await run();
    await edit(id, { title: "TRIAL-JIRA-Rejected edit" });
    jira.fail.updateIssue = [new JiraApiError("validation", 400)];
    expect(await run()).toMatchObject({ dead: 1 });
    expect((await outbox(id)).at(-1)).toMatchObject({
      state: "dead",
      last_error: "Jira rejected the request. The mapping needs checking.",
    });
    // nothing was agreed, so the next change sends both
    await edit(id, { module: "Payments" });
    await run();
    const l = await link(id);
    expect(jira.raw(l["jira_issue_id"]).fields["summary"]).toBe("TRIAL-JIRA-Rejected edit");
  });

  it("a paused mapping still collects changes and sends them after resuming", async () => {
    const id = await create();
    await run();
    await q("update bugflow.jira_project_mappings set state='paused' where id=$1", [MAP]);
    await edit(id, { title: "TRIAL-JIRA-Changed while paused" });
    expect(await waiting(id)).toHaveLength(1);
    jira.calls = [];
    expect(await run()).toMatchObject({ waiting: 1 });
    expect(jira.calls).toEqual([]);
    await q("update bugflow.jira_project_mappings set state='active' where id=$1", [MAP]);
    await dueNow(id);
    expect(await run()).toMatchObject({ done: 1 });
    expect(jira.raw((await link(id))["jira_issue_id"]).fields["summary"]).toBe(
      "TRIAL-JIRA-Changed while paused",
    );
  });

  it("left nothing half-done", async () => {
    expect(
      await q(
        "select bug_id,op,state from bugflow.jira_outbox where state in ('pending','retry','processing')",
      ),
    ).toEqual([]);
  });
});
