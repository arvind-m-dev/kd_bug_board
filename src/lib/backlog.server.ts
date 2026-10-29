import { neonQuery, neonExecute } from "./neon.server";
import { checkOrigin, requireAdmin } from "./portal-access.server";
import { formatBugCode } from "./bug-workflow";
import {
  rankBetween,
  validParent,
  type CreateWorkItem,
  type UpdateWorkItem,
  type WorkKind,
} from "./backlog";
import type { Status } from "./bugflow";

export type BacklogItem = {
  id: string;
  code: string;
  kind: WorkKind;
  title: string;
  status: Status;
  priority: string;
  projectId: string;
  parentId: string | null;
  estimate: number | null;
  ready: boolean;
  rank: string | null;
  assignee: string;
  /** The open sprint this item sits in, when any. */
  sprintId: string | null;
};
export type BacklogData = {
  projects: { id: string; name: string }[];
  openSprints: { id: string; name: string; projectId: string }[];
  items: BacklogItem[];
};

function parseItem(r: Record<string, unknown>): BacklogItem {
  return {
    id: String(r["id"]),
    code: formatBugCode(String(r["id"]), String(r["code_prefix"] ?? "BF")),
    kind: (r["kind"] as WorkKind) ?? "bug",
    title: String(r["title"]),
    status: r["status"] as Status,
    priority: String(r["priority"]),
    projectId: String(r["project_id"]),
    parentId: r["parent_id"] ? String(r["parent_id"]) : null,
    estimate: r["estimate"] == null ? null : Number(r["estimate"]),
    ready: r["ready"] === true,
    rank: r["backlog_rank"] ? String(r["backlog_rank"]) : null,
    assignee: String(r["assignee_name"] ?? "Unassigned"),
    sprintId: r["sprint_id"] ? String(r["sprint_id"]) : null,
  };
}

export async function backlogData(): Promise<BacklogData> {
  await requireAdmin();
  const { results } = await neonQuery<{ results: { rows: Record<string, unknown>[] }[] }>(
    [
      {
        query: "select id,name from bugflow.projects where not archived order by name,id limit 100",
        params: [],
      },
      {
        query:
          "select id,name,project_id from bugflow.sprints where state<>'closed' order by (state='active') desc,created_at desc limit 100",
        params: [],
      },
      {
        query: `select b.id,b.kind,b.title,b.status,b.priority,b.project_id,b.parent_id,b.estimate,b.ready,b.backlog_rank,b.code_prefix,coalesce(a.name,'Unassigned') as assignee_name,
            (select si.sprint_id from bugflow.sprint_items si join bugflow.sprints s on s.id=si.sprint_id where si.bug_id=b.id and si.removed_at is null and s.state<>'closed' limit 1) as sprint_id
          from bugflow.bugs b left join bugflow.users a on a.id=b.assignee_id
          where b.deleted_at is null and b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')
          order by b.project_id,b.backlog_rank nulls last,b.id limit 1000`,
        params: [],
      },
    ],
    [],
    { "Neon-Batch-Read-Only": "true" },
  );
  return {
    projects: (results[0]?.rows ?? []).map((r) => ({
      id: String(r["id"]),
      name: String(r["name"]),
    })),
    openSprints: (results[1]?.rows ?? []).map((r) => ({
      id: String(r["id"]),
      name: String(r["name"]),
      projectId: String(r["project_id"]),
    })),
    items: (results[2]?.rows ?? []).map(parseItem),
  };
}

async function audit(actorId: string, bugId: string, action: string, detail: object) {
  await neonExecute([
    {
      query: `insert into bugflow.activity(id,actor_id,bug_id,action,detail) values($1,$2,$3::bigint,$4,$5::jsonb)`,
      params: [crypto.randomUUID(), actorId, bugId, action, JSON.stringify(detail)],
    },
  ]);
}

