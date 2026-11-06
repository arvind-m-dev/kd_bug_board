import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("@/lib/neon.server", async () => (await import("./local")).neon);
vi.mock("@/lib/portal-access.server", async () => (await import("./local")).session);
import { updateWorkItem } from "@/lib/backlog.server";
import { neonDirectory, neonInbox, persistEvent } from "@/lib/jira/inbox.server";
import { neonQueue, neonStore } from "@/lib/jira/outbox.server";
import { runInbox, runOutbox } from "@/lib/jira/processor";
import { noteSprintEvent } from "@/lib/jira/sprints.server";
import { JIRA_SYNC_USER_ID } from "@/lib/jira/types";
import { addToSprint, closeSprint, createSprint, removeFromSprint } from "@/lib/sprints.server";
import { CONFIG, FAKE_SPRINT_FIELD, FakeJira } from "@/test/jira-fixtures";
import { create } from "./common";
import { CONN, PROJECT, pool, q, seed } from "./local";

const POINTS = "customfield_10016";
const config = { ...CONFIG, sprintField: FAKE_SPRINT_FIELD, estimateField: POINTS };
const jira = new FakeJira(config);
const deps = { store: neonStore, jira: () => jira };
const inbox = () =>
  runInbox({ queue: neonInbox, directory: neonDirectory, owner: crypto.randomUUID(), ...deps });
const outbox = () => runOutbox({ queue: neonQueue, owner: crypto.randomUUID(), ...deps });
let n = 0;
const arrive = (issueId: string) =>
  persistEvent(CONN, {
    dedupKey: `wh-${++n}`,
    eventType: "jira:issue_updated",
    source: "webhook",
    issueId,
    issueKey: null,
    projectId: "10000",
    eventAt: null,
    actor: null,
  });
const jiraSprint = (id: number, state: string, name = `Sprint ${id}`) => ({
  id,
  name,
  state,
  boardId: 3,
  startDate: "2026-11-02T04:00:00.000Z",
  endDate: "2026-11-16T04:00:00.000Z",
  goal: "Ship checkout",
});
const mirrors = () =>
  q(
    "select jl.jira_sprint_id::int as jira,jl.jira_state,s.name,s.state,s.starts_on,s.goal,s.created_by from bugflow.jira_sprint_links jl join bugflow.sprints s on s.id=jl.sprint_id order by jl.jira_sprint_id",
  );
const membership = (bugId: string) =>
  q(
    "select jl.jira_sprint_id::int as jira,(si.removed_at is null) as open,s.state from bugflow.sprint_items si join bugflow.sprints s on s.id=si.sprint_id left join bugflow.jira_sprint_links jl on jl.sprint_id=s.id where si.bug_id=$1 order by si.added_at",
    [bugId],
  );
const linked = async (bugId: string) =>
  jira.raw(
    (await q("select jira_issue_id from bugflow.jira_issue_links where bug_id=$1", [bugId]))[0]![
      "jira_issue_id"
    ],
  );
const mirrorOf = async (jiraSprintId: number) =>
  String(
    (
      await q("select sprint_id from bugflow.jira_sprint_links where jira_sprint_id=$1", [
        jiraSprintId,
      ])
    )[0]!["sprint_id"],
  );

let first = "";
let second = "";

beforeAll(async () => {
  await seed(true, config);
  first = await create();
  second = await create({ title: "TRIAL-JIRA-Second bug" });
  await outbox();
});
afterAll(() => pool.end());

it("mirrors Jira's sprint and puts the bug in it, with the estimate", async () => {
  const issue = await linked(first);
  issue.fields[FAKE_SPRINT_FIELD] = [jiraSprint(6, "closed"), jiraSprint(7, "active")];
  issue.fields[POINTS] = 3;
  await arrive(issue.id);
  expect(await inbox()).toMatchObject({ done: 1 });
  expect(await mirrors()).toEqual([
    {
      jira: 7,
      jira_state: "active",
      name: "Sprint 7",
      state: "active",
      starts_on: "2026-11-02",
      goal: "Ship checkout",
      created_by: JIRA_SYNC_USER_ID,
    },
  ]);
  expect(await membership(first)).toEqual([{ jira: 7, open: true, state: "active" }]);
  expect((await q("select estimate from bugflow.bugs where id=$1", [first]))[0]).toEqual({
    estimate: 3,
  });
  expect(
    await q(
      "select action,actor_id from bugflow.activity where bug_id=$1 and action like 'sprint.%'",
      [first],
    ),
  ).toEqual([{ action: "sprint.item_added", actor_id: JIRA_SYNC_USER_ID }]);
});

