import { cleanOptions } from "../bug-workflow";
import { neonExecute, neonQuery } from "../neon.server";
import { derivedUuid } from "./ids";
import { noteSprints } from "./sprints.server";
import type { InboundChange } from "./inbound";
import { type InboundMeta, type SyncStore, SyncProblem } from "./processor";
import { JIRA_SYNC_USER_ID } from "./types";

// Writing a Jira change into BugFlow. This is the integration's own write path: it never goes through a
// browser session or a portal. Every statement checks the bug's version, records a request id, and writes the
// same history rows (activity, status history, assignment, verification) a person's change leaves, as the
// non-login Jira Sync user. What may be written at all was decided beforehand by the pure rules in inbound.ts.

type Row = Record<string, unknown>;
type Batch = { results: { rows: Row[] }[] };

/** A bug this change may touch: the expected version, a real bug, not in the Trash, and not a repeat. */
const UNCHANGED = `b.id=$1 and b.updated_at=$2::timestamptz and b.deleted_at is null and b.kind='bug' and not exists(select 1 from bugflow.bug_mutations where request_id=$3)`;
/** An active member with a live portal on the bug's project. Jira cannot widen anyone's access. */
const ON_PROJECT = (user: string, project: string) =>
  `exists(select 1 from bugflow.portals p join bugflow.users u on u.id=p.user_id join bugflow.portal_projects pp on pp.portal_id=p.id where p.user_id=${user} and p.type<>'admin' and p.active and u.active and u.deleted_at is null and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) and pp.project_id=${project})`;

const versionOf = (rows: Row[] | undefined) => (rows?.[0] ? String(rows[0]["version"]) : null);
const unzip = (hops: [string, string][]) => [hops.map((h) => h[0]), hops.map((h) => h[1])];
const HISTORY = (from: number, to: number) =>
  `history as (insert into bugflow.status_history(id,bug_id,actor_id,previous_status,new_status,created_at) select gen_random_uuid(),c.id,$4,h.prev,h.next,clock_timestamp()+(h.ord*interval '1 millisecond') from changed c cross join unnest($${from}::text[],$${to}::text[]) with ordinality h(prev,next,ord))`;

async function edit(
  bugId: string,
  version: string,
  e: NonNullable<InboundChange["edit"]>,
  tag: object,
  meta: InboundMeta,
) {
  const editId = crypto.randomUUID();
  const applied = (n: number) => `exists(select 1 from bugflow.activity where id=$${n}::uuid)`;
  const statements = [
    {
      // The audit row is written by the same statement as the version-checked update; the detail and step
      // writes below depend on it, so they never apply the leftovers of an edit that lost.
      query: `with u as (update bugflow.bugs b set title=coalesce($5,b.title),description=coalesce($6,b.description),expected=coalesce($7,b.expected),actual=coalesce($8,b.actual),environment=coalesce($9,b.environment),priority=coalesce($10,b.priority),severity=coalesce($11,b.severity),due_on=case when $12::boolean then $13::date else b.due_on end,estimate=case when $16::boolean then $17::smallint else b.estimate end,updated_at=clock_timestamp() where ${UNCHANGED} returning b.id,b.updated_at::text as version), mutation as (insert into bugflow.bug_mutations(request_id,bug_id,actor_id) select $3,id,$4 from u), logged as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $14,id,$4,'bug.edited',$15::jsonb from u) select version from u`,
      params: [
        bugId,
        version,
        await derivedUuid(meta.linkId, "edit", version),
        JIRA_SYNC_USER_ID,
        e.title ?? null,
        e.description ?? null,
        e.expected ?? null,
        e.actual ?? null,
        e.environment ?? null,
        e.priority ?? null,
        e.severity ?? null,
        e.dueOn !== undefined,
        e.dueOn ?? null,
        editId,
        JSON.stringify({
          ...tag,
          fields: Object.keys(e),
          ...(e.title ? { title: e.title } : {}),
          ...(e.priority ? { priority: e.priority } : {}),
          ...(e.severity ? { severity: e.severity } : {}),
          ...(e.dueOn !== undefined ? { due: e.dueOn ?? "none" } : {}),
        }),
        e.estimate !== undefined,
        e.estimate ?? null,
      ],
    },
    ...(e.module === undefined
      ? []
      : [
          {
            query: `update bugflow.bug_details set module_name=$2 where bug_id=$1 and ${applied(3)}`,
            params: [bugId, e.module, editId],
          },
        ]),
    ...(e.steps === undefined
      ? []
      : [
          {
            query: `delete from bugflow.steps where bug_id=$1 and ${applied(2)}`,
            params: [bugId, editId],
          },
          {
            query: `insert into bugflow.steps(bug_id,position,content) select $1,s.ordinality::int,s.value from jsonb_array_elements_text($2::jsonb) with ordinality s(value,ordinality) where ${applied(3)}`,
            params: [bugId, JSON.stringify(e.steps), editId],
          },
        ]),
  ];
  const { results } = await neonExecute<Batch>(statements);
  return versionOf(results[0]?.rows);
}

