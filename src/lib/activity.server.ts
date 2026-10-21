import { neonQuery } from './neon.server';
import { requireAdmin } from './portal-access.server';
import { formatBugCode } from './bug-workflow';
import type { ActivityFilters, ActivityInsights, ActivityRow } from './activity';

/** Server-only activity stream. Admin-only read over the shared audit trail. */

const CATEGORY: Record<string, string[]> = {
  created: ['bug.created', 'bug.sample_created'],
  status: ['bug.status'],
  priority: ['bug.priority', 'bug.severity'],
  assign: ['bug.assign'],
  verify: ['bug.verify'],
  comment: ['bug.comment'],
  edited: ['bug.edited'],
  deleted: ['bug.deleted'],
  team: ['member.updated', 'member.deactivate', 'member.activate', 'member.delete', 'portal.created', 'portal.regenerated', 'portal.revoked', 'project.created', 'settings.dropdowns'],
};

/** Source portal of an actor: their most recent portal type. */
const VIA_SQL = `coalesce((select px.type from bugflow.portals px where px.user_id=a.actor_id order by px.created_at desc limit 1), '')`;

/** Chart series bucket for an action (fixed order: reported, status, assign, other). */
const SERIES_SQL = `case when a.action in ('bug.created','bug.sample_created') then 'reported' when a.action in ('bug.status','bug.verify') then 'status' when a.action='bug.assign' then 'assign' else 'other' end`;

/** Shared WHERE clause so the stream and the charts always agree. */
function filterSql(f: ActivityFilters, params: unknown[], opts: { skipType?: boolean } = {}) {
  const conds: string[] = [];
  const acts = CATEGORY[f.type];
  if (acts && !opts.skipType) { params.push(acts); conds.push(`a.action=any($${params.length}::text[])`); }
  if (f.days > 0) { params.push(f.days); conds.push(`a.created_at>=now()-($${params.length}::int||' days')::interval`); }
  if (f.actor) { params.push(f.actor); conds.push(`a.actor_id=$${params.length}::uuid`); }
  if (f.via) { params.push(f.via); conds.push(`${VIA_SQL}=$${params.length}`); }
  const q = f.query.trim();
  if (q) {
    const m = /^BF-?(\d+)$/i.exec(q);
    if (m) { params.push(Number(m[1])); conds.push(`a.bug_id=$${params.length}::int`); }
    else { params.push(`%${q}%`); conds.push(`(u.name ilike $${params.length} or b.title ilike $${params.length})`); }
  }
  return conds;
}

