import { neonBatch } from "./neon.server";
import { requireAdmin } from "./portal-access.server";
import { formatBugCode } from "./bug-workflow";
import { periodWindow, type Period } from "./period";

/** Everything the Overview shows for bugs reported in a period, counted over ALL bugs (not one page). */
export async function overviewStats(period: Period & { tz?: string }) {
  await requireAdmin();
  const params: unknown[] = [];
  const win = periodWindow(period, params)("b.created_at");
  const base = `bugflow.bugs b where b.deleted_at is null and ${win}`;
  const owners = `(select x.bug_id, x.user_id from bugflow.bug_assignees x union select id, assignee_id from bugflow.bugs where assignee_id is not null)`;
  const open = `b.status not in ('RESOLVED','NOT_A_BUG','DUPLICATE','WONT_FIX')`;
  const attention = `(b.status in ('NEW','REOPENED','RECHECK','NEEDS_INFORMATION') or (b.status in ('VALIDATED','READY_FOR_ASSIGNMENT') and not exists(select 1 from ${owners} o where o.bug_id=b.id)))`;
  const [status, priority, severity, workload, unowned, urgent] = await neonBatch([
    { query: `select b.status as k, count(*)::int as n from ${base} group by 1`, params },
    { query: `select b.priority as k, count(*)::int as n from ${base} group by 1`, params },
    { query: `select b.severity as k, count(*)::int as n from ${base} group by 1`, params },
    {
      query: `select u.id, u.name, count(distinct b.id)::int as n from bugflow.bugs b join ${owners} o on o.bug_id=b.id join bugflow.users u on u.id=o.user_id where b.deleted_at is null and ${win} and ${open} group by u.id, u.name order by n desc, u.name`,
      params,
    },
    {
      query: `select count(*)::int as n from ${base} and ${open} and not exists(select 1 from ${owners} o where o.bug_id=b.id)`,
      params,
    },
    {
      query: `select b.id, b.title, b.status, b.priority, to_json(b.created_at) as created_at,
        coalesce((select string_agg(u.name, ', ' order by u.name) from ${owners} o join bugflow.users u on u.id=o.user_id where o.bug_id=b.id), '') as owners
      from ${base} and ${attention}
      order by array_position(array['P0','P1','P2','P3','P4','P5'], b.priority), b.created_at limit 500`,
      params,
    },
  ]);
  const map = (r: { rows: Record<string, unknown>[] }) =>
    Object.fromEntries(r.rows.map((x) => [String(x["k"]), Number(x["n"])]));
  return {
    byStatus: map(status),
    byPriority: map(priority),
    bySeverity: map(severity),
    workload: workload.rows.map((r) => ({
      id: String(r["id"]),
      name: String(r["name"]),
      n: Number(r["n"]),
    })),
    unowned: Number(unowned.rows[0]?.["n"] ?? 0),
    attention: urgent.rows.map((r) => ({
      id: String(r["id"]),
      code: formatBugCode(String(r["id"])),
      title: String(r["title"]),
      status: String(r["status"]),
      priority: String(r["priority"]),
      createdAt: String(r["created_at"]),
      owners: String(r["owners"]),
    })),
  };
}
