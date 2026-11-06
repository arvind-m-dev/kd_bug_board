import { formatBugCode } from "../bug-workflow";
import { neonExecute, neonQuery } from "../neon.server";
import { checkOrigin, requireAdmin } from "../portal-access.server";
import { reconcileAndProcess } from "./jobs.server";
import { SYNC_FIELDS, type SyncField } from "./types";

// What an Admin can see and do about the running sync: its health, the work that is waiting or parked, the
// conflicts that need a person, and the decisions on them. A decision is only recorded here; the next sync pass
// carries it out through the same rules as every other change, so no decision can skip the workflow.

type Row = Record<string, unknown>;
type Batch = { results: { rows: Row[] }[] };

export type JiraConflictView = {
  id: string;
  bugId: string;
  bugCode: string;
  bugTitle: string;
  issueKey: string | null;
  field: string;
  reason: string;
  /** BugFlow's and Jira's value, as text to show. */
  local: string;
  remote: string;
  createdAt: string;
};
export type JiraParkedView = {
  id: string;
  direction: "to_jira" | "from_jira";
  /** The bug code for outgoing work, the Jira issue key for incoming. */
  subject: string;
  error: string;
  at: string;
};
export type JiraOverview = {
  queue: { toJira: number; fromJira: number; parked: number };
  conflicts: JiraConflictView[];
  parked: JiraParkedView[];
  lastEventAt: string | null;
  lastReconciledAt: string | null;
  /** Jira's push notifications: registered until this time, or null when they are not (local http, or failed). */
  notificationsUntil: string | null;
  linked: number;
};

const iso = (v: unknown) => (v == null ? null : String(v));
const shown = (v: unknown): string =>
  v == null ? "" : Array.isArray(v) ? v.map(String).join("\n") : String(v);

export async function jiraOverview(): Promise<JiraOverview> {
  await requireAdmin();
  const { results } = await neonQuery<Batch>(
    [
      {
        query: `select (select count(*) from bugflow.jira_outbox where state in ('pending','retry','processing'))::int as to_jira,(select count(*) from bugflow.jira_inbox where state in ('pending','retry','processing'))::int as from_jira,(select count(*) from bugflow.jira_outbox where state='dead')::int+(select count(*) from bugflow.jira_inbox where state='dead')::int as parked,(select count(*) from bugflow.jira_issue_links where state in ('linked','conflict'))::int as linked`,
      },
      {
        query: `select x.id,x.field,x.reason,x.local_value,x.remote_value,to_json(x.created_at) as created_iso,l.jira_issue_key,b.id as bug_id,b.title,b.code_prefix from bugflow.jira_conflicts x join bugflow.jira_issue_links l on l.id=x.link_id join bugflow.bugs b on b.id=l.bug_id where x.state='open' and l.state<>'disabled' order by x.created_at desc limit 100`,
      },
      {
        query: `select x.id,x.direction,x.bug_id,x.code_prefix,x.issue_key,x.last_error,to_json(x.at) as at from ((select o.id,'to_jira' as direction,b.id::text as bug_id,b.code_prefix,null::text as issue_key,o.last_error,o.processed_at as at from bugflow.jira_outbox o join bugflow.bugs b on b.id=o.bug_id where o.state='dead') union all (select i.id,'from_jira',null,null,coalesce(i.jira_issue_key,i.jira_issue_id),i.last_error,i.processed_at from bugflow.jira_inbox i where i.state='dead')) x order by x.at desc nulls last limit 50`,
      },
      {
        query: `select to_json(last_event_at) as event_iso,to_json(last_reconciled_at) as reconciled_iso,case when jsonb_array_length(webhooks)>0 then to_json(webhook_expires_at) end as hooks_iso from bugflow.jira_connections where disconnected_at is null limit 1`,
      },
    ],
    [],
    { "Neon-Batch-Read-Only": "true" },
  );
  const counts = results[0]?.rows[0] ?? {};
  const c = results[3]?.rows[0] ?? {};
  return {
    queue: {
      toJira: Number(counts["to_jira"] ?? 0),
      fromJira: Number(counts["from_jira"] ?? 0),
      parked: Number(counts["parked"] ?? 0),
    },
    linked: Number(counts["linked"] ?? 0),
    conflicts: (results[1]?.rows ?? []).map((r) => ({
      id: String(r["id"]),
      bugId: String(r["bug_id"]),
      bugCode: formatBugCode(String(r["bug_id"]), String(r["code_prefix"] ?? "BF")),
      bugTitle: String(r["title"]),
      issueKey: iso(r["jira_issue_key"]),
      field: String(r["field"]),
      reason: String(r["reason"]),
      local: shown(r["local_value"]),
      remote: shown(r["remote_value"]),
      createdAt: String(r["created_iso"]),
    })),
    parked: (results[2]?.rows ?? []).map((r) => ({
      id: String(r["id"]),
      direction: r["direction"] === "to_jira" ? "to_jira" : "from_jira",
      subject: r["bug_id"]
        ? formatBugCode(String(r["bug_id"]), String(r["code_prefix"] ?? "BF"))
        : String(r["issue_key"] ?? ""),
      error: String(r["last_error"] ?? ""),
      at: String(r["at"] ?? ""),
    })),
    lastEventAt: iso(c["event_iso"]),
    lastReconciledAt: iso(c["reconciled_iso"]),
    notificationsUntil: iso(c["hooks_iso"]),
  };
}

