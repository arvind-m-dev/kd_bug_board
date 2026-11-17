import { SYNC_FIELDS, type SyncField, type SyncFields } from "./types";

// The three-way comparison. For every field there are four values: what BugFlow and Jira hold now, and what
// each held when they last agreed (the two snapshots on the link). Nothing here is "newest wins".

export type Direction = "both" | "out";
export type Decision =
  | "none" // nothing to do
  | "push" // only BugFlow changed: send to Jira
  | "pull" // only Jira changed: apply to BugFlow
  | "ack" // both hold the same value now: just remember it
  | "conflict"; // both changed, differently

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function decide(
  baseLocal: unknown,
  baseRemote: unknown,
  local: unknown,
  remote: unknown,
  direction: Direction,
): Decision {
  const localChanged = !same(local, baseLocal);
  const remoteChanged = !same(remote, baseRemote);
  if (same(local, remote)) return localChanged || remoteChanged ? "ack" : "none";
  if (direction === "out") return localChanged ? "push" : "none"; // BugFlow owns the field; Jira's edit is not taken
  if (localChanged && remoteChanged) return "conflict";
  if (localChanged) return "push";
  return remoteChanged ? "pull" : "none";
}

export type SyncPlan = Record<Exclude<Decision, "none">, SyncField[]>;

export function planSync(
  baseLocal: SyncFields,
  baseRemote: SyncFields,
  local: SyncFields,
  remote: SyncFields,
  directions: Record<SyncField, Direction>,
): SyncPlan {
  const plan: SyncPlan = { push: [], pull: [], ack: [], conflict: [] };
  for (const f of SYNC_FIELDS) {
    const d = decide(baseLocal[f], baseRemote[f], local[f], remote[f], directions[f]);
    if (d !== "none") plan[d].push(f);
  }
  return plan;
}