export async function activityStream(cursor: string | undefined, f: ActivityFilters): Promise<{ rows: ActivityRow[]; nextCursor: string }> {
  await requireAdmin();
  const params: unknown[] = []; const conds = filterSql(f, params);
  if (cursor) {
    const sep = cursor.lastIndexOf('|');
    if (sep > 0) {
      const at = decodeURIComponent(cursor.slice(0, sep)); const id = cursor.slice(sep + 1);
      params.push(at, id); conds.push(`(a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
  }
  const where = conds.length ? `where ${conds.join(' and ')}` : '';
  const { rows } = await neonQuery(
    `select a.id, a.action, to_json(a.created_at) as at, a.detail, a.bug_id, u.name as actor,
      ${VIA_SQL} as via,
      b.title as btitle,
      coalesce((select u3.name from bugflow.users u3 where u3.id::text=a.detail->>'assignee'), '') as assignee_name
     from bugflow.activity a
     join bugflow.users u on u.id=a.actor_id
     left join bugflow.bugs b on b.id=a.bug_id
     ${where} order by a.created_at desc, a.id desc limit 51`,
    params,
  );
  const parsed: ActivityRow[] = rows.map(r => {
    const bugId = r['bug_id'] == null ? null : String(r['bug_id']);
    const detail = Object.fromEntries(Object.entries((r['detail'] ?? {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    if (detail['assignee'] && /^[0-9a-f-]{36}$/i.test(detail['assignee'])) detail['assignee'] = String(r['assignee_name'] ?? detail['assignee']);
    return {
      id: String(r['id']), action: String(r['action']), at: String(r['at']),
      bugId, bugCode: bugId ? formatBugCode(bugId) : '', bugTitle: String(r['btitle'] ?? ''),
      actor: String(r['actor'] ?? ''), via: String(r['via'] ?? ''), detail,
    };
  });
  const last = parsed[50];
  const nextCursor = last ? `${encodeURIComponent(last.at)}|${last.id}` : '';
  return { rows: parsed, nextCursor };
}

/** Aggregates for the activity infographics, using the same filters as the stream. */
export async function activityInsights(f: ActivityFilters): Promise<ActivityInsights> {
  await requireAdmin();
  const windowDays = f.days > 0 ? f.days : 30;
  const base = (opts?: { skipType?: boolean }) => {
    const params: unknown[] = []; const conds = filterSql(f, params, opts);
    return { params, where: conds.length ? `where ${conds.join(' and ')}` : '' };
  };
  const from = `from bugflow.activity a join bugflow.users u on u.id=a.actor_id left join bugflow.bugs b on b.id=a.bug_id`;

  const t = base();
  const totals = await neonQuery(`select count(*)::int as events, count(distinct a.bug_id)::int as bugs, count(distinct a.actor_id)::int as people,
      count(*) filter (where a.detail->>'status'='REOPENED' and coalesce(a.detail->>'previousStatus','')<>'REOPENED')::int as reopened,
      count(*) filter (where a.detail->>'status'='RESOLVED' and coalesce(a.detail->>'previousStatus','')<>'RESOLVED')::int as resolved
    ${from} ${t.where}`, t.params);

  // Daily series is always windowed (all time → last 30 days) and zero-filled in the viewer's time zone.
  const d = base(); d.params.push(f.tz); const tz = `$${d.params.length}`; d.params.push(windowDays); const win = `$${d.params.length}`;
  const dailyWhere = `${d.where ? `${d.where} and` : 'where'} a.created_at>=now()-(${win}::int||' days')::interval`;
  const daily = await neonQuery(`with days as (select generate_series((now() at time zone ${tz})::date-(${win}::int-1), (now() at time zone ${tz})::date, '1 day')::date as day),
    ev as (select (a.created_at at time zone ${tz})::date as day, ${SERIES_SQL} as series ${from} ${dailyWhere})
    select to_char(days.day,'YYYY-MM-DD') as day,
      count(ev.series) filter (where ev.series='reported')::int as reported, count(ev.series) filter (where ev.series='status')::int as status,
      count(ev.series) filter (where ev.series='assign')::int as assign, count(ev.series) filter (where ev.series='other')::int as other
    from days left join ev on ev.day=days.day group by days.day order by days.day`, d.params);

  // Category mix ignores the type filter so it still shows the whole picture to pick from.
  const c = base({ skipType: true });
  const categories = await neonQuery(`select a.action, count(*)::int as n ${from} ${c.where} group by a.action`, c.params);
  const byKey = new Map<string, number>();
  for (const r of categories.rows) {
    const key = Object.entries(CATEGORY).find(([, acts]) => acts.includes(String(r['action'])))?.[0] ?? 'team';
    byKey.set(key, (byKey.get(key) ?? 0) + Number(r['n']));
  }

  const p = base();
  const people = await neonQuery(`select u.id, u.name, count(*)::int as n ${from} ${p.where} group by u.id, u.name order by n desc, u.name limit 6`, p.params);

  const tr = totals.rows[0] ?? {};
  return {
    totals: { events: Number(tr['events'] ?? 0), bugs: Number(tr['bugs'] ?? 0), people: Number(tr['people'] ?? 0), reopened: Number(tr['reopened'] ?? 0), resolved: Number(tr['resolved'] ?? 0) },
    daily: daily.rows.map(r => ({ day: String(r['day']), reported: Number(r['reported']), status: Number(r['status']), assign: Number(r['assign']), other: Number(r['other']) })),
    categories: [...byKey].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    people: people.rows.map(r => ({ id: String(r['id']), name: String(r['name']), count: Number(r['n']) })),
    windowDays,
  };
}

/** People who appear in the activity log, for the person filter. */
export async function activityPeople(): Promise<{ id: string; name: string }[]> {
  await requireAdmin();
  const { rows } = await neonQuery(`select distinct u.id, u.name from bugflow.activity a join bugflow.users u on u.id=a.actor_id order by u.name limit 200`);
  return rows.map(r => ({ id: String(r['id']), name: String(r['name']) }));
}
