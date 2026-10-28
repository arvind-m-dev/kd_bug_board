import { neonQuery, neonExecute } from "./neon.server";
import { requireAdmin, checkOrigin } from "./portal-access.server";
import { hashToken } from "./portal-access";
import {
  formatBugCode,
  statusPath,
  mayUpdateStatus,
  mayVerify,
  type BugAccess,
  type BugActor,
  type LiveBug,
  type BugWorkspaceData,
  type BugChange,
  type reportSchema,
  type BugEdit,
  mayEditBug,
  maySetDue,
  cleanOptions,
  type DropdownOptions,
  type ExportBug,
} from "./bug-workflow";
import type { z } from "zod";
import type { Status } from "./bugflow";

export async function actorFor(access: BugAccess): Promise<BugActor> {
  if (access.kind === "admin") {
    const a = await requireAdmin();
    return {
      userId: a.userId,
      portalId: a.id,
      name: a.name,
      role: "admin",
      permissions: ["view", "report", "comment", "evidence", "validate", "assign"],
    };
  }
  if (access.kind === "ai") {
    // An AI token resolves to its portal's actor; the admin portal grants full permissions, a member portal its granted set.
    const { rows } = await neonExecute(
      `update bugflow.ai_tokens t set last_used_at=now() from bugflow.portals p join bugflow.users u on u.id=p.user_id where t.portal_id=p.id and t.token_hash=$1 and t.revoked_at is null and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) returning p.id,p.user_id,p.type,u.name,(select o.permissions from bugflow.portal_onboarding o where o.portal_id=p.id) as permissions`,
      [await hashToken(access.token)],
    );
    const r = rows[0];
    if (!r) throw new Error("This AI token is invalid or has been revoked.");
    const type = String(r["type"]);
    if (type === "admin")
      return {
        userId: String(r["user_id"]),
        portalId: String(r["id"]),
        name: String(r["name"]),
        role: "admin",
        permissions: ["view", "report", "comment", "evidence", "validate", "assign"],
      };
    return {
      portalId: String(r["id"]),
      userId: String(r["user_id"]),
      name: String(r["name"]),
      role: type as "reporter" | "qa" | "developer" | "member",
      permissions: Array.isArray(r["permissions"])
        ? r["permissions"].filter((v): v is string => typeof v === "string")
        : [],
    };
  }
  const { rows } = await neonQuery(
    `select p.id,p.user_id,p.type,u.name,o.permissions from bugflow.portals p join bugflow.users u on u.id=p.user_id join bugflow.portal_onboarding o on o.portal_id=p.id where p.token_hash=$1 and p.type=$2 and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) limit 1`,
    [await hashToken(access.token), access.type],
  );
  const r = rows[0];
  if (!r)
    throw new Error("This portal link has expired or been revoked. Ask your Admin for a new link.");
  return {
    portalId: String(r["id"]),
    userId: String(r["user_id"]),
    name: String(r["name"]),
    role: access.type,
    permissions: Array.isArray(r["permissions"])
      ? r["permissions"].filter((v): v is string => typeof v === "string")
      : [],
  };
}
function scopeBase(actor: BugActor) {
  return actor.role === "admin"
    ? "($1::uuid is not null and $2::uuid is not null and ($3::boolean or true))"
    : `exists(select 1 from bugflow.portal_projects pp where pp.portal_id=$1::uuid and pp.project_id=b.project_id) and (b.reporter_id=$2::uuid or b.assignee_id=$2::uuid or exists(select 1 from bugflow.bug_assignees ba where ba.bug_id=b.id and ba.user_id=$2::uuid) or $3::boolean)`;
}
function scope(actor: BugActor) {
  return `(${scopeBase(actor)}) and b.deleted_at is null`;
}
const columns = `b.*,pr.name as project_name,r.name as reporter_name,coalesce(a.name,'Unassigned') as assignee_name,coalesce((select jsonb_agg(jsonb_build_object('id',ux.id,'name',ux.name,'role',coalesce((select min(px.type) from bugflow.portals px where px.user_id=ux.id and px.type<>'admin'),'admin')) order by (ux.id=b.assignee_id) desc,ux.name) from bugflow.bug_assignees bx join bugflow.users ux on ux.id=bx.user_id where bx.bug_id=b.id),'[]'::jsonb) as assignees,to_json(b.created_at) as created_iso,to_json(b.updated_at) as updated_iso,b.updated_at::text as version,coalesce(d.module_name,'') as module_name,(select jsonb_build_object('by',u2.name,'action',a2.action,'at',to_json(a2.created_at),'via',coalesce((select px.type from bugflow.portals px where px.user_id=u2.id order by px.created_at desc limit 1),'')) from bugflow.activity a2 join bugflow.users u2 on u2.id=a2.actor_id where a2.bug_id=b.id order by a2.created_at desc,a2.id desc limit 1) as last_change,coalesce(d.evidence_urls,'[]'::jsonb) as evidence_urls,coalesce((select jsonb_agg(s.content order by s.position) from bugflow.steps s where s.bug_id=b.id),'[]'::jsonb) as steps,(select jsonb_build_object('by',x.who,'at',to_json(x.at),'notes',x.notes) from (select u3.name as who,a3.created_at as at,a3.detail->>'notes' as notes from bugflow.activity a3 join bugflow.users u3 on u3.id=a3.actor_id where a3.bug_id=b.id and a3.detail->>'status'=b.status and coalesce(a3.detail->>'notes','')<>'' union all select u4.name,v.created_at,v.notes from bugflow.verifications v join bugflow.users u4 on u4.id=v.actor_id where v.bug_id=b.id and v.passed=(b.status='RESOLVED') and b.status in ('REOPENED','RESOLVED') and v.notes<>'') x order by x.at desc limit 1) as status_note`;
const joins = `from bugflow.bugs b join bugflow.projects pr on pr.id=b.project_id join bugflow.users r on r.id=b.reporter_id left join bugflow.users a on a.id=b.assignee_id left join bugflow.bug_details d on d.bug_id=b.id`;
function parseBug(r: Record<string, unknown>, evidence = false): LiveBug {
  return {
    id: String(r["id"]),
    code: formatBugCode(String(r["id"])),
    title: String(r["title"]),
    projectId: String(r["project_id"]),
    project: String(r["project_name"]),
    reporterId: String(r["reporter_id"]),
    reporter: String(r["reporter_name"]),
    assigneeId: r["assignee_id"] ? String(r["assignee_id"]) : null,
    assignee: String(r["assignee_name"]),
    assignees: Array.isArray(r["assignees"])
      ? (r["assignees"] as { id: string; name: string; role?: string }[]).map((x) => ({
          id: String(x.id),
          name: String(x.name),
          role: x.role ? String(x.role) : "",
        }))
      : [],
    status: r["status"] as Status,
    priority: String(r["priority"]),
    severity: String(r["severity"]),
    description: String(r["description"]),
    expected: String(r["expected"]),
    actual: String(r["actual"]),
    browserDevice: String(r["browser_device"]),
    environment: String(r["environment"]),
    fixNotes: String(r["fix_notes"]),
    createdAt: String(r["created_iso"]),
    updatedAt: String(r["updated_iso"]),
    version: String(r["version"]),
    dueOn: r["due_on"] ? String(r["due_on"]).slice(0, 10) : null,
    module: String(r["module_name"]),
    steps: Array.isArray(r["steps"]) ? r["steps"].map(String) : [],
    lastChange:
      r["last_change"] && typeof r["last_change"] === "object"
        ? (() => {
            const l = r["last_change"] as Record<string, unknown>;
            return {
              by: String(l["by"]),
              via: String(l["via"]),
              action: String(l["action"]),
              at: String(l["at"]),
            };
          })()
        : null,
    evidenceUrls:
      evidence && Array.isArray(r["evidence_urls"]) ? r["evidence_urls"].map(String) : [],
    statusNote:
      r["status_note"] && typeof r["status_note"] === "object"
        ? (() => {
            const n = r["status_note"] as Record<string, unknown>;
            return { by: String(n["by"]), at: String(n["at"]), notes: String(n["notes"]) };
          })()
        : null,
  };
}
export async function workspaceData(access: BugAccess, cursor?: string): Promise<BugWorkspaceData> {
  await (await import("./trash.server")).maybeExpireTrash().catch(() => undefined);
  const actor = await actorFor(access);
  if (!actor.permissions.includes("view"))
    throw new Error("This portal does not have permission to view bugs.");
  const params = [
    actor.portalId,
    actor.userId,
    actor.role === "qa" || actor.permissions.includes("view_all"),
  ];
  const timeZone = await workspaceTimeZone();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const where = scope(actor);
  const { results } = await neonQuery<{ results: { rows: Record<string, unknown>[] }[] }>(
    [
      {
        query:
          actor.role === "admin"
            ? "select id,name from bugflow.projects where not archived order by name,id limit 100"
            : "select p.id,p.name from bugflow.projects p join bugflow.portal_projects pp on pp.project_id=p.id where pp.portal_id=$1 and not p.archived order by p.name,p.id limit 100",
        params: actor.role === "admin" ? [] : [actor.portalId],
      },
      {
        query: `select count(*) as total,count(*) filter(where b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')) as open,count(*) filter(where b.status='RECHECK') as recheck,count(*) filter(where b.status='RESOLVED') as resolved,count(*) filter(where b.assignee_id is null) as unassigned,count(*) filter(where b.due_on is not null and b.due_on<$4::date and b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')) as overdue from bugflow.bugs b where ${where}`,
        params: [...params, today],
      },
      {
        query: `select ${columns} ${joins} where ${where} and ($4::bigint is null or b.id<$4) order by b.id desc limit 51`,
        params: [...params, cursor ?? null],
      },
      {
        // Admin sees every active member (also those on no project yet); others see members who share a project with them.
        query: `select u.id,u.name,min(p.type) as role,coalesce(jsonb_agg(distinct pp.project_id) filter (where pp.project_id is not null),'[]'::jsonb) as project_ids from bugflow.users u join bugflow.portals p on p.user_id=u.id left join bugflow.portal_projects pp on pp.portal_id=p.id where p.type<>'admin' and u.deleted_at is null and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) and ($2::boolean or exists(select 1 from bugflow.portal_projects mine where mine.portal_id=$1 and mine.project_id=pp.project_id)) group by u.id,u.name order by u.name,u.id limit 200`,
        params: [actor.portalId, actor.role === "admin"],
      },
      {
        query: `select b.status,(b.assignee_id is not null) as assigned,count(*) as n from bugflow.bugs b where ${where} group by 1,2`,
        params: params,
      },
      { query: `select value from bugflow.settings where key='dropdown_options'`, params: [] },
    ],
    [],
    { "Neon-Batch-Read-Only": "true" },
  );
  const stats = results[1]?.rows[0] ?? {};
  const rows = results[2]?.rows ?? [];
  const media = await (await import("./bug-media.server")).mediaClientConfig();
  return {
    media,
    options: cleanOptions(results[5]?.rows[0]?.["value"]),
    actor,
    projects: (results[0]?.rows ?? []).map((r) => ({
      id: String(r["id"]),
      name: String(r["name"]),
    })),
    developers: actor.permissions.includes("assign")
      ? (results[3]?.rows ?? []).map((r) => ({
          id: String(r["id"]),
          name: String(r["name"]),
          role: String(r["role"] ?? ""),
          projectIds: Array.isArray(r["project_ids"]) ? r["project_ids"].map(String) : [],
        }))
      : [],
    bugs: rows.slice(0, 50).map((r) => parseBug(r, actor.permissions.includes("evidence"))),
    total: Number(stats["total"] ?? 0),
    open: Number(stats["open"] ?? 0),
    recheck: Number(stats["recheck"] ?? 0),
    resolved: Number(stats["resolved"] ?? 0),
    unassigned: Number(stats["unassigned"] ?? 0),
    overdue: Number(stats["overdue"] ?? 0),
    today,
    timeZone,
    statusCounts: (results[4]?.rows ?? []).map((r) => ({
      status: String(r["status"]),
      assigned: r["assigned"] === true,
      count: Number(r["n"] ?? 0),
    })),
    nextCursor: rows.length > 50 ? String(rows[49]?.["id"]) : null,
  };
}
export async function reportBug(access: BugAccess, data: z.infer<typeof reportSchema>) {
  checkOrigin();
  const actor = await actorFor(access);
  if (!actor.permissions.includes("report"))
    throw new Error("Your Admin has not granted bug reporting permission.");
  if (!(await dropdownOptions()).severities.includes(data.severity))
    throw new Error("Choose a severity from the list.");
  // A reporter without planning permission cannot set a due date on creation; the value is dropped, not rejected.
  const dueOn = maySetDue(actor) ? data.dueOn : null;
  const { rows } = await neonExecute(
    `with permitted as (select p.id from bugflow.projects p where p.id=$3 and not p.archived and ($2::boolean or exists(select 1 from bugflow.portal_projects pp join bugflow.portals ap on ap.id=pp.portal_id where pp.portal_id=$1 and pp.project_id=p.id and ap.active and ap.revoked_at is null and (ap.expires_at is null or ap.expires_at>now())))), existing as (select b.id from bugflow.bug_details d join bugflow.bugs b on b.id=d.bug_id where d.request_id=$4 and b.reporter_id=$5), created as (insert into bugflow.bugs(title,project_id,reporter_id,priority,severity,description,expected,actual,browser_device,environment,due_on) select $6,id,$5,$7,$8,$9,$10,$11,$12,$13,$19::date from permitted where not exists(select 1 from existing) returning id), details as (insert into bugflow.bug_details(bug_id,request_id,module_name,evidence_urls) select id,$4,$14,$15::jsonb from created), steps as (insert into bugflow.steps(bug_id,position,content) select c.id,s.ordinality::int,s.value from created c cross join jsonb_array_elements_text($16::jsonb) with ordinality s(value,ordinality)), history as (insert into bugflow.status_history(id,bug_id,actor_id,new_status) select $17,id,$5,'NEW' from created), activity as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $18,id,$5,'bug.created',jsonb_build_object('priority',$7::text) from created) select id from created union all select id from existing`,
    [
      actor.portalId,
      actor.role === "admin",
      data.projectId,
      data.requestId,
      actor.userId,
      data.title,
      data.priority,
      data.severity,
      data.description,
      data.expected,
      data.actual,
      data.browserDevice,
      data.environment,
      data.module,
      JSON.stringify(data.evidenceUrls),
      JSON.stringify(data.steps),
      crypto.randomUUID(),
      crypto.randomUUID(),
      dueOn,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Choose a project available to this portal.");
  return { id: String(row["id"]), code: formatBugCode(String(row["id"])) };
}
export async function bugDetail(access: BugAccess, id: string) {
  const actor = await actorFor(access);
  if (!actor.permissions.includes("view")) throw new Error("Bug access is not permitted.");
  const { rows } = await neonQuery(
    `select ${columns} ${joins} where ${scope(actor)} and b.id=$4 limit 1`,
    [
      actor.portalId,
      actor.userId,
      actor.role === "qa" || actor.permissions.includes("view_all"),
      id,
    ],
  );
  const r = rows[0];
  if (!r) throw new Error("This bug is not available in your portal.");
  const summary = actor.role !== "admin";
  const keep = ["status", "previousStatus", "priority", "previousPriority"];
  const { rows: events } = await neonQuery(
    `select a.id,a.action,a.detail,u.name,to_json(a.created_at) as created_iso from bugflow.activity a join bugflow.users u on u.id=a.actor_id where a.bug_id=$1 order by a.created_at desc,a.id desc limit ${actor.role === "admin" ? 100 : 12}`,
    [id],
  );
  const media = await (
    await import("./bug-media.server")
  ).listMedia(id, actor.permissions.includes("evidence"));
  return {
    media,
    bug: parseBug(r, actor.permissions.includes("evidence")),
    events: events.map((e) => ({
      id: String(e["id"]),
      bugId: id,
      actor: String(e["name"]),
      action: String(e["action"]),
      detail: Object.fromEntries(
        Object.entries((e["detail"] ?? {}) as Record<string, unknown>)
          .filter(
            ([k]) =>
              !summary ||
              keep.includes(k) ||
              (["bug.status", "bug.verify"].includes(String(e["action"])) &&
                (k === "notes" || k === "noteTo")),
          )
          .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
      ),
      createdAt: String(e["created_iso"]),
    })),
  };
}
export async function changeBug(access: BugAccess, data: BugChange) {
  checkOrigin();
  const actor = await actorFor(access);
  const { bug } = await bugDetail(access, data.id);
  let status = bug.status,
    priority = bug.priority,
    severity = bug.severity,
    assignee = bug.assigneeId;
  let assigneeIds: string[] = [];
  let grantIds: string[] = [];
  let hops: [string, string][] = [];
  if (data.action === "status") {
    const path = data.status ? statusPath(actor, bug, data.status) : null;
    if (!data.status || !path) throw new Error("This status update is not permitted.");
    hops = path;
    status = data.status;
  }
  if (data.action === "priority") {
    if (actor.role !== "admin" || !data.priority)
      throw new Error("Only Admin can change priority.");
    priority = data.priority;
  }
  if (data.action === "severity") {
    if (actor.role !== "admin" || !data.severity)
      throw new Error("Only Admin can change severity.");
    if (!(await dropdownOptions()).severities.includes(data.severity))
      throw new Error("Choose a severity from Settings.");
    severity = data.severity;
  }
  if (data.action === "assign") {
    const ids = [
      ...new Set(
        data.assigneeIds?.length ? data.assigneeIds : data.assigneeId ? [data.assigneeId] : [],
      ),
    ];
    if (!actor.permissions.includes("assign") || !ids.length)
      throw new Error("Assignment is not permitted.");
    const { rows } = await neonQuery(
      `select p.user_id,bool_or(pp.project_id=$2) as on_project from bugflow.portals p join bugflow.users u on u.id=p.user_id left join bugflow.portal_projects pp on pp.portal_id=p.id where p.user_id=any($1::uuid[]) and p.type<>'admin' and u.deleted_at is null and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) group by p.user_id`,
      [ids, bug.projectId],
    );
    if (rows.length !== ids.length) throw new Error("Choose active members.");
    const outside = rows.filter((r) => r["on_project"] !== true).map((r) => String(r["user_id"]));
    if (outside.length) {
      // Only Admin may widen someone's project access, and only when asked to (granted in the same save below).
      if (actor.role !== "admin" || !data.grantAccess)
        throw new Error(
          "Some of these people have no access to this bug's project. Ask Admin to add them first.",
        );
      grantIds = outside;
    }
    if (
      !["VALIDATED", "READY_FOR_ASSIGNMENT", "ASSIGNED", "REOPENED", "IN_PROGRESS"].includes(
        bug.status,
      )
    ) {
      const path = statusPath(actor, bug, "READY_FOR_ASSIGNMENT");
      if (!path) throw new Error("Validate this bug before assigning it.");
      hops = path;
    }
    assignee = ids[0] ?? null;
    assigneeIds = ids;
    if (bug.status !== "IN_PROGRESS" && bug.status !== "ASSIGNED") {
      hops.push([hops.length ? "READY_FOR_ASSIGNMENT" : bug.status, "ASSIGNED"]);
      status = "ASSIGNED";
    }
  }
  if (data.action === "comment" && (!actor.permissions.includes("comment") || !data.notes))
    throw new Error("Add a comment before saving.");
  if (data.action === "verify") {
    if (!mayVerify(actor, bug) || data.passed === undefined)
      throw new Error(
        "Only QA or Admin can pass or fail a retest (and not the developer who made the fix).",
      );
    status = data.passed ? "RESOLVED" : "REOPENED";
    hops = [[bug.status, status]];
  }
  const { rows } = await neonExecute(
    `with prior as (select b.* from bugflow.bugs b where b.id=$1 and b.updated_at=$2::timestamptz and exists(select 1 from bugflow.portals p join bugflow.users u on u.id=p.user_id where p.id=$3 and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now())) and not exists(select 1 from bugflow.bug_mutations where request_id=$4) for update), changed as (update bugflow.bugs b set status=$5,priority=$6,severity=$20,assignee_id=$7::uuid,fix_notes=case when $8='status' and $5='RECHECK' then $9 else b.fix_notes end,updated_at=clock_timestamp() from prior old where b.id=old.id returning b.id), mutation as (insert into bugflow.bug_mutations(request_id,bug_id,actor_id) select $4,id,$10 from changed), history as (insert into bugflow.status_history(id,bug_id,actor_id,previous_status,new_status,created_at) select case when h.ord=1 then $11::uuid else gen_random_uuid() end,c.id,$10,h.prev,h.next,clock_timestamp()+(h.ord*interval '1 millisecond') from changed c cross join unnest($21::text[],$22::text[]) with ordinality h(prev,next,ord)), assignment as (insert into bugflow.assignments(id,bug_id,actor_id,previous_assignee_id,assignee_id) select $12,c.id,$10,p.assignee_id,$7::uuid from changed c join prior p on p.id=c.id where $8='assign'), unassign as (delete from bugflow.bug_assignees x using changed c where $8='assign' and x.bug_id=c.id and x.user_id<>all($19::uuid[])), coassign as (insert into bugflow.bug_assignees(bug_id,user_id,assigned_by) select c.id,u,$10 from changed c cross join unnest($19::uuid[]) u where $8='assign' on conflict do nothing), grant_access as (insert into bugflow.portal_projects(portal_id,project_id) select p.id,$24::uuid from changed c cross join bugflow.portals p join bugflow.users u on u.id=p.user_id where $8='assign' and p.user_id=any($23::uuid[]) and p.type<>'admin' and p.active and u.active and p.revoked_at is null on conflict do nothing), comment as (insert into bugflow.comments(id,bug_id,actor_id,content) select $13,id,$10,$9 from changed where $8='comment'), verification as (insert into bugflow.verifications(id,bug_id,actor_id,passed,notes) select $14,id,$10,$15::boolean,$9 from changed where $8='verify'), activity as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $16,c.id,$10,$17,jsonb_build_object('previousStatus',p.status,'status',$5::text,'previousPriority',p.priority,'priority',$6::text,'previousSeverity',p.severity,'severity',$20::text,'assignee',$7::text,'notes',$9::text,'noteTo',$18::text,'assignees',to_jsonb($19::uuid[]),'granted',to_jsonb($23::uuid[])) from changed c join prior p on p.id=c.id) select id from changed union all select bug_id as id from bugflow.bug_mutations where request_id=$4 and actor_id=$10`,
    [
      data.id,
      data.version,
      actor.portalId,
      data.requestId,
      status,
      priority,
      assignee,
      data.action,
      data.notes,
      actor.userId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      data.passed ?? false,
      crypto.randomUUID(),
      `bug.${data.action}`,
      data.noteTo,
      assigneeIds,
      severity,
      hops.map((h) => h[0]),
      hops.map((h) => h[1]),
      grantIds,
      bug.projectId,
    ],
  );
  if (!rows.length)
    throw new Error(
      "This bug changed or your access expired. Refresh the bug before trying again.",
    );
  return { saved: true };
}

export async function editBugReport(access: BugAccess, data: BugEdit) {
  checkOrigin();
  const actor = await actorFor(access);
  const { bug } = await bugDetail(access, data.id);
  if (!mayEditBug(actor, bug))
    throw new Error("You can only edit open bugs you reported or are assigned to.");
  // Priority and severity are Admin decisions once a bug exists (the status panel enforces the same rule).
  if (actor.role !== "admin" && (data.priority !== bug.priority || data.severity !== bug.severity))
    throw new Error("Only Admin can change priority or severity after a bug is reported.");
  if (
    data.severity !== bug.severity &&
    !(await dropdownOptions()).severities.includes(data.severity)
  )
    throw new Error("Choose a severity from the list.");
  const evidence = actor.permissions.includes("evidence") || actor.role === "admin";
  // Only planners may change the due date; for anyone else the stored value is preserved ($13 = false).
  const applyDue = maySetDue(actor);
  // The audit row is written by the same statement as the version-checked update, so it exists only when this
  // edit won; the detail and step writes below depend on it and never apply a stale edit's leftovers.
  const editId = crypto.randomUUID();
  const applied = (n: number) => `exists(select 1 from bugflow.activity where id=$${n}::uuid)`;
  const { results } = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    {
      query: `with old as (select priority,severity,due_on from bugflow.bugs where id=$1), u as (update bugflow.bugs set title=$3,priority=$4,severity=$5,description=$6,expected=$7,actual=$8,browser_device=$9,environment=$10,due_on=case when $13::boolean then $14::date else due_on end,updated_at=clock_timestamp() where id=$1 and updated_at=$2::timestamptz and deleted_at is null returning id) insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $11,u.id,$12,'bug.edited',jsonb_strip_nulls(jsonb_build_object('title',$3::text,'previousPriority',case when old.priority<>$4 then old.priority end,'priority',case when old.priority<>$4 then $4::text end,'previousSeverity',case when old.severity<>$5 then old.severity end,'severity',case when old.severity<>$5 then $5::text end,'previousDue',case when $13::boolean and old.due_on is distinct from $14::date then coalesce(to_char(old.due_on,'YYYY-MM-DD'),'none') end,'due',case when $13::boolean and old.due_on is distinct from $14::date then coalesce($14::text,'none') end)) from u cross join old returning bug_id`,
      params: [
        data.id,
        data.version,
        data.title,
        data.priority,
        data.severity,
        data.description,
        data.expected,
        data.actual,
        data.browserDevice,
        data.environment,
        editId,
        actor.userId,
        applyDue,
        data.dueOn,
      ],
    },
    {
      query: `update bugflow.bug_details set module_name=$2,evidence_urls=case when $4::boolean then $3::jsonb else evidence_urls end where bug_id=$1 and ${applied(5)}`,
      params: [data.id, data.module, JSON.stringify(data.evidenceUrls), evidence, editId],
    },
    {
      query: `delete from bugflow.steps where bug_id=$1 and ${applied(2)}`,
      params: [data.id, editId],
    },
    {
      query: `insert into bugflow.steps(bug_id,position,content) select $1,s.ordinality::int,s.value from jsonb_array_elements_text($2::jsonb) with ordinality s(value,ordinality) where ${applied(3)}`,
      params: [data.id, JSON.stringify(data.steps), editId],
    },
  ]);
  if (!results[0]?.rows.length)
    throw new Error("This bug changed since you opened it. Refresh and try again.");
  return { saved: true };
}

