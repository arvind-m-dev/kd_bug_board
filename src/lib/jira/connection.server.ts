import { neonQuery, neonExecute } from "../neon.server";
import { audited } from "../audit.server";
import { checkOrigin, requireAdmin } from "../portal-access.server";
import { jiraAccessToken, jiraEnv, jiraFetch } from "./auth.server";
import { accessibleSites, myself } from "./client.server";
import { JiraAuthError, safeErrorText } from "./errors";
import { cloudIdSchema, siteAllowed, type JiraSite } from "./oauth";
import type { JiraConnectionState, JiraConnectionView, JiraStatus } from "./types";

// Admin operations on the Jira connection. Connecting only stores an authorization: nothing synchronizes until a
// project mapping is activated (later stage), and no state is called "connected" before a live read from Jira.

const isMissingTable = (error: unknown) => (error as { code?: unknown } | null)?.code === "42P01";

type Row = Record<string, unknown>;
async function liveRow(): Promise<Row | null> {
  const { rows } = await neonQuery(
    `select id,cloud_id,site_url,site_name,authorized_display_name,scopes,state,last_error,to_json(last_api_ok_at) as verified_iso,to_json(created_at) as created_iso from bugflow.jira_connections where disconnected_at is null limit 1`,
  );
  return rows[0] ?? null;
}
const text = (v: unknown) => (v == null ? null : String(v));

async function view(row: Row, allowedSite: string | null): Promise<JiraConnectionView> {
  const state = String(row["state"]) as JiraConnectionState;
  let pendingSites: JiraSite[] = [];
  let lastError = text(row["last_error"]);
  if (state === "pending_site")
    try {
      const { token } = await jiraAccessToken(String(row["id"]));
      pendingSites = (await accessibleSites(token)).filter((s) => siteAllowed(s.url, allowedSite));
    } catch (error) {
      lastError = safeErrorText(error);
    }
  return {
    state,
    siteName: text(row["site_name"]),
    siteUrl: text(row["site_url"]),
    account: text(row["authorized_display_name"]),
    scopes: Array.isArray(row["scopes"]) ? row["scopes"].map(String) : [],
    lastVerifiedAt: text(row["verified_iso"]),
    lastError,
    connectedAt: String(row["created_iso"]),
    pendingSites,
  };
}

export async function jiraStatus(): Promise<JiraStatus> {
  await requireAdmin();
  const { config, missing } = jiraEnv();
  if (!config) return { available: false, reason: "not_configured", missing };
  let row: Row | null;
  try {
    row = await liveRow();
  } catch (error) {
    if (isMissingTable(error))
      return { available: false, reason: "database_not_ready", missing: [] };
    throw error;
  }
  return {
    available: true,
    origin: config.origin,
    callbackUrl: config.redirectUri,
    allowedSite: config.allowedSite,
    connection: row ? await view(row, config.allowedSite) : null,
  };
}

/** A live read from Jira as the connection. Records the outcome either way; never reports success it did not see. */
export async function checkJiraConnection(): Promise<JiraStatus> {
  checkOrigin();
  await requireAdmin();
  const row = await liveRow();
  if (!row) throw new Error("Jira is not connected.");
  if (!row["cloud_id"]) throw new Error("Choose the Jira site first.");
  const id = String(row["id"]);
  try {
    await jiraFetch({ id, cloudId: String(row["cloud_id"]) }, "/rest/api/3/myself");
    await neonExecute(
      `update bugflow.jira_connections set last_api_ok_at=now(),last_error=null,state=case when state='error' then 'connected' else state end,updated_at=now() where id=$1 and disconnected_at is null`,
      [id],
    );
  } catch (error) {
    // The token store already marks a refused authorization; anything else is recorded as the last error.
    if (!(error instanceof JiraAuthError && error.code === "reauthorization_required"))
      await neonExecute(
        `update bugflow.jira_connections set last_error=$2,updated_at=now() where id=$1 and disconnected_at is null`,
        [id, safeErrorText(error)],
      );
  }
  return jiraStatus();
}

