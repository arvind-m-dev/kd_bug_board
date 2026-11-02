// Admin password attempts per client address: after LIMIT failures within WINDOW_MS, further attempts are refused
// until the window passes. Kept per server instance (no schema change); it slows guessing, it is not a lockout.
const WINDOW_MS = 15 * 60_000;
const LIMIT = 10;
const failures = new Map<string, number[]>();

export const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait 15 minutes and try again.";

/** The client address as the hosting proxy reports it (Vercel sets x-real-ip / x-forwarded-for). */
export function clientKey(headers: Headers) {
  const ip =
    headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return (ip || "unknown").slice(0, 64);
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
