import { neonExecute, neonQuery } from "../neon.server";
import { jiraPort } from "./issues.server";
import { CLAIM_LOCK, neonQueue, neonStore } from "./outbox.server";
import { jiraOutboxOn } from "./outbox-entry.server";
import {
  type InboxQueue,
  type InboxRow,
  type MappingDirectory,
  type RemoteActor,
  type RunSummary,
  runInbox,
} from "./processor";

// The inbound inbox in Neon: "something happened to this Jira issue". A row carries only a small envelope
// (which issue, which project, who); the processor reads the issue from Jira before doing anything, so an old,
// repeated or reordered event can never apply stale content.

type Row = Record<string, unknown>;
type Batch = { results: { rows: Row[] }[] };

export type InboxEvent = {
  /** Same value for every delivery of the same event, so a repeat is dropped. */
  dedupKey: string;
  eventType: string;
  source: "webhook" | "reconcile" | "manual";
  issueId: string;
  issueKey: string | null;
  projectId: string | null;
  eventAt: string | null;
  actor: RemoteActor | null;
};

/** Stores an event once. False when this delivery was already stored. */
export async function persistEvent(connectionId: string, e: InboxEvent): Promise<boolean> {
  const { rows } = await neonExecute(
    `insert into bugflow.jira_inbox(connection_id,dedup_key,event_type,source,jira_issue_id,jira_issue_key,event_at,envelope) values($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::jsonb) on conflict (connection_id,dedup_key) do nothing returning id`,
    [
      connectionId,
      e.dedupKey,
      e.eventType,
      e.source,
      e.issueId,
      e.issueKey,
      e.eventAt,
      JSON.stringify({
        ...(e.projectId ? { projectId: e.projectId } : {}),
        ...(e.actor ? { actor: e.actor } : {}),
      }),
    ],
  );
  return rows.length > 0;
}

const LEASE = `interval '5 minutes'`;
const MINE = `id=$1 and lease_owner=$2::uuid and state='processing'`;

function toRow(r: Row): InboxRow {
  const envelope = (r["envelope"] ?? {}) as {
    projectId?: unknown;
    actor?: { accountId?: unknown; displayName?: unknown };
  };
  const actor = envelope.actor;
  return {
    id: String(r["id"]),
    connectionId: String(r["connection_id"]),
    issueId: String(r["jira_issue_id"]),
    projectId: typeof envelope.projectId === "string" ? envelope.projectId : null,
    receivedAt: Number(r["received_ms"]),
    attempts: Number(r["attempts"]),
    actor:
      actor && typeof actor.accountId === "string"
        ? {
            accountId: actor.accountId,
            displayName: typeof actor.displayName === "string" ? actor.displayName : "",
          }
        : null,
  };
}

export const neonInbox: InboxQueue = {
  /**
   * Leases due events, one per issue, and never an issue that another worker is on, whether from this queue or
   * (for the bug it is linked to) from the outbox. Serialized by the same lock as outbox claims.
   */
  async claim(owner, limit) {
    const { results } = await neonExecute<Batch>([
      { query: `select pg_advisory_xact_lock(${CLAIM_LOCK})` },
      {
        query: `update bugflow.jira_inbox i set state='processing',lease_owner=$1::uuid,lease_until=now()+${LEASE} where i.id in (select d.id from (select distinct on (w.connection_id,w.jira_issue_id) w.id,w.next_attempt_at,w.received_at from bugflow.jira_inbox w where w.jira_issue_id is not null and ((w.state in ('pending','retry') and w.next_attempt_at<=now()) or (w.state='processing' and w.lease_until<now())) and not exists(select 1 from bugflow.jira_inbox p where p.connection_id=w.connection_id and p.jira_issue_id=w.jira_issue_id and p.id<>w.id and p.state='processing' and p.lease_until>=now()) and not exists(select 1 from bugflow.jira_issue_links l join bugflow.jira_outbox p on p.bug_id=l.bug_id where l.connection_id=w.connection_id and l.jira_issue_id=w.jira_issue_id and p.state='processing' and p.lease_until>=now()) order by w.connection_id,w.jira_issue_id,w.next_attempt_at,w.received_at) d order by d.next_attempt_at,d.received_at limit $2) returning i.id,i.connection_id,i.jira_issue_id,i.envelope,i.attempts,(extract(epoch from i.received_at)*1000)::bigint as received_ms`,
        params: [owner, limit],
      },
    ]);
    return (results[1]?.rows ?? []).map(toRow);
  },

  async finish(row, owner, state, error) {
    await neonExecute([
      {
        // The issue was read after this row was leased, so every event for it that had already arrived by then
        // is covered by this pass and needs no pass of its own.
        query: `update bugflow.jira_inbox w set state='done',processed_at=now() from bugflow.jira_inbox o where o.id=$1 and o.lease_owner=$2::uuid and o.state='processing' and $3<>'dead' and w.connection_id=o.connection_id and w.jira_issue_id=o.jira_issue_id and w.id<>o.id and w.state in ('pending','retry') and w.received_at<=o.lease_until-${LEASE}`,
        params: [row.id, owner, state],
      },
      {
        query: `update bugflow.jira_inbox set state=$3,processed_at=now(),lease_owner=null,lease_until=null,last_error=$4,attempts=attempts+1 where ${MINE}`,
        params: [row.id, owner, state, error],
      },
    ]);
  },

  async later(row, owner, delayMs, counts, error) {
    await neonExecute(
      `update bugflow.jira_inbox set state='retry',next_attempt_at=now()+make_interval(secs=>$3::double precision/1000),lease_owner=null,lease_until=null,last_error=$4,attempts=attempts+$5::int where ${MINE}`,
      [row.id, owner, delayMs, error, counts ? 1 : 0],
    );
  },
};

export const neonDirectory: MappingDirectory = {
  mappingById: (id) => neonQueue.mapping(id),
  async mappingForProject(connectionId, jiraProjectId) {
    const { rows } = await neonQuery(
      `select id from bugflow.jira_project_mappings where connection_id=$1 and jira_project_id=$2 and state in ('active','paused') limit 1`,
      [connectionId, jiraProjectId],
    );
    return rows[0] ? neonQueue.mapping(String(rows[0]["id"])) : null;
  },
};

/** One bounded pass over the inbox. Safe to call as often as wanted, and from several places at once. */
export async function processJiraInbox(
  options: { limit?: number; budgetMs?: number } = {},
): Promise<RunSummary | { skipped: "database_not_ready" }> {
  if (!(await jiraOutboxOn())) return { skipped: "database_not_ready" };
  return runInbox({
    queue: neonInbox,
    directory: neonDirectory,
    store: neonStore,
    jira: jiraPort,
    owner: crypto.randomUUID(),
    ...options,
    log: (error, row) =>
      console.error(
        `[jira-inbox] issue ${row.issueId}: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`,
      ),
  });
}
