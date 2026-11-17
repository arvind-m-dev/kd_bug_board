import { z } from "zod";

// Pure rules for the Atlassian OAuth 2.0 (3LO) connection: addresses, scopes and response shapes. No I/O here.
// Verified against Atlassian's "OAuth 2.0 (3LO) apps" guide (2026-11): code grant with `state`; PKCE is not part of
// the documented flow, so the client secret stays on the server and `state` is bound to the Admin session instead.

export const JIRA_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
export const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const JIRA_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
export const JIRA_API_BASE = "https://api.atlassian.com/ex/jira";
export const JIRA_CALLBACK_PATH = "/api/integrations/jira/callback";
export const JIRA_SETTINGS_PATH = "/admin/settings/jira";
/** How long an Admin has to finish the Atlassian sign-in after pressing Connect. */
export const JIRA_STATE_TTL_MINUTES = 10;

/**
 * Scopes for the whole sync. `offline_access` yields the rotating refresh token. Sprints and estimates travel in
 * the issue's own Sprint and story-points fields, so no Jira Software scope is needed.
 */
export const JIRA_SCOPES = [
  "read:jira-work",
  "write:jira-work",
  "manage:jira-webhook",
  "read:jira-user",
  "offline_access",
] as const;

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
/** The app's public origin for callbacks and webhooks: https always; plain http only on this computer. */
export function publicOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.test(u.hostname)))
      return u.origin;
  } catch {
    return null;
  }
  return null;
}
export const callbackUrl = (origin: string) => `${origin}${JIRA_CALLBACK_PATH}`;

export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const u = new URL(JIRA_AUTHORIZE_URL);
  u.searchParams.set("audience", "api.atlassian.com");
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("scope", (input.scopes ?? JIRA_SCOPES).join(" "));
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("state", input.state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

/** A token response is only usable with a refresh token: without one the connection dies when the access token does. */
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const cloudIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const resourcesSchema = z.array(
  z.object({
    id: cloudIdSchema,
    url: z.string().url(),
    name: z.string(),
    scopes: z.array(z.string()).default([]),
  }),
);
export type JiraSite = { id: string; url: string; name: string };

/** The sites this authorization can reach with Jira scopes (an account may also hold Confluence-only grants). */
export function jiraSites(resources: z.infer<typeof resourcesSchema>): JiraSite[] {
  return resources
    .filter((r) => r.scopes.includes("read:jira-work"))
    .map((r) => ({ id: r.id, url: r.url, name: r.name }));
}

/**
 * Optional guard (JIRA_ALLOWED_SITE_URL): when set, only that Jira site may be connected, so a trial can never be
 * pointed at another site the same Atlassian account can reach. Unset means any site the Admin chooses.
 */
export function siteAllowed(siteUrl: string, allowed: string | null): boolean {
  if (!allowed) return true;
  try {
    return new URL(siteUrl).origin === new URL(allowed).origin;
  } catch {
    return false;
  }
}

/** Outcome codes the callback hands back to the settings page (never Atlassian's own error text). */
export const JIRA_CALLBACK_OUTCOMES = {
  connected: "Jira is connected.",
  choose_site: "Choose which Jira site to connect.",
  denied: "The Atlassian sign-in was cancelled, so nothing was connected.",
  state_invalid:
    "That sign-in link expired or was already used. Press Connect to start again from this browser.",
  exchange_failed:
    "Atlassian did not accept the sign-in. Check the app's client ID, secret and callback URL.",
  no_refresh_token:
    "Atlassian returned no refresh token. Add the offline_access scope to the app and connect again.",
  no_site: "This Atlassian account gave the app no Jira site. Choose a site on the consent screen.",
  site_not_allowed:
    "That Jira site is not the one allowed for this workspace (JIRA_ALLOWED_SITE_URL).",
  site_mismatch:
    "This account cannot reach the Jira site that is already connected. Disconnect first to connect a different site.",
  verify_failed:
    "The sign-in worked but a test read from Jira failed, so nothing was saved. Try again.",
  unavailable: "Jira is not configured on this server.",
  failed: "The connection could not be saved. Try again.",
} as const;
export type JiraCallbackOutcome = keyof typeof JIRA_CALLBACK_OUTCOMES;
export const isCallbackOutcome = (v: unknown): v is JiraCallbackOutcome =>
  typeof v === "string" && v in JIRA_CALLBACK_OUTCOMES;
