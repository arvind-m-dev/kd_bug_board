import { getCookie, setCookie, deleteCookie, getRequest, setResponseHeader } from '@tanstack/react-start/server';
import { neonQuery, neonExecute, neonUserError } from './neon.server';
import { hashToken, randomToken, equalSecret, portalTypesByRole, type saveMemberSchema, type unlockSchema, type portalReadSchema } from './portal-access';
import { encryptPortal } from './portal-crypto.server';
import type { z } from 'zod';

export async function databaseCall<T>(work: () => Promise<T>): Promise<T> {
  setResponseHeader('Cache-Control', 'no-store');
  try { return await work(); } catch (error) {
    if (error && typeof error === 'object' && 'kind' in error) { console.error(error); throw new Error(neonUserError(error).message); }
    throw error;
  }
}
export function checkOrigin() {
  const request = getRequest(); const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new Error('This request must come from your Futurist Global Bug Board workspace.');
}
// Verified Admin sessions are remembered briefly per server instance so each request skips a database round trip.
// Sign-out clears the entry; other revocations take effect within ADMIN_CACHE_MS.
const ADMIN_CACHE_MS = 60_000;
const adminCache = new Map<string, { admin: { id: string; userId: string; name: string }; until: number }>();
export async function requireAdmin() {
  const token = getCookie('bugflow_admin');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Unlock private Admin access in Settings first.');
  const key = await hashToken(token); const hit = adminCache.get(key);
  if (hit && hit.until > Date.now()) return hit.admin;
  adminCache.delete(key);
  const { rows } = await neonQuery("select p.id, p.user_id, u.name from bugflow.admin_sessions s join bugflow.portals p on p.id=s.portal_id join bugflow.users u on u.id=p.user_id where s.token_hash=$1 and s.expires_at>now() and p.type='admin' and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) limit 1", [key]);
  const admin = rows[0]; if (!admin) throw new Error('Admin access has expired or was revoked. Unlock access in Settings.');
  const result = { id: String(admin['id']), userId: String(admin['user_id']), name: String(admin['name']) };
  if (adminCache.size > 500) adminCache.clear();
  adminCache.set(key, { admin: result, until: Date.now() + ADMIN_CACHE_MS });
  return result;
}
export async function adminStatus() {
  try { return { unlocked: true, name: (await requireAdmin()).name }; }
  catch (error) { if (error && typeof error === 'object' && 'kind' in error) throw error; return { unlocked: false, name: '' }; }
}
export async function unlockAdmin(data: z.infer<typeof unlockSchema>) {
  checkOrigin(); const password = process.env['BUGFLOW_ADMIN_PASSWORD']; const email = process.env['BUGFLOW_ADMIN_EMAIL'];
  if (!password || !email) throw new Error('Admin sign-in is not configured.');
  const passwordValid = await equalSecret(data.password, password);
  const emailValid = await equalSecret(data.email.toLowerCase(), email.toLowerCase());
  if (!passwordValid || !emailValid) throw new Error('Incorrect email or password.');
  const userId = crypto.randomUUID(); const portalId = crypto.randomUUID(); const session = randomToken();
  const result = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    { query: 'select pg_advisory_xact_lock(7438592)' },
    { query: "update bugflow.users u set email=$1 where u.id in (select user_id from bugflow.portals where type='admin') and lower(u.email)<>$1 and not exists (select 1 from bugflow.users other where lower(other.email)=$1 and other.id<>u.id)", params: [email.toLowerCase()] },
    { query: "insert into bugflow.users (id,name,email) select $1,$2,$3 where not exists (select 1 from bugflow.portals where type='admin') on conflict (email) do nothing", params: [userId, 'Admin', email.toLowerCase()] },
    { query: "insert into bugflow.portals (id,user_id,type,token_hash) select $1,u.id,'admin',$2 from bugflow.users u where u.email=$3 and not exists (select 1 from bugflow.portals where type='admin')", params: [portalId, await hashToken(randomToken()), data.email.toLowerCase()] },
    { query: "insert into bugflow.admin_sessions (token_hash,portal_id,expires_at) select $1,p.id,now()+interval '8 hours' from bugflow.portals p join bugflow.users u on u.id=p.user_id where p.type='admin' and p.active and p.revoked_at is null and u.active and u.email=$2 and (p.expires_at is null or p.expires_at>now()) returning portal_id", params: [await hashToken(session), data.email.toLowerCase()] },
  ]);
  if (!result.results[4]?.rows.length) throw new Error('Admin account is unavailable or inactive.');
  setCookie('bugflow_admin', session, { httpOnly: true, secure: true, sameSite: 'none', partitioned: true, path: '/', maxAge: 8 * 3600 });
  return { unlocked: true };
}
export async function lockAdmin() {
  checkOrigin(); const token = getCookie('bugflow_admin');
  if (token) { const key = await hashToken(token); adminCache.delete(key); await neonExecute('delete from bugflow.admin_sessions where token_hash=$1', [key]); }
  deleteCookie('bugflow_admin', { httpOnly: true, secure: true, sameSite: 'none', partitioned: true, path: '/' }); return { locked: true };
}
export async function listMembers() {
  await requireAdmin();
  const { rows } = await neonQuery("select p.id,p.user_id,u.name,u.email,p.type,p.active,u.active as user_active,p.token_ciphertext is not null as copyable,(u.active and p.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now())) as usable,o.collaborator_role,o.scope_note,coalesce(p.online_until>now(), p.last_seen_at>now()-interval '2 minutes') as online,to_json(greatest(p.last_seen_at, case when p.online_until is not null then least(p.online_until, now()) end)) as last_seen from bugflow.portals p join bugflow.users u on u.id=p.user_id join bugflow.portal_onboarding o on o.portal_id=p.id where u.deleted_at is null order by p.created_at desc,p.id desc limit 100");
  return rows.map(r => ({ id: String(r['id']), userId: String(r['user_id']), name: String(r['name']), email: String(r['email']), type: String(r['type']), active: r['usable'] === true, userActive:r['user_active']===true, copyable:r['copyable']===true, role: String(r['collaborator_role']), scope: String(r['scope_note']), online: r['online'] === true, lastSeen: r['last_seen'] ? String(r['last_seen']) : null }));
}
export async function listProjects() {
  await requireAdmin(); const { rows } = await neonQuery('select id,name from bugflow.projects where not archived order by name,id limit 100');
  return rows.map(r => ({ id: String(r['id']), name: String(r['name']) }));
}
export async function createProject(name: string) {
  checkOrigin(); const admin = await requireAdmin(); const id = crypto.randomUUID();
  await neonExecute([{ query: 'insert into bugflow.projects(id,name) values($1,$2)', params: [id,name] }, { query: 'insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,$3,$4)', params: [crypto.randomUUID(),admin.userId,'project.created',{projectId:id}] }]);
  return { id, name };
}
export async function saveMember(data: z.infer<typeof saveMemberSchema>) {
  checkOrigin(); const admin = await requireAdmin();
  const projects = await listProjects(); const ids = [...new Set(data.projectIds)];
  if (ids.some(id => !projects.some(p => p.id === id))) throw new Error('Choose active projects from this workspace.');
  const token = randomToken(); const id = crypto.randomUUID(); const userId = crypto.randomUUID(); const value = data.collaborator; const type = portalTypesByRole[value.role];
  await neonExecute([
    { query: 'insert into bugflow.users(id,name,email) values($1,$2,$3) on conflict(email) do nothing', params: [userId,value.name,value.email.toLowerCase()] },
    { query: "insert into bugflow.portals(id,user_id,type,token_hash,token_ciphertext,expires_at) select $1,id,$2,$3,$5,now()+interval '90 days' from bugflow.users where email=$4 and active", params: [id,type,await hashToken(token),value.email.toLowerCase(),await encryptPortal(token)] },
    { query: 'insert into bugflow.portal_onboarding(portal_id,collaborator_role,permissions,scope_note,context,welcome) values($1,$2,$3,$4,$5,$6)', params: [id,value.role,JSON.stringify([...new Set(value.permissions)]),projects.filter(p => ids.includes(p.id)).map(p=>p.name).join(', '),value.context,data.welcome] },
    ...ids.map(projectId => ({ query: 'insert into bugflow.portal_projects(portal_id,project_id) values($1,$2)', params: [id,projectId] })),
    { query: 'insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,$3,$4)', params: [crypto.randomUUID(),admin.userId,'portal.created',{portalId:id,permissions:value.permissions,projectIds:ids}] },
  ]);
  return { id, path: `/${type}/${token}` };
}
export async function changePortal(id: string, regenerate: boolean) {
  checkOrigin(); const admin = await requireAdmin(); const token = regenerate ? randomToken() : null;
  const result = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    { query: regenerate ? "update bugflow.portals set token_hash=$2,token_ciphertext=$3,active=true,revoked_at=null,expires_at=now()+interval '90 days' where id=$1 and type<>'admin' returning type" : "update bugflow.portals set active=false,revoked_at=now() where id=$1 and type<>'admin' returning type", params: regenerate && token ? [id,await hashToken(token),await encryptPortal(token)] : [id] },
    { query: "insert into bugflow.activity(id,actor_id,action,detail) select $1,$2,$3,$4 where exists(select 1 from bugflow.portals where id=$5 and type<>'admin')", params: [crypto.randomUUID(),admin.userId,regenerate?'portal.regenerated':'portal.revoked',{portalId:id},id] },
  ]);
  const row = result.results[0]?.rows[0]; if (!row) throw new Error('Member portal not found.');
  return { path: token ? `/${String(row['type'])}/${token}` : '' };
}
export async function readPortal(data: z.infer<typeof portalReadSchema>) {
  const { rows } = await neonQuery("select p.id,p.user_id,p.type,to_json(p.created_at) as since,p.welcome_seen_at,u.name,o.welcome,o.permissions,o.scope_note,o.collaborator_role from bugflow.portals p join bugflow.users u on u.id=p.user_id join bugflow.portal_onboarding o on o.portal_id=p.id where p.token_hash=$1 and p.type<>'admin' and p.active and u.active and u.deleted_at is null and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) limit 1", [await hashToken(data.token)]);
  const row = rows[0]; if (!row) return null;
  await neonExecute('update bugflow.portals set last_seen_at=now() where id=$1', [row['id']]).catch(() => undefined);
  return { type: String(row['type']) as typeof data.type, memberCode: String(row['user_id']).slice(0, 8).toUpperCase(), since: String(row['since']), firstVisit:!row['welcome_seen_at'], name: String(row['name']), welcome: String(row['welcome']), permissions: Array.isArray(row['permissions']) ? row['permissions'].filter((p): p is string=>typeof p==='string') : [], scope: String(row['scope_note']), role: String(row['collaborator_role']) };
}