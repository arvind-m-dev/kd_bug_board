import { afterAll, beforeAll, expect, it, vi } from "vitest";

const jiraUsers = vi.hoisted(() => ({ reply: [] as unknown[] }));
vi.mock("@/lib/neon.server", async () => (await import("./local")).neon);
vi.mock("@/lib/portal-access.server", async () => (await import("./local")).session);
// Live reads are answered from fixtures: no request leaves this machine.
vi.mock("@/lib/jira/auth.server", () => ({
  jiraFetch: async () => structuredClone(jiraUsers.reply),
  jiraEnv: () => ({ config: null, missing: ["JIRA_CLIENT_ID"] }),
}));
import {
  jiraOverview,
  resolveJiraConflict,
  retryJiraParked,
  syncJiraNow,
} from "@/lib/jira/admin.server";
import { JiraApiError } from "@/lib/jira/errors";
import { neonDirectory, neonInbox, persistEvent } from "@/lib/jira/inbox.server";
import { neonQueue, neonStore } from "@/lib/jira/outbox.server";
import {
  findJiraAccounts,
  jiraPeople,
  linkJiraPerson,
  unlinkJiraPerson,
} from "@/lib/jira/people.server";
import { runInbox, runOutbox } from "@/lib/jira/processor";
import { CONFIG, FakeJira } from "@/test/jira-fixtures";
import { change, create, edit } from "./common";
import { ADMIN, CONN, PROJECT, pool, q, seed } from "./local";

const RAVI = "aaaaaaaa-0000-4000-8000-0000000000b2";
const MEERA = "aaaaaaaa-0000-4000-8000-0000000000b3";
const jira = new FakeJira();
const deps = { store: neonStore, jira: () => jira };
const work = async () => {
  await runInbox({
    queue: neonInbox,
    directory: neonDirectory,
    owner: crypto.randomUUID(),
    ...deps,
  });
  return runOutbox({ queue: neonQueue, owner: crypto.randomUUID(), ...deps });
};
const link = async (bugId: string) =>
  (await q("select * from bugflow.jira_issue_links where bug_id=$1", [bugId]))[0]!;
const title = async (bugId: string) =>
  (await q("select title from bugflow.bugs where id=$1", [bugId]))[0]!["title"];
/** A bug in sync, then its title changed on both sides at once. */
async function clash(local: string, remote: string) {
  const id = await create();
  await work();
  const l = await link(id);
  const issue = jira.raw(l["jira_issue_id"]);
  issue.fields["summary"] = remote;
  await edit(id, { title: local });
  await work();
  const open = (await jiraOverview()).conflicts.find((c) => c.bugId === id)!;
  return { id, issue, conflictId: open.id, open };
}

