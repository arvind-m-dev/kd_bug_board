import { audited } from "../audit.server";
import { formatBugCode } from "../bug-workflow";
import type { Status } from "../bugflow";
import { neonExecute, neonQuery } from "../neon.server";
import { jiraEnv } from "./auth.server";
import { jiraOutboxOn } from "./outbox-entry.server";
import { jiraPort } from "./issues.server";
import { inboundStore } from "./inbound.server";
import { type LocalBug, MappingError, configProblems } from "./mapping";
import {
  type Link,
  type LinkState,
  type Mapping,
  type OutboxQueue,
  type Overrides,
  type RunSummary,
  type SyncStore,
  runOutbox,
} from "./processor";
import { mappingConfigSchema } from "./schemas";
import { JIRA_SYNC_USER_ID, SYNC_FIELDS, type SyncFields } from "./types";

// The outbound outbox in Neon: the leased queue and the database side of the processor. Neon is the queue;
// nothing is held in process memory. The entry a bug write adds lives in outbox-entry.server.ts.

type Row = Record<string, unknown>;
type Batch = { results: { rows: Row[] }[] };
type Statement = { query: string; params?: unknown[] };

// ---- the queue ----

/** One lock for both queues: a bug and its issue are never worked on from two sides at once. */
export const CLAIM_LOCK = 727027;
const LEASE = `interval '5 minutes'`;
const MINE = `id=$1 and lease_owner=$2::uuid and state='processing'`;
const WAITING_TWIN = `exists(select 1 from bugflow.jira_outbox w where w.bug_id=o.bug_id and w.op=o.op and w.id<>o.id and w.state in ('pending','retry'))`;

export const neonQueue: OutboxQueue = {
  /**
   * Leases due rows, at most one per bug, and never a bug another worker is still on (from this queue or, for
   * its Jira issue, from the inbox). Claims are serialized by
   * an advisory lock held for this one transaction, so two workers cannot both pass the "nobody is on this bug"
   * check. A row whose lease ran out (a worker died) is due again.
   */
  async claim(owner, limit) {
    const { results } = await neonExecute<Batch>([
      { query: `select pg_advisory_xact_lock(${CLAIM_LOCK})` },
      {
        query: `update bugflow.jira_outbox o set state='processing',lease_owner=$1::uuid,lease_until=now()+${LEASE} where o.id in (select d.id from (select distinct on (w.bug_id) w.id,w.next_attempt_at,w.created_at from bugflow.jira_outbox w where w.op in ('create','sync') and w.bug_id is not null and ((w.state in ('pending','retry') and w.next_attempt_at<=now()) or (w.state='processing' and w.lease_until<now())) and not exists(select 1 from bugflow.jira_outbox p where p.bug_id=w.bug_id and p.id<>w.id and p.state='processing' and p.lease_until>=now()) and not exists(select 1 from bugflow.jira_issue_links l join bugflow.jira_inbox p on p.connection_id=l.connection_id and p.jira_issue_id=l.jira_issue_id where l.bug_id=w.bug_id and p.state='processing' and p.lease_until>=now()) order by w.bug_id,w.next_attempt_at,w.created_at) d order by d.next_attempt_at,d.created_at limit $2) returning o.id,o.mapping_id,o.bug_id,o.attempts`,
        params: [owner, limit],
      },
    ]);
    return (results[1]?.rows ?? []).map((r) => ({
      id: String(r["id"]),
      mappingId: String(r["mapping_id"]),
      bugId: String(r["bug_id"]),
      attempts: Number(r["attempts"]),
    }));
  },

  async mapping(mappingId) {
    const { rows } = await neonQuery(
      `select m.id,m.connection_id,m.project_id,m.jira_project_id,m.issue_type_id,m.config,m.state,c.cloud_id,c.state as connection_state,(c.disconnected_at is null) as connected from bugflow.jira_project_mappings m join bugflow.jira_connections c on c.id=m.connection_id where m.id=$1`,
      [mappingId],
    );
    const r = rows[0];
    if (
      !r ||
      !["active", "paused"].includes(String(r["state"])) ||
      r["connected"] !== true ||
      !r["cloud_id"]
    )
      return null;
    const config = mappingConfigSchema.safeParse(r["config"]);
    if (!config.success || configProblems(config.data).length)
      throw new MappingError("The saved Jira mapping is not valid any more.");
    return {
      id: String(r["id"]),
      connectionId: String(r["connection_id"]),
      cloudId: String(r["cloud_id"]),
      projectId: String(r["project_id"]),
      jiraProjectId: String(r["jira_project_id"]),
      issueTypeId: String(r["issue_type_id"]),
      config: config.data,
      live: r["state"] === "active" && r["connection_state"] === "connected",
    };
  },

  async finish(row, owner, state, error) {
    await neonExecute(
      `update bugflow.jira_outbox set state=$3,processed_at=now(),lease_owner=null,lease_until=null,last_error=$4,attempts=attempts+1 where ${MINE}`,
      [row.id, owner, state, error],
    );
  },

  /**
   * Back to waiting. If a newer entry for the same bug is already waiting, that one carries on (it inherits the
   * delay) and this one is closed: two waiting entries for one bug would only repeat the same work.
   */
  async later(row, owner, delayMs, counts, error) {
    const due = `now()+make_interval(secs=>$3::double precision/1000)`;
    await neonExecute([
      {
        query: `update bugflow.jira_outbox w set next_attempt_at=greatest(w.next_attempt_at,${due}) from bugflow.jira_outbox o where o.id=$1 and o.lease_owner=$2::uuid and o.state='processing' and w.bug_id=o.bug_id and w.op=o.op and w.id<>o.id and w.state in ('pending','retry')`,
        params: [row.id, owner, delayMs],
      },
      {
        query: `update bugflow.jira_outbox o set state=case when ${WAITING_TWIN} then 'done' else 'retry' end,processed_at=case when ${WAITING_TWIN} then now() end,next_attempt_at=${due},lease_owner=null,lease_until=null,last_error=$4,attempts=o.attempts+$5::int where o.${MINE}`,
        params: [row.id, owner, delayMs, error, counts ? 1 : 0],
      },
    ]);
  },
};

