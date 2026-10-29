import { neonQuery, neonExecute } from "./neon.server";
import { checkOrigin, requireAdmin } from "./portal-access.server";
import { formatBugCode } from "./bug-workflow";
import {
  summarizeSprint,
  type Sprint,
  type SprintItem,
  type SprintState,
  type CreateSprint,
} from "./sprints";
import type { z } from "zod";
import type { updateSprintSchema, sprintActionSchema, sprintItemSchema } from "./sprints";

function parseSprint(r: Record<string, unknown>): Sprint {
  return {
    id: String(r["id"]),
    projectId: String(r["project_id"]),
    project: String(r["project_name"]),
    name: String(r["name"]),
    goal: String(r["goal"] ?? ""),
    startsOn: r["starts_on"] ? String(r["starts_on"]).slice(0, 10) : null,
    endsOn: r["ends_on"] ? String(r["ends_on"]).slice(0, 10) : null,
    state: String(r["state"]) as SprintState,
    startedAt: r["started_iso"] ? String(r["started_iso"]) : null,
    closedAt: r["closed_iso"] ? String(r["closed_iso"]) : null,
    createdAt: String(r["created_iso"]),
  };
}
function parseItem(r: Record<string, unknown>): SprintItem {
  return {
    bugId: String(r["bug_id"]),
    code: formatBugCode(String(r["bug_id"]), String(r["code_prefix"] ?? "BF")),
    title: String(r["title"]),
    status: r["status"] as SprintItem["status"],
    priority: String(r["priority"]),
    assignee: String(r["assignee_name"] ?? "Unassigned"),
    dueOn: r["due_on"] ? String(r["due_on"]).slice(0, 10) : null,
    addedAt: String(r["added_iso"]),
    removedAt: r["removed_iso"] ? String(r["removed_iso"]) : null,
    carriedFromSprintId: r["carried_from_sprint_id"] ? String(r["carried_from_sprint_id"]) : null,
  };
}

export type SprintsData = {
  projects: { id: string; name: string }[];
  sprints: (Sprint & { items: SprintItem[]; summary: ReturnType<typeof summarizeSprint> })[];
};

export async function sprintsData(): Promise<SprintsData> {
  await requireAdmin();
  const { results } = await neonQuery<{ results: { rows: Record<string, unknown>[] }[] }>(
    [
      {
        query: "select id,name from bugflow.projects where not archived order by name,id limit 100",
        params: [],
      },
      {
        query: `select s.*,pr.name as project_name,to_json(s.started_at) as started_iso,to_json(s.closed_at) as closed_iso,to_json(s.created_at) as created_iso from bugflow.sprints s join bugflow.projects pr on pr.id=s.project_id order by (s.state='active') desc,(s.state='planned') desc,s.created_at desc limit 200`,
        params: [],
      },
      {
        query: `select si.sprint_id,si.bug_id,si.carried_from_sprint_id,to_json(si.added_at) as added_iso,to_json(si.removed_at) as removed_iso,b.title,b.status,b.priority,b.due_on,b.code_prefix,coalesce(a.name,'Unassigned') as assignee_name from bugflow.sprint_items si join bugflow.bugs b on b.id=si.bug_id left join bugflow.users a on a.id=b.assignee_id where si.removed_at is null and b.deleted_at is null order by si.added_at desc limit 2000`,
        params: [],
      },
    ],
    [],
    { "Neon-Batch-Read-Only": "true" },
  );
  const byId = new Map<string, SprintItem[]>();
  for (const r of results[2]?.rows ?? []) {
    const sid = String(r["sprint_id"]);
    (byId.get(sid) ?? byId.set(sid, []).get(sid)!).push(parseItem(r));
  }
  const sprints = (results[1]?.rows ?? []).map((r) => {
    const s = parseSprint(r);
    const items = byId.get(s.id) ?? [];
    return { ...s, items, summary: summarizeSprint(items, s.startedAt) };
  });
  return {
    projects: (results[0]?.rows ?? []).map((r) => ({
      id: String(r["id"]),
      name: String(r["name"]),
    })),
    sprints,
  };
}

async function audit(actorId: string, bugId: string | null, action: string, detail: object) {
  await neonExecute([
    {
      query: `insert into bugflow.activity(id,actor_id,bug_id,action,detail) values($1,$2,$3::bigint,$4,$5::jsonb)`,
      params: [crypto.randomUUID(), actorId, bugId, action, JSON.stringify(detail)],
    },
  ]);
}

