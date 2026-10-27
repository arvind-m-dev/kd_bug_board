/** Settings → System health: live checks of everything the workspace depends on. Never contains a secret. */
export type HealthState = "ok" | "warn" | "fail" | "off";
export type HealthCheck = {
  key: string;
  label: string;
  state: HealthState;
  /** One line: what was measured, in plain words. */
  summary: string;
  /** Extra facts shown under the summary (counts, sizes, versions). */
  facts: { label: string; value: string }[];
  /** What to do when the state is not ok. */
  action?: string;
  ms?: number;
  /** Space used against a plan limit, when the service has one. */
  meter?: UsageMeter;
};
export type UsageMeter = {
  usedBytes: number;
  /** null = no known limit (only the used amount is shown). */
  limitBytes: number | null;
  /** Where the limit comes from, e.g. "Neon Free plan · 1 GB per project". */
  limitLabel: string;
};
/** Above WARN_AT the meter turns amber; at ALARM_AT it turns red and the Admin panel shows an alarm. */
export const WARN_AT = 0.75;
export const ALARM_AT = 0.9;
export function usageLevel(m: Pick<UsageMeter, "usedBytes" | "limitBytes">): HealthState {
  if (!m.limitBytes) return "ok";
  const share = m.usedBytes / m.limitBytes;
  return share >= ALARM_AT ? "fail" : share >= WARN_AT ? "warn" : "ok";
}
/** The worse of two states (off counts as ok). */
export const worse = (a: HealthState, b: HealthState): HealthState =>
  a === "fail" || b === "fail" ? "fail" : a === "warn" || b === "warn" ? "warn" : a;
/** Admin banner: storage that is close to (or over) its limit. */
export type StorageAlarm = {
  key: "database" | "storage";
  label: string;
  level: "warn" | "fail";
  usedBytes: number;
  limitBytes: number;
};
export type SystemHealth = { checkedAt: string; overall: HealthState; checks: HealthCheck[] };

/** The worst state wins; optional services that are switched off ("off") never make the whole system unhealthy. */
export function overallState(checks: Pick<HealthCheck, "state">[]): HealthState {
  if (checks.some((c) => c.state === "fail")) return "fail";
  if (checks.some((c) => c.state === "warn")) return "warn";
  return "ok";
}
export const HEALTH_LABEL: Record<HealthState, string> = {
  ok: "Healthy",
  warn: "Needs attention",
  fail: "Down",
  off: "Not set up",
};
