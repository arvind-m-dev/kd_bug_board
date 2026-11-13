import { z } from "zod";
import { audited } from "../audit.server";
import { neonExecute, neonQuery } from "../neon.server";
import { checkOrigin, requireAdmin } from "../portal-access.server";
import { jiraFetch } from "./auth.server";
import { JiraApiError, JiraAuthError, safeErrorText } from "./errors";
import { type PeopleReport, peopleReport } from "./people";

// Who is who. A BugFlow member counts as a Jira account once linked: by an Admin here, or automatically when
// Jira finds exactly one active person under the member's own email address (a name alone is never enough).
// With the link, the member's own Jira account is named as assignee and reporter; without it, their name still
// appears as text on the issue. Linking never creates, invites or changes a user on either side: a Jira person
// becomes a BugFlow member only when an Admin adds them, with a role the Admin picks.

type Row = Record<string, unknown>;
export type JiraPerson = {
  userId: string;
  name: string;
  role: string;
  accountId: string | null;
  jiraName: string | null;
  /** Working portal links this member has (more than one is reported). */
  links: number;
};
export type JiraAccount = { accountId: string; name: string };
/** Someone who can be given work in a mapped Jira project, and the BugFlow member linked to them (if any). */
export type JiraOnlyPerson = JiraAccount & { email: string | null; member: string | null };

async function connection(): Promise<{ id: string; cloudId: string; state: string }> {
  const { rows } = await neonQuery(
    `select id,cloud_id,state from bugflow.jira_connections where disconnected_at is null limit 1`,
  );
  const r = rows[0];
  if (!r || !r["cloud_id"]) throw new Error("Connect Jira first.");
  return { id: String(r["id"]), cloudId: String(r["cloud_id"]), state: String(r["state"]) };
}

const PEOPLE = `select u.id,u.name,min(p.type) as role,count(distinct p.id)::int as links,um.account_id,um.display_name from bugflow.users u join bugflow.portals p on p.user_id=u.id left join bugflow.jira_user_mappings um on um.user_id=u.id and um.connection_id=$1 and um.confirmed_at is not null where p.type<>'admin' and u.deleted_at is null and u.active and p.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) group by u.id,u.name,um.account_id,um.display_name order by u.name,u.id limit 200`;
const toPerson = (r: Row): JiraPerson => ({
  userId: String(r["id"]),
  name: String(r["name"]),
  role: String(r["role"] ?? ""),
  accountId: r["account_id"] ? String(r["account_id"]) : null,
  jiraName: r["account_id"] ? String(r["display_name"] ?? "") : null,
  links: Number(r["links"] ?? 1),
});

export async function jiraPeople(): Promise<JiraPerson[]> {
  await requireAdmin();
  const c = await connection();
  return (await neonQuery(PEOPLE, [c.id])).rows.map(toPerson);
}

const usersSchema = z.array(
  z
    .object({
      accountId: z.string().min(1).max(128),
      displayName: z.string().nullish(),
      emailAddress: z.string().nullish(),
      active: z.boolean().optional(),
      accountType: z.string().optional(),
    })
    .passthrough(),
);
/** People in Jira whose name (or visible email) matches. Only real, active people: no apps, no customers. */
export async function findJiraAccounts(query: string): Promise<JiraAccount[]> {
  await requireAdmin();
  const c = await connection();
  if (c.state !== "connected") throw new Error("Jira is paused or needs a new sign-in.");
  try {
    const raw = await jiraFetch(
      c,
      `/rest/api/3/user/search?maxResults=20&query=${encodeURIComponent(query)}`,
    );
    const parsed = usersSchema.safeParse(raw);
    if (!parsed.success) throw new JiraApiError("unexpected", 200);
    return parsed.data
      .filter((u) => u.active !== false && (u.accountType ?? "atlassian") === "atlassian")
      .map((u) => ({ accountId: u.accountId, name: u.displayName ?? u.accountId }));
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
}

/** Their open, synchronized bugs are looked at again, so Jira shows the right person without waiting for an edit. */
const RESYNC = `insert into bugflow.jira_outbox(mapping_id,bug_id,op,dedup_key) select l.mapping_id,l.bug_id,'sync','sync:'||l.bug_id||':'||gen_random_uuid() from bugflow.jira_issue_links l join bugflow.bugs b on b.id=l.bug_id where l.connection_id=$1 and l.state in ('linked','conflict') and b.deleted_at is null and (b.assignee_id=$2 or b.reporter_id=$2) on conflict do nothing`;

export async function linkJiraPerson(userId: string, account: JiraAccount): Promise<JiraPerson[]> {
  checkOrigin();
  const admin = await requireAdmin();
  const c = await connection();
  const q = audited(
    `insert into bugflow.jira_user_mappings(connection_id,user_id,account_id,display_name,source,confirmed_at,confirmed_by) select $1,u.id,$3,$4,'manual',now(),$5 from bugflow.users u where u.id=$2 and u.active and u.deleted_at is null on conflict (connection_id,user_id) do update set account_id=excluded.account_id,display_name=excluded.display_name,source='manual',confirmed_at=now(),confirmed_by=excluded.confirmed_by returning user_id`,
    [c.id, userId, account.accountId, account.name, admin.userId],
    {
      actorId: admin.userId,
      action: "jira.person_linked",
      detail: { userId, jiraName: account.name },
    },
  );
  try {
    const { results } = await neonExecute<{ results: { rows: Row[] }[] }>([
      {
        query: `delete from bugflow.jira_user_mappings um using bugflow.users u where um.connection_id=$1 and um.account_id=$2 and u.id=um.user_id and um.user_id<>$3 and (u.deleted_at is not null or not u.active)`,
        params: [c.id, account.accountId, userId],
      },
      q,
      { query: RESYNC, params: [c.id, userId] },
    ]);
    if (!results[1]?.rows.length) throw new Error("That member is not active any more.");
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "23505")
      throw new Error("That Jira account is already linked to another member.");
    throw error;
  }
  return (await neonQuery(PEOPLE, [c.id])).rows.map(toPerson);
}