export async function createSprint(data: CreateSprint) {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonExecute(
    `insert into bugflow.sprints(project_id,name,goal,starts_on,ends_on,created_by) select $1,$2,$3,$4::date,$5::date,$6 where exists(select 1 from bugflow.projects where id=$1 and not archived) returning id`,
    [data.projectId, data.name, data.goal, data.startsOn, data.endsOn, admin.userId],
  );
  const id = rows[0]?.["id"];
  if (!id) throw new Error("Choose an active project for the sprint.");
  await audit(admin.userId, null, "sprint.created", { sprint: String(id), name: data.name });
  return { id: String(id) };
}

export async function updateSprint(data: z.infer<typeof updateSprintSchema>) {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonExecute(
    `update bugflow.sprints set name=$2,goal=$3,starts_on=$4::date,ends_on=$5::date where id=$1 and state<>'closed' returning id`,
    [data.id, data.name, data.goal, data.startsOn, data.endsOn],
  );
  if (!rows[0]) throw new Error("This sprint is closed or no longer exists.");
  await audit(admin.userId, null, "sprint.updated", { sprint: data.id, name: data.name });
  return { saved: true };
}

export async function startSprint(data: z.infer<typeof sprintActionSchema>) {
  checkOrigin();
  const admin = await requireAdmin();
  try {
    const { rows } = await neonExecute(
      `update bugflow.sprints set state='active',started_at=now() where id=$1 and state='planned' returning id`,
      [data.id],
    );
    if (!rows[0]) throw new Error("Only a planned sprint can be started.");
  } catch (e) {
    // The partial unique index blocks a second active sprint in the same project.
    if (/sprints_one_active_per_project|unique/i.test(String((e as Error).message)))
      throw new Error("That project already has an active sprint. Close it first.");
    throw e;
  }
  await audit(admin.userId, null, "sprint.started", { sprint: data.id });
  return { started: true };
}

export async function closeSprint(data: z.infer<typeof sprintActionSchema>) {
  checkOrigin();
  const admin = await requireAdmin();
  const { results } = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    {
      query: `update bugflow.sprints set state='closed',closed_at=now() where id=$1 and state='active' returning id,project_id`,
      params: [data.id],
    },
    // Carry still-open bugs (not in a closed status) into the chosen sprint, if one was given and it is open and in
    // the same project. Already-present bugs are left alone. carried_from_sprint_id records the origin.
    {
      query: `insert into bugflow.sprint_items(sprint_id,bug_id,added_by,carried_from_sprint_id)
        select $2,si.bug_id,$3,$1 from bugflow.sprint_items si
        join bugflow.bugs b on b.id=si.bug_id
        where si.sprint_id=$1 and si.removed_at is null and b.deleted_at is null
          and b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')
          and $2::uuid is not null
          and exists(select 1 from bugflow.sprints t where t.id=$2 and t.state in ('planned','active')
            and t.project_id=(select project_id from bugflow.sprints where id=$1))
          and exists(select 1 from bugflow.sprints c where c.id=$1 and c.state='closed')
        on conflict (sprint_id,bug_id) do nothing`,
      params: [data.id, data.carryTo ?? null, admin.userId],
    },
  ]);
  if (!results[0]?.rows[0]) throw new Error("Only an active sprint can be closed.");
  await audit(admin.userId, null, "sprint.closed", {
    sprint: data.id,
    carriedTo: data.carryTo ?? null,
  });
  return { closed: true };
}

export async function addToSprint(data: z.infer<typeof sprintItemSchema>) {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonExecute(
    `insert into bugflow.sprint_items(sprint_id,bug_id,added_by)
      select $1,$2::bigint,$3 from bugflow.sprints s
      where s.id=$1 and s.state in ('planned','active')
        and exists(select 1 from bugflow.bugs b where b.id=$2::bigint and b.deleted_at is null and b.kind<>'epic' and b.project_id=s.project_id)
        and not exists(
          select 1 from bugflow.sprint_items o join bugflow.sprints os on os.id=o.sprint_id
          where o.bug_id=$2::bigint and o.removed_at is null and os.state in ('planned','active') and os.id<>$1)
    on conflict (sprint_id,bug_id) do update set removed_at=null,removed_by=null,added_at=now(),added_by=$3
      where bugflow.sprint_items.removed_at is not null
    returning bug_id`,
    [data.sprintId, data.bugId, admin.userId],
  );
  if (!rows[0])
    throw new Error(
      "Could not add this bug: the sprint must be open, the bug must belong to its project, and the bug cannot already be in another open sprint.",
    );
  await audit(admin.userId, data.bugId, "sprint.item_added", { sprint: data.sprintId });
  return { added: true };
}