async function assign(
  bugId: string,
  version: string,
  a: NonNullable<InboundChange["assign"]>,
  tag: object,
  meta: InboundMeta,
) {
  const [from, to] = unzip(a.hops);
  // The new assignee replaces the previous main assignee; other co-assignees stay. The member check is part of
  // the statement, so someone who lost access between the decision and the write is not assigned.
  const { rows } = await neonExecute(
    `with prior as (select b.* from bugflow.bugs b where ${UNCHANGED} and ${ON_PROJECT("$5::uuid", "b.project_id")} for update), changed as (update bugflow.bugs b set assignee_id=$5::uuid,status=$6,updated_at=clock_timestamp() from prior old where b.id=old.id returning b.id,b.updated_at::text as version), mutation as (insert into bugflow.bug_mutations(request_id,bug_id,actor_id) select $3,id,$4 from changed), ${HISTORY(7, 8)}, assignment as (insert into bugflow.assignments(id,bug_id,actor_id,previous_assignee_id,assignee_id) select gen_random_uuid(),c.id,$4,p.assignee_id,$5::uuid from changed c join prior p on p.id=c.id), dropped as (delete from bugflow.bug_assignees x using prior p where x.bug_id=p.id and x.user_id=p.assignee_id and x.user_id<>$5::uuid and exists(select 1 from changed)), added as (insert into bugflow.bug_assignees(bug_id,user_id,assigned_by) select c.id,$5::uuid,$4 from changed c on conflict do nothing), logged as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select gen_random_uuid(),c.id,$4,'bug.assign',$9::jsonb||jsonb_build_object('previousStatus',p.status,'status',$6::text,'assignee',$5::text,'assignees',jsonb_build_array($5::text)) from changed c join prior p on p.id=c.id) select version from changed`,
    [
      bugId,
      version,
      await derivedUuid(meta.linkId, "assign", version),
      JIRA_SYNC_USER_ID,
      a.userId,
      a.status,
      from,
      to,
      JSON.stringify(tag),
    ],
  );
  return versionOf(rows);
}

async function move(
  bugId: string,
  version: string,
  s: NonNullable<InboundChange["status"]>,
  tag: object,
  meta: InboundMeta,
) {
  const [from, to] = unzip(s.hops);
  const notes = `${s.verify ? "Resolved" : "Changed"} in Jira (${meta.issueKey})`;
  // `b.status=$5` re-checks the status the path was computed from. A passed retest is recorded as a
  // verification by the integration, so the history shows who (what) resolved the bug.
  const { rows } = await neonExecute(
    `with prior as (select b.* from bugflow.bugs b where ${UNCHANGED} and b.status=$5 for update), changed as (update bugflow.bugs b set status=$6,fix_notes=case when $6='RECHECK' then $9 else b.fix_notes end,updated_at=clock_timestamp() from prior old where b.id=old.id returning b.id,b.updated_at::text as version), mutation as (insert into bugflow.bug_mutations(request_id,bug_id,actor_id) select $3,id,$4 from changed), ${HISTORY(7, 8)}, verification as (insert into bugflow.verifications(id,bug_id,actor_id,passed,notes) select gen_random_uuid(),id,$4,true,$9 from changed where $10::boolean), logged as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select gen_random_uuid(),c.id,$4,case when $10::boolean then 'bug.verify' else 'bug.status' end,$11::jsonb||jsonb_build_object('previousStatus',p.status,'status',$6::text,'notes',$9::text) from changed c join prior p on p.id=c.id) select version from changed`,
    [
      bugId,
      version,
      await derivedUuid(meta.linkId, "status", version),
      JIRA_SYNC_USER_ID,
      s.from,
      s.target,
      from,
      to,
      notes,
      s.verify,
      JSON.stringify(tag),
    ],
  );
  return versionOf(rows);
}