/** For an authorization that reaches several Jira sites: the Admin picks one, verified with a live read. */
export async function selectJiraSite(cloudId: string): Promise<JiraStatus> {
  checkOrigin();
  const admin = await requireAdmin();
  const { config } = jiraEnv();
  if (!config) throw new Error("Jira is not set up on this server.");
  if (!cloudIdSchema.safeParse(cloudId).success) throw new Error("Choose a site from the list.");
  const row = await liveRow();
  if (!row || row["state"] !== "pending_site") throw new Error("There is no site to choose.");
  const id = String(row["id"]);
  const { token } = await jiraAccessToken(id);
  const site = (await accessibleSites(token)).find(
    (s) => s.id === cloudId && siteAllowed(s.url, config.allowedSite),
  );
  if (!site) throw new Error("That Jira site is not available to this authorization.");
  const account = await myself(site.id, token);
  const q = audited(
    `update bugflow.jira_connections set cloud_id=$2,site_url=$3,site_name=$4,authorized_account_id=$5,authorized_display_name=$6,state='connected',last_api_ok_at=now(),last_error=null,updated_at=now() where id=$1 and disconnected_at is null and state='pending_site' returning id`,
    [id, site.id, site.url, site.name, account.accountId, account.displayName],
    { actorId: admin.userId, action: "jira.connected", detail: { site: site.name, url: site.url } },
  );
  const { rows } = await neonExecute(q.query, q.params);
  if (!rows.length) throw new Error("The connection changed. Refresh and try again.");
  return jiraStatus();
}

async function setState(from: "connected" | "paused", to: "connected" | "paused", action: string) {
  checkOrigin();
  const admin = await requireAdmin();
  const q = audited(
    `update bugflow.jira_connections set state=$2,updated_at=now() where disconnected_at is null and state=$1 returning id`,
    [from, to],
    { actorId: admin.userId, action, detail: {} },
  );
  const { rows } = await neonExecute(q.query, q.params);
  if (!rows.length)
    throw new Error(
      to === "paused"
        ? "Only a connected Jira can be paused."
        : "Only a paused Jira can be resumed.",
    );
  return jiraStatus();
}
export const pauseJira = () => setState("connected", "paused", "jira.paused");
export const resumeJira = () => setState("paused", "connected", "jira.resumed");

/**
 * Removes the saved authorization and stops every mapping. Bugs, links and history stay on both sides.
 * Atlassian offers no API for an app to revoke its own grant, so the Admin is told where to remove it.
 */
export async function disconnectJira(): Promise<JiraStatus> {
  checkOrigin();
  const admin = await requireAdmin();
  const row = await liveRow();
  if (!row) throw new Error("Jira is not connected.");
  const id = String(row["id"]);
  // Jira's notifications are removed while the authorization still works. If that fails (Jira unreachable,
  // access already revoked) the disconnect goes ahead: unrenewed, they expire by themselves within 30 days,
  // and the receiver refuses events for a disconnected connection.
  try {
    const hooks = (
      await neonQuery(`select webhooks from bugflow.jira_connections where id=$1`, [id])
    ).rows[0]?.["webhooks"];
    const ids = Array.isArray(hooks)
      ? hooks.flatMap((w: { id?: unknown }) => (typeof w.id === "number" ? [w.id] : []))
      : [];
    if (ids.length && row["cloud_id"])
      await jiraFetch({ id, cloudId: String(row["cloud_id"]) }, "/rest/api/3/webhook", {
        method: "DELETE",
        body: { webhookIds: ids },
      });
  } catch {
    // see above
  }
  const { results } = await neonExecute<{ results: { rows: Row[] }[] }>([
    audited(
      `update bugflow.jira_connections set access_token_ciphertext=null,refresh_token_ciphertext=null,refresh_lease_until=null,webhooks='[]'::jsonb,webhook_expires_at=null,state='revoked',disconnected_at=now(),updated_at=now() where id=$1 and disconnected_at is null returning id`,
      [id],
      {
        actorId: admin.userId,
        action: "jira.disconnected",
        detail: { site: text(row["site_name"]), url: text(row["site_url"]) },
      },
    ),
    {
      query: `update bugflow.jira_project_mappings set state='disabled',updated_at=now() where connection_id=$1 and state<>'disabled'`,
      params: [id],
    },
    { query: `delete from bugflow.jira_oauth_states` },
  ]);
  if (!results[0]?.rows.length) throw new Error("Jira was already disconnected.");
  return jiraStatus();
}