// ---- the processor's view of bugs and links ----

const LINK = `select id,state,jira_issue_id,create_op_id,bugflow_snapshot,jira_snapshot,overrides,(extract(epoch from updated_at)*1000)::bigint as touched_ms,updated_at::text as touched from bugflow.jira_issue_links where bug_id=$1 order by (state='disabled'),updated_at desc limit 1`;
const account = (column: string) =>
  `(select um.account_id from bugflow.jira_user_mappings um where um.connection_id=$2 and um.user_id=${column} and um.confirmed_at is not null)`;
const BUG = `select b.id,b.reporter_id,b.assignee_id,b.estimate,(select jl.jira_sprint_id::text from bugflow.sprint_items si join bugflow.sprints s on s.id=si.sprint_id join bugflow.jira_sprint_links jl on jl.sprint_id=s.id and jl.connection_id=$2 where si.bug_id=b.id and si.removed_at is null and s.state in ('planned','active') limit 1) as sprint_jira_id,b.code_prefix,b.title,b.description,b.expected,b.actual,b.priority,b.severity,b.status,b.due_on,b.environment,(b.deleted_at is not null) as trashed,b.updated_at::text as version,coalesce(d.module_name,'') as module_name,coalesce((select jsonb_agg(s.content order by s.position) from bugflow.steps s where s.bug_id=b.id),'[]'::jsonb) as steps,r.name as reporter_name,a.name as assignee_name,${account("b.reporter_id")} as reporter_account,${account("b.assignee_id")} as assignee_account,coalesce((select jsonb_agg(ux.name order by (ux.id=b.assignee_id) desc,ux.name) from bugflow.bug_assignees bx join bugflow.users ux on ux.id=bx.user_id where bx.bug_id=b.id),'[]'::jsonb) as assignee_names from bugflow.bugs b join bugflow.users r on r.id=b.reporter_id left join bugflow.users a on a.id=b.assignee_id left join bugflow.bug_details d on d.bug_id=b.id where b.id=$1 and b.kind='bug' and b.purged_at is null`;

