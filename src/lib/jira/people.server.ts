import { z } from "zod";
import { audited } from "../audit.server";
import { neonExecute, neonQuery } from "../neon.server";
import { checkOrigin, requireAdmin } from "../portal-access.server";
import { jiraFetch } from "./auth.server";
import { JiraApiError, JiraAuthError, safeErrorText } from "./errors";

// Who is who. A BugFlow member counts as a Jira account only after an Admin confirmed that link here; a
// matching name or email is at most a suggestion. With the link, the member's own Jira account is named as
// assignee (and as reporter where Jira allows it); without it, their name still appears as text on the issue.
// Linking never creates, invites or changes a user on either side.

type Row = Record<string, unknown>;
export type JiraPerson = {
  userId: string;
  name: string;
  role: string;
  accountId: string | null;
  jiraName: string | null;
};
export type JiraAccount = { accountId: string; name: string };

async function connection(): Promise<{ id: string; cloudId: string; state: string }> {
  const { rows } = await neonQuery(
    `select id,cloud_id,state from bugflow.jira_connections where disconnected_at is null limit 1`,
  );
  const r = rows[0];
  if (!r || !r["cloud_id"]) throw new Error("Connect Jira first.");
  return { id: String(r["id"]), cloudId: String(r["cloud_id"]), state: String(r["state"]) };
}

const PEOPLE = `select u.id,u.name,min(p.type) as role,um.account_id,um.display_name from bugflow.users u join bugflow.portals p on p.user_id=u.id left join bugflow.jira_user_mappings um on um.user_id=u.id and um.connection_id=$1 and um.confirmed_at is not null where p.type<>'admin' and u.deleted_at is null and u.active and p.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) group by u.id,u.name,um.account_id,um.display_name order by u.name,u.id limit 200`;
const toPerson = (r: Row): JiraPerson => ({
  userId: String(r["id"]),
  name: String(r["name"]),
  role: String(r["role"] ?? ""),
  accountId: r["account_id"] ? String(r["account_id"]) : null,
  jiraName: r["account_id"] ? String(r["display_name"] ?? "") : null,
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
      q,
      { query: RESYNC, params: [c.id, userId] },
    ]);
    if (!results[0]?.rows.length) throw new Error("That member is not active any more.");
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "23505")
      throw new Error("That Jira account is already linked to another member.");
    throw error;
  }
  return (await neonQuery(PEOPLE, [c.id])).rows.map(toPerson);
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
