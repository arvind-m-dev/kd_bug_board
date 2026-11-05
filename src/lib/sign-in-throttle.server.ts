// Admin password attempts per client address: after LIMIT failures within WINDOW_MS, further attempts are refused
// until the window passes. Kept per server instance (no schema change); it slows guessing, it is not a lockout.
const WINDOW_MS = 15 * 60_000;
const LIMIT = 10;
const failures = new Map<string, number[]>();

export const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait 15 minutes and try again.";

/**
 * The client address for throttling. Proxy headers are trusted only on Vercel, whose edge overwrites x-real-ip and
 * x-forwarded-for; anywhere else a client could send them to dodge the limit, so the socket address (srvx `ip`) is
 * used instead. Never collapses to one shared key that would lock everyone out.
 */
export function clientKey(request: Request, onVercel = Boolean(process.env["VERCEL"])) {
  const headers = request.headers;
  const proxied = onVercel
    ? (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim())
    : undefined;
  const socket = (request as Request & { ip?: string }).ip;
  return (proxied || socket || "local").slice(0, 64);
}
function recent(key: string, now = Date.now()) {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}
export function assertSignInAllowed(key: string) {
  if (recent(key).length >= LIMIT) throw new Error(TOO_MANY_ATTEMPTS);
}
export function recordSignInFailure(key: string) {
  // Bound memory by dropping the oldest addresses only; clearing everything would reset every attacker's count.
  if (failures.size > 5000) {
    let drop = failures.size - 4000;
    for (const k of failures.keys()) {
      if (drop-- <= 0) break;
      if (k !== key) failures.delete(k);
    }
  }
  failures.set(key, [...recent(key), Date.now()]);
}
/**
 * Checks the limit and counts this attempt before the (async) password comparison, so parallel requests can't all
 * pass the check before any failure is recorded. A successful sign-in then calls `clearSignInFailures`.
 */
export function beginSignInAttempt(key: string) {
  assertSignInAllowed(key);
  recordSignInFailure(key);
}
export function clearSignInFailures(key: string) {
  failures.delete(key);
}
