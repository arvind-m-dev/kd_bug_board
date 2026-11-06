import type { z } from "zod";
import { audited } from "../audit.server";
import { neonExecute, neonQuery } from "../neon.server";
import { checkOrigin, requireAdmin } from "../portal-access.server";
import { jiraFetch } from "./auth.server";
import {
  type JiraCreateField,
  type JiraIssueTypeInfo,
  type JiraProjectInfo,
  bugType,
  createFields,
  createMetaSchema,
  issueTypes,
  projectPageSchema,
  projectSchema,
  projectStatusesSchema,
  shapeProblems,
  suggestConfig,
} from "./discovery";
import { JiraApiError, JiraAuthError, safeErrorText } from "./errors";
import { configProblems } from "./mapping";
import { type MappingConfig, mappingConfigSchema } from "./schemas";

// Admin operations on a project mapping: which BugFlow project goes with which Jira project, and how statuses,
// priorities and fields translate. Everything shown comes from a live read of Jira; a mapping is switched on
// only after it passed against the Jira project as it is at that moment. Switching on sends nothing by itself:
// a bug goes to Jira when it is next reported or changed.

type Row = Record<string, unknown>;
type Connection = { id: string; cloudId: string };
export type JiraMappingState = "draft" | "active" | "paused";
export type JiraMappingView = {
  projectId: string;
  projectName: string;
  jiraProjectId: string;
  jiraProjectKey: string;
  issueTypeId: string;
  state: JiraMappingState;
  config: MappingConfig | null;
  /** Outbox entries for this mapping: not sent yet, parked after a failure, and waiting on a conflict. */
  queue: { waiting: number; parked: number; conflicts: number };
};
export type JiraProjectShape = {
  project: JiraProjectInfo;
  issueTypes: JiraIssueTypeInfo[];
  /** The type the rest describes: the one asked for, else the one named Bug. Null when there is none. */
  issueTypeId: string | null;
  fields: JiraCreateField[];
  suggestion: MappingConfig | null;
};

async function connection(): Promise<Connection> {
  const { rows } = await neonQuery(
    `select id,cloud_id,state from bugflow.jira_connections where disconnected_at is null limit 1`,
  );
  const r = rows[0];
  if (!r || !r["cloud_id"]) throw new Error("Connect Jira first.");
  if (r["state"] !== "connected")
    throw new Error("Jira is paused or needs a new sign-in. Sort that out on this page first.");
  return { id: String(r["id"]), cloudId: String(r["cloud_id"]) };
}