export type ConflictResolution = "use_bugflow" | "use_jira" | "ignore" | "unlink";
const isSyncField = (f: string): f is SyncField => (SYNC_FIELDS as readonly string[]).includes(f);
/** Adds a bug's "changed" entry so the next pass picks the decision up straight away. */
const NUDGE = `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select l.mapping_id,l.bug_id,'sync','sync:'||l.bug_id||':'||gen_random_uuid() from bugflow.jira_issue_links l where l.id=$1 on conflict do nothing`;
const AUDIT = `insert into bugflow.activity(id,actor_id,bug_id,action,detail) select gen_random_uuid(),$2::uuid,l.bug_id,'jira.conflict_resolved',jsonb_build_object('field',$3::text,'resolution',$4::text,'issueKey',l.jira_issue_key) from bugflow.jira_issue_links l where l.id=$1 and exists(select 1 from bugflow.jira_conflicts where id=$5::uuid and resolved_by=$2::uuid)`;

/**
 * Records an Admin's decision on one open conflict.
 * - use_bugflow / use_jira: the next pass sends BugFlow's value, or takes Jira's, for that field. Taking Jira's
 *   value still goes through the workflow rules; if they refuse it, the conflict comes back saying why.
 * - ignore: both values are accepted as they are; the field is compared again only when either side changes.
 * - unlink: the bug and the issue stop being synchronized. Neither is deleted or changed.
 */
