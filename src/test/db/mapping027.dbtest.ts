import { afterAll, beforeAll, expect, it, vi } from "vitest";

const jira = vi.hoisted(() => ({ replies: new Map<string, unknown>(), fail: null as unknown }));
vi.mock("@/lib/neon.server", async () => (await import("./local")).neon);
vi.mock("@/lib/portal-access.server", async () => (await import("./local")).session);
// The live reads are answered from fixtures: no request leaves this machine.
vi.mock("@/lib/jira/auth.server", () => ({
  jiraFetch: async (_c: unknown, path: string) => {
    if (jira.fail) throw jira.fail;
    const key = [...jira.replies.keys()].find((k) => path.startsWith(k));
    if (!key) throw new Error(`no fixture for ${path}`);
    return structuredClone(jira.replies.get(key));
  },
}));
import { JiraApiError } from "@/lib/jira/errors";
import {
  activateJiraMapping,
  jiraProjectShape,
  jiraResources,
  pauseJiraMapping,
  previewJiraMapping,
  saveJiraMapping,
} from "@/lib/jira/mapping.server";
import type { MappingConfig } from "@/lib/jira/schemas";
import {
  CREATE_META_REPLY,
  PROJECT_PAGE_REPLY,
  PROJECT_REPLY,
  STATUSES_REPLY,
} from "@/test/jira-shapes";
import { create } from "./common";
import { ADMIN, CONN, PROJECT, pool, q, seed } from "./local";

const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const rows = () =>
  q(
    "select project_id,jira_project_id,jira_project_key,issue_type_id,state from bugflow.jira_project_mappings order by created_at",
  );
const audit = (action: string) => q("select 1 from bugflow.activity where action=$1", [action]);
let config: MappingConfig;
const input = (over: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  jiraProjectId: "10000",
  issueTypeId: "10004",
  config,
  ...over,
});

beforeAll(async () => {
  await seed(true);
  await q("insert into bugflow.projects(id,name) values($1,'TRIAL-JIRA second project')", [OTHER]);
  jira.replies.set("/rest/api/3/project/search", PROJECT_PAGE_REPLY);
  jira.replies.set("/rest/api/3/project/10000/statuses", STATUSES_REPLY);
  jira.replies.set("/rest/api/3/issue/createmeta/10000/issuetypes/10004", CREATE_META_REPLY);
  jira.replies.set("/rest/api/3/project/10000", PROJECT_REPLY);
});
afterAll(() => pool.end());

it("lists what Jira and BugFlow really have, and nothing mapped yet", async () => {
  const r = await jiraResources();
  expect(r.jiraProjects).toEqual([{ id: "10000", key: "BFT", name: "BugFlow Trial" }]);
  expect(r.projects.map((p) => p.name)).toEqual(
    expect.arrayContaining(["TRIAL-JIRA project", "TRIAL-JIRA second project"]),
  );
  expect(r.mappings).toEqual([]);
});

it("reads a Jira project's shape and suggests a mapping from it", async () => {
  const shape = await jiraProjectShape("10000");
  expect(shape).toMatchObject({ project: { key: "BFT" }, issueTypeId: "10004" });
  expect(shape.fields.map((f) => f.id)).toContain("labels");
  config = shape.suggestion!;
  expect(config.statusOut.RECHECK).toBe("10002");
});

it("saves a draft, takes the project key from Jira, and edits the same draft", async () => {
  const saved = await saveJiraMapping(input());
  expect(saved).toMatchObject({
    state: "draft",
    jiraProjectKey: "BFT",
    queue: { waiting: 0, parked: 0, conflicts: 0 },
  });
  await saveJiraMapping(input({ config: { ...config, dueOn: false } }));
  expect(await rows()).toMatchObject([
    { project_id: PROJECT, jira_project_key: "BFT", state: "draft" },
  ]);
  expect(await audit("jira.mapping_saved")).toHaveLength(2);
  await saveJiraMapping(input());
});