/**
 * Links the member just saved under `email` to the Jira account the Admin added them from. The account is the
 * one the Admin picked, so the email does not have to be the one Jira knows.
 */
export async function linkJiraPersonByEmail(email: string, account: JiraAccount) {
  checkOrigin();
  await requireAdmin();
  const { rows } = await neonQuery(
    `select id from bugflow.users where email=$1 and active and deleted_at is null`,
    [email.trim().toLowerCase()],
  );
  const userId = rows[0]?.["id"];
  if (!userId) throw new Error("The new member could not be found to link.");
  return linkJiraPerson(String(userId), account);
}

export async function unlinkJiraPerson(userId: string): Promise<JiraPerson[]> {
  checkOrigin();
  const admin = await requireAdmin();
  const c = await connection();
  const q = audited(
    `delete from bugflow.jira_user_mappings where connection_id=$1 and user_id=$2 returning user_id`,
    [c.id, userId],
    { actorId: admin.userId, action: "jira.person_unlinked", detail: { userId } },
  );
  await neonExecute([q, { query: RESYNC, params: [c.id, userId] }]);
  return (await neonQuery(PEOPLE, [c.id])).rows.map(toPerson);
}

const isPerson = (u: z.infer<typeof usersSchema>[number]) =>
  u.active !== false && (u.accountType ?? "atlassian") === "atlassian";

/**
 * Links every unlinked member whose email Jira knows for exactly one active person. Jira matches its search on
 * email even where it hides the address; when it does show one, it must be the member's. An account already
 * linked to someone else, two matches, or a member the Admin unlinked by hand, is left for the Admin.
 * Returns how many were linked.
 */
export async function matchPeopleByEmail(actorId: string): Promise<number> {
  const c = await connection();
  if (c.state !== "connected") return 0;
  const { rows } = await neonQuery(
    `select u.id,u.email from bugflow.users u where u.active and u.deleted_at is null and exists(select 1 from bugflow.portals p where p.user_id=u.id and p.type<>'admin' and p.active and p.revoked_at is null) and not exists(select 1 from bugflow.jira_user_mappings um where um.connection_id=$1 and um.user_id=u.id) and not exists(select 1 from bugflow.activity a where a.action='jira.person_unlinked' and a.detail->>'userId'=u.id::text) order by u.created_at limit 200`,
    [c.id],
  );
  let linked = 0;
  for (const r of rows) {
    const email = String(r["email"] ?? "").toLowerCase();
    if (!email.includes("@")) continue;
    const raw = await jiraFetch(
      c,
      `/rest/api/3/user/search?maxResults=5&query=${encodeURIComponent(email)}`,
    );
    const parsed = usersSchema.safeParse(raw);
    if (!parsed.success) continue;
    const people = parsed.data.filter(isPerson);
    const shown = people.filter((u) => u.emailAddress);
    const match =
      shown.length > 0 ? shown.filter((u) => u.emailAddress!.toLowerCase() === email) : people;
    if (match.length !== 1) continue;
    const a = match[0]!;
    const userId = String(r["id"]);
    const q = audited(
      `insert into bugflow.jira_user_mappings(connection_id,user_id,account_id,display_name,source,confirmed_at,confirmed_by) values($1,$2,$3,$4,'suggested',now(),null) on conflict do nothing returning user_id`,
      [c.id, userId, a.accountId, a.displayName ?? a.accountId],
      {
        actorId,
        action: "jira.person_linked",
        detail: { userId, jiraName: a.displayName ?? "", by: "email" },
      },
    );
    const { results } = await neonExecute<{ results: { rows: Row[] }[] }>([
      q,
      { query: RESYNC, params: [c.id, userId] },
    ]);
    if (results[0]?.rows.length) linked++;
  }
  return linked;
}

