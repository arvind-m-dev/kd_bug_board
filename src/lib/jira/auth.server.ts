import { getRequest } from "@tanstack/react-start/server";
import { neonQuery, neonExecute } from "../neon.server";
import { audited } from "../audit.server";
import { ADMIN_EXPIRED, hashToken, randomToken } from "../portal-access";
import { adminSessionFromRequest, checkOrigin, requireAdmin } from "../portal-access.server";
import { JIRA_KEY_VERSION, jiraKeyConfigured, openToken, sealToken } from "./crypto.server";
import { accessibleSites, jiraCall, myself } from "./client.server";
import { JiraApiError, JiraAuthError } from "./errors";
import {
  JIRA_SETTINGS_PATH,
  JIRA_STATE_TTL_MINUTES,
  JIRA_TOKEN_URL,
  authorizeUrl,
  callbackUrl,
  publicOrigin,
  siteAllowed,
  tokenResponseSchema,
  type JiraCallbackOutcome,
  type JiraSite,
} from "./oauth";
import { freshAccessToken, type RefreshCall, type TokenSet, type TokenStore } from "./refresh";

// The Atlassian OAuth 2.0 (3LO) connection: configuration, the connect/callback flow and token refresh.
// Tokens exist in plain form only in memory here; the database holds ciphertext and the browser never sees either.

export type JiraConfig = {
  clientId: string;
  clientSecret: string;
  /** This app's public address: where Atlassian sends the browser back, and later the webhooks. */
  origin: string;
  redirectUri: string;
  allowedSite: string | null;
};
/** Server configuration for Jira, plus the names (never values) of anything missing. */
export function jiraEnv(): { config: JiraConfig | null; missing: string[] } {
  const clientId = process.env["JIRA_CLIENT_ID"]?.trim() ?? "";
  const clientSecret = process.env["JIRA_CLIENT_SECRET"]?.trim() ?? "";
  const vercel = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
  const origin = publicOrigin(
    process.env["JIRA_PUBLIC_ORIGIN"] ??
      process.env["SITE_URL"] ??
      process.env["VITE_SITE_URL"] ??
      (vercel ? `https://${vercel}` : null),
  );
  const missing: string[] = [];
  if (!clientId) missing.push("JIRA_CLIENT_ID");
  if (!clientSecret) missing.push("JIRA_CLIENT_SECRET");
  if (!jiraKeyConfigured()) missing.push("JIRA_TOKEN_ENCRYPTION_KEY");
  if (!origin) missing.push("JIRA_PUBLIC_ORIGIN");
  if (missing.length || !origin) return { config: null, missing };
  return {
    config: {
      clientId,
      clientSecret,
      origin,
      redirectUri: callbackUrl(origin),
      allowedSite: process.env["JIRA_ALLOWED_SITE_URL"]?.trim() || null,
    },
    missing,
  };
}

async function tokenRequest(body: Record<string, string>) {
  try {
    const r = await fetch(JIRA_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: r.status, json: (await r.json().catch(() => null)) as unknown };
  } catch {
    return { status: 0, json: null as unknown };
  }
}
function toTokenSet(json: unknown): TokenSet | null {
  const parsed = tokenResponseSchema.safeParse(json);
  return parsed.success
    ? {
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token,
        expiresAt: Date.now() + parsed.data.expires_in * 1000,
      }
    : null;
}
const grantedScopes = (json: unknown) => {
  const scope = (json as { scope?: unknown } | null)?.scope;
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
};

function refreshCall(config: JiraConfig): RefreshCall {
  return async (refreshToken) => {
    const r = await tokenRequest({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    });
    if (r.status === 200) {
      const tokens = toTokenSet(r.json);
      return tokens ? { ok: true, tokens } : { ok: false, kind: "transient" };
    }
    // Atlassian answers an expired, revoked or already-replaced refresh token with `invalid_grant`.
    const error = (r.json as { error?: unknown } | null)?.error;
    return { ok: false, kind: error === "invalid_grant" ? "invalid_grant" : "transient" };
  };
}