it("refuses a mapping that breaks the rules, with the reason", async () => {
  const { NEW: _dropped, ...rest } = config.statusOut;
  await expect(saveJiraMapping(input({ config: { ...config, statusOut: rest } }))).rejects.toThrow(
    "BugFlow status NEW has no Jira status.",
  );
  await expect(saveJiraMapping(input({ issueTypeId: "10777" }))).rejects.toThrow(/issue type/);
});

it("a draft sends nothing", async () => {
  const id = await create();
  expect(await q("select 1 from bugflow.jira_outbox where bug_id=$1", [id])).toEqual([]);
});

it("does not switch on while live Jira cannot take what BugFlow sends", async () => {
  const meta = structuredClone(CREATE_META_REPLY);
  meta.fields = meta.fields.filter((f) => f.fieldId !== "labels");
  jira.replies.set("/rest/api/3/issue/createmeta/10000/issuetypes/10004", meta);
  const result = await activateJiraMapping(PROJECT);
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toMatch(/Labels field/);
  expect((await rows())[0]).toMatchObject({ state: "draft" });
  jira.replies.set("/rest/api/3/issue/createmeta/10000/issuetypes/10004", CREATE_META_REPLY);
});

it("switches on after passing, and from then a new bug is queued for Jira", async () => {
  expect(await previewJiraMapping(PROJECT)).toMatchObject({ problems: [], bugs: 1 });
  expect(await activateJiraMapping(PROJECT)).toMatchObject({
    problems: [],
    mapping: { state: "active" },
  });
  expect(await audit("jira.mapping_activated")).toHaveLength(1);
  const id = await create();
  expect(await q("select op,state from bugflow.jira_outbox where bug_id=$1", [id])).toEqual([
    { op: "create", state: "pending" },
  ]);
  expect((await jiraResources()).mappings[0]!.queue.waiting).toBe(1);
});

it("is not edited while on; paused, its rules can change but not its Jira project", async () => {
  await expect(saveJiraMapping(input())).rejects.toThrow(/Pause it/);
  expect(await pauseJiraMapping(PROJECT)).toMatchObject({ state: "paused" });
  expect(await saveJiraMapping(input({ config: { ...config, assignee: false } }))).toMatchObject({
    state: "paused",
    config: { assignee: false },
  });
  jira.replies.set("/rest/api/3/project/10001/statuses", STATUSES_REPLY);
  jira.replies.set("/rest/api/3/issue/createmeta/10001/issuetypes/10004", CREATE_META_REPLY);
  jira.replies.set("/rest/api/3/project/10001", { ...PROJECT_REPLY, id: "10001", key: "OTH" });
  await expect(saveJiraMapping(input({ jiraProjectId: "10001" }))).rejects.toThrow(/Pause it/);
  expect(await rows()).toHaveLength(1);
});

it("keeps one BugFlow project per Jira project", async () => {
  await saveJiraMapping(input({ projectId: OTHER }));
  const result = await activateJiraMapping(OTHER);
  expect(result.problems).toEqual([
    "Another BugFlow project is already synchronized with this Jira project.",
  ]);
  expect((await rows()).map((r) => r["state"])).toEqual(["paused", "draft"]);
  expect(await activateJiraMapping(PROJECT)).toMatchObject({
    problems: [],
    mapping: { state: "active" },
  });
});

it("shows a safe line, never Jira's own error, when a live read fails", async () => {
  jira.fail = new JiraApiError("forbidden", 403);
  await expect(jiraResources()).rejects.toThrow(
    "The connected Atlassian account is not allowed to do this in Jira.",
  );
  await expect(jiraResources()).rejects.not.toBeInstanceOf(JiraApiError);
  jira.fail = null;
});

it("does nothing while the connection is paused or signed out", async () => {
  await q("update bugflow.jira_connections set state='paused' where id=$1", [CONN]);
  await expect(jiraResources()).rejects.toThrow(/paused or needs a new sign-in/);
  await expect(activateJiraMapping(PROJECT)).rejects.toThrow(/paused or needs a new sign-in/);
  await q("update bugflow.jira_connections set state='connected' where id=$1", [CONN]);
  expect(ADMIN).toBeTruthy();
});
