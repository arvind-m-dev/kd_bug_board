import { z } from "zod";
import { neonExecute, neonQuery } from "../neon.server";
import { jiraEnv, jiraFetch } from "./auth.server";
import { JiraApiError } from "./errors";
import { jiraOutboxOn } from "./outbox-entry.server";
import {
  type ReconcileJira,
  type ReconcileStore,
  type ReconcileSummary,
  type Seen,
  reconcile,
} from "./reconcile";
import { ISSUE_EVENTS, SPRINT_EVENTS } from "./webhook";

// Reconciliation against Neon and Jira. See reconcile.ts for what a run does and why.

type Row = Record<string, unknown>;
const jiraId = z.string().regex(/^\d{1,20}$/);
const pageSchema = z.object({
  issues: z
    .array(
      z
        .object({
          id: jiraId,
          key: z.string().min(1).max(64),
          fields: z.object({ updated: z.string().nullish() }).passthrough().optional(),
        })
        .passthrough(),
    )
    .default([]),
  nextPageToken: z.string().nullish(),
});
const registeredSchema = z.object({
  webhookRegistrationResult: z
    .array(
      z.object({
        createdWebhookId: z.number().int().optional(),
        errors: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});
const expirySchema = z.object({ expirationDate: z.union([z.number(), z.string()]).nullish() });

function parsed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new JiraApiError("unexpected", 200);
  return r.data;
}
/** Jira writes +0530; anything unreadable is dropped rather than guessed. */
const iso = (value: string | null | undefined) => {
  const at = Date.parse((value ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(at) ? null : new Date(at).toISOString();
};

export function reconcileJiraPort(connection: { id: string; cloudId: string }): ReconcileJira {
  return {
    async search(jql, pageToken) {
      const raw = await jiraFetch(connection, "/rest/api/3/search/jql", {
        method: "POST",
        body: {
          jql,
          fields: ["updated"],
          maxResults: 100,
          ...(pageToken ? { nextPageToken: pageToken } : {}),
        },
      });
      const page = parsed(pageSchema, raw);
      return {
        issues: page.issues.flatMap((i): Seen[] => {
          const updatedAt = iso(i.fields?.updated);
          return updatedAt ? [{ id: i.id, key: i.key, updatedAt }] : [];
        }),
        nextPageToken: page.nextPageToken ?? null,
      };
    },
    async registerWebhook(url, jql, events) {
      const raw = await jiraFetch(connection, "/rest/api/3/webhook", {
        method: "POST",
        body: { url, webhooks: [{ events, jqlFilter: jql }] },
      });
      const ids = parsed(registeredSchema, raw).webhookRegistrationResult.flatMap((r) =>
        r.createdWebhookId === undefined ? [] : [r.createdWebhookId],
      );
      if (!ids.length) throw new JiraApiError("validation", 400);
      return ids;
    },
    async refreshWebhooks(ids) {
      const raw = await jiraFetch(connection, "/rest/api/3/webhook/refresh", {
        method: "PUT",
        body: { webhookIds: ids },
      });
      const at = parsed(expirySchema, raw).expirationDate;
      return typeof at === "number" ? new Date(at).toISOString() : iso(at);
    },
    async deleteWebhooks(ids) {
      await jiraFetch(connection, "/rest/api/3/webhook", {
        method: "DELETE",
        body: { webhookIds: ids },
      });
    },
  };
}

const count = (rows: Row[]) => rows.length;

export const neonReconcileStore: ReconcileStore = {
  async targets() {
    const { rows } = await neonQuery(
      `select m.id,m.connection_id,c.cloud_id,m.jira_project_id,m.issue_type_id,(extract(epoch from coalesce(m.reconcile_cursor,m.updated_at))*1000)::bigint as cursor_ms,(m.full_scan_at is null or m.full_scan_at<now()-interval '24 hours') as full_due from bugflow.jira_project_mappings m join bugflow.jira_connections c on c.id=m.connection_id where m.state='active' and c.state='connected' and c.disconnected_at is null and c.cloud_id is not null order by m.created_at`,
    );
    return rows.map((r) => ({
      mappingId: String(r["id"]),
      connectionId: String(r["connection_id"]),
      cloudId: String(r["cloud_id"]),
      jiraProjectId: String(r["jira_project_id"]),
      issueTypeId: String(r["issue_type_id"]),
      cursorMs: Number(r["cursor_ms"]),
      fullCheckDue: r["full_due"] === true,
    }));
  },

  async queueSeen(target, issues) {
    if (!issues.length) return 0;
    // Unknown issue, or newer in Jira than the link last saw. The key holds the issue's own change time, so
    // seeing the same change again in the overlap adds nothing. An unlinked pair (disabled link) stays alone.
    const { rows } = await neonExecute(
      `insert into bugflow.jira_inbox(connection_id,dedup_key,event_type,source,jira_issue_id,jira_issue_key,event_at,envelope) select $1,'rec:'||x.id||':'||x.updated,'reconcile','reconcile',x.id,x.key,x.updated::timestamptz,jsonb_build_object('projectId',$2::text) from jsonb_to_recordset($3::jsonb) as x(id text,key text,updated text) left join bugflow.jira_issue_links l on l.connection_id=$1 and l.jira_issue_id=x.id where l.id is null or (l.state<>'disabled' and (l.jira_updated_at is null or l.jira_updated_at<x.updated::timestamptz)) on conflict (connection_id,dedup_key) do nothing returning id`,
      [
        target.connectionId,
        target.jiraProjectId,
        JSON.stringify(issues.map((i) => ({ id: i.id, key: i.key, updated: i.updatedAt }))),
      ],
    );
    return count(rows);
  },

  async queueLocalDrift(target) {
    const { rows } = await neonExecute(
      `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select l.mapping_id,l.bug_id,'sync','sync:'||l.bug_id||':'||gen_random_uuid() from bugflow.jira_issue_links l join bugflow.bugs b on b.id=l.bug_id where l.mapping_id=$1 and l.state in ('linked','conflict','local_trashed') and b.purged_at is null and (l.bugflow_version is null or b.updated_at>l.bugflow_version) on conflict do nothing returning id`,
      [target.mappingId],
    );
    return count(rows);
  },

  async queueStaleLinks(target, limit) {
    const { rows } = await neonExecute(
      `insert into bugflow.jira_inbox(connection_id,dedup_key,event_type,source,jira_issue_id,jira_issue_key,envelope) select l.connection_id,'check:'||l.jira_issue_id||':'||to_char(now(),'YYYY-MM-DD'),'reconcile','reconcile',l.jira_issue_id,l.jira_issue_key,jsonb_build_object('projectId',$2::text) from (select * from bugflow.jira_issue_links where mapping_id=$1 and state in ('linked','conflict') and jira_issue_id is not null and (last_synced_at is null or last_synced_at<now()-interval '24 hours') order by last_synced_at nulls first limit $3) l on conflict (connection_id,dedup_key) do nothing returning id`,
      [target.mappingId, target.jiraProjectId, limit],
    );
    return count(rows);
  },

  async saveScan(target, cursorIso, fullCheckDone) {
    await neonExecute(
      `update bugflow.jira_project_mappings set reconcile_cursor=$2::timestamptz,full_scan_at=case when $3::boolean then now() else full_scan_at end where id=$1`,
      [target.mappingId, cursorIso, fullCheckDone],
    );
  },

  async connections() {
    const { rows } = await neonQuery(
      `select c.id,c.cloud_id,c.webhooks,(extract(epoch from c.webhook_expires_at)*1000)::bigint as expires_ms,coalesce((select jsonb_agg(m.jira_project_id) from bugflow.jira_project_mappings m where m.connection_id=c.id and m.state='active'),'[]'::jsonb) as projects,exists(select 1 from bugflow.jira_project_mappings m where m.connection_id=c.id and m.state='active' and m.board_id is not null) as sprints from bugflow.jira_connections c where c.state='connected' and c.disconnected_at is null and c.cloud_id is not null`,
    );
    return rows.map((r) => ({
      connectionId: String(r["id"]),
      cloudId: String(r["cloud_id"]),
      projectIds: Array.isArray(r["projects"]) ? r["projects"].map(String) : [],
      sprints: r["sprints"] === true,
      webhooks: Array.isArray(r["webhooks"])
        ? (r["webhooks"] as { id?: unknown; jql?: unknown }[]).flatMap((w) =>
            typeof w.id === "number" && typeof w.jql === "string" ? [{ id: w.id, jql: w.jql }] : [],
          )
        : [],
      expiresAtMs: r["expires_ms"] == null ? null : Number(r["expires_ms"]),
    }));
  },

  async saveWebhooks(connectionId, webhooks, expiresIso, problem) {
    await neonExecute(
      `update bugflow.jira_connections set webhooks=$2::jsonb,webhook_expires_at=$3::timestamptz,last_error=$4,updated_at=now() where id=$1 and disconnected_at is null`,
      [connectionId, JSON.stringify(webhooks), expiresIso, problem],
    );
  },

  async touch(connectionId) {
    await neonExecute(`update bugflow.jira_connections set last_reconciled_at=now() where id=$1`, [
      connectionId,
    ]);
  },
};

/** One reconciliation run. Safe to repeat; it only queues work for the processors. */
export async function reconcileJira(): Promise<
  ReconcileSummary | { skipped: "database_not_ready" | "not_configured" }
> {
  const { config } = jiraEnv();
  if (!config) return { skipped: "not_configured" };
  if (!(await jiraOutboxOn())) return { skipped: "database_not_ready" };
  return reconcile({
    store: neonReconcileStore,
    jira: reconcileJiraPort,
    origin: config.origin,
    issueEvents: ISSUE_EVENTS,
    sprintEvents: SPRINT_EVENTS,
    log: (error) =>
      console.error(
        `[jira-reconcile] ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`,
      ),
  });
}
