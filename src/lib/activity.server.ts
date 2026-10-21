import { neonQuery } from './neon.server';
import { requireAdmin } from './portal-access.server';
import { formatBugCode } from './bug-workflow';
import type { ActivityFilters, ActivityInsights, ActivityRow, TeamPerformance } from './activity';
import { periodWindow, type Period } from './period';

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
const roleOf = (userCol: string) => `coalesce((select px.type from bugflow.portals px where px.user_id=${userCol} order by px.created_at desc limit 1), '')`;
const VIA_SQL = roleOf('a.actor_id');

/** Chart series bucket for an action (fixed order: reported, status, assign, other). */
const SERIES_SQL = `case when a.action in ('bug.created','bug.sample_created') then 'reported' when a.action in ('bug.status','bug.verify') then 'status' when a.action='bug.assign' then 'assign' else 'other' end`;

/** Shared WHERE clause so the stream and the charts always agree. */
function filterSql(f: ActivityFilters, params: unknown[], opts: { skipType?: boolean; skipActor?: boolean } = {}) {
  const conds: string[] = [];
  const acts = CATEGORY[f.type];
  if (acts && !opts.skipType) { params.push(acts); conds.push(`a.action=any($${params.length}::text[])`); }
  const inPeriod = periodWindow(f, params)('a.created_at'); if (inPeriod !== 'true') conds.push(inPeriod);
  if (f.actor && !opts.skipActor) { params.push(f.actor); conds.push(`a.actor_id=$${params.length}::uuid`); }
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
  const base = (opts?: { skipType?: boolean; skipActor?: boolean }) => {
    const params: unknown[] = []; const conds = filterSql(f, params, opts);
    return { params, where: conds.length ? `where ${conds.join(' and ')}` : '' };
  };
  const from = `from bugflow.activity a join bugflow.users u on u.id=a.actor_id left join bugflow.bugs b on b.id=a.bug_id`;

  // The four aggregates are independent, so run them in parallel.
  const t = base(), sr = base(), c = base({ skipType: true }), p = base({ skipActor: true });
  const [totals, series, categories, people] = await Promise.all([
    neonQuery(`select count(*)::int as events, count(distinct a.bug_id)::int as bugs, count(distinct a.actor_id)::int as people,
      count(*) filter (where a.detail->>'status'='REOPENED' and coalesce(a.detail->>'previousStatus','')<>'REOPENED')::int as reopened,
      count(*) filter (where a.detail->>'status'='RESOLVED' and coalesce(a.detail->>'previousStatus','')<>'RESOLVED')::int as resolved
      ${from} ${t.where}`, t.params),
    // Share of activity by chart series over the whole filtered period.
    neonQuery(`select ${SERIES_SQL} as series, count(*)::int as n ${from} ${sr.where} group by 1`, sr.params),
    // Category mix ignores the type filter so it still shows the whole picture to pick from.
    neonQuery(`select a.action, count(*)::int as n ${from} ${c.where} group by a.action`, c.params),
    // Everyone, so the list can highlight the selected person: ignores the person filter; current members with no changes show 0.
    neonQuery(`with counted as (select u.id, count(*)::int as n ${from} ${p.where} group by u.id)
      select u.id, u.name, ${roleOf('u.id')} as role, coalesce(c.n, 0)::int as n from bugflow.users u left join counted c on c.id=u.id
      where c.id is not null or (u.active and u.deleted_at is null and exists(select 1 from bugflow.portals px where px.user_id=u.id))
      order by n desc, u.name limit 200`, p.params),
  ]);
  const byKey = new Map<string, number>();
  for (const r of categories.rows) {
    const key = Object.entries(CATEGORY).find(([, acts]) => acts.includes(String(r['action'])))?.[0] ?? 'team';
    byKey.set(key, (byKey.get(key) ?? 0) + Number(r['n']));
  }

  const tr = totals.rows[0] ?? {};
  return {
    totals: { events: Number(tr['events'] ?? 0), bugs: Number(tr['bugs'] ?? 0), people: Number(tr['people'] ?? 0), reopened: Number(tr['reopened'] ?? 0), resolved: Number(tr['resolved'] ?? 0) },
    series: { reported: 0, status: 0, assign: 0, other: 0, ...Object.fromEntries(series.rows.map(r => [String(r['series']), Number(r['n'])])) },
    categories: [...byKey].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    people: people.rows.map(r => ({ id: String(r['id']), name: String(r['name']), role: String(r['role']), count: Number(r['n']) })),
  };
}

/** People who appear in the activity log, for the person filter. */
export async function activityPeople(): Promise<{ id: string; name: string; role: string }[]> {
  await requireAdmin();
  const { rows } = await neonQuery(`select u.id, u.name, ${roleOf('u.id')} as role from bugflow.users u where exists(select 1 from bugflow.activity a where a.actor_id=u.id) order by u.name limit 200`);
  return rows.map(r => ({ id: String(r['id']), name: String(r['name']), role: String(r['role']) }));
}

