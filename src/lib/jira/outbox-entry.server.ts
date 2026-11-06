import { neonQuery } from "../neon.server";

// What a bug write adds so the change reaches Jira: one outbox row, written by the same statement or
// transaction as the change itself. Kept apart from the processor so the bug-write path loads nothing else
// of the Jira integration.

type Statement = { query: string; params?: unknown[] };

let tables: { at: number; present: boolean } | null = null;
/**
 * Whether this database has the Jira tables (migration 027). Bug writes add their outbox entry only when it
 * does, so a database without the migration behaves exactly as before. "Present" is remembered for the life of
 * the process (tables are never dropped); "absent" is re-checked after a minute.
 */
export async function jiraOutboxOn(): Promise<boolean> {
  if (tables && (tables.present || Date.now() - tables.at < 60_000)) return tables.present;
  const { rows } = await neonQuery(
    `select to_regclass('bugflow.jira_outbox') is not null as present`,
  );
  tables = { at: Date.now(), present: rows[0]?.["present"] === true };
  return tables.present;
}

// A paused mapping still collects entries, so resuming sends what changed meanwhile.
const MAPPED = `m.state in ('active','paused')`;
const KEY = { create: `'create:'||m.id||':'||x.id`, sync: `'sync:'||x.id||':'||gen_random_uuid()` };

/**
 * A CTE to append to the statement that changes a bug: one outbox entry per changed bug whose project is
 * mapped to Jira. `changed` is a query giving `id` and `project_id` of the bugs the statement changed, so the
 * entry exists exactly when the change committed. An entry only says "this bug changed"; while one is waiting
 * for a bug, further changes add nothing.
 */
export const outboxCte = (op: "create" | "sync", changed: string) =>
  `jira_marked as (insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select m.id,x.id,'${op}',${KEY[op]} from (${changed}) x join bugflow.jira_project_mappings m on m.project_id=x.project_id and ${MAPPED} on conflict do nothing)`;

/** The same entry as a statement of its own, for a batch whose first statement wrote the audit row `activityId`. */
export const outboxStatement = (bugId: string, activityId: string): Statement => ({
  query: `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select m.id,x.id,'sync',${KEY.sync} from bugflow.bugs x join bugflow.jira_project_mappings m on m.project_id=x.project_id and ${MAPPED} where x.id=$1 and x.kind='bug' and exists(select 1 from bugflow.activity where id=$2::uuid) on conflict do nothing`,
  params: [bugId, activityId],
});

/**
 * An entry for one bug whose sprint membership or estimate changed (those do not touch the bug row, so there is
 * no audit row of the bug write to hang it on). Only for a mapping that synchronizes `field`.
 */
export const outboxMarker = (bugId: string, field: "sprintField" | "estimateField"): Statement => ({
  query: `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select m.id,x.id,'sync',${KEY.sync} from bugflow.bugs x join bugflow.jira_project_mappings m on m.project_id=x.project_id and ${MAPPED} and m.config ? $2 where x.id=$1 and x.kind='bug' on conflict do nothing`,
  params: [bugId, field],
});

/** Entries for every bug currently in the given sprints (a sprint closed and bugs were carried over). */
export const outboxSprintMarkers = (sprintIds: (string | null)[]): Statement => ({
  query: `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select m.id,x.id,'sync',${KEY.sync} from (select distinct b.id,b.project_id from bugflow.sprint_items si join bugflow.bugs b on b.id=si.bug_id where si.sprint_id=any($1::uuid[]) and si.removed_at is null and b.kind='bug') x join bugflow.jira_project_mappings m on m.project_id=x.project_id and ${MAPPED} and m.config ? 'sprintField' on conflict do nothing`,
  params: [sprintIds.filter((id) => id !== null)],
});