/**
 * Jira moved the issue between sprints. The bug leaves the open sprint it is in and joins the one that mirrors
 * Jira's, under one lock per bug, with the same conditions as an Admin's move (sprint open, same project, not
 * an epic, not in another open sprint). If the bug did not end up where it should, nothing is kept.
 */
async function moveSprint(bugId: string, to: string | null, tag: object): Promise<boolean> {
  const detail = JSON.stringify(tag);
  try {
    await neonExecute([
      {
        query: `select pg_advisory_xact_lock(hashtextextended('bugflow.sprint_item:' || $1::text, 0))`,
        params: [bugId],
      },
      {
        query: `with gone as (update bugflow.sprint_items si set removed_at=now(),removed_by=$2 from bugflow.sprints s where s.id=si.sprint_id and si.bug_id=$1::bigint and si.removed_at is null and s.state in ('planned','active') and ($3::uuid is null or si.sprint_id<>$3::uuid) returning si.sprint_id) insert into bugflow.activity(id,actor_id,bug_id,action,detail) select gen_random_uuid(),$2,$1::bigint,'sprint.item_removed',$4::jsonb||jsonb_build_object('sprint',sprint_id::text) from gone`,
        params: [bugId, JIRA_SYNC_USER_ID, to, detail],
      },
      ...(to === null
        ? []
        : [
            {
              query: `with added as (insert into bugflow.sprint_items(sprint_id,bug_id,added_by) select $1,$2::bigint,$3 from bugflow.sprints s where s.id=$1 and s.state in ('planned','active') and exists(select 1 from bugflow.bugs b where b.id=$2::bigint and b.deleted_at is null and b.kind<>'epic' and b.project_id=s.project_id) and not exists(select 1 from bugflow.sprint_items o join bugflow.sprints os on os.id=o.sprint_id where o.bug_id=$2::bigint and o.removed_at is null and os.state in ('planned','active') and os.id<>$1) on conflict (sprint_id,bug_id) do update set removed_at=null,removed_by=null,added_at=now(),added_by=$3 where bugflow.sprint_items.removed_at is not null returning bug_id) insert into bugflow.activity(id,actor_id,bug_id,action,detail) select gen_random_uuid(),$3,bug_id,'sprint.item_added',$4::jsonb||jsonb_build_object('sprint',$1::text) from added`,
              params: [to, bugId, JIRA_SYNC_USER_ID, detail],
            },
            {
              // Not in the sprint after all (it closed, or the bug moved meanwhile): fail, so the removal above
              // is undone with it.
              query: `select 1/count(*) from bugflow.sprint_items where sprint_id=$1 and bug_id=$2::bigint and removed_at is null`,
              params: [to, bugId],
            },
          ]),
    ]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "22012") return false;
    throw error;
  }
}

export const inboundStore: Pick<
  SyncStore,
  "linkByIssue" | "inboundContext" | "applyInbound" | "importIssue" | "noteSprints"