beforeAll(async () => {
  await seed(true, CONFIG);
  for (const [id, name] of [
    [RAVI, "Ravi"],
    [MEERA, "Meera"],
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
    await q("insert into bugflow.portal_projects(portal_id,project_id) values($1,$2)", [
      portal,
      PROJECT,
    ]);
  }
});
afterAll(() => pool.end());

it("shows a conflict with both values, and 'use Jira's' is carried out by the next pass", async () => {
  const { id, conflictId, open } = await clash("BugFlow title", "Jira title");
  expect(open).toMatchObject({
    field: "title",
    reason: "both_changed",
    local: "BugFlow title",
    remote: "Jira title",
    issueKey: "BFT-1",
  });
  const after = await resolveJiraConflict(conflictId, "use_jira");
  expect(after.conflicts.find((c) => c.id === conflictId)).toBeUndefined();
  expect((await link(id))["overrides"]).toMatchObject({ pull: ["title"], push: [] });
  expect(after.queue.toJira).toBe(1); // the decision is picked up straight away
  await work();
  expect(await title(id)).toBe("Jira title");
  expect(await link(id)).toMatchObject({
    state: "linked",
    overrides: { push: [], pull: [], held: [] },
  });
  expect(
    await q("select resolution,resolved_by from bugflow.jira_conflicts where id=$1", [conflictId]),
  ).toEqual([{ resolution: "use_jira", resolved_by: ADMIN }]);
  expect(
    await q(
      "select detail from bugflow.activity where bug_id=$1 and action='jira.conflict_resolved'",
      [id],
    ),
  ).toMatchObject([{ detail: { field: "title", resolution: "use_jira" } }]);
  await expect(resolveJiraConflict(conflictId, "use_jira")).rejects.toThrow(/already settled/);
});

it("'use BugFlow's' sends BugFlow's value", async () => {
  const { id, issue, conflictId } = await clash("BugFlow wins", "Jira loses");
  await resolveJiraConflict(conflictId, "use_bugflow");
  await work();
  expect(issue.fields["summary"]).toBe("BugFlow wins");
  expect(await title(id)).toBe("BugFlow wins");
  expect((await link(id))["state"]).toBe("linked");
});

it("'ignore' accepts both values until either side changes again", async () => {
  const { id, issue, conflictId } = await clash("Kept in BugFlow", "Kept in Jira");
  await resolveJiraConflict(conflictId, "ignore");
  expect(await link(id)).toMatchObject({
    state: "linked",
    bugflow_snapshot: { title: "Kept in BugFlow" },
    jira_snapshot: { title: "Kept in Jira" },
  });
  await edit(id, { module: "Payments" });
  await work();
  expect([await title(id), issue.fields["summary"]]).toEqual(["Kept in BugFlow", "Kept in Jira"]);
  expect((await jiraOverview()).conflicts.filter((c) => c.bugId === id)).toEqual([]);
  // a new change to the field is a normal change again
  await edit(id, { title: "Changed later" });
  await work();
  expect(issue.fields["summary"]).toBe("Changed later");
});

it("'unlink' stops the pair for good and deletes neither record", async () => {
  const { id, issue, conflictId } = await clash("Unlinked in BugFlow", "Unlinked in Jira");
  const issues = jira.issues.size;
  await resolveJiraConflict(conflictId, "unlink");
  expect((await link(id))["state"]).toBe("disabled");
  await edit(id, { title: "Edited after unlinking" });
  issue.fields["summary"] = "Edited in Jira after unlinking";
  await persistEvent(CONN, {
    dedupKey: "after-unlink",
    eventType: "jira:issue_updated",
    source: "webhook",
    issueId: issue.id,
    issueKey: null,
    projectId: "10000",
    eventAt: null,
    actor: null,
  });
  await work();
  expect(jira.issues.size).toBe(issues); // no second issue
  expect(
    await q("select count(*)::int as n from bugflow.jira_issue_links where jira_issue_id=$1", [
      issue.id,
    ]),
  ).toEqual([{ n: 1 }]);
  expect([await title(id), issue.fields["summary"]]).toEqual([
    "Edited after unlinking",
    "Edited in Jira after unlinking",
  ]);
  expect((await q("select deleted_at from bugflow.bugs where id=$1", [id]))[0]).toEqual({
    deleted_at: null,
  });
});

it("lists parked work with a safe reason and puts it back in the queue on request", async () => {
  const id = await create();
  await work();
  jira.fail.updateIssue = [new JiraApiError("forbidden", 403)];
  await edit(id, { title: "TRIAL-JIRA-Needs a permission" });
  await work();
  const before = await jiraOverview();
  expect(before.queue.parked).toBe(1);
  expect(before.parked).toMatchObject([
    {
      direction: "to_jira",
      error: "The connected Atlassian account is not allowed to do this in Jira.",
    },
  ]);
  expect((await retryJiraParked()).retried).toBe(1);
  await work();
  expect(jira.raw((await link(id))["jira_issue_id"]).fields["summary"]).toBe(
    "TRIAL-JIRA-Needs a permission",
  );
  expect((await jiraOverview()).queue).toEqual({ toJira: 0, fromJira: 0, parked: 0 });
  expect(await q("select 1 from bugflow.jira_outbox where state='dead'")).toEqual([]);
});

it("links a member to a Jira account only by the Admin's choice, one account per member", async () => {
  expect((await jiraPeople()).map((p) => [p.name, p.accountId])).toEqual([
    ["Meera", null],
    ["Ravi", null],
  ]);
  jiraUsers.reply = [
    { accountId: "acc-ravi", displayName: "Ravi K", active: true, accountType: "atlassian" },
    { accountId: "acc-bot", displayName: "Automation", active: true, accountType: "app" },
    { accountId: "acc-gone", displayName: "Ravi Old", active: false, accountType: "atlassian" },
  ];
  expect(await findJiraAccounts("ravi")).toEqual([{ accountId: "acc-ravi", name: "Ravi K" }]);

  const id = await create();
  await work();
  await change(id, { action: "assign", assigneeIds: [RAVI] });
  await work();
  const issue = jira.raw((await link(id))["jira_issue_id"]);
  expect(issue.fields["assignee"] ?? null).toBeNull(); // not linked yet: named as text only

  const people = await linkJiraPerson(RAVI, { accountId: "acc-ravi", name: "Ravi K" });
  expect(people.find((p) => p.userId === RAVI)).toMatchObject({
    accountId: "acc-ravi",
    jiraName: "Ravi K",
  });
  await work(); // their synchronized bugs are looked at again without anyone editing them
  expect(issue.fields["assignee"]).toEqual({ accountId: "acc-ravi" });
  await expect(linkJiraPerson(MEERA, { accountId: "acc-ravi", name: "Ravi K" })).rejects.toThrow(
    /already linked to another member/,
  );

  await unlinkJiraPerson(RAVI);
  await work();
  expect(issue.fields["assignee"]).toBeNull();
  expect(
    await q(
      "select action from bugflow.activity where action like 'jira.person_%' order by created_at",
    ),
  ).toEqual([{ action: "jira.person_linked" }, { action: "jira.person_unlinked" }]);
});

it("'Sync now' runs a bounded pass and reports what it did", async () => {
  const { run, overview } = await syncJiraNow();
  expect(run).toEqual({
    reconcile: { skipped: "not_configured" },
    inbox: { claimed: 0, done: 0, conflict: 0, retry: 0, dead: 0, waiting: 0 },
    outbox: { claimed: 0, done: 0, conflict: 0, retry: 0, dead: 0, waiting: 0 },
  });
  expect(overview.linked).toBeGreaterThan(0);
});
