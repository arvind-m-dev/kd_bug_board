import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("@/lib/neon.server", async () => (await import("./local")).neon);
vi.mock("@/lib/portal-access.server", async () => (await import("./local")).session);
import { deleteBugReport } from "@/lib/bug-workflow.server";
import { buildDescription, readDescription } from "@/lib/jira/adf";
import { neonDirectory, neonInbox, persistEvent } from "@/lib/jira/inbox.server";
import { neonQueue, neonStore } from "@/lib/jira/outbox.server";
import { runInbox, runOutbox } from "@/lib/jira/processor";
import { JIRA_SYNC_USER_ID } from "@/lib/jira/types";
import { CONFIG, FakeJira } from "@/test/jira-fixtures";
import { change, create, edit } from "./common";
import { CONN, MAP, PROJECT, pool, q, seed } from "./local";

const RAVI = "aaaaaaaa-0000-4000-8000-0000000000b2";
const MEERA = "aaaaaaaa-0000-4000-8000-0000000000b3";
const jira = new FakeJira();
const deps = { store: neonStore, jira: () => jira };
const inbox = () =>
  runInbox({ queue: neonInbox, directory: neonDirectory, owner: crypto.randomUUID(), ...deps });
const outbox = () => runOutbox({ queue: neonQueue, owner: crypto.randomUUID(), ...deps });
let n = 0;
const arrive = (issueId: string, dedupKey = `wh-${++n}`) =>
  persistEvent(CONN, {
    dedupKey,
    eventType: "jira:issue_updated",
    source: "webhook",
    issueId,
    issueKey: null,
    projectId: "10000",
    eventAt: null,
    actor: { accountId: "acc-jordan", displayName: "Jordan (Jira)" },
  });
const bugOf = async (issueId: string) =>
  (
    await q(
      "select b.*,l.state as link_state,l.origin,l.id as link_id,l.overrides from bugflow.jira_issue_links l join bugflow.bugs b on b.id=l.bug_id where l.jira_issue_id=$1",
      [issueId],
    )
  )[0]!;
const history = async (bugId: string) =>
  (
    await q(
      "select previous_status,new_status,actor_id from bugflow.status_history where bug_id=$1 order by created_at",
      [bugId],
    )
  ).map((r) => `${r["previous_status"] ?? ""}>${r["new_status"]}`);
const activity = (bugId: string, action: string) =>
  q(
    "select actor_id,detail from bugflow.activity where bug_id=$1 and action=$2 order by created_at",
    [bugId, action],
  );
const conflicts = (linkId: string) =>
  q("select field,reason,state from bugflow.jira_conflicts where link_id=$1 order by created_at", [
    linkId,
  ]);

beforeAll(async () => {
  await seed(true, CONFIG);
  for (const [id, name, account, onProject] of [
    [RAVI, "Ravi", "acc-ravi", true],
    [MEERA, "Meera", "acc-meera", false],
  ] as const) {
    await q("insert into bugflow.users(id,name,email) values($1,$2,$3)", [
      id,
      name,
      `${name.toLowerCase()}@example.test`,
    ]);
    const portal = crypto.randomUUID();
    await q(
      "insert into bugflow.portals(id,user_id,type,token_hash) values($1,$2,'developer',$3)",
      [portal, id, `hash-${name}`],
    );
    if (onProject)
      await q("insert into bugflow.portal_projects(portal_id,project_id) values($1,$2)", [
        portal,
        PROJECT,
      ]);
    await q(
      "insert into bugflow.jira_user_mappings(connection_id,user_id,account_id,display_name,source,confirmed_at) values($1,$2,$3,$4,'manual',now())",
      [CONN, id, account, name],
    );
  }
});
afterAll(() => pool.end());

let issueId = "";
let bugId = "";

it("stores a delivery once, and a Jira-made bug becomes one BugFlow bug with its link", async () => {
  const issue = jira.written();
  issueId = issue.id;
  expect(await arrive(issueId, "wh-a")).toBe(true);
  expect(await arrive(issueId, "wh-a")).toBe(false); // Jira retried the same delivery
  expect(await arrive(issueId, "wh-b")).toBe(true);
  expect(await inbox()).toMatchObject({ claimed: 1, done: 1 });
  // the second event was already covered by that pass
  expect(await q("select state from bugflow.jira_inbox order by received_at")).toEqual([
    { state: "done" },
    { state: "done" },
  ]);
  expect(
    await q("select count(*)::int as n from bugflow.bugs where title=$1", [
      "TRIAL-JIRA-Login page is blank",
    ]),
  ).toEqual([{ n: 1 }]);
  const bug = await bugOf(issueId);
  bugId = String(bug["id"]);
  expect(bug).toMatchObject({
    status: "NEW",
    priority: "P2",
    severity: "Medium",
    reporter_id: JIRA_SYNC_USER_ID,
    link_state: "linked",
    origin: "jira",
    description: "Nothing renders after sign-in.",
  });
  expect(await history(bugId)).toEqual([">NEW"]);
  expect(await activity(bugId, "bug.created")).toMatchObject([
    { actor_id: JIRA_SYNC_USER_ID, detail: { source: "jira", issueKey: issue.key } },
  ]);
  expect(readDescription(issue.fields["description"]).details.at(-1)).toMatch(/^Bug Board: BF-/);

  await arrive(issueId);
  await inbox();
  expect(await q("select count(*)::int as n from bugflow.jira_issue_links")).toEqual([{ n: 1 }]);
});

