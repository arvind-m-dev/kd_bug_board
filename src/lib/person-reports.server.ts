import { neonBatch, neonQuery } from './neon.server';
import { requireAdmin } from './portal-access.server';
import { formatBugCode } from './bug-workflow';
import type { Counts, PersonDetail, PersonMetrics } from './person-reports';
import { periodWindow, type Period } from './period';

/** Server-only per-person metrics. Admin-only, read-only over bugs, history and verifications. */

const CLOSED = `('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')`;
const REJECTED = `('NOT_A_BUG','DUPLICATE','WONT_FIX')`;
const REVALIDATE_FROM = `('NOT_A_BUG','DUPLICATE','WONT_FIX','REOPENED','RESOLVED')`;

function counts(v: unknown): Counts {
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, n]) => [k, Number(n)]));
}

export async function personMetrics(period: Period & { tz?: string }, person?: string): Promise<PersonMetrics[]> {
  await requireAdmin();
  const params: unknown[] = [];
  const win = periodWindow(period, params);
  let who = '';
  if (person) { params.push(person); who = `where u.id=$${params.length}::uuid`; }
  const agg = (col: string, where: string) => `(select coalesce(jsonb_object_agg(k,n),'{}'::jsonb) from (select ${col} as k,count(*)::int as n from b where ${where} group by ${col}) x)`;
  const { rows } = await neonQuery(`with b as (select * from bugflow.bugs where deleted_at is null),
    own as (select bug_id, user_id from bugflow.bug_assignees union select id, assignee_id from b where assignee_id is not null),
    h as (select * from bugflow.status_history where ${win('created_at')}),
    resolved as (select sh.bug_id, max(sh.created_at) as at from bugflow.status_history sh join b on b.id=sh.bug_id where sh.new_status='RESOLVED' and b.status='RESOLVED' group by sh.bug_id),
    first_assigned as (select bug_id, min(created_at) as at from bugflow.assignments group by bug_id),
    fixes as (select r.bug_id, extract(epoch from r.at-coalesce(fa.at,b.created_at))/86400.0 as fix_days from resolved r join b on b.id=r.bug_id left join first_assigned fa on fa.bug_id=r.bug_id where ${win('r.at')})
    select u.id, u.name, (u.active and u.deleted_at is null) as current,
      coalesce((select px.type from bugflow.portals px where px.user_id=u.id order by px.created_at desc limit 1),'') as role,
      (select count(*) from b where b.reporter_id=u.id and ${win('b.created_at')})::int as raised,
      ${agg('b.priority', `b.reporter_id=u.id and ${win('b.created_at')}`)} as raised_priority,
      ${agg('b.severity', `b.reporter_id=u.id and ${win('b.created_at')}`)} as raised_severity,
      ${agg('b.status', `b.reporter_id=u.id and ${win('b.created_at')}`)} as raised_status,
      (select count(distinct h.bug_id) from h join b on b.id=h.bug_id where b.reporter_id=u.id and h.new_status='REOPENED')::int as raised_reopened,
      (select count(distinct h.bug_id) from h join b on b.id=h.bug_id where b.reporter_id=u.id and h.new_status='VALIDATING' and h.previous_status in ${REVALIDATE_FROM})::int as raised_revalidated,
      (select count(distinct o.bug_id) from own o where o.user_id=u.id)::int as owned,
      (select count(distinct o.bug_id) from own o join b on b.id=o.bug_id where o.user_id=u.id and b.status not in ${CLOSED})::int as owned_open,
      (select coalesce(jsonb_object_agg(k,n),'{}'::jsonb) from (select b.priority as k,count(distinct b.id)::int as n from own o join b on b.id=o.bug_id where o.user_id=u.id group by b.priority) x) as owned_priority,
      (select count(*) from h where h.actor_id=u.id and h.new_status='RECHECK')::int as sent_to_qa,
      (select count(distinct f.bug_id) from fixes f join own o on o.bug_id=f.bug_id where o.user_id=u.id)::int as fixed,
      (select avg(f.fix_days) from fixes f join own o on o.bug_id=f.bug_id where o.user_id=u.id) as avg_fix_days,
      (select count(distinct h.bug_id) from h join own o on o.bug_id=h.bug_id where o.user_id=u.id and h.new_status='REOPENED')::int as owned_reopened,
      (select count(*) from h where h.actor_id=u.id and h.new_status='VALIDATED')::int as validated,
      (select count(*) from h where h.actor_id=u.id and h.new_status in ${REJECTED})::int as rejected,
      (select count(*) from h where h.actor_id=u.id and h.new_status='VALIDATING' and h.previous_status in ${REVALIDATE_FROM})::int as revalidated,
      (select count(*) from h where h.actor_id=u.id and h.new_status='NEEDS_INFORMATION')::int as needs_info,
      (select count(*) from bugflow.verifications v where v.actor_id=u.id and v.passed and ${win('v.created_at')})::int as qa_passed,
      (select count(*) from bugflow.verifications v where v.actor_id=u.id and not v.passed and ${win('v.created_at')})::int as qa_failed,
      (select count(*) from bugflow.activity a where a.actor_id=u.id and ${win('a.created_at')})::int as changes
    from bugflow.users u ${who}`, params);
  return rows.map(r => ({
    id: String(r['id']), name: String(r['name']), role: String(r['role']), current: r['current'] === true,
    raised: Number(r['raised']), raisedByPriority: counts(r['raised_priority']), raisedBySeverity: counts(r['raised_severity']), raisedByStatus: counts(r['raised_status']),
    raisedReopened: Number(r['raised_reopened']), raisedRevalidated: Number(r['raised_revalidated']),
    owned: Number(r['owned']), ownedOpen: Number(r['owned_open']), ownedByPriority: counts(r['owned_priority']), sentToQa: Number(r['sent_to_qa']),
    fixed: Number(r['fixed']), avgFixDays: r['avg_fix_days'] == null ? null : Number(r['avg_fix_days']), ownedReopened: Number(r['owned_reopened']),
    validated: Number(r['validated']), rejected: Number(r['rejected']), revalidated: Number(r['revalidated']), needsInfo: Number(r['needs_info']),
    qaPassed: Number(r['qa_passed']), qaFailed: Number(r['qa_failed']), changes: Number(r['changes']),
  }));
}

