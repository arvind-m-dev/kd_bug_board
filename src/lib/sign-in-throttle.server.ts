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
  if (failures.size > 5000) failures.clear();
  failures.set(key, [...recent(key), Date.now()]);
}
export function clearSignInFailures(key: string) {
  failures.delete(key);
}