/** The Admin's "match by email now": the same as the hourly run, straight away. */
export async function matchJiraPeopleByEmail(): Promise<{ linked: number; people: JiraPerson[] }> {
  checkOrigin();
  const admin = await requireAdmin();
  try {
    const linked = await matchPeopleByEmail(admin.userId);
    const c = await connection();
    return { linked, people: (await neonQuery(PEOPLE, [c.id])).rows.map(toPerson) };
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
}

/** People Jira lets be given work in the mapped projects, each with the BugFlow member linked to them, if any. */
export async function jiraOnlyPeople(): Promise<JiraOnlyPerson[]> {
  await requireAdmin();
  const c = await connection();
  if (c.state !== "connected") return [];
  const { rows } = await neonQuery(
    `select distinct jira_project_key from bugflow.jira_project_mappings where connection_id=$1 and state in ('active','paused')`,
    [c.id],
  );
  const keys = rows.map((r) => String(r["jira_project_key"])).filter(Boolean);
  if (!keys.length) return [];
  try {
    const raw = await jiraFetch(
      c,
      `/rest/api/3/user/assignable/multiProjectSearch?maxResults=200&projectKeys=${encodeURIComponent(keys.join(","))}`,
    );
    const parsed = usersSchema.safeParse(raw);
    if (!parsed.success) throw new JiraApiError("unexpected", 200);
    const { rows: linked } = await neonQuery(
      `select um.account_id,u.name from bugflow.jira_user_mappings um join bugflow.users u on u.id=um.user_id where um.connection_id=$1 and u.active and u.deleted_at is null`,
      [c.id],
    );
    const members = new Map(linked.map((r) => [String(r["account_id"]), String(r["name"])]));
    return parsed.data.filter(isPerson).map((u) => ({
      accountId: u.accountId,
      name: u.displayName ?? u.accountId,
      email: u.emailAddress ?? null,
      member: members.get(u.accountId) ?? null,
    }));
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
}

/**
 * The Admin's "Sync members": links whoever can be linked by email now, reads both lists again, and reports
 * what may be the same person twice. Nothing is merged or deleted; the report only points at it.
 */
export async function syncJiraMembers(): Promise<{
  linked: number;
  people: JiraPerson[];
  jira: JiraOnlyPerson[];
  report: PeopleReport;
}> {
  checkOrigin();
  const admin = await requireAdmin();
  try {
    const linked = await matchPeopleByEmail(admin.userId);
    const c = await connection();
    const people = (await neonQuery(PEOPLE, [c.id])).rows.map(toPerson);
    const jira = await jiraOnlyPeople();
    return { linked, people, jira, report: peopleReport(people, jira) };
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
}

const userSchema = z
  .object({ accountId: z.string(), displayName: z.string().nullish() })
  .passthrough();

/**
 * Jira owns people's names. Renames a linked member to the name their Jira account has right now (read live, so
 * a stale copy is never applied), when an Admin asks. Their open synced bugs are looked at again so the
 * "Reported by" line on each Jira issue follows. History keeps who did what; it shows the new name.
 */
export async function applyJiraName(
  userId: string,
): Promise<{ name: string; people: JiraPerson[] }> {
  checkOrigin();
  const admin = await requireAdmin();
  const c = await connection();
  const { rows } = await neonQuery(
    `select um.account_id,u.name from bugflow.jira_user_mappings um join bugflow.users u on u.id=um.user_id where um.connection_id=$1 and um.user_id=$2 and um.confirmed_at is not null and u.active and u.deleted_at is null`,
    [c.id, userId],
  );
  const r = rows[0];
  if (!r) throw new Error("That member is not linked to a Jira account.");
  let name: string;
  try {
    const raw = await jiraFetch(
      c,
      `/rest/api/3/user?accountId=${encodeURIComponent(String(r["account_id"]))}`,
    );
    const parsed = userSchema.safeParse(raw);
    name = (parsed.success ? (parsed.data.displayName ?? "") : "").trim().replace(/\s+/g, " ");
  } catch (error) {
    if (error instanceof JiraApiError || error instanceof JiraAuthError)
      throw new Error(safeErrorText(error));
    throw error;
  }
  if (!name || name.length > 100)
    throw new Error("Jira did not give a usable name for this person.");
  const previous = String(r["name"]);
  if (name !== previous) {
    const q = audited(
      `update bugflow.users set name=$2 where id=$1 and active and deleted_at is null and not exists(select 1 from bugflow.portals ap where ap.user_id=bugflow.users.id and ap.type='admin') returning id`,
      [userId, name],
      {
        actorId: admin.userId,
        action: "member.updated",
        detail: { userId, previousName: previous, name, source: "jira" },
      },
    );
    const { results } = await neonExecute<{ results: { rows: Row[] }[] }>([
      q,
      {
        query: `update bugflow.jira_user_mappings set display_name=$3 where connection_id=$1 and user_id=$2`,
        params: [c.id, userId, name],
      },
      { query: RESYNC, params: [c.id, userId] },
    ]);
    if (!results[0]?.rows.length) throw new Error("That member's name cannot be changed here.");
  }
  return { name, people: (await neonQuery(PEOPLE, [c.id])).rows.map(toPerson) };
}