it("keeps one active sprint per project: a second active Jira sprint waits as planned", async () => {
  const issue = await linked(second);
  issue.fields[FAKE_SPRINT_FIELD] = [jiraSprint(8, "active")];
  await arrive(issue.id);
  await inbox();
  expect((await mirrors()).map((m) => [m["jira"], m["state"]])).toEqual([
    [7, "active"],
    [8, "planned"],
  ]);
  expect(await membership(second)).toEqual([{ jira: 8, open: true, state: "planned" }]);
});

it("closes the mirror when Jira closes the sprint, carrying nothing over, then starts the next", async () => {
  const a = await linked(first);
  a.fields[FAKE_SPRINT_FIELD] = [jiraSprint(6, "closed"), jiraSprint(7, "closed")];
  await arrive(a.id);
  await inbox();
  expect((await mirrors()).map((m) => [m["jira"], m["state"]])).toEqual([
    [7, "closed"],
    [8, "planned"],
  ]);
  // the bug stays recorded in the closed sprint and is in no open one: nobody decided to carry it over
  expect(await membership(first)).toEqual([{ jira: 7, open: true, state: "closed" }]);
  const b = await linked(second);
  await arrive(b.id);
  await inbox();
  expect((await mirrors()).map((m) => [m["jira"], m["state"]])).toEqual([
    [7, "closed"],
    [8, "active"],
  ]);
});

it("tells Jira when an Admin plans a bug into a mirrored sprint, takes it out, or changes the estimate", async () => {
  const sprint8 = await mirrorOf(8);
  const issue = await linked(first);
  await addToSprint({ sprintId: sprint8, bugId: first });
  expect(await outbox()).toMatchObject({ done: 1 });
  expect(issue.fields[FAKE_SPRINT_FIELD]).toMatchObject([{ id: 8 }]);
  await updateWorkItem({ id: first, estimate: 13 });
  await outbox();
  expect(issue.fields[POINTS]).toBe(13);
  await removeFromSprint({ sprintId: sprint8, bugId: first });
  await outbox();
  expect(issue.fields[FAKE_SPRINT_FIELD]).toBeNull();
});

it("does not pull a bug out of a BugFlow-only sprint because Jira planned it elsewhere", async () => {
  const third = await create({ title: "TRIAL-JIRA-Third bug" });
  await outbox();
  const own = await createSprint({
    projectId: PROJECT,
    name: "TRIAL-JIRA BugFlow-only sprint",
    goal: "",
    startsOn: null,
    endsOn: null,
  });
  await addToSprint({ sprintId: own.id, bugId: third });
  await outbox();
  const issue = await linked(third);
  issue.fields[FAKE_SPRINT_FIELD] = [jiraSprint(8, "active")];
  await arrive(issue.id);
  expect(await inbox()).toMatchObject({ conflict: 1 });
  expect((await membership(third)).filter((m) => m["open"])).toEqual([
    { jira: null, open: true, state: "planned" },
  ]);
  expect(await q("select field,reason from bugflow.jira_conflicts where state='open'")).toEqual([
    { field: "sprint", reason: "in_another_sprint" },
  ]);
});

it("queues a look at the sprint's synchronized issues when Jira reports a sprint event", async () => {
  await q("update bugflow.jira_inbox set state='done'");
  await noteSprintEvent(CONN, {
    kind: "sprint",
    eventType: "sprint_closed",
    sprintId: 8,
    boardId: 3,
    eventAt: "2026-11-06T12:00:00.000Z",
  });
  await noteSprintEvent(CONN, {
    kind: "sprint",
    eventType: "sprint_closed",
    sprintId: 8,
    boardId: 3,
    eventAt: "2026-11-06T12:00:00.000Z",
  });
  const second8 = (await linked(second)).id;
  expect(
    await q("select jira_issue_id,event_type from bugflow.jira_inbox where state='pending'"),
  ).toEqual([{ jira_issue_id: second8, event_type: "sprint_closed" }]);
});

it("marks carried-over bugs for Jira when an Admin closes a sprint in BugFlow", async () => {
  await q("update bugflow.jira_outbox set state='done'");
  const sprint8 = await mirrorOf(8);
  const next = await createSprint({
    projectId: PROJECT,
    name: "TRIAL-JIRA next",
    goal: "",
    startsOn: null,
    endsOn: null,
  });
  await closeSprint({ id: sprint8, carryTo: next.id });
  expect(await q("select bug_id::text from bugflow.jira_outbox where state='pending'")).toEqual([
    { bug_id: second },
  ]);
});
