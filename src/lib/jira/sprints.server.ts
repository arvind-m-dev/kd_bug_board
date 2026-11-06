import { neonExecute, neonQuery } from "../neon.server";
import type { JiraSprint } from "./mapping";
import type { Mapping } from "./processor";
import { JIRA_SYNC_USER_ID } from "./types";
import type { WebhookEnvelope } from "./webhook";

// Sprints. Jira owns them: a Jira sprint seen on a synchronized issue is mirrored as a BugFlow sprint (name,
// goal, dates, started, closed). BugFlow's own rules stay in force: one active sprint per project, a closed
// sprint is never reopened, and closing never carries bugs over (carry-over stays a person's decision).
// Sprints are learned from the issues' Sprint field, which needs no extra Jira permission.

type Row = Record<string, unknown>;
const day = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
const ACTIVE_FREE = (project: string, except: string) =>
  `not exists(select 1 from bugflow.sprints a where a.project_id=${project} and a.state='active' and a.id<>${except})`;

export async function noteSprints(mapping: Mapping, sprints: JiraSprint[]): Promise<void> {
  const { rows } = await neonQuery(
    `select jl.jira_sprint_id::text as jira_id,jl.jira_state,s.id,s.name,s.goal,s.state,s.starts_on,s.ends_on from bugflow.jira_sprint_links jl join bugflow.sprints s on s.id=jl.sprint_id where jl.connection_id=$1 and jl.jira_sprint_id=any($2::bigint[])`,
    [mapping.connectionId, sprints.map((s) => s.id)],
  );
  const known = new Map(rows.map((r: Row) => [String(r["jira_id"]), r]));
  for (const sprint of sprints) {
    const mirror = known.get(sprint.id);
    const [from, to] = [day(sprint.startDate), day(sprint.endDate)];
    if (!mirror) {
      // A sprint that is already over is history, not something to plan in: it is not brought in.
      if (sprint.state === "closed") continue;
      // Active in Jira becomes active here only while the project has no active sprint; otherwise it waits as
      // planned, and is started when the other one closes.
      await neonExecute(
        `with st as (select case when $6='active' and ${ACTIVE_FREE("$1", "'00000000-0000-0000-0000-000000000000'")} then 'active' else 'planned' end as state), made as (insert into bugflow.sprints(project_id,name,goal,starts_on,ends_on,state,created_by,started_at) select $1,$2,$3,$4::date,$5::date,st.state,$7,case when st.state='active' then now() end from st where not exists(select 1 from bugflow.jira_sprint_links where connection_id=$8 and jira_sprint_id=$9::bigint) returning id), linked as (insert into bugflow.jira_sprint_links(connection_id,jira_sprint_id,sprint_id,mapping_id,jira_board_id,jira_state) select $8,$9::bigint,id,$10,$11::bigint,$6 from made), logged as (insert into bugflow.activity(id,actor_id,action,detail) select gen_random_uuid(),$7,'sprint.created',jsonb_build_object('sprint',id::text,'name',$2::text,'source','jira') from made) select id from made`,
        [
          mapping.projectId,
          sprint.name,
          sprint.goal,
          from,
          to,
          sprint.state,
          JIRA_SYNC_USER_ID,
          mapping.connectionId,
          sprint.id,
          mapping.id,
          sprint.boardId,
        ],
      );
      continue;
    }
    const id = String(mirror["id"]);
    const dated = (v: unknown) => (v ? String(v).slice(0, 10) : null);
    if (
      mirror["name"] !== sprint.name ||
      mirror["goal"] !== sprint.goal ||
      dated(mirror["starts_on"]) !== from ||
      dated(mirror["ends_on"]) !== to
    )
      await neonExecute(
        `with done as (update bugflow.sprints set name=$2,goal=$3,starts_on=$4::date,ends_on=$5::date where id=$1 and state<>'closed' returning id) insert into bugflow.activity(id,actor_id,action,detail) select gen_random_uuid(),$6,'sprint.updated',jsonb_build_object('sprint',id::text,'name',$2::text,'source','jira') from done`,
        [id, sprint.name, sprint.goal, from, to, JIRA_SYNC_USER_ID],
      );
    if (sprint.state === "active" && mirror["state"] === "planned")
      await neonExecute(
        `with done as (update bugflow.sprints s set state='active',started_at=now() where s.id=$1 and s.state='planned' and ${ACTIVE_FREE("s.project_id", "s.id")} returning id) insert into bugflow.activity(id,actor_id,action,detail) select gen_random_uuid(),$2,'sprint.started',jsonb_build_object('sprint',id::text,'source','jira') from done`,
        [id, JIRA_SYNC_USER_ID],
      );
    if (sprint.state === "closed" && mirror["state"] === "active")
      // Closed without carrying anything over: which bugs move on is decided by a person, in either tool.
      await neonExecute(
        `with done as (update bugflow.sprints set state='closed',closed_at=now() where id=$1 and state='active' returning id) insert into bugflow.activity(id,actor_id,action,detail) select gen_random_uuid(),$2,'sprint.closed',jsonb_build_object('sprint',id::text,'source','jira') from done`,
        [id, JIRA_SYNC_USER_ID],
      );
    if (mirror["jira_state"] !== sprint.state)
      await neonExecute(
        `update bugflow.jira_sprint_links set jira_state=$3,updated_at=now() where connection_id=$1 and jira_sprint_id=$2::bigint`,
        [mapping.connectionId, sprint.id, sprint.state],
      );
  }
}

/**
 * A sprint was started, closed, renamed… in Jira. The sprint itself is read from the issues, so the event
 * only queues a look at the synchronized issues in that sprint.
 */
export async function noteSprintEvent(
  connectionId: string,
  e: Extract<WebhookEnvelope, { kind: "sprint" }>,
) {
  await neonExecute(
    `insert into bugflow.jira_inbox(connection_id,dedup_key,event_type,source,jira_issue_id,jira_issue_key,event_at,envelope) select l.connection_id,'sprint:'||$2::text||':'||$3||':'||coalesce($4,'')||':'||l.jira_issue_id,$3,'webhook',l.jira_issue_id,l.jira_issue_key,$4::timestamptz,jsonb_build_object('projectId',m.jira_project_id) from bugflow.jira_sprint_links jl join bugflow.sprint_items si on si.sprint_id=jl.sprint_id and si.removed_at is null join bugflow.jira_issue_links l on l.bug_id=si.bug_id and l.connection_id=jl.connection_id and l.state in ('linked','conflict') and l.jira_issue_id is not null join bugflow.jira_project_mappings m on m.id=l.mapping_id where jl.connection_id=$1 and jl.jira_sprint_id=$2::bigint on conflict (connection_id,dedup_key) do nothing`,
    [connectionId, e.sprintId, e.eventType, e.eventAt],
  );
}