it("writes a Jira edit into BugFlow with history, as the Jira integration, and sends nothing back", async () => {
  const issue = jira.raw(issueId);
  const parts = readDescription(issue.fields["description"]);
  issue.fields["summary"] = "TRIAL-JIRA-Login page stays blank";
  issue.fields["description"] = buildDescription({
    ...parts,
    steps: ["Sign in", "Wait"],
    expected: "The dashboard shows.",
  });
  const before = (await bugOf(issueId))["updated_at"];
  jira.calls = [];
  await arrive(issueId);
  expect(await inbox()).toMatchObject({ done: 1 });
  const bug = await bugOf(issueId);
  expect(bug).toMatchObject({
    title: "TRIAL-JIRA-Login page stays blank",
    expected: "The dashboard shows.",
  });
  expect(bug["updated_at"]).not.toEqual(before);
  expect(
    await q("select content from bugflow.steps where bug_id=$1 order by position", [bugId]),
  ).toEqual([{ content: "Sign in" }, { content: "Wait" }]);
  expect((await activity(bugId, "bug.edited")).at(-1)).toMatchObject({
    actor_id: JIRA_SYNC_USER_ID,
    detail: { source: "jira", jiraUser: "Jordan (Jira)", fields: ["title", "steps", "expected"] },
  });
  expect(
    await q(
      "select count(*)::int as n from bugflow.bug_mutations where bug_id=$1 and actor_id=$2",
      [bugId, JIRA_SYNC_USER_ID],
    ),
  ).toEqual([{ n: 1 }]);
  expect(jira.count("updateIssue")).toBe(0);
  expect(await q("select 1 from bugflow.jira_outbox where bug_id=$1", [bugId])).toEqual([]);
});

it("does not assign someone who is not on the project, and assigns a confirmed member through triage", async () => {
  const issue = jira.raw(issueId);
  issue.fields["assignee"] = { accountId: "acc-meera" };
  await arrive(issueId);
  expect(await inbox()).toMatchObject({ conflict: 1 });
  const first = await bugOf(issueId);
  expect(first["assignee_id"]).toBeNull();
  expect(await conflicts(first["link_id"])).toEqual([
    { field: "assignee", reason: "assignee_not_on_project", state: "open" },
  ]);

  issue.fields["assignee"] = { accountId: "acc-ravi" };
  await arrive(issueId);
  expect(await inbox()).toMatchObject({ done: 1 });
  const bug = await bugOf(issueId);
  expect(bug).toMatchObject({ assignee_id: RAVI, status: "ASSIGNED", link_state: "linked" });
  expect(await history(bugId)).toEqual([
    ">NEW",
    "NEW>VALIDATING",
    "VALIDATING>VALIDATED",
    "VALIDATED>READY_FOR_ASSIGNMENT",
    "READY_FOR_ASSIGNMENT>ASSIGNED",
  ]);
  expect(
    await q("select assignee_id,actor_id from bugflow.assignments where bug_id=$1", [bugId]),
  ).toEqual([{ assignee_id: RAVI, actor_id: JIRA_SYNC_USER_ID }]);
  expect(await q("select user_id from bugflow.bug_assignees where bug_id=$1", [bugId])).toEqual([
    { user_id: RAVI },
  ]);
  expect(await conflicts(bug["link_id"])).toMatchObject([{ state: "resolved" }]);
  // Assigned sits in Jira's In Progress column on this board, so Jira was told
  expect(issue.fields["status"]).toEqual({ id: "2" });
});

it("moves status along the workflow, and Jira's Done does not stand in for a retest", async () => {
  const issue = jira.raw(issueId);
  issue.fields["status"] = { id: "3" };
  await arrive(issueId);
  expect(await inbox()).toMatchObject({ done: 1 });
  expect(await bugOf(issueId)).toMatchObject({
    status: "RECHECK",
    fix_notes: `Changed in Jira (${issue.key})`,
  });
  expect((await history(bugId)).slice(-2)).toEqual(["ASSIGNED>IN_PROGRESS", "IN_PROGRESS>RECHECK"]);

  issue.fields["status"] = { id: "4" };
  await arrive(issueId);
  expect(await inbox()).toMatchObject({ conflict: 1 });
  const bug = await bugOf(issueId);
  expect(bug["status"]).toBe("RECHECK");
  expect((await conflicts(bug["link_id"])).at(-1)).toEqual({
    field: "status",
    reason: "needs_qa_verification",
    state: "open",
  });
  expect(await q("select 1 from bugflow.verifications where bug_id=$1", [bugId])).toEqual([]);
});