/** The database side of the refresh protocol in refresh.ts: every write is one conditional statement. */
function tokenStore(connectionId: string): TokenStore {
  const live = "id=$1 and disconnected_at is null";
  return {
    async read() {
      const { rows } = await neonQuery(
        `select access_token_ciphertext as a,refresh_token_ciphertext as r,(extract(epoch from access_expires_at)*1000)::bigint as expires_ms,token_generation as g,state from bugflow.jira_connections where ${live}`,
        [connectionId],
      );
      const row = rows[0];
      if (!row || !row["a"] || !row["r"]) return null;
      if (row["state"] === "reauthorization_required")
        throw new JiraAuthError("reauthorization_required");
      return {
        accessToken: await openToken(String(row["a"]), connectionId, "access"),
        refreshToken: await openToken(String(row["r"]), connectionId, "refresh"),
        expiresAt: Number(row["expires_ms"] ?? 0),
        generation: Number(row["g"]),
      };
    },
    async acquireLease(generation, ttlMs) {
      const { rows } = await neonExecute(
        `update bugflow.jira_connections set refresh_lease_until=now()+make_interval(secs=>$3::double precision) where ${live} and token_generation=$2 and (refresh_lease_until is null or refresh_lease_until<now()) returning id`,
        [connectionId, generation, ttlMs / 1000],
      );
      return rows.length > 0;
    },
    async saveRotated(generation, next) {
      const { rows } = await neonExecute(
        `update bugflow.jira_connections set access_token_ciphertext=$3,refresh_token_ciphertext=$4,access_expires_at=$5::timestamptz,token_key_version=$6,token_generation=token_generation+1,refresh_lease_until=null,updated_at=now() where ${live} and token_generation=$2 returning id`,
        [
          connectionId,
          generation,
          await sealToken(next.accessToken, connectionId, "access"),
          await sealToken(next.refreshToken, connectionId, "refresh"),
          new Date(next.expiresAt).toISOString(),
          JIRA_KEY_VERSION,
        ],
      );
      return rows.length > 0;
    },
    async releaseLease(generation) {
      await neonExecute(
        `update bugflow.jira_connections set refresh_lease_until=null where ${live} and token_generation=$2`,
        [connectionId, generation],
      );
    },
    async requireReauthorization(generation) {
      await neonExecute(
        `update bugflow.jira_connections set state='reauthorization_required',refresh_lease_until=null,last_error='Atlassian no longer accepts the saved authorization.',updated_at=now() where ${live} and token_generation=$2`,
        [connectionId, generation],
      );
    },
  };
}

/** A usable access token for the connection, refreshing it first when it is about to expire. */
export async function jiraAccessToken(connectionId: string, rejectedGeneration?: number) {
  const { config } = jiraEnv();
  if (!config) throw new JiraAuthError("not_connected");
  return freshAccessToken(tokenStore(connectionId), refreshCall(config), { rejectedGeneration });
}

/** One Jira REST call as the connection, with a single refresh-and-retry when Jira rejects the token. */
export async function jiraFetch(
  connection: { id: string; cloudId: string },
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  const first = await jiraAccessToken(connection.id);
  try {
    return await jiraCall(connection.cloudId, first.token, path, init);
  } catch (error) {
    if (!(error instanceof JiraApiError) || error.kind !== "auth") throw error;
    const second = await jiraAccessToken(connection.id, first.generation);
    return jiraCall(connection.cloudId, second.token, path, init);
  }
}

/** Starts the Atlassian sign-in for the signed-in Admin and returns the address to send the browser to. */
export async function startJiraConnect(): Promise<{ url: string }> {
  checkOrigin();
  await requireAdmin();
  const { config, missing } = jiraEnv();
  if (!config) throw new Error(`Jira is not set up on this server yet (${missing.join(", ")}).`);
  const request = getRequest();
  // Atlassian sends the browser back to the public address; the Admin session cookie only exists there.
  const here = request.headers.get("origin") ?? new URL(request.url).origin;
  if (here !== config.origin)
    throw new Error(
      `Open Bug Board at ${config.origin} to connect Jira. Atlassian returns there after sign-in.`,
    );
  const session = await adminSessionFromRequest(request);
  if (!session) throw new Error(ADMIN_EXPIRED);
  const { rows } = await neonQuery(
    `select 1 from bugflow.jira_connections where disconnected_at is null limit 1`,
  );
  const state = randomToken();
  await neonExecute([
    { query: `delete from bugflow.jira_oauth_states where expires_at<now()-interval '1 day'` },
    {
      query: `insert into bugflow.jira_oauth_states(state_hash,admin_session_hash,admin_user_id,purpose,redirect_uri,expires_at) values($1,$2,$3,$4,$5,now()+make_interval(mins=>$6))`,
      params: [
        await hashToken(state),
        session.sessionHash,
        session.userId,
        rows.length ? "reconnect" : "connect",
        config.redirectUri,
        JIRA_STATE_TTL_MINUTES,
      ],
    },
  ]);
  return {
    url: authorizeUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state }),
  };
}

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });

/**
 * GET /api/integrations/jira/callback — where Atlassian returns the Admin's browser. Runs outside the Start
 * runtime, so the Admin session is read from the request itself. Nothing is stored unless the one-time state
 * belongs to this Admin session, the code exchanges, the site is allowed and a live read from Jira succeeds.
 */
