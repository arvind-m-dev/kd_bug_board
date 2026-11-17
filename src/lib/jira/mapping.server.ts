import { z } from "zod";
import { audited } from "../audit.server";
import { formatBugCode } from "../bug-workflow";
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
import { type BugDuplicates, type DupLocal, type DupRemote, bugDuplicates } from "./duplicates";
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
  const before = await mappingOf(c, input.projectId);
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
  // Name labels switched on or off: every linked issue is looked at again, so existing issues get (or lose) them
  // without waiting for their next change. The entries wait in the queue while the project is paused.
  if (before && !!before.config?.nameLabels !== !!input.config.nameLabels)
    await neonExecute(
      `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select l.mapping_id,l.bug_id,'sync','labels:'||l.bug_id||':'||$3 from bugflow.jira_issue_links l join bugflow.bugs b on b.id=l.bug_id where l.connection_id=$1 and l.mapping_id in (select id from bugflow.jira_project_mappings where connection_id=$1 and project_id=$2) and l.state in ('linked','conflict') and b.deleted_at is null on conflict do nothing`,
      [c.id, input.projectId, crypto.randomUUID()],
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

// ---- first sync: what existed before the project was switched on ----

/** Bug Board states that count as finished: sent to Jira too, where they land in the mapped (Done) status. */
const FINISHED = `('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')`;
/** At most this many Jira pages (100 issues each) are read per run; a larger project takes another run. */
const IMPORT_PAGES = 50;

export type InitialSyncCount = {
  /** Bug Board bugs (not in Trash) with no Jira issue yet: still open, and finished. */
  toJiraOpen: number;
  toJiraFinished: number;
  /** Jira issues of the mapped type with no Bug Board bug yet, not Done in Jira: these come in. */
  fromJira: number;
  /**
   * Jira issues already Done with no Bug Board bug. Left out: Bug Board may not take Jira's Done as resolved
   * (QA has not verified it), so each would arrive as a new bug waiting for a decision.
   */
  fromJiraDoneSkipped: number;
  /** More Jira issues than one run reads: run it again once this one is through. */
  more: boolean;
};

type Unlinked = { id: string; key: string; title: string; updatedAt: string; done: boolean };

/** Jira issues of the mapped type in the mapped project, each marked when a link (of any state) points at it. */
async function jiraIssuesOf(c: Connection, m: JiraMappingView, maxPages = IMPORT_PAGES) {
  const found: Unlinked[] = [];
  let token: string | null = null;
  let pages = 0;
  do {
    const raw = (await jiraFetch(c, "/rest/api/3/search/jql", {
      method: "POST",
      body: {
        jql: `project = ${m.jiraProjectId} AND issuetype = ${m.issueTypeId} ORDER BY created ASC`,
        fields: ["updated", "status", "summary"],
        maxResults: 100,
        ...(token ? { nextPageToken: token } : {}),
      },
    })) as { issues?: unknown; nextPageToken?: unknown } | null;
    const issues = Array.isArray(raw?.issues) ? raw.issues : [];
    for (const i of issues as Record<string, unknown>[]) {
      const fields = (i["fields"] ?? {}) as Record<string, unknown>;
      const status = (fields["status"] ?? {}) as Record<string, unknown>;
      const category = (status["statusCategory"] ?? {}) as Record<string, unknown>;
      const updated = Date.parse(String(fields["updated"] ?? ""));
      if (typeof i["id"] !== "string" || typeof i["key"] !== "string" || Number.isNaN(updated))
        continue;
      found.push({
        id: i["id"],
        key: i["key"],
        title: typeof fields["summary"] === "string" ? fields["summary"] : "",
        updatedAt: new Date(updated).toISOString(),
        done: category["key"] === "done",
      });
    }
    token = typeof raw?.nextPageToken === "string" ? raw.nextPageToken : null;
    pages++;
  } while (token && pages < maxPages);
  if (!found.length) return { issues: found.map((i) => ({ ...i, linked: false })), more: !!token };
  const { rows } = await neonQuery(
    `select jira_issue_id from bugflow.jira_issue_links where connection_id=$1 and jira_issue_id=any($2::text[])`,
    [c.id, found.map((i) => i.id)],
  );
  const linked = new Set(rows.map((r) => String(r["jira_issue_id"])));
  return { issues: found.map((i) => ({ ...i, linked: linked.has(i.id) })), more: !!token };
}

/** Jira issues of the mapped type in the mapped project that no link points at yet. */
async function unlinkedJiraIssues(c: Connection, m: JiraMappingView) {
  const all = await jiraIssuesOf(c, m);
  return { issues: all.issues.filter((i) => !i.linked), more: all.more };
}

async function activeMapping(c: Connection, projectId: string) {
  const m = await mappingOf(c, projectId);
  if (!m) throw new Error("This project has no Jira mapping.");
  if (m.state !== "active") throw new Error("Switch the project's Jira sync on first.");
  return m;
}

const UNSENT = `from bugflow.bugs b where b.project_id=$1 and b.kind='bug' and b.deleted_at is null and not exists(select 1 from bugflow.jira_issue_links l where l.bug_id=b.id)`;

/** Counts what a first sync would move, in both directions, without changing anything. */
export async function initialSyncPreview(projectId: string): Promise<InitialSyncCount> {
  await requireAdmin();
  const c = await connection();
  const m = await activeMapping(c, projectId);
  const [{ rows }, jira] = await Promise.all([
    neonQuery(
      `select count(*) filter (where b.status not in ${FINISHED})::int as open,count(*) filter (where b.status in ${FINISHED})::int as finished ${UNSENT}`,
      [projectId],
    ),
    unlinkedJiraIssues(c, m),
  ]);
  return {
    toJiraOpen: Number(rows[0]?.["open"] ?? 0),
    toJiraFinished: Number(rows[0]?.["finished"] ?? 0),
    fromJira: jira.issues.filter((i) => !i.done).length,
    fromJiraDoneSkipped: jira.issues.filter((i) => i.done).length,
    more: jira.more,
  };
}

/**
 * Queues the first sync: every Bug Board bug without a Jira issue is queued for creation, and every open Jira
 * issue without a Bug Board bug is queued for import. Both go through the same queues and rules as any other
 * change, so a bug is created once on each side however often this runs (the create entry's key is fixed per
 * bug, and the import entry's key per Jira issue and change time). Nothing is sent here; the job does it.
 */
export async function startInitialSync(projectId: string): Promise<InitialSyncCount> {
  checkOrigin();
  const admin = await requireAdmin();
  const c = await connection();
  const m = await activeMapping(c, projectId);
  const jira = await unlinkedJiraIssues(c, m);
  const incoming = jira.issues.filter((i) => !i.done);
  const { results } = await neonExecute<{ results: { rows: Row[] }[] }>([
    {
      query: `with q as (insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select pm.id,b.id,'create','create:'||pm.id||':'||b.id from bugflow.bugs b join bugflow.jira_project_mappings pm on pm.project_id=b.project_id and pm.connection_id=$2 and pm.state='active' where b.project_id=$1 and b.kind='bug' and b.deleted_at is null and not exists(select 1 from bugflow.jira_issue_links l where l.bug_id=b.id) on conflict do nothing returning bug_id) select (b.status in ${FINISHED}) as finished from q join bugflow.bugs b on b.id=q.bug_id`,
      params: [projectId, c.id],
    },
    {
      query: `insert into bugflow.jira_inbox(connection_id,dedup_key,event_type,source,jira_issue_id,jira_issue_key,event_at,envelope) select $1,'rec:'||x.id||':'||x.updated,'reconcile','reconcile',x.id,x.key,x.updated::timestamptz,jsonb_build_object('projectId',$2::text) from jsonb_to_recordset($3::jsonb) as x(id text,key text,updated text) on conflict (connection_id,dedup_key) do nothing returning id`,
      params: [
        c.id,
        m.jiraProjectId,
        JSON.stringify(incoming.map((i) => ({ id: i.id, key: i.key, updated: i.updatedAt }))),
      ],
    },
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values(gen_random_uuid(),$1,'jira.initial_sync',$2::jsonb)`,
      params: [
        admin.userId,
        JSON.stringify({ projectId, jiraProject: m.jiraProjectKey, fromJira: incoming.length }),
      ],
    },
  ]);
  const queued = results[0]?.rows ?? [];
  return {
    toJiraOpen: queued.filter((r) => r["finished"] !== true).length,
    toJiraFinished: queued.filter((r) => r["finished"] === true).length,
    fromJira: incoming.length,
    fromJiraDoneSkipped: jira.issues.length - incoming.length,
    more: jira.more,
  };
}

// ---- possible double entry: the same bug in Bug Board and in Jira ----

export type ProjectDuplicates = BugDuplicates & {
  projectId: string;
  projectName: string;
  jiraProjectKey: string;
  /** Jira has more issues than one check reads; only the first ones were compared. */
  more: boolean;
};

const DUP_PAGES = 10;

/**
 * For every synced project: Bug Board bugs and Jira issues with the same title. An unlinked bug and an unlinked
 * issue with the same title are offered for linking; same titles on one side are listed. Bugs in Trash and
 * findings an Admin marked as not duplicates are left out.
 */
export async function jiraBugDuplicates(): Promise<ProjectDuplicates[]> {
  await requireAdmin();
  const c = await connection();
  const { rows } = await neonQuery(`${MAPPINGS} and m.state in ('active','paused')`, [c.id]);
  const mappings = rows.map(toView);
  const { rows: ignoredRows } = await neonQuery(
    `select distinct detail->>'key' as key from bugflow.activity where action='jira.duplicate_ignored'`,
  );
  const ignored = new Set(ignoredRows.map((r) => String(r["key"])));
  try {
    return await Promise.all(
      mappings.map(async (m) => {
        const [{ rows: bugs }, jira] = await Promise.all([
          neonQuery(
            `select b.id,b.title,b.code_prefix,l.jira_issue_key,(l.id is not null) as linked from bugflow.bugs b left join bugflow.jira_issue_links l on l.bug_id=b.id and l.state<>'disabled' where b.project_id=$1 and b.kind='bug' and b.deleted_at is null order by b.id limit 2000`,
            [m.projectId],
          ),
          jiraIssuesOf(c, m, DUP_PAGES),
        ]);
        const local: DupLocal[] = bugs.map((r) => ({
          bugId: String(r["id"]),
          code: formatBugCode(String(r["id"]), String(r["code_prefix"] ?? "BF")),
          title: String(r["title"] ?? ""),
          // An issue still being created counts as linked: it is not a second entry.
          issueKey: r["jira_issue_key"] ? String(r["jira_issue_key"]) : r["linked"] ? "…" : null,
        }));
        const remote: DupRemote[] = jira.issues.map((i) => ({
          issueId: i.id,
          key: i.key,
          title: i.title,
          linked: i.linked,
        }));
        return {
          projectId: m.projectId,
          projectName: m.projectName,
          jiraProjectKey: m.jiraProjectKey,
          more: jira.more,
          ...bugDuplicates(local, remote, ignored),
        };
      }),
    );
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
}

/** Marks one finding as not a duplicate. It stays out of the check until the bugs or issues in it change. */
export async function ignoreJiraDuplicate(key: string): Promise<ProjectDuplicates[]> {
  checkOrigin();
  const admin = await requireAdmin();
  await neonExecute([
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values(gen_random_uuid(),$1,'jira.duplicate_ignored',jsonb_build_object('key',$2::text))`,
      params: [admin.userId, key],
    },
  ]);
  return jiraBugDuplicates();
}

const issueCheckSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    fields: z
      .object({
        project: z.object({ id: z.string() }).passthrough(),
        issuetype: z.object({ id: z.string() }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Links an unlinked Bug Board bug to an unlinked Jira issue an Admin says are the same bug. From then on they are
 * kept in step like any other pair, starting from Jira's current values: whatever differs in Bug Board is then
 * sent to Jira by the next pass (the confirmation says so). Nothing is deleted on either side.
 */
export async function linkJiraDuplicate(
  projectId: string,
  bugId: string,
  issueId: string,
): Promise<ProjectDuplicates[]> {
  checkOrigin();
  const admin = await requireAdmin();
  const c = await connection();
  const m = await activeMapping(c, projectId);
  let issue: z.infer<typeof issueCheckSchema>;
  try {
    const parsed = issueCheckSchema.safeParse(
      await jiraFetch(
        c,
        `/rest/api/3/issue/${encodeURIComponent(issueId)}?fields=project,issuetype`,
      ),
    );
    if (!parsed.success) throw new JiraApiError("unexpected", 200);
    issue = parsed.data;
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
  if (issue.fields.project.id !== m.jiraProjectId || issue.fields.issuetype.id !== m.issueTypeId)
    throw new Error("That Jira issue is not a Bug in this project's Jira project any more.");
  try {
    const { results } = await neonExecute<{ results: { rows: Row[] }[] }>([
      audited(
        `insert into bugflow.jira_issue_links(mapping_id,connection_id,bug_id,jira_issue_id,jira_issue_key,origin,state) select pm.id,$1,b.id,$4,$5,'bugflow','linked' from bugflow.jira_project_mappings pm join bugflow.bugs b on b.project_id=pm.project_id where pm.connection_id=$1 and pm.project_id=$2 and b.id=$3::bigint and b.kind='bug' and b.deleted_at is null and not exists(select 1 from bugflow.jira_issue_links l where l.bug_id=b.id and l.state<>'disabled') returning id`,
        [c.id, projectId, bugId, issue.id, issue.key],
        {
          actorId: admin.userId,
          bugId,
          action: "jira.duplicate_linked",
          detail: { issueKey: issue.key, issueId: issue.id },
        },
      ),
      {
        query: `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select mapping_id,bug_id,'sync','sync:'||bug_id||':'||gen_random_uuid() from bugflow.jira_issue_links where connection_id=$1 and jira_issue_id=$2 and state='linked' on conflict do nothing`,
        params: [c.id, issue.id],
      },
    ]);
    if (!results[0]?.rows.length)
      throw new Error("That bug is in Trash or already linked to a Jira issue.");
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "23505")
      throw new Error("That Jira issue is already linked to another bug.");
    throw error;
  }
  return jiraBugDuplicates();
}