/** Parent checks shared by create and update: kinds fit, same project, and no ancestry loop. */
async function assertParent(
  childId: string | null,
  childKind: WorkKind,
  projectId: string,
  parentId: string,
) {
  const { rows } = await neonQuery(
    `select kind,project_id::text as project_id from bugflow.bugs where id=$1::bigint and deleted_at is null`,
    [parentId],
  );
  const parent = rows[0];
  if (!parent) throw new Error("The chosen parent no longer exists.");
  if (String(parent["project_id"]) !== projectId)
    throw new Error("Parent and child must belong to the same project.");
  if (!validParent(childKind, (parent["kind"] as WorkKind) ?? "bug"))
    throw new Error("That parent kind cannot hold this item.");
  if (childId) {
    const { rows: loop } = await neonQuery(
      `with recursive anc as (
         select id,parent_id from bugflow.bugs where id=$1::bigint
         union all select b.id,b.parent_id from bugflow.bugs b join anc on b.id=anc.parent_id)
       select 1 from anc where id=$2::bigint limit 1`,
      [parentId, childId],
    );
    if (loop.length) throw new Error("That would create a loop of parents.");
  }
}

/** The rank that sorts after everything currently in the project. */
async function tailRank(projectId: string): Promise<string> {
  const { rows } = await neonQuery(
    `select max(backlog_rank) as r from bugflow.bugs where project_id=$1 and deleted_at is null`,
    [projectId],
  );
  return rankBetween(rows[0]?.["r"] ? String(rows[0]["r"]) : null, null);
}

export async function createWorkItem(data: CreateWorkItem) {
  checkOrigin();
  const admin = await requireAdmin();
  if (data.parentId) await assertParent(null, data.kind, data.projectId, data.parentId);
  const rank = await tailRank(data.projectId);
  const { rows } = await neonExecute(
    `with existing as (select b.id from bugflow.bug_details d join bugflow.bugs b on b.id=d.bug_id where d.request_id=$1 and b.reporter_id=$2),
     created as (insert into bugflow.bugs(title,project_id,reporter_id,priority,severity,description,expected,actual,kind,parent_id,estimate,backlog_rank)
       select $3,$4,$2,'P3','Medium',$5,'','',$6,$7::bigint,$8,$9 from bugflow.projects p where p.id=$4 and not p.archived and not exists(select 1 from existing) returning id),
     details as (insert into bugflow.bug_details(bug_id,request_id,module_name,evidence_urls) select id,$1,'','[]'::jsonb from created),
     history as (insert into bugflow.status_history(id,bug_id,actor_id,new_status) select gen_random_uuid(),id,$2,'NEW' from created)
     select id from created union all select id from existing`,
    [
      data.requestId,
      admin.userId,
      data.title,
      data.projectId,
      data.description || data.title,
      data.kind,
      data.parentId ?? null,
      data.estimate,
      rank,
    ],
  );
  const id = rows[0]?.["id"];
  if (!id) throw new Error("Choose an active project.");
  await audit(admin.userId, String(id), "backlog.created", { kind: data.kind, title: data.title });
  return { id: String(id), code: formatBugCode(String(id)) };
}

export async function updateWorkItem(data: UpdateWorkItem) {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows: existing } = await neonQuery(
    `select kind,project_id::text as project_id from bugflow.bugs where id=$1::bigint and deleted_at is null`,
    [data.id],
  );
  const row = existing[0];
  if (!row) throw new Error("This item is not available.");
  if (data.parentId)
    await assertParent(
      data.id,
      (row["kind"] as WorkKind) ?? "bug",
      String(row["project_id"]),
      data.parentId,
    );
  const { rows } = await neonExecute(
    `update bugflow.bugs set
       backlog_rank=coalesce($2,backlog_rank),
       ready=coalesce($3,ready),
       estimate=case when $4::boolean then $5 else estimate end,
       parent_id=case when $6::boolean then $7::bigint else parent_id end
     where id=$1::bigint and deleted_at is null returning id`,
    [
      data.id,
      data.rank ?? null,
      data.ready ?? null,
      data.estimate !== undefined,
      data.estimate ?? null,
      data.parentId !== undefined,
      data.parentId ?? null,
    ],
  );
  if (!rows[0]) throw new Error("This item is not available.");
  const rankOnly =
    data.rank !== undefined &&
    data.ready === undefined &&
    data.estimate === undefined &&
    data.parentId === undefined;
  await audit(admin.userId, data.id, rankOnly ? "backlog.ranked" : "backlog.updated", {
    rank: data.rank,
    ready: data.ready,
    estimate: data.estimate,
    parent: data.parentId,
  });
  return { saved: true };
}