/** All current members, plus former members with recorded work; current first, then busiest, then by name. */
export async function personOverview(period: Period & { tz?: string }) {
  const all = await personMetrics(period);
  const work = (m: PersonMetrics) => m.raised + m.owned + m.sentToQa + m.validated + m.rejected + m.revalidated + m.needsInfo + m.qaPassed + m.qaFailed;
  return all.filter(m => (m.current && m.role) || work(m) > 0)
    .sort((a, b) => Number(b.current) - Number(a.current) || work(b) - work(a) || a.name.localeCompare(b.name));
}

export async function personDetail(period: Period & { tz?: string }, person: string): Promise<PersonDetail> {
  await requireAdmin();
  // Metrics, weekly trend and recent bugs are independent: fetch them in parallel.
  const [[metrics], [trend, recent]] = await Promise.all([personMetrics(period, person), neonBatch([
  // Weekly raised vs fixed for the last 12 weeks (Monday-start weeks).
  { query: `with weeks as (select generate_series(date_trunc('week', now())-interval '11 weeks', date_trunc('week', now()), '1 week') as wk),
    b as (select * from bugflow.bugs where deleted_at is null),
    own as (select bug_id from bugflow.bug_assignees where user_id=$1::uuid union select id from b where assignee_id=$1::uuid),
    res as (select sh.bug_id, max(sh.created_at) as at from bugflow.status_history sh join b on b.id=sh.bug_id where sh.new_status='RESOLVED' and b.status='RESOLVED' group by sh.bug_id)
    select to_char(w.wk,'YYYY-MM-DD') as week,
      (select count(*) from b where b.reporter_id=$1::uuid and date_trunc('week', b.created_at)=w.wk)::int as raised,
      (select count(*) from res join own on own.bug_id=res.bug_id where date_trunc('week', res.at)=w.wk)::int as fixed
    from weeks w order by w.wk`, params: [person] },
  { query: `select b.id, b.title, b.status, b.priority, b.severity, to_json(b.updated_at) as updated_at,
      (b.reporter_id=$1::uuid) as raised,
      (b.assignee_id=$1::uuid or exists(select 1 from bugflow.bug_assignees x where x.bug_id=b.id and x.user_id=$1::uuid)) as assigned
    from bugflow.bugs b where b.deleted_at is null and (b.reporter_id=$1::uuid or b.assignee_id=$1::uuid or exists(select 1 from bugflow.bug_assignees x where x.bug_id=b.id and x.user_id=$1::uuid))
    order by b.updated_at desc limit 12`, params: [person] }])]);
  if (!metrics) throw new Error('This person could not be found.');
  return {
    metrics,
    trend: trend.rows.map(r => ({ week: String(r['week']), raised: Number(r['raised']), fixed: Number(r['fixed']) })),
    recent: recent.rows.map(r => ({
      id: String(r['id']), code: formatBugCode(String(r['id'])), title: String(r['title']), status: String(r['status']), priority: String(r['priority']), severity: String(r['severity']),
      relation: r['raised'] === true && r['assigned'] === true ? 'both' : r['raised'] === true ? 'raised' : 'assigned', updatedAt: String(r['updated_at']),
    })),
  };
}

/** Whole-team trend (raised vs fixed per week) and the latest bugs; the team totals come from personOverview. */
export async function teamDetail(): Promise<{ trend: PersonDetail['trend']; recent: PersonDetail['recent'] }> {
  await requireAdmin();
  const [trend, recent] = await neonBatch([
    { query: `with weeks as (select generate_series(date_trunc('week', now())-interval '11 weeks', date_trunc('week', now()), '1 week') as wk),
      b as (select * from bugflow.bugs where deleted_at is null),
      res as (select sh.bug_id, max(sh.created_at) as at from bugflow.status_history sh join b on b.id=sh.bug_id where sh.new_status='RESOLVED' and b.status='RESOLVED' group by sh.bug_id)
      select to_char(w.wk,'YYYY-MM-DD') as week,
        (select count(*) from b where date_trunc('week', b.created_at)=w.wk)::int as raised,
        (select count(*) from res where date_trunc('week', res.at)=w.wk)::int as fixed
      from weeks w order by w.wk` },
    { query: `select b.id, b.title, b.status, b.priority, b.severity, to_json(b.updated_at) as updated_at from bugflow.bugs b where b.deleted_at is null order by b.updated_at desc limit 15` },
  ]);
  return {
    trend: trend.rows.map(r => ({ week: String(r['week']), raised: Number(r['raised']), fixed: Number(r['fixed']) })),
    recent: recent.rows.map(r => ({ id: String(r['id']), code: formatBugCode(String(r['id'])), title: String(r['title']), status: String(r['status']), priority: String(r['priority']), severity: String(r['severity']), relation: 'team' as const, updatedAt: String(r['updated_at']) })),
  };
}