export async function handleJiraCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const back = (outcome: JiraCallbackOutcome) => redirect(`${JIRA_SETTINGS_PATH}?jira=${outcome}`);
  try {
    const session = await adminSessionFromRequest(request);
    if (!session) return redirect(`/login?redirect=${encodeURIComponent(JIRA_SETTINGS_PATH)}`);
    const { config } = jiraEnv();
    if (!config) return back("unavailable");
    const state = url.searchParams.get("state") ?? "";
    if (!/^[a-f0-9]{64}$/.test(state)) return back("state_invalid");
    // One statement claims the state: unused, unexpired and created by this very Admin session.
    const { rows: claimed } = await neonExecute(
      `update bugflow.jira_oauth_states set used_at=now() where state_hash=$1 and used_at is null and expires_at>now() and admin_session_hash=$2 returning redirect_uri`,
      [await hashToken(state), session.sessionHash],
    );
    const claim = claimed[0];
    if (!claim) return back("state_invalid");
    if (url.searchParams.get("error")) return back("denied");
    const code = url.searchParams.get("code") ?? "";
    if (!code || code.length > 4000) return back("exchange_failed");

    const exchanged = await tokenRequest({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: String(claim["redirect_uri"]),
    });
    if (exchanged.status !== 200) {
      console.error(`Jira code exchange failed: HTTP ${exchanged.status}`);
      return back("exchange_failed");
    }
    const tokens = toTokenSet(exchanged.json);
    if (!tokens) {
      const hasAccess = !!(exchanged.json as { access_token?: unknown } | null)?.access_token;
      return back(hasAccess ? "no_refresh_token" : "exchange_failed");
    }

    const reachable = await accessibleSites(tokens.accessToken);
    if (!reachable.length) return back("no_site");
    const sites = reachable.filter((s) => siteAllowed(s.url, config.allowedSite));
    if (!sites.length) return back("site_not_allowed");

    const { rows: liveRows } = await neonQuery(
      `select id,cloud_id from bugflow.jira_connections where disconnected_at is null limit 1`,
    );
    const live = liveRows[0];
    const liveCloud = live?.["cloud_id"] ? String(live["cloud_id"]) : null;
    let site: JiraSite | null;
    if (liveCloud) {
      // Reconnecting keeps mappings and links, so it must be the same Jira site.
      site = sites.find((s) => s.id === liveCloud) ?? null;
      if (!site) return back("site_mismatch");
    } else site = sites.length === 1 ? (sites[0] ?? null) : null; // several sites: the Admin chooses, never a guess
    const account = site ? await myself(site.id, tokens.accessToken) : null;

    const id = live ? String(live["id"]) : crypto.randomUUID();
    const values = [
      id,
      site?.id ?? null,
      site?.url ?? null,
      site?.name ?? null,
      account?.accountId ?? null,
      account?.displayName ?? null,
      await sealToken(tokens.accessToken, id, "access"),
      await sealToken(tokens.refreshToken, id, "refresh"),
      JIRA_KEY_VERSION,
      new Date(tokens.expiresAt).toISOString(),
      grantedScopes(exchanged.json),
      site ? "connected" : "pending_site",
    ];
    const statement = live
      ? audited(
          // A paused connection stays paused: signing in again must not quietly resume syncing.
          `update bugflow.jira_connections set cloud_id=$2,site_url=$3,site_name=$4,authorized_account_id=$5,authorized_display_name=$6,access_token_ciphertext=$7,refresh_token_ciphertext=$8,token_key_version=$9,access_expires_at=$10::timestamptz,scopes=$11::text[],state=case when state='paused' and $12::text='connected' then 'paused' else $12::text end,token_generation=token_generation+1,refresh_lease_until=null,last_error=null,last_api_ok_at=case when $12::text='connected' then now() else last_api_ok_at end,updated_at=now() where id=$1 and disconnected_at is null returning id`,
          values,
          {
            actorId: session.userId,
            action: site ? "jira.reconnected" : "jira.site_pending",
            detail: { site: site?.name ?? null, url: site?.url ?? null },
          },
        )
      : audited(
          `insert into bugflow.jira_connections(id,cloud_id,site_url,site_name,authorized_account_id,authorized_display_name,access_token_ciphertext,refresh_token_ciphertext,token_key_version,access_expires_at,scopes,state,created_by,last_api_ok_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::text[],$12::text,$13,case when $12::text='connected' then now() end) returning id`,
          [...values, session.userId],
          {
            actorId: session.userId,
            action: site ? "jira.connected" : "jira.site_pending",
            detail: { site: site?.name ?? null, url: site?.url ?? null },
          },
        );
    const { rows: saved } = await neonExecute(statement.query, statement.params);
    if (!saved.length) return back("failed");
    return back(site ? "connected" : "choose_site");
  } catch (error) {
    // Messages only: error objects can carry response bodies.
    console.error(
      "Jira callback failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    );
    return back(error instanceof JiraApiError ? "verify_failed" : "failed");
  }
}