it("resolves from Jira only when the Admin allowed it, as a recorded verification by the integration", async () => {
  await q(
    "update bugflow.jira_project_mappings set config=jsonb_set(config,'{inbound,resolveFromRecheck}','true') where id=$1",
    [MAP],
  );
  await arrive(issueId);
  expect(await inbox()).toMatchObject({ done: 1 });
  const bug = await bugOf(issueId);
  expect(bug).toMatchObject({ status: "RESOLVED", link_state: "linked" });
  expect(
    await q("select actor_id,passed from bugflow.verifications where bug_id=$1", [bugId]),
  ).toEqual([{ actor_id: JIRA_SYNC_USER_ID, passed: true }]);
  expect((await activity(bugId, "bug.verify")).at(-1)).toMatchObject({
    detail: { source: "jira", status: "RESOLVED" },
  });
  expect((await history(bugId)).at(-1)).toBe("RECHECK>RESOLVED");
});

it("never works on a bug from both sides at once", async () => {
  const id = await create();
  await outbox();
  const issue = (
    await q("select jira_issue_id from bugflow.jira_issue_links where bug_id=$1", [id])
  )[0]!["jira_issue_id"];
  await edit(id, { title: "TRIAL-JIRA-Changed in BugFlow" });
  jira.raw(issue).fields["duedate"] = "2026-12-24";
  await arrive(issue);
  const owner = crypto.randomUUID();
  const [taken] = await neonQueue.claim(owner, 10);
  expect(taken).toMatchObject({ bugId: id });
  expect(await neonInbox.claim(crypto.randomUUID(), 10)).toEqual([]); // the outbox worker has the bug
  await neonQueue.later(taken!, owner, 0, false, null);
  const inboxOwner = crypto.randomUUID();
  const [event] = await neonInbox.claim(inboxOwner, 10);
  expect(event).toMatchObject({
    issueId: issue,
    projectId: "10000",
    actor: { displayName: "Jordan (Jira)" },
  });
  expect(await neonQueue.claim(crypto.randomUUID(), 10)).toEqual([]); // and now the inbox worker has it
  await neonInbox.later(event!, inboxOwner, 0, false, null);
  expect(await inbox()).toMatchObject({ done: 1 });
  expect(jira.raw(issue).fields["summary"]).toBe("TRIAL-JIRA-Changed in BugFlow");
  await outbox();
});

it("carries out an Admin's 'use Jira's value' and takes nothing for a bug in the Trash", async () => {
  const id = await create();
  await outbox();
  const link = (
    await q("select id,jira_issue_id from bugflow.jira_issue_links where bug_id=$1", [id])
  )[0]!;
  const issue = jira.raw(link["jira_issue_id"]);
  issue.fields["summary"] = "Jira title";
  await edit(id, { title: "BugFlow title" });
  await outbox();
  expect(await conflicts(link["id"])).toEqual([
    { field: "title", reason: "both_changed", state: "open" },
  ]);
  await q(`update bugflow.jira_issue_links set overrides='{"pull":["title"]}' where id=$1`, [
    link["id"],
  ]);
  await arrive(issue.id);
  expect(await inbox()).toMatchObject({ done: 1 });
  expect((await q("select title from bugflow.bugs where id=$1", [id]))[0]).toEqual({
    title: "Jira title",
  });
  expect(
    (await q("select state,overrides from bugflow.jira_issue_links where id=$1", [link["id"]]))[0],
  ).toEqual({ state: "linked", overrides: { push: [], pull: [], held: [] } });

  await deleteBugReport(id, "TRIAL-JIRA cleanup");
  await outbox();
  issue.fields["summary"] = "Edited after trash";
  await arrive(issue.id);
  await inbox();
  expect((await q("select title from bugflow.bugs where id=$1", [id]))[0]).toEqual({
    title: "Jira title",
  });
  await change(bugId, { action: "comment", notes: "TRIAL-JIRA still fine" });
});

it("refuses a write when the bug's version moved on, and leaves no half-done work", async () => {
  const bug = (
    await q("select id,updated_at::text as v from bugflow.bugs where id=$1", [bugId])
  )[0]!;
  const stale = await neonStore.applyInbound(
    bugId,
    "2000-01-01 00:00:00+00",
    {
      edit: { title: "Should not land" },
      assign: null,
      status: null,
      sprint: null,
      fields: ["title"],
    },
    { linkId: "x", issueKey: "BFT-1", actor: null },
  );
  expect(stale).toBeNull();
  expect(
    (await q("select updated_at::text as v from bugflow.bugs where id=$1", [bugId]))[0]!["v"],
  ).toBe(bug["v"]);
  expect(
    await q("select 1 from bugflow.jira_inbox where state in ('pending','retry','processing')"),
  ).toEqual([]);
  expect(
    await q("select 1 from bugflow.jira_outbox where state in ('pending','retry','processing')"),
  ).toEqual([]);
});