export async function removeFromSprint(data: z.infer<typeof sprintItemSchema>) {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonExecute(
    `update bugflow.sprint_items set removed_at=now(),removed_by=$3 where sprint_id=$1 and bug_id=$2::bigint and removed_at is null returning bug_id`,
    [data.sprintId, data.bugId, admin.userId],
  );
  if (!rows[0]) throw new Error("That bug is not in this sprint.");
  await audit(admin.userId, data.bugId, "sprint.item_removed", { sprint: data.sprintId });
  return { removed: true };
}

/**
 * The active (else newest planned) sprint of one project, with its live items. Carries NO access check of its own:
 * callers (the MCP tools) must already have verified the project is visible to their panel.
 */
export async function activeSprint(projectId: string) {
  const { rows } = await neonQuery(
    `select s.*,pr.name as project_name,to_json(s.started_at) as started_iso,to_json(s.closed_at) as closed_iso,to_json(s.created_at) as created_iso
     from bugflow.sprints s join bugflow.projects pr on pr.id=s.project_id
     where s.project_id=$1 and s.state<>'closed' order by (s.state='active') desc,s.created_at desc limit 1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  const sprint = parseSprint(row);
  const { rows: itemRows } = await neonQuery(
    `select si.sprint_id,si.bug_id,si.carried_from_sprint_id,to_json(si.added_at) as added_iso,to_json(si.removed_at) as removed_iso,b.title,b.status,b.priority,b.due_on,b.code_prefix,coalesce(a.name,'Unassigned') as assignee_name
     from bugflow.sprint_items si join bugflow.bugs b on b.id=si.bug_id left join bugflow.users a on a.id=b.assignee_id
     where si.sprint_id=$1 and si.removed_at is null and b.deleted_at is null order by si.added_at limit 500`,
    [sprint.id],
  );
  const items = itemRows.map(parseItem);
  return { ...sprint, items, summary: summarizeSprint(items, sprint.startedAt) };
}

/**
 * Read-only sprints for a portal: open sprints (and the project names) of exactly the projects this access can see.
 * No mutations here — planning stays with Admin; members watch their sprint.
 */
export async function portalSprints(access: import("./bug-workflow").BugAccess) {
  const { actorFor } = await import("./bug-workflow.server");
  const actor = await actorFor(access);
  if (!actor.permissions.includes("view"))
    throw new Error("This portal does not have permission to view bugs.");
  const { rows } = await neonQuery(
    `select s.*,pr.name as project_name,to_json(s.started_at) as started_iso,to_json(s.closed_at) as closed_iso,to_json(s.created_at) as created_iso
     from bugflow.sprints s join bugflow.projects pr on pr.id=s.project_id
     where s.state<>'closed' and ($2::boolean or exists(select 1 from bugflow.portal_projects pp where pp.portal_id=$1::uuid and pp.project_id=s.project_id))
     order by (s.state='active') desc,s.created_at desc limit 20`,
    [actor.portalId, actor.role === "admin"],
  );
  const sprints = rows.map(parseSprint);
  if (!sprints.length) return [];
  const ids = sprints.map((s) => s.id);
  const { rows: itemRows } = await neonQuery(
    `select si.sprint_id,si.bug_id,si.carried_from_sprint_id,to_json(si.added_at) as added_iso,to_json(si.removed_at) as removed_iso,b.title,b.status,b.priority,b.due_on,b.code_prefix,coalesce(a.name,'Unassigned') as assignee_name
     from bugflow.sprint_items si join bugflow.bugs b on b.id=si.bug_id left join bugflow.users a on a.id=b.assignee_id
     where si.sprint_id=any($1::uuid[]) and si.removed_at is null and b.deleted_at is null order by si.added_at limit 1000`,
    [ids],
  );
  return sprints.map((s) => {
    const items = itemRows.filter((r) => String(r["sprint_id"]) === s.id).map(parseItem);
    return { ...s, items, summary: summarizeSprint(items, s.startedAt) };
  });
}