const text = (v: unknown) => (v == null ? "" : String(v));
const names = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const snapshot = (v: unknown) => (v && typeof v === "object" ? (v as SyncFields) : null);
function overridesOf(v: unknown): Overrides {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? SYNC_FIELDS.filter((f) => x.includes(f)) : []);
  return { push: list(o["push"]), pull: list(o["pull"]), held: list(o["held"]) };
}
function toLink(r: Row): Link {
  return {
    id: String(r["id"]),
    state: String(r["state"]) as LinkState,
    jiraIssueId: r["jira_issue_id"] ? String(r["jira_issue_id"]) : null,
    createOpId: r["create_op_id"] ? String(r["create_op_id"]) : null,
    baseLocal: snapshot(r["bugflow_snapshot"]),
    baseRemote: snapshot(r["jira_snapshot"]),
    overrides: overridesOf(r["overrides"]),
    touchedAt: Number(r["touched_ms"]),
    touchedVersion: String(r["touched"]),
  };
}
/** Jira writes offsets as +0530; a timestamp BugFlow cannot read is stored as unknown, not guessed. */
function isoTime(value: string | null): string | null {
  if (!value) return null;
  const at = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

export const neonStore: SyncStore = {
  ...inboundStore,
  async loadBug(bugId, mapping) {
    const { rows } = await neonQuery(BUG, [bugId, mapping.connectionId]);
    const r = rows[0];
    if (!r) return null;
    const id = String(r["id"]);
    const all = names(r["assignee_names"]);
    const bug: LocalBug = {
      id,
      code: formatBugCode(id, text(r["code_prefix"]) || "BF"),
      url: `${jiraEnv().config?.origin ?? ""}/admin/bugs?bug=${id}`,
      title: text(r["title"]),
      description: text(r["description"]),
      steps: names(r["steps"]),
      expected: text(r["expected"]),
      actual: text(r["actual"]),
      priority: text(r["priority"]),
      severity: text(r["severity"]),
      status: text(r["status"]) as Status,
      dueOn: r["due_on"] ? String(r["due_on"]).slice(0, 10) : null,
      environment: text(r["environment"]),
      module: text(r["module_name"]),
      reporterId: String(r["reporter_id"]),
      assigneeId: r["assignee_id"] ? String(r["assignee_id"]) : null,
      reporterName: text(r["reporter_name"]),
      reporterAccountId: r["reporter_account"] ? String(r["reporter_account"]) : null,
      assigneeNames: all.length ? all : r["assignee_name"] ? [String(r["assignee_name"])] : [],
      assigneeAccountId: r["assignee_account"] ? String(r["assignee_account"]) : null,
      sprintJiraId: r["sprint_jira_id"] ? String(r["sprint_jira_id"]) : null,
      estimate: r["estimate"] == null ? null : Number(r["estimate"]),
    };
    return { bug, trashed: r["trashed"] === true, version: String(r["version"]) };
  },

  async loadLink(bugId) {
    const { rows } = await neonQuery(LINK, [bugId]);
    return rows[0] ? toLink(rows[0]) : null;
  },

  async beginCreate(bugId, mapping) {
    const { rows } = await neonExecute(
      `insert into bugflow.jira_issue_links(mapping_id,connection_id,bug_id,origin,state,create_op_id) values($1,$2,$3,'bugflow','creating',gen_random_uuid()) on conflict (bug_id) where state<>'disabled' do nothing returning id`,
      [mapping.id, mapping.connectionId, bugId],
    );
    const link = await this.loadLink(bugId);
    if (!link) throw new Error("The Jira link for this bug could not be read back.");
    return { link, fresh: rows.length > 0 };
  },

  async touchCreate(link) {
    const { rows } = await neonExecute(
      `update bugflow.jira_issue_links set updated_at=clock_timestamp() where id=$1 and state='creating' and updated_at=$2::timestamptz returning id`,
      [link.id, link.touchedVersion],
    );
    return rows.length > 0;
  },

  async finishCreate(link, bugId, issue) {
    const q = audited(
      `update bugflow.jira_issue_links set jira_issue_id=$2,jira_issue_key=$3,state='linked',updated_at=now() where id=$1 and state='creating' returning id`,
      [link.id, issue.id, issue.key],
      {
        actorId: JIRA_SYNC_USER_ID,
        bugId,
        action: "jira.created",
        detail: { issueId: issue.id, issueKey: issue.key },
      },
    );
    await neonExecute(q.query, q.params);
  },

  async saveSync(link, bugId, result) {
    const update = `update bugflow.jira_issue_links set bugflow_snapshot=$2::jsonb,jira_snapshot=$3::jsonb,state=$4,bugflow_version=$5::timestamptz,jira_updated_at=$6::timestamptz,jira_issue_key=$7,overrides=$8::jsonb,last_synced_at=now(),updated_at=now() where id=$1 and state in ('linked','conflict','local_trashed') returning id`;
    const params = [
      link.id,
      JSON.stringify(result.baseLocal),
      JSON.stringify(result.baseRemote),
      result.state,
      result.version,
      isoTime(result.jiraUpdatedAt),
      result.issueKey,
      JSON.stringify(result.overrides),
    ];
    const statements: Statement[] = [
      // Only a pass that wrote to Jira adds to the bug's history.
      result.exported.length
        ? audited(update, params, {
            actorId: JIRA_SYNC_USER_ID,
            bugId,
            action: "jira.exported",
            detail: { issueKey: result.issueKey, fields: result.exported },
          })
        : { query: update, params },
      {
        // A conflict is over when both sides agreed on its field in this pass, or when this pass no longer
        // reports it.
        query: `update bugflow.jira_conflicts set state='resolved',resolution='merged',resolved_at=now() where link_id=$1 and state='open' and (field=any($3::text[]) or field<>all($2::text[]))`,
        params: [link.id, result.conflicts.map((c) => c.field), result.settled],
      },
    ];
    if (result.conflicts.length)
      statements.push({
        query: `insert into bugflow.jira_conflicts(link_id,field,base_value,local_value,remote_value,reason) select $1,x.field,x.base,x.local,x.remote,x.reason from jsonb_to_recordset($2::jsonb) as x(field text,base jsonb,local jsonb,remote jsonb,reason text) on conflict (link_id,field) where state='open' do update set base_value=excluded.base_value,local_value=excluded.local_value,remote_value=excluded.remote_value,reason=excluded.reason`,
        params: [
          link.id,
          JSON.stringify(
            result.conflicts.map((c) => ({
              ...c,
              base: c.base ?? null,
              local: c.local ?? null,
              remote: c.remote ?? null,
            })),
          ),
        ],
      });
    await neonExecute(statements);
  },

  async setLinkState(linkId, state) {
    await neonExecute(
      `update bugflow.jira_issue_links set state=$2,updated_at=now() where id=$1 and state<>'disabled'`,
      [linkId, state],
    );
  },
};

/** One bounded pass over the outbox. Safe to call as often as wanted, and from several places at once. */
export async function processJiraOutbox(
  options: { limit?: number; budgetMs?: number } = {},
): Promise<RunSummary | { skipped: "database_not_ready" }> {
  if (!(await jiraOutboxOn())) return { skipped: "database_not_ready" };
  return runOutbox({
    queue: neonQueue,
    store: neonStore,
    jira: jiraPort,
    owner: crypto.randomUUID(),
    ...options,
    // Error names and classes only: Jira replies and tokens are never logged.
    log: (error, row) =>
      console.error(
        `[jira-outbox] bug ${row.bugId}: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`,
      ),
  });
}
