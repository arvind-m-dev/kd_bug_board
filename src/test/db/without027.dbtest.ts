import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("@/lib/neon.server", async () => (await import("./local")).neon);
vi.mock("@/lib/portal-access.server", async () => (await import("./local")).session);
import { bugDetail, deleteBugReport } from "@/lib/bug-workflow.server";
import { processJiraOutbox } from "@/lib/jira/outbox.server";
import {
  addToSprint,
  closeSprint,
  createSprint,
  removeFromSprint,
  startSprint,
} from "@/lib/sprints.server";
import { restoreTrashItem } from "@/lib/trash.server";
import { updateWorkItem } from "@/lib/backlog.server";
import { admin, change, create, edit } from "./common";
import { PROJECT, pool, q, seed, statements } from "./local";

beforeAll(() => seed(false));
afterAll(() => pool.end());

it("is a database without the Jira tables", async () => {
  expect((await q("select to_regclass('bugflow.jira_outbox') as t"))[0]!["t"]).toBeNull();
});

it("every bug write still works, and none of them touches a Jira table", async () => {
  const id = await create();
  await change(id, { action: "status", status: "VALIDATING" });
  await change(id, { action: "priority", priority: "P0" });
  await change(id, { action: "comment", notes: "TRIAL-JIRA comment" });
  await edit(id, { title: "TRIAL-JIRA-Edited", steps: ["One", "Two", "Three"] });
  await deleteBugReport(id, "TRIAL-JIRA cleanup");
  await restoreTrashItem({ kind: "bug", id });
  const { bug } = await bugDetail(admin, id);
  expect(bug).toMatchObject({
    title: "TRIAL-JIRA-Edited",
    status: "VALIDATING",
    priority: "P0",
    steps: ["One", "Two", "Three"],
  });
  // sprint planning and estimates carry Jira markers too; without the tables they must be untouched
  const sprint = await createSprint({
    projectId: PROJECT,
    name: "TRIAL-JIRA sprint",
    goal: "",
    startsOn: null,
    endsOn: null,
  });
  await addToSprint({ sprintId: sprint.id, bugId: id });
  await removeFromSprint({ sprintId: sprint.id, bugId: id });
  await addToSprint({ sprintId: sprint.id, bugId: id });
  await startSprint({ id: sprint.id });
  await closeSprint({ id: sprint.id });
  await updateWorkItem({ id, estimate: 5 });
  expect((await q("select estimate from bugflow.bugs where id=$1", [id]))[0]).toEqual({
    estimate: 5,
  });
  expect(statements.filter((s) => /jira_/.test(s) && !/to_regclass/.test(s))).toEqual([]);
  // the "tables absent" answer is remembered: asked once, not on every write
  expect(statements.filter((s) => /to_regclass/.test(s))).toHaveLength(1);
});

it("the processor does nothing here", async () => {
  expect(await processJiraOutbox()).toEqual({ skipped: "database_not_ready" });
});