async function dropdownOptions() {
  const { rows } = await neonQuery(
    `select value from bugflow.settings where key='dropdown_options'`,
  );
  return cleanOptions(rows[0]?.["value"]);
}

let tzCache: { at: number; tz: string } | null = null;
/** The workspace's configured time zone (settings key 'workspace'), or UTC. Cached 30s; used to decide "today". */
export async function workspaceTimeZone(): Promise<string> {
  if (tzCache && Date.now() - tzCache.at < 30000) return tzCache.tz;
  let tz = "UTC";
  try {
    const { rows } = await neonQuery(`select value from bugflow.settings where key='workspace'`);
    const v = rows[0]?.["value"] as { timeZone?: unknown } | undefined;
    if (v && typeof v.timeZone === "string") {
      // Validate against the runtime's zone database; an unknown name throws and we keep UTC.
      new Intl.DateTimeFormat("en-CA", { timeZone: v.timeZone });
      tz = v.timeZone;
    }
  } catch {
    tz = "UTC";
  }
  tzCache = { at: Date.now(), tz };
  return tz;
}
/** Today's date (YYYY-MM-DD) in the workspace time zone. en-CA formats as YYYY-MM-DD. */
export async function workspaceToday(): Promise<string> {
  const tz = await workspaceTimeZone();
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export async function saveDropdownOptions(options: DropdownOptions) {
  checkOrigin();
  const admin = await requireAdmin();
  const clean = cleanOptions(options);
  await neonExecute([
    {
      query: `insert into bugflow.settings(key,value) values('dropdown_options',$1::jsonb) on conflict (key) do update set value=excluded.value`,
      params: [JSON.stringify(clean)],
    },
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.dropdowns',$3::jsonb)`,
      params: [crypto.randomUUID(), admin.userId, JSON.stringify(clean)],
    },
  ]);
  return clean;
}
export async function saveWorkspaceTimeZone(timeZone: string) {
  checkOrigin();
  const admin = await requireAdmin();
  // Reject anything the runtime's zone database does not know, so "today" is always computable.
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
  } catch {
    throw new Error("Choose a valid time zone.");
  }
  await neonExecute([
    {
      query: `insert into bugflow.settings(key,value) values('workspace',jsonb_build_object('timeZone',$1::text)) on conflict (key) do update set value=bugflow.settings.value||jsonb_build_object('timeZone',$1::text)`,
      params: [timeZone],
    },
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.timezone',jsonb_build_object('timeZone',$3::text))`,
      params: [crypto.randomUUID(), admin.userId, timeZone],
    },
  ]);
  tzCache = null;
  return { timeZone };
}
export async function deleteBugReport(id: string, reason: string) {
  checkOrigin();
  const admin = await requireAdmin();
  const { results } = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    {
      query: `update bugflow.bugs set deleted_at=now(),updated_at=clock_timestamp() where id=$1 and deleted_at is null returning id,title`,
      params: [id],
    },
    {
      query: `insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $1,$2,$3,'bug.deleted',jsonb_build_object('reason',$4::text) where exists(select 1 from bugflow.bugs where id=$2 and deleted_at is not null)`,
      params: [crypto.randomUUID(), id, admin.userId, reason],
    },
  ]);
  if (!results[0]?.rows.length) throw new Error("This bug was already deleted.");
  // Attachments stay with the bug in the Trash so a restore brings them back; they leave storage when it is deleted forever.
  return { deleted: true };
}

