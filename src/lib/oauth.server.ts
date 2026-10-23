import { neonQuery, neonExecute } from './neon.server';
import { hashToken, randomToken, equalSecret } from './portal-access';
import { formatAiToken } from './ai-tokens';

/**
 * OAuth 2.1 (authorization code + PKCE S256) for the MCP endpoint, so connectors that cannot paste a token
 * (claude.ai, ChatGPT) can sign in. Clients register themselves; the user approves on a consent page by signing in
 * as Admin or with a member portal link; the issued access token is an ordinary AI token (scoped per panel, revocable).
 */
const CODE_TTL_MS = 5 * 60_000;
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(value: string) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }

export function authServerMetadata(origin: string) {
  return {
    issuer: origin, authorization_endpoint: `${origin}/api/oauth/authorize`, token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['bugflow'],
  };
}
export function protectedResourceMetadata(origin: string) {
  return { resource: `${origin}/api/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'], scopes_supported: ['bugflow'] };
}

/** Dynamic Client Registration: store the client's redirect URIs and give it a public client_id (no secret; PKCE protects it). */
export async function registerClient(body: { redirect_uris?: unknown; client_name?: unknown }) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10) : [];
  if (!uris.length) throw new Error('redirect_uris is required.');
  const clientId = `bf_${randomToken().slice(0, 32)}`; const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : '';
  await neonExecute(`insert into bugflow.oauth_clients(id,client_id,name,redirect_uris) values($1,$2,$3,$4::jsonb)`, [crypto.randomUUID(), clientId, name, JSON.stringify(uris)]);
  return { client_id: clientId, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] };
}

async function clientRedirect(clientId: string, redirectUri: string) {
  const { rows } = await neonQuery(`select name,redirect_uris from bugflow.oauth_clients where client_id=$1 limit 1`, [clientId]);
  const r = rows[0]; if (!r) throw new Error('Unknown client.');
  const uris = Array.isArray(r['redirect_uris']) ? (r['redirect_uris'] as unknown[]).map(String) : [];
  if (!uris.includes(redirectUri)) throw new Error('redirect_uri does not match this client.');
  return { name: String(r['name'] ?? '') };
}
/** Validates the authorize request before the consent page is shown; throws for anything a user should not approve. */
export async function validateAuthorize(p: { clientId: string; redirectUri: string; codeChallenge: string; method: string; responseType: string }) {
  if (p.responseType !== 'code') throw new Error('Only response_type=code is supported.');
  if (p.method !== 'S256') throw new Error('PKCE S256 is required.');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(p.codeChallenge)) throw new Error('Invalid code_challenge.');
  return clientRedirect(p.clientId, p.redirectUri);
}

const findAdminPortal = async () => (await neonQuery(`select id from bugflow.portals where type='admin' and active and revoked_at is null limit 1`)).rows[0]?.['id'] as string | undefined;
const findMemberPortal = async (token: string, type: string) => (await neonQuery(`select p.id from bugflow.portals p join bugflow.users u on u.id=p.user_id where p.token_hash=$1 and p.type=$2 and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) limit 1`, [await hashToken(token), type])).rows[0]?.['id'] as string | undefined;

/** The user signed in and approved: check the credentials, bind an auth code to their panel, return it for the redirect. */
export async function approveAuthorize(p: { clientId: string; redirectUri: string; codeChallenge: string; method: string; responseType: string; login: { kind: 'admin'; email: string; password: string } | { kind: 'portal'; token: string; type: string }; clientName: string }) {
  await validateAuthorize(p);
  let portalId: string | undefined; let label: string;
  if (p.login.kind === 'admin') {
    const password = process.env['BUGFLOW_ADMIN_PASSWORD']; const email = process.env['BUGFLOW_ADMIN_EMAIL'];
    if (!password || !email || !(await equalSecret(p.login.password, password)) || !(await equalSecret(p.login.email.toLowerCase(), email.toLowerCase()))) throw new Error('Incorrect email or password.');
    portalId = await findAdminPortal(); label = `OAuth · ${p.clientName || 'AI client'} · Admin`;
  } else {
    if (!/^[a-f0-9]{64}$/.test(p.login.token) || !['reporter', 'qa', 'developer', 'member'].includes(p.login.type)) throw new Error('Paste a valid portal link.');
    portalId = await findMemberPortal(p.login.token, p.login.type); label = `OAuth · ${p.clientName || 'AI client'} · ${p.login.type}`;
  }
  if (!portalId) throw new Error('That panel is not available.');
  const code = randomToken();
  await neonExecute(`insert into bugflow.oauth_codes(code_hash,client_id,redirect_uri,code_challenge,portal_id,label,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')`, [await sha256(code), p.clientId, p.redirectUri, p.codeChallenge, portalId, label.slice(0, 60)]);
  return { code };
}

/** Token endpoint: verify the code and PKCE, mint an AI token as the access token, and burn the code. */
export async function exchangeCode(p: { code: string; redirectUri: string; clientId: string; codeVerifier: string }) {
  if (!p.code || !p.codeVerifier) throw new Error('invalid_request');
  const hash = await sha256(p.code);
  const { rows } = await neonExecute(`update bugflow.oauth_codes set used_at=now() where code_hash=$1 and used_at is null and expires_at>now() and client_id=$2 and redirect_uri=$3 returning portal_id,code_challenge,label`, [hash, p.clientId, p.redirectUri]);
  const r = rows[0]; if (!r) throw new Error('invalid_grant');
  if (await sha256(p.codeVerifier) !== String(r['code_challenge'])) throw new Error('invalid_grant');
  const secret = randomToken();
  await neonExecute(`insert into bugflow.ai_tokens(id,portal_id,token_hash,label) values($1,$2,$3,$4)`, [crypto.randomUUID(), String(r['portal_id']), await hashToken(secret), String(r['label'] ?? 'OAuth')]);
  return { access_token: formatAiToken(secret), token_type: 'Bearer', scope: 'bugflow' };
}

/** Best-effort cleanup of expired codes; called from the token path. */
export async function sweepOauthCodes() { await neonExecute(`delete from bugflow.oauth_codes where expires_at<now()-interval '1 hour'`).catch(() => undefined); }
