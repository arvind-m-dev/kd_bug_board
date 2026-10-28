import {
  getCookie,
  setCookie,
  deleteCookie,
  getRequest,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { neonQuery, neonExecute, neonUserError } from "./neon.server";
import {
  hashToken,
  randomToken,
  equalSecret,
  portalTypesByRole,
  ADMIN_SIGNED_OUT,
  ADMIN_EXPIRED,
  type saveMemberSchema,
  type unlockSchema,
  type portalReadSchema,
} from "./portal-access";
import { encryptPortal } from "./portal-crypto.server";
import {
  assertSignInAllowed,
  clearSignInFailures,
  clientKey,
  recordSignInFailure,
} from "./sign-in-throttle.server";
import { normalizePortalAppearance } from "./appearance";
import type { z } from "zod";

export async function databaseCall<T>(work: () => Promise<T>): Promise<T> {
  setResponseHeader("Cache-Control", "no-store");
  try {
    return await work();
  } catch (error) {
    if (error && typeof error === "object" && "kind" in error) {
      console.error(error);
      throw new Error(neonUserError(error).message);
    }
    throw error;
  }
}
export function checkOrigin() {
  // Browser server-function calls run inside the Start request runtime; AI-token (MCP) calls run outside it and carry no
  // cookie, so there is no CSRF surface and no request to read — skip the check there rather than throw.
  let request: Request;
  try {
    request = getRequest();
  } catch {
    return;
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new Error("This request must come from your Bug Board workspace.");
}
// Verified Admin sessions are remembered briefly per server instance so each request skips a database round trip.
// Sign-out clears the entry; other revocations take effect within ADMIN_CACHE_MS.
const ADMIN_CACHE_MS = 60_000;
const adminCache = new Map<
  string,
  { admin: { id: string; userId: string; name: string }; until: number }
>();
export async function requireAdmin() {
  const token = getCookie("bugflow_admin");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error(ADMIN_SIGNED_OUT);
  const key = await hashToken(token);
  const hit = adminCache.get(key);
  if (hit && hit.until > Date.now()) return hit.admin;
  adminCache.delete(key);
  const { rows } = await neonQuery(
    "select p.id, p.user_id, u.name from bugflow.admin_sessions s join bugflow.portals p on p.id=s.portal_id join bugflow.users u on u.id=p.user_id where s.token_hash=$1 and s.expires_at>now() and p.type='admin' and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) limit 1",
    [key],
  );
  const admin = rows[0];
  if (!admin) throw new Error(ADMIN_EXPIRED);
  const result = {
    id: String(admin["id"]),
    userId: String(admin["user_id"]),
    name: String(admin["name"]),
  };
  if (adminCache.size > 500) adminCache.clear();
  adminCache.set(key, { admin: result, until: Date.now() + ADMIN_CACHE_MS });
  return result;
}
/** Temporary one-click Admin entry (BUGFLOW_DEMO_LOGIN=1): anyone who opens /login becomes Admin. Turn off when done. */
export const demoLoginEnabled = () => process.env["BUGFLOW_DEMO_LOGIN"] === "1";
export async function adminStatus() {
  const demo = demoLoginEnabled();
  try {
    return { unlocked: true, name: (await requireAdmin()).name, demo };
  } catch (error) {
    if (error && typeof error === "object" && "kind" in error) throw error;
    return { unlocked: false, name: "", demo };
  }
}
/** Signs in with the configured Admin credentials on the server, so they never reach the browser. */
export async function demoUnlockAdmin() {
  if (!demoLoginEnabled()) throw new Error("One-click sign-in is turned off.");
  return unlockAdmin({
    email: process.env["BUGFLOW_ADMIN_EMAIL"] ?? "",
    password: process.env["BUGFLOW_ADMIN_PASSWORD"] ?? "",
  });
}
export async function unlockAdmin(data: z.infer<typeof unlockSchema>) {
  checkOrigin();
  const password = process.env["BUGFLOW_ADMIN_PASSWORD"];
  const email = process.env["BUGFLOW_ADMIN_EMAIL"];
  if (!password || !email) throw new Error("Admin sign-in is not configured.");
  const attempt = clientKey(getRequest().headers);
  assertSignInAllowed(attempt);
  const passwordValid = await equalSecret(data.password, password);
  const emailValid = await equalSecret(data.email.toLowerCase(), email.toLowerCase());
  if (!passwordValid || !emailValid) {
    recordSignInFailure(attempt);
    throw new Error("Incorrect email or password.");
  }
  clearSignInFailures(attempt);
  const userId = crypto.randomUUID();
  const portalId = crypto.randomUUID();
  const session = randomToken();
  const result = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    { query: "select pg_advisory_xact_lock(7438592)" },
    {
      query:
        "update bugflow.users u set email=$1 where u.id in (select user_id from bugflow.portals where type='admin') and lower(u.email)<>$1 and not exists (select 1 from bugflow.users other where lower(other.email)=$1 and other.id<>u.id)",
      params: [email.toLowerCase()],
    },
    {
      query:
        "insert into bugflow.users (id,name,email) select $1,$2,$3 where not exists (select 1 from bugflow.portals where type='admin') on conflict (email) do nothing",
      params: [userId, "Admin", email.toLowerCase()],
    },
    {
      query:
        "insert into bugflow.portals (id,user_id,type,token_hash) select $1,u.id,'admin',$2 from bugflow.users u where u.email=$3 and not exists (select 1 from bugflow.portals where type='admin')",
      params: [portalId, await hashToken(randomToken()), data.email.toLowerCase()],
    },
    {
      query:
        "insert into bugflow.admin_sessions (token_hash,portal_id,expires_at) select $1,p.id,now()+interval '8 hours' from bugflow.portals p join bugflow.users u on u.id=p.user_id where p.type='admin' and p.active and p.revoked_at is null and u.active and u.email=$2 and (p.expires_at is null or p.expires_at>now()) returning portal_id",
      params: [await hashToken(session), data.email.toLowerCase()],
    },
  ]);
  if (!result.results[4]?.rows.length) throw new Error("Admin account is unavailable or inactive.");
  setCookie("bugflow_admin", session, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: 8 * 3600,
  });
  return { unlocked: true };
}
export async function lockAdmin() {
  checkOrigin();
  const token = getCookie("bugflow_admin");
  if (token) {
    const key = await hashToken(token);
    adminCache.delete(key);
    await neonExecute("delete from bugflow.admin_sessions where token_hash=$1", [key]);
  }
  deleteCookie("bugflow_admin", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
  });
  return { locked: true };
}
export async function listMembers() {
  await requireAdmin();
  const { rows } = await neonQuery(
    "select p.id,p.user_id,u.name,u.email,p.type,p.active,u.active as user_active,p.token_ciphertext is not null as copyable,(u.active and p.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now())) as usable,o.collaborator_role,o.scope_note,coalesce(p.online_until>now(), p.last_seen_at>now()-interval '2 minutes') as online,to_json(greatest(p.last_seen_at, case when p.online_until is not null then least(p.online_until, now()) end)) as last_seen from bugflow.portals p join bugflow.users u on u.id=p.user_id join bugflow.portal_onboarding o on o.portal_id=p.id where u.deleted_at is null order by p.created_at desc,p.id desc limit 100",
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    userId: String(r["user_id"]),
    name: String(r["name"]),
    email: String(r["email"]),
    type: String(r["type"]),
    active: r["usable"] === true,
    userActive: r["user_active"] === true,
    copyable: r["copyable"] === true,
    role: String(r["collaborator_role"]),
    scope: String(r["scope_note"]),
    online: r["online"] === true,
    lastSeen: r["last_seen"] ? String(r["last_seen"]) : null,
  }));
}
export async function listProjects() {
  await requireAdmin();
  const { rows } = await neonQuery(
    "select id,name from bugflow.projects where not archived order by name,id limit 100",
  );
  return rows.map((r) => ({ id: String(r["id"]), name: String(r["name"]) }));
}
/** Per-project bug, module and member counts for the Projects & modules page. */
export async function projectSummary() {
  await requireAdmin();
  const { rows } =
    await neonQuery(`select p.id, p.name, p.environment, p.archived, to_json(p.created_at) as created_at,
    (select count(*)::int from bugflow.bugs b where b.project_id=p.id and b.deleted_at is null) as total,
    (select count(*)::int from bugflow.bugs b where b.project_id=p.id and b.deleted_at is null and b.status not in ('RESOLVED','NOT_A_BUG','DUPLICATE','WONT_FIX')) as open,
    (select count(distinct d.module_name)::int from bugflow.bugs b join bugflow.bug_details d on d.bug_id=b.id where b.project_id=p.id and b.deleted_at is null and d.module_name<>'') as modules,
    (select count(*)::int from bugflow.portal_projects pp join bugflow.portals x on x.id=pp.portal_id join bugflow.users u on u.id=x.user_id where pp.project_id=p.id and x.type<>'admin' and x.active and u.active and u.deleted_at is null and x.revoked_at is null and (x.expires_at is null or x.expires_at>now())) as members,
    (select to_json(max(b.updated_at)) from bugflow.bugs b where b.project_id=p.id and b.deleted_at is null) as last_update
   from bugflow.projects p order by p.name, p.id limit 200`);
  return rows.map((r) => ({
    id: String(r["id"]),
    name: String(r["name"]),
    environment: String(r["environment"]),
    archived: r["archived"] === true,
    createdAt: String(r["created_at"]),
    total: Number(r["total"]),
    open: Number(r["open"]),
    modules: Number(r["modules"]),
    members: Number(r["members"]),
    lastUpdate: r["last_update"] ? String(r["last_update"]) : null,
  }));
}
/** Archive hides a project from report forms and project choices; bugs, history and member scopes are kept. */
export async function setProjectArchived(id: string, archived: boolean) {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonExecute<{ rows: Record<string, unknown>[] }>(
    "with changed as (update bugflow.projects set archived=$2 where id=$1 and archived<>$2 returning id) insert into bugflow.activity(id,actor_id,action,detail) select $3,$4,$5,$6 from changed returning id",
    [
      id,
      archived,
      crypto.randomUUID(),
      admin.userId,
      archived ? "project.archived" : "project.restored",
      { projectId: id },
    ],
  );
  if (!rows.length) throw new Error("This project was already changed. Refresh and try again.");
  return { id, archived };
}
export async function createProject(name: string) {
  checkOrigin();
  const admin = await requireAdmin();
  const id = crypto.randomUUID();
  await neonExecute([
    { query: "insert into bugflow.projects(id,name) values($1,$2)", params: [id, name] },
    {
      query: "insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,$3,$4)",
      params: [crypto.randomUUID(), admin.userId, "project.created", { projectId: id }],
    },
  ]);
  return { id, name };
}
export async function saveMember(data: z.infer<typeof saveMemberSchema>) {
  checkOrigin();
  const admin = await requireAdmin();
  const projects = await listProjects();
  const ids = [...new Set(data.projectIds)];
  if (ids.some((id) => !projects.some((p) => p.id === id)))
    throw new Error("Choose active projects from this workspace.");
  const token = randomToken();
  const id = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const value = data.collaborator;
  const type = portalTypesByRole[value.role];
  await neonExecute([
    {
      query:
        "insert into bugflow.users(id,name,email) values($1,$2,$3) on conflict(email) do nothing",
      params: [userId, value.name, value.email.toLowerCase()],
    },
    {
      query:
        "insert into bugflow.portals(id,user_id,type,token_hash,token_ciphertext,expires_at) select $1,id,$2,$3,$5,now()+interval '90 days' from bugflow.users where email=$4 and active",
      params: [
        id,
        type,
        await hashToken(token),
        value.email.toLowerCase(),
        await encryptPortal(token),
      ],
    },
    {
      query:
        "insert into bugflow.portal_onboarding(portal_id,collaborator_role,permissions,scope_note,context,welcome) values($1,$2,$3,$4,$5,$6)",
      params: [
        id,
        value.role,
        JSON.stringify([...new Set(value.permissions)]),
        projects
          .filter((p) => ids.includes(p.id))
          .map((p) => p.name)
          .join(", "),
        value.context,
        data.welcome,
      ],
    },
    ...ids.map((projectId) => ({
      query: "insert into bugflow.portal_projects(portal_id,project_id) values($1,$2)",
      params: [id, projectId],
    })),
    {
      query: "insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,$3,$4)",
      params: [
        crypto.randomUUID(),
        admin.userId,
        "portal.created",
        { portalId: id, permissions: value.permissions, projectIds: ids },
      ],
    },
  ]);
  return { id, path: `/${type}/${token}` };
}
export async function changePortal(id: string, regenerate: boolean) {
  checkOrigin();
  const admin = await requireAdmin();
  const token = regenerate ? randomToken() : null;
  const result = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    {
      query: regenerate
        ? "update bugflow.portals set token_hash=$2,token_ciphertext=$3,active=true,revoked_at=null,expires_at=now()+interval '90 days' where id=$1 and type<>'admin' returning type"
        : "update bugflow.portals set active=false,revoked_at=now() where id=$1 and type<>'admin' returning type",
      params: regenerate && token ? [id, await hashToken(token), await encryptPortal(token)] : [id],
    },
    {
      query:
        "insert into bugflow.activity(id,actor_id,action,detail) select $1,$2,$3,$4 where exists(select 1 from bugflow.portals where id=$5 and type<>'admin')",
      params: [
        crypto.randomUUID(),
        admin.userId,
        regenerate ? "portal.regenerated" : "portal.revoked",
        { portalId: id },
        id,
      ],
    },
  ]);
  const row = result.results[0]?.rows[0];
  if (!row) throw new Error("Member portal not found.");
  return { path: token ? `/${String(row["type"])}/${token}` : "" };
}
const parsePortalAppearance = (v: unknown) => normalizePortalAppearance(v);
export async function readPortal(data: z.infer<typeof portalReadSchema>) {
  const { rows } = await neonQuery(
    "select p.id,p.user_id,p.type,to_json(p.created_at) as since,p.welcome_seen_at,p.appearance,u.name,o.welcome,o.permissions,o.scope_note,o.collaborator_role from bugflow.portals p join bugflow.users u on u.id=p.user_id join bugflow.portal_onboarding o on o.portal_id=p.id where p.token_hash=$1 and p.type<>'admin' and p.active and u.active and u.deleted_at is null and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) limit 1",
    [await hashToken(data.token)],
  );
  const row = rows[0];
  if (!row) return null;
  await neonExecute("update bugflow.portals set last_seen_at=now() where id=$1", [row["id"]]).catch(
    () => undefined,
  );
  return {
    type: String(row["type"]) as typeof data.type,
    memberCode: String(row["user_id"]).slice(0, 8).toUpperCase(),
    since: String(row["since"]),
    firstVisit: !row["welcome_seen_at"],
    name: String(row["name"]),
    welcome: String(row["welcome"]),
    permissions: Array.isArray(row["permissions"])
      ? row["permissions"].filter((p): p is string => typeof p === "string")
      : [],
    scope: String(row["scope_note"]),
    role: String(row["collaborator_role"]),
    appearance: parsePortalAppearance(row["appearance"]),
  };
}
