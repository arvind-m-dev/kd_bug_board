import { neonQuery } from './neon.server';
import { requireAdmin } from './portal-access.server';
import { formatBugCode } from './bug-workflow';
import type { ActivityRow } from './activity';

/** Server-only activity stream. Admin-only read over the shared audit trail. */

const CATEGORY: Record<string, string[]> = {
  created: ['bug.created', 'bug.sample_created'],
  status: ['bug.status'],
  priority: ['bug.priority'],
  assign: ['bug.assign'],
  verify: ['bug.verify'],
  comment: ['bug.comment'],
  edited: ['bug.edited'],
  deleted: ['bug.deleted'],
  team: ['member.updated', 'member.deactivate', 'member.activate', 'member.delete', 'portal.created', 'portal.regenerated', 'portal.revoked', 'project.created', 'settings.dropdowns'],
};

export async function activityStream(cursor: string | undefined, type = 'all', days = 0, query = ''): Promise<{ rows: ActivityRow[]; nextCursor: string }> {
  await requireAdmin();
  const conds: string[] = []; const params: unknown[] = [];
  const acts = CATEGORY[type];
  if (acts) { params.push(acts); conds.push(`a.action=any($${params.length}::text[])`); }
  if (days > 0) { params.push(days); conds.push(`a.created_at>=now()-($${params.length}::int||' days')::interval`); }
  const q = query.trim();
  if (q) {
    const m = /^BF-?(\d+)$/i.exec(q);
    if (m) { params.push(Number(m[1])); conds.push(`a.bug_id=$${params.length}::int`); }
    else { params.push(`%${q}%`); conds.push(`(u.name ilike $${params.length} or b.title ilike $${params.length})`); }
  }
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
      coalesce((select px.type from bugflow.portals px where px.user_id=a.actor_id order by px.created_at desc limit 1), '') as via,
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