/** Every bug in the actor's scope (newest first, up to 2000) with the latest developer and QA comment and the ids of its attachments — for the spreadsheet export. */
export async function exportBugs(
  access: BugAccess,
  filter: { projectId: string | null; includeClosed: boolean },
): Promise<ExportBug[]> {
  const actor = await actorFor(access);
  if (!actor.permissions.includes("view"))
    throw new Error("This portal does not have permission to view bugs.");
  const params: unknown[] = [
    actor.portalId,
    actor.userId,
    actor.role === "qa" || actor.permissions.includes("view_all"),
    filter.projectId,
  ];
  const closed = filter.includeClosed
    ? ""
    : " and b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')";
  const comment = (types: string) =>
    `(select c.content from bugflow.comments c where c.bug_id=b.id and exists(select 1 from bugflow.portals px where px.user_id=c.actor_id and px.type in (${types})) order by c.created_at desc limit 1)`;
  const { rows } = await neonQuery(
    `select ${columns},${comment("'developer'")} as dev_comment,${comment("'qa','admin'")} as qa_comment,coalesce((select jsonb_agg(m.id order by m.created_at) from bugflow.bug_media m where m.bug_id=b.id and m.status='ready' and m.deleted_at is null),'[]'::jsonb) as media_ids ${joins} where ${scope(actor)} and ($4::uuid is null or b.project_id=$4::uuid)${closed} order by b.created_at,b.id limit 2000`,
    params,
  );
  return rows.map((r) => ({
    ...parseBug(r, actor.permissions.includes("evidence")),
    devComment: r["dev_comment"] == null ? "" : String(r["dev_comment"]),
    qaComment: r["qa_comment"] == null ? "" : String(r["qa_comment"]),
    mediaIds: Array.isArray(r["media_ids"]) ? (r["media_ids"] as unknown[]).map(String) : [],
  }));
}
