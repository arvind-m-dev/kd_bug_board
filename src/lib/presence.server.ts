import { neonExecute } from './neon.server';
import { hashToken } from './portal-access';

const TYPES = new Set(['reporter', 'qa', 'developer', 'member']);
/** How long one heartbeat keeps a member online (heartbeats arrive every 30 s; tolerates a missed one or throttled tabs). */
export const ONLINE_FOR_SECONDS = 100;

/**
 * POST /api/presence {token, type, state: 'here' | 'leaving'} from an open member portal.
 * A plain endpoint (not a server function) so the browser can still send it while the tab is closing.
 */
export async function handlePresence(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  let body: { token?: unknown; type?: unknown; state?: unknown };
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400 }); }
  const { token, type, state } = body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof type !== 'string' || !TYPES.has(type) || (state !== 'here' && state !== 'leaving')) return new Response(null, { status: 400 });
  const until = state === 'here' ? `now()+interval '${ONLINE_FOR_SECONDS} seconds'` : 'now()';
  await neonExecute(`update bugflow.portals p set online_until=${until}${state === 'here' ? ', last_seen_at=now()' : ''} from bugflow.users u
    where u.id=p.user_id and p.token_hash=$1 and p.type=$2 and p.active and u.active and u.deleted_at is null and p.revoked_at is null and (p.expires_at is null or p.expires_at>now())`, [await hashToken(token), type]).catch(() => undefined);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