export async function resolveJiraConflict(conflictId: string, resolution: ConflictResolution) {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonQuery(
    `select x.link_id,x.field from bugflow.jira_conflicts x where x.id=$1 and x.state='open'`,
    [conflictId],
  );
  const conflict = rows[0];
  if (!conflict) throw new Error("This conflict was already settled. Refresh the list.");
  const linkId = String(conflict["link_id"]);
  const field = String(conflict["field"]);
  if (resolution !== "unlink" && !isSyncField(field))
    throw new Error("This one can only be settled by unlinking the bug from the Jira issue.");
  const close = (state: "resolved" | "ignored", as: string) => ({
    query: `update bugflow.jira_conflicts set state=$2,resolution=$3,resolved_by=$4,resolved_at=now() where id=$1 and state='open'`,
    params: [conflictId, state, as, admin.userId],
  });
  const audit = { query: AUDIT, params: [linkId, admin.userId, field, resolution, conflictId] };

  if (resolution === "unlink") {
    await neonExecute([
      close("resolved", "unlinked"),
      {
        query: `update bugflow.jira_conflicts set state='resolved',resolution='unlinked',resolved_by=$2,resolved_at=now() where link_id=$1 and state='open'`,
        params: [linkId, admin.userId],
      },
      {
        query: `update bugflow.jira_issue_links set state='disabled',updated_at=now() where id=$1`,
        params: [linkId],
      },
      audit,
    ]);
  } else if (resolution === "ignore") {
    await neonExecute([
      // Both sides' current values become "what was agreed", so nothing counts as changed until one moves again.
      {
        query: `update bugflow.jira_issue_links l set bugflow_snapshot=jsonb_set(coalesce(l.bugflow_snapshot,'{}'::jsonb),array[$2::text],coalesce(x.local_value,'null'::jsonb)),jira_snapshot=jsonb_set(coalesce(l.jira_snapshot,'{}'::jsonb),array[$2::text],coalesce(x.remote_value,'null'::jsonb)),overrides=jsonb_set(l.overrides,'{held}',coalesce((select jsonb_agg(h) from jsonb_array_elements_text(coalesce(l.overrides->'held','[]'::jsonb)) h where h<>$2),'[]'::jsonb)),state=case when exists(select 1 from bugflow.jira_conflicts o where o.link_id=l.id and o.state='open' and o.id<>x.id) then l.state else 'linked' end,updated_at=now() from bugflow.jira_conflicts x where x.id=$1 and x.state='open' and l.id=x.link_id`,
        params: [conflictId, field],
      },
      close("ignored", "ignored"),
      audit,
    ]);
  } else {
    const [mine, other] = resolution === "use_bugflow" ? ["push", "pull"] : ["pull", "push"];
    await neonExecute([
      {
        // The decision replaces any earlier one for the same field.
        query: `update bugflow.jira_issue_links l set overrides=l.overrides||jsonb_build_object($2::text,coalesce((select jsonb_agg(distinct v) from (select jsonb_array_elements_text(coalesce(l.overrides->$2,'[]'::jsonb)) as v union select $4::text) a),'[]'::jsonb),$3::text,coalesce((select jsonb_agg(v) from jsonb_array_elements_text(coalesce(l.overrides->$3,'[]'::jsonb)) v where v<>$4),'[]'::jsonb)),updated_at=now() where l.id=$1 and l.state<>'disabled'`,
        params: [linkId, mine, other, field],
      },
      close("resolved", resolution),
      { query: NUDGE, params: [linkId] },
      audit,
    ]);
  }
  return jiraOverview();
}

/**
 * Puts parked work back in the queue (after the cause was fixed: a permission, a mapping, a Jira field).
 * Nothing is ever deleted: an entry that a newer one already covers is closed, the rest wait again.
 */
export async function retryJiraParked() {
  checkOrigin();
  const admin = await requireAdmin();
  const { results } = await neonExecute<Batch>([
    {
      query: `update bugflow.jira_outbox o set state='pending',attempts=0,next_attempt_at=now(),last_error=null,processed_at=null where o.state='dead' and o.id in (select distinct on (d.bug_id,d.op) d.id from bugflow.jira_outbox d where d.state='dead' order by d.bug_id,d.op,d.created_at desc) and not exists(select 1 from bugflow.jira_outbox w where w.bug_id=o.bug_id and w.op=o.op and w.state in ('pending','retry')) returning o.id`,
    },
    { query: `update bugflow.jira_outbox set state='done' where state='dead' returning id` },
    {
      query: `update bugflow.jira_inbox set state='pending',attempts=0,next_attempt_at=now(),last_error=null,processed_at=null where state='dead' returning id`,
    },
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values(gen_random_uuid(),$1,'jira.retry','{}'::jsonb)`,
      params: [admin.userId],
    },
  ]);
  return {
    retried: (results[0]?.rows.length ?? 0) + (results[2]?.rows.length ?? 0),
    overview: await jiraOverview(),
  };
}

/** Looks for missed changes and works both queues once, now, instead of waiting for the scheduler. */
export async function syncJiraNow() {
  checkOrigin();
  await requireAdmin();
  const run = await reconcileAndProcess();
  return { run, overview: await jiraOverview() };
}