/**
 * Team performance for a period (0 = all time).
 * Raised = bugs reported in the period. Fix submitted = moves to RECHECK by that person.
 * Fixed = bugs they own that are currently RESOLVED, resolved in the period.
 * Fix time = first assignment (or report, if never assigned) → resolution.
 */
export async function teamPerformance(period: Period & { tz?: string }): Promise<TeamPerformance> {
  await requireAdmin();
  const params: unknown[] = []; const win = periodWindow(period, params);
  const cte = `with b as (select * from bugflow.bugs where deleted_at is null),
    resolved as (select h.bug_id, max(h.created_at) as at from bugflow.status_history h join b on b.id=h.bug_id where h.new_status='RESOLVED' and b.status='RESOLVED' group by h.bug_id),
    first_assigned as (select bug_id, min(created_at) as at from bugflow.assignments group by bug_id),
    owners as (select bug_id, user_id from bugflow.bug_assignees union select id, assignee_id from b where assignee_id is not null),
    fixes as (select r.bug_id, r.at, extract(epoch from r.at-coalesce(fa.at,b.created_at))/86400.0 as fix_days, extract(epoch from r.at-b.created_at)/86400.0 as resolve_days
      from resolved r join b on b.id=r.bug_id left join first_assigned fa on fa.bug_id=r.bug_id where ${win('r.at')})`;
  const [people, totals] = await Promise.all([neonQuery(`${cte},
    reopened as (select distinct h.bug_id from bugflow.status_history h where h.new_status='REOPENED' and ${win('h.created_at')})
    select u.id, u.name, (u.active and u.deleted_at is null) as current,
      ${roleOf('u.id')} as role,
      (select count(*) from b where b.reporter_id=u.id and ${win('b.created_at')})::int as raised,
      (select count(*) from owners o join b on b.id=o.bug_id where o.user_id=u.id and b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX'))::int as open_now,
      (select count(*) from bugflow.status_history h where h.actor_id=u.id and h.new_status='RECHECK' and ${win('h.created_at')})::int as submitted,
      (select count(distinct f.bug_id) from fixes f join owners o on o.bug_id=f.bug_id where o.user_id=u.id)::int as fixed,
      (select avg(f.fix_days) from fixes f join owners o on o.bug_id=f.bug_id where o.user_id=u.id) as avg_fix_days,
      (select count(distinct r.bug_id) from reopened r join owners o on o.bug_id=r.bug_id where o.user_id=u.id)::int as reopened,
      (select count(*) from bugflow.verifications v where v.actor_id=u.id and v.passed and ${win('v.created_at')})::int as qa_passed,
      (select count(*) from bugflow.verifications v where v.actor_id=u.id and not v.passed and ${win('v.created_at')})::int as qa_failed
    from bugflow.users u`, params), // inactive/removed members keep their history; rows with no work are dropped below
  neonQuery(`${cte}
    select (select count(*) from b where ${win('b.created_at')})::int as raised,
      (select count(*) from fixes)::int as fixed,
      (select avg(fix_days) from fixes) as avg_fix_days,
      (select avg(resolve_days) from fixes) as avg_resolve_days,
      (select avg(extract(epoch from fa.at-b.created_at)/86400.0) from first_assigned fa join b on b.id=fa.bug_id where ${win('fa.at')}) as avg_assign_days,
      (select count(*) from b where b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX'))::int as open_now`, params)]);
  const num = (v: unknown) => (v == null ? null : Number(v));
  const t = totals.rows[0] ?? {};
  return {
    totals: { raised: Number(t['raised'] ?? 0), fixed: Number(t['fixed'] ?? 0), openNow: Number(t['open_now'] ?? 0), avgFixDays: num(t['avg_fix_days']), avgResolveDays: num(t['avg_resolve_days']), avgAssignDays: num(t['avg_assign_days']) },
    people: people.rows
      .map(r => ({ id: String(r['id']), name: String(r['name']), role: String(r['role']), current: r['current'] === true, raised: Number(r['raised']), openNow: Number(r['open_now']), submitted: Number(r['submitted']), fixed: Number(r['fixed']), avgFixDays: num(r['avg_fix_days']), reopened: Number(r['reopened']), qaPassed: Number(r['qa_passed']), qaFailed: Number(r['qa_failed']) }))
      .filter(p => p.raised + p.openNow + p.submitted + p.fixed + p.reopened + p.qaPassed + p.qaFailed > 0)
      .sort((a, b) => b.fixed - a.fixed || b.raised - a.raised || a.name.localeCompare(b.name)),
  };
}