/** One live read, parsed. Jira's own error text never reaches the page; a safe line does. */
async function read<T>(
  c: Connection,
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  try {
    const parsed = schema.safeParse(await jiraFetch(c, path));
    if (!parsed.success) throw new JiraApiError("unexpected", 200);
    return parsed.data;
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
}

const jiraIdOk = (id: string) => /^\d{1,20}$/.test(id);
async function shape(
  c: Connection,
  jiraProjectId: string,
  issueTypeId?: string,
): Promise<JiraProjectShape> {
  if (!jiraIdOk(jiraProjectId) || (issueTypeId !== undefined && !jiraIdOk(issueTypeId)))
    throw new Error("Choose a Jira project from the list.");
  const [project, statuses] = await Promise.all([
    read(c, `/rest/api/3/project/${jiraProjectId}`, projectSchema),
    read(c, `/rest/api/3/project/${jiraProjectId}/statuses`, projectStatusesSchema),
  ]);
  const types = issueTypes(statuses);
  const type = issueTypeId ? (types.find((t) => t.id === issueTypeId) ?? null) : bugType(types);
  const fields: JiraCreateField[] = [];
  // The create screen can hold more fields than one page; stop at the reported total (or after five pages).
  for (let page = 0; type && page < 5; page++) {
    const meta = await read(
      c,
      `/rest/api/3/issue/createmeta/${jiraProjectId}/issuetypes/${type.id}?maxResults=100&startAt=${fields.length}`,
      createMetaSchema,
    );
    fields.push(...createFields(meta.fields));
    if (!meta.fields.length || fields.length >= (meta.total ?? 0)) break;
  }
  return {
    project: { id: project.id, key: project.key, name: project.name },
    issueTypes: types,
    issueTypeId: type?.id ?? null,
    fields,
    suggestion: type
      ? suggestConfig(type.statuses, fields.find((f) => f.id === "priority")?.options ?? [], fields)
      : null,
  };
}

const MAPPINGS = `select m.project_id,p.name as project_name,m.jira_project_id,m.jira_project_key,m.issue_type_id,m.state,m.config,(select count(*) from bugflow.jira_outbox o where o.mapping_id=m.id and o.state in ('pending','retry','processing'))::int as waiting,(select count(*) from bugflow.jira_outbox o where o.mapping_id=m.id and o.state='dead')::int as parked,(select count(*) from bugflow.jira_conflicts x join bugflow.jira_issue_links l on l.id=x.link_id where l.mapping_id=m.id and x.state='open')::int as conflicts from bugflow.jira_project_mappings m join bugflow.projects p on p.id=m.project_id where m.connection_id=$1 and m.state in ('draft','active','paused')`;
function toView(r: Row): JiraMappingView {
  const config = mappingConfigSchema.safeParse(r["config"]);
  return {
    projectId: String(r["project_id"]),
    projectName: String(r["project_name"]),
    jiraProjectId: String(r["jira_project_id"]),
    jiraProjectKey: String(r["jira_project_key"]),
    issueTypeId: String(r["issue_type_id"]),
    state: String(r["state"]) as JiraMappingState,
    config: config.success ? config.data : null,
    queue: {
      waiting: Number(r["waiting"]),
      parked: Number(r["parked"]),
      conflicts: Number(r["conflicts"]),
    },
  };
}
async function mappingOf(c: Connection, projectId: string): Promise<JiraMappingView | null> {
  const { rows } = await neonQuery(`${MAPPINGS} and m.project_id=$2 limit 1`, [c.id, projectId]);
  return rows[0] ? toView(rows[0]) : null;
}

/** The Jira projects the connected account can see, the BugFlow projects, and the mappings that exist. */
export async function jiraResources(): Promise<{
  jiraProjects: JiraProjectInfo[];
  projects: { id: string; name: string }[];
  mappings: JiraMappingView[];
}> {
  await requireAdmin();
  const c = await connection();
  const jiraProjects: JiraProjectInfo[] = [];
  for (let page = 0; page < 10; page++) {
    const found = await read(
      c,
      `/rest/api/3/project/search?maxResults=50&startAt=${jiraProjects.length}&orderBy=name`,
      projectPageSchema,
    );
    jiraProjects.push(...found.values.map(({ id, key, name }) => ({ id, key, name })));
    if (found.isLast !== false || !found.values.length) break;
  }
  const [projects, mappings] = await Promise.all([
    neonQuery(`select id,name from bugflow.projects where not archived order by name,id limit 100`),
    neonQuery(`${MAPPINGS} order by p.name`, [c.id]),
  ]);
  return {
    jiraProjects,
    projects: projects.rows.map((r) => ({ id: String(r["id"]), name: String(r["name"]) })),
    mappings: mappings.rows.map(toView),
  };
}

/** One Jira project's issue types, statuses and create-screen fields, with a mapping to start from. */
export async function jiraProjectShape(jiraProjectId: string, issueTypeId?: string) {
  await requireAdmin();
  return shape(await connection(), jiraProjectId, issueTypeId);
}

export type MappingInput = {
  projectId: string;
  jiraProjectId: string;
  issueTypeId: string;
  config: MappingConfig;
};

/**
 * Saves a mapping as a draft (or changes the translation rules of a paused one). An active mapping is not
 * edited in place: pause it first, so no bug is exported halfway between two sets of rules.
 */
export async function saveJiraMapping(input: MappingInput): Promise<JiraMappingView> {
  checkOrigin();
  const admin = await requireAdmin();
  const c = await connection();
  const problems = configProblems(input.config);
  if (problems.length) throw new Error(problems[0]);
  const live = await shape(c, input.jiraProjectId, input.issueTypeId);
  if (!live.issueTypeId) throw new Error("That issue type is not in the Jira project.");
  // `kept` is the row being edited: a draft, or a paused mapping that still points at the same Jira project and
  // issue type (its links do). Nothing is written while an active mapping exists for the project.
  // The audit row is written by the same statement, and only when a row was saved.
  const { rows } = await neonExecute(
    `with kept as (select id from bugflow.jira_project_mappings where connection_id=$1 and project_id=$2 and (state='draft' or (state='paused' and jira_project_id=$3 and issue_type_id=$5)) order by (state='paused') desc,updated_at desc limit 1), busy as (select 1 from bugflow.jira_project_mappings where project_id=$2 and state in ('active','paused') and id not in (select id from kept)), changed as (update bugflow.jira_project_mappings m set jira_project_id=$3,jira_project_key=$4,issue_type_id=$5,config=$6::jsonb,updated_at=now() from kept where m.id=kept.id and not exists(select 1 from busy) returning m.id), added as (insert into bugflow.jira_project_mappings(connection_id,project_id,jira_project_id,jira_project_key,issue_type_id,config,state,created_by) select $1,p.id,$3,$4,$5,$6::jsonb,'draft',$7::uuid from bugflow.projects p where p.id=$2 and not p.archived and not exists(select 1 from kept) and not exists(select 1 from busy) returning id), done as (select id from changed union all select id from added), logged as (insert into bugflow.activity(id,actor_id,action,detail) select gen_random_uuid(),$7::uuid,'jira.mapping_saved',$8::jsonb from (select 1 from done limit 1) x) select id from done`,
    [
      c.id,
      input.projectId,
      input.jiraProjectId,
      live.project.key,
      input.issueTypeId,
      JSON.stringify(input.config),
      admin.userId,
      JSON.stringify({ projectId: input.projectId, jiraProject: live.project.key }),
    ],
  );
  if (!rows.length)
    throw new Error(
      "This project's Jira sync is on, or paused with another Jira project. Pause it to change the rules; disconnecting is the way to point it elsewhere.",
    );
  const saved = await mappingOf(c, input.projectId);
  if (!saved) throw new Error("The mapping could not be read back.");
  return saved;
}

export type MappingCheck = {
  mapping: JiraMappingView;
  /** Empty: the live Jira project can take what BugFlow will send. */
  problems: string[];
  /** Bugs in the project now. None is sent by switching on; each goes when it is next changed. */
  bugs: number;
};

/** The saved mapping checked against the Jira project as it is right now. */
export async function previewJiraMapping(projectId: string): Promise<MappingCheck> {
  await requireAdmin();
  return check(await connection(), projectId);
}
async function check(c: Connection, projectId: string): Promise<MappingCheck> {
  const mapping = await mappingOf(c, projectId);
  if (!mapping) throw new Error("Save a mapping for this project first.");
  const { rows } = await neonQuery(
    `select count(*)::int as n from bugflow.bugs where project_id=$1 and kind='bug' and deleted_at is null`,
    [projectId],
  );
  const bugs = Number(rows[0]?.["n"] ?? 0);
  if (!mapping.config)
    return { mapping, problems: ["The saved mapping cannot be read. Save it again."], bugs };
  const live = await shape(c, mapping.jiraProjectId, mapping.issueTypeId);
  const type = live.issueTypes.find((t) => t.id === live.issueTypeId) ?? null;
  return {
    mapping,
    problems: [
      ...configProblems(mapping.config),
      ...shapeProblems(mapping.config, type, live.fields),
    ],
    bugs,
  };
}

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === "23505";

/** Switches a draft or paused mapping on, only if it passes against live Jira at this moment. */
export async function activateJiraMapping(projectId: string): Promise<MappingCheck> {
  checkOrigin();
  const admin = await requireAdmin();
  const c = await connection();
  const result = await check(c, projectId);
  if (result.problems.length) return result;
  const q = audited(
    `update bugflow.jira_project_mappings set state='active',updated_at=now() where connection_id=$1 and project_id=$2 and state in ('draft','paused') returning id`,
    [c.id, projectId],
    {
      actorId: admin.userId,
      action: "jira.mapping_activated",
      detail: { projectId, jiraProject: result.mapping.jiraProjectKey },
    },
  );
  try {
    await neonExecute(q.query, q.params);
  } catch (error) {
    if (!isUnique(error)) throw error;
    return {
      ...result,
      problems: ["Another BugFlow project is already synchronized with this Jira project."],
    };
  }
  const mapping = await mappingOf(c, projectId);
  return mapping ? { ...result, mapping } : result;
}

/** Stops exporting for one project. Changes keep collecting and are sent when it is switched on again. */
export async function pauseJiraMapping(projectId: string): Promise<JiraMappingView> {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonQuery(
    `select id from bugflow.jira_connections where disconnected_at is null limit 1`,
  );
  const c: Connection = { id: String(rows[0]?.["id"] ?? ""), cloudId: "" };
  if (!c.id) throw new Error("Connect Jira first.");
  const q = audited(
    `update bugflow.jira_project_mappings set state='paused',updated_at=now() where connection_id=$1 and project_id=$2 and state='active' returning id`,
    [c.id, projectId],
    { actorId: admin.userId, action: "jira.mapping_paused", detail: { projectId } },
  );
  await neonExecute(q.query, q.params);
  const mapping = await mappingOf(c, projectId);
  if (!mapping) throw new Error("This project has no Jira mapping.");
  return mapping;
}