> = {
  async linkByIssue(connectionId, issueId) {
    const { rows } = await neonQuery(
      `select bug_id,mapping_id,(state='disabled') as unlinked from bugflow.jira_issue_links where connection_id=$1 and jira_issue_id=$2 limit 1`,
      [connectionId, issueId],
    );
    return rows[0]
      ? {
          bugId: String(rows[0]["bug_id"]),
          mappingId: String(rows[0]["mapping_id"]),
          unlinked: rows[0]["unlinked"] === true,
        }
      : null;
  },

  async inboundContext(bugId, mapping, jira) {
    const { results } = await neonQuery<Batch>(
      [
        { query: `select value from bugflow.settings where key='dropdown_options'`, params: [] },
        {
          // Only an Admin-confirmed link between a member and an Atlassian account counts as that person.
          query: `select um.user_id,${ON_PROJECT("um.user_id", "$3::uuid")} as on_project from bugflow.jira_user_mappings um where um.connection_id=$1 and um.account_id=$2 and um.confirmed_at is not null`,
          params: [mapping.connectionId, jira.assignee, mapping.projectId],
        },
        {
          query: `select (select jsonb_build_object('sprintId',s.id,'open',s.state in ('planned','active')) from bugflow.jira_sprint_links jl join bugflow.sprints s on s.id=jl.sprint_id where jl.connection_id=$1 and jl.jira_sprint_id=$2::bigint) as target,exists(select 1 from bugflow.sprint_items si join bugflow.sprints s on s.id=si.sprint_id where si.bug_id=$3::bigint and si.removed_at is null and s.state in ('planned','active') and not exists(select 1 from bugflow.jira_sprint_links jl where jl.sprint_id=s.id and jl.connection_id=$1)) as elsewhere`,
          params: [mapping.connectionId, jira.sprint, bugId],
        },
      ],
      [],
      { "Neon-Batch-Read-Only": "true" },
    );
    const member = results[1]?.rows[0];
    const sprint = results[2]?.rows[0];
    const target = sprint?.["target"] as { sprintId?: unknown; open?: unknown } | null | undefined;
    return {
      options: cleanOptions(results[0]?.rows[0]?.["value"]),
      assignee: member
        ? { userId: String(member["user_id"]), onProject: member["on_project"] === true }
        : null,
      sprint: {
        target: target?.sprintId
          ? { sprintId: String(target.sprintId), open: target.open === true }
          : null,
        elsewhere: sprint?.["elsewhere"] === true,
      },
    };
  },

  noteSprints,

  async applyInbound(bugId, version, change, meta) {
    const tag = {
      source: "jira",
      issueKey: meta.issueKey,
      ...(meta.actor ? { jiraUser: meta.actor.displayName } : {}),
    };
    let v: string | null = version;
    if (change.edit) v = await edit(bugId, v, change.edit, tag, meta);
    if (v && change.assign) v = await assign(bugId, v, change.assign, tag, meta);
    if (v && change.status) v = await move(bugId, v, change.status, tag, meta);
    if (v && change.sprint && !(await moveSprint(bugId, change.sprint.to, tag))) return null;
    return v ? { version: v } : null;
  },

  async importIssue(mapping, remote, draft, codePrefix) {
    // The request id comes from the connection and the immutable issue id, so the same issue can only ever
    // become one bug. Bug, details, steps, history, audit entry and link are one statement: all or nothing.
    const requestId = await derivedUuid("jira-import", mapping.connectionId, remote.id);
    const reporter = remote.reporter;
    const { rows } = await neonExecute(
      `with existing as (select d.bug_id as id from bugflow.bug_details d where d.request_id=$1), reporter as (select coalesce((select um.user_id from bugflow.jira_user_mappings um join bugflow.users u on u.id=um.user_id where um.connection_id=$2 and um.account_id=$3 and um.confirmed_at is not null and u.active and u.deleted_at is null),$4::uuid) as id), created as (insert into bugflow.bugs(title,project_id,reporter_id,priority,severity,description,expected,actual,browser_device,environment,due_on,code_prefix,estimate) select $5,p.id,r.id,$6,$7,$8,$9,$10,'',$11,$12::date,$13,$22::smallint from bugflow.projects p cross join reporter r where p.id=$14 and not p.archived and not exists(select 1 from existing) returning id), details as (insert into bugflow.bug_details(bug_id,request_id,module_name,evidence_urls) select id,$1,$15,'[]'::jsonb from created), steps as (insert into bugflow.steps(bug_id,position,content) select c.id,s.ordinality::int,s.value from created c cross join jsonb_array_elements_text($16::jsonb) with ordinality s(value,ordinality)), history as (insert into bugflow.status_history(id,bug_id,actor_id,new_status) select gen_random_uuid(),id,$4::uuid,'NEW' from created), logged as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select gen_random_uuid(),id,$4::uuid,'bug.created',$17::jsonb from created), link as (insert into bugflow.jira_issue_links(mapping_id,connection_id,bug_id,jira_issue_id,jira_issue_key,origin,state,remote_reporter) select $18,$2,id,$19,$20,'jira','linked',$21::jsonb from created) select id from created union all select id from existing`,
      [
        requestId,
        mapping.connectionId,
        reporter?.accountId ?? "",
        JIRA_SYNC_USER_ID,
        draft.title,
        draft.priority,
        draft.severity,
        draft.description,
        draft.expected,
        draft.actual,
        draft.environment,
        draft.dueOn,
        codePrefix,
        mapping.projectId,
        draft.module,
        JSON.stringify(draft.steps),
        JSON.stringify({
          priority: draft.priority,
          source: "jira",
          issueKey: remote.key,
          ...(reporter ? { jiraReporter: reporter.displayName } : {}),
        }),
        mapping.id,
        remote.id,
        remote.key,
        reporter ? JSON.stringify(reporter) : null,
        draft.estimate,
      ],
    );
    if (!rows[0])
      throw new SyncProblem(
        "The BugFlow project of this mapping is archived, so Jira bugs cannot be added to it.",
      );
    return { bugId: String(rows[0]["id"]) };
  },
};
