import { JiraApiError } from "./errors";

// Reconciliation: webhooks only make things fast; this is what makes them unnecessary for correctness. Each
// run asks Jira what changed since the last run (with an overlap, because Jira's search trails its writes and
// clocks race), looks for BugFlow changes whose outbox entry never ran, re-checks links nobody has looked at
// for a day, and keeps the webhook registration alive. It only ever queues work; the processors do it.
// Written against small interfaces so it runs in tests against fakes.

/** Re-read this much before the cursor every time. Duplicates are dropped by the inbox's dedup key. */
export const OVERLAP_MS = 10 * 60_000;
/** Never ask further back than this in one scan; the daily link check covers anything older. */
export const MAX_WINDOW_MS = 30 * 24 * 3_600_000;
export const MAX_PAGES = 5;
export const STALE_LINKS_PER_RUN = 200;
const DAY = 24 * 3_600_000;
export const WEBHOOK_LIFETIME_MS = 30 * DAY;
export const WEBHOOK_RENEW_BEFORE_MS = 7 * DAY;

export type Seen = { id: string; key: string; updatedAt: string };
export type ScanTarget = {
  mappingId: string;
  connectionId: string;
  cloudId: string;
  jiraProjectId: string;
  issueTypeId: string;
  /** Everything changed before this was already seen. */
  cursorMs: number;
  fullCheckDue: boolean;
};
export type WebhookState = {
  connectionId: string;
  cloudId: string;
  /** Jira projects with a mapping that is switched on. */
  projectIds: string[];
  sprints: boolean;
  webhooks: { id: number; jql: string }[];
  expiresAtMs: number | null;
};

export interface ReconcileJira {
  search(
    jql: string,
    pageToken: string | null,
  ): Promise<{ issues: Seen[]; nextPageToken: string | null }>;
  registerWebhook(url: string, jql: string, events: string[]): Promise<number[]>;
  /** New expiry as an ISO time, or null when Jira did not say. */
  refreshWebhooks(ids: number[]): Promise<string | null>;
  deleteWebhooks(ids: number[]): Promise<void>;
}
export interface ReconcileStore {
  targets(): Promise<ScanTarget[]>;
  /** Queues an inbox event for each issue that is unknown or newer than its link. Returns how many. */
  queueSeen(target: ScanTarget, issues: Seen[]): Promise<number>;
  /** Queues an outbox entry for each linked bug that changed after its last sync. Returns how many. */
  queueLocalDrift(target: ScanTarget): Promise<number>;
  /** Queues a check of links not looked at for a day (finds deleted or moved issues). Returns how many. */
  queueStaleLinks(target: ScanTarget, limit: number): Promise<number>;
  saveScan(target: ScanTarget, cursorIso: string, fullCheckDone: boolean): Promise<void>;
  connections(): Promise<WebhookState[]>;
  saveWebhooks(
    connectionId: string,
    webhooks: { id: number; jql: string }[],
    expiresIso: string | null,
    problem: string | null,
  ): Promise<void>;
  touch(connectionId: string): Promise<void>;
}

/**
 * Issues of the mapped type changed in the last N minutes, oldest first. A relative time is used on purpose:
 * Jira reads absolute times in the connected account's own time zone, a relative one means the same everywhere.
 */
export function scanJql(
  target: Pick<ScanTarget, "jiraProjectId" | "issueTypeId">,
  sinceMs: number,
  nowMs: number,
) {
  const minutes = Math.max(1, Math.ceil((nowMs - sinceMs) / 60_000));
  return `project = ${target.jiraProjectId} AND issuetype = ${target.issueTypeId} AND updated >= "-${minutes}m" ORDER BY updated ASC`;
}
export const webhookJql = (projectIds: string[]) =>
  `project in (${[...projectIds].sort().join(", ")})`;

export type WebhookOutcome =
  "none_needed" | "not_https" | "current" | "renewed" | "registered" | "failed";
export type ReconcileSummary = {
  mappings: number;
  seen: number;
  fromJira: number;
  fromBugFlow: number;
  linkChecks: number;
  webhooks: WebhookOutcome[];
  /** Mappings whose scan failed this run; they are tried again next run from the same place. */
  failed: number;
};

export async function reconcile(deps: {
  store: ReconcileStore;
  jira: (c: { id: string; cloudId: string }) => ReconcileJira;
  /** This app's public address; webhooks are only registered for https. */
  origin: string;
  issueEvents: readonly string[];
  sprintEvents: readonly string[];
  now?: () => number;
  log?: (error: unknown) => void;
}): Promise<ReconcileSummary> {
  const now = deps.now ?? Date.now;
  const summary: ReconcileSummary = {
    mappings: 0,
    seen: 0,
    fromJira: 0,
    fromBugFlow: 0,
    linkChecks: 0,
    webhooks: [],
    failed: 0,
  };
  const touched = new Set<string>();

  for (const target of await deps.store.targets()) {
    summary.mappings++;
    const jira = deps.jira({ id: target.connectionId, cloudId: target.cloudId });
    const started = now();
    try {
      const since = Math.max(target.cursorMs, started - MAX_WINDOW_MS) - OVERLAP_MS;
      const jql = scanJql(target, since, started);
      let token: string | null = null;
      let latest = 0;
      let pages = 0;
      do {
        const page = await jira.search(jql, token);
        summary.seen += page.issues.length;
        summary.fromJira += await deps.store.queueSeen(target, page.issues);
        for (const i of page.issues) latest = Math.max(latest, Date.parse(i.updatedAt) || 0);
        token = page.nextPageToken;
        pages++;
      } while (token && pages < MAX_PAGES);
      summary.fromBugFlow += await deps.store.queueLocalDrift(target);
      let fullCheckDone = false;
      if (target.fullCheckDue) {
        const queued = await deps.store.queueStaleLinks(target, STALE_LINKS_PER_RUN);
        summary.linkChecks += queued;
        fullCheckDone = queued < STALE_LINKS_PER_RUN;
      }
      // Everything read: the next scan starts where this one began. Stopped early (more pages than one run
      // takes): it continues from the newest change it did read.
      const cursor = token ? Math.max(latest, target.cursorMs) : started;
      await deps.store.saveScan(target, new Date(cursor).toISOString(), fullCheckDone);
      touched.add(target.connectionId);
    } catch (error) {
      deps.log?.(error);
      summary.failed++;
      if (error instanceof JiraApiError && (error.kind === "rate_limited" || error.kind === "auth"))
        break;
    }
  }

  for (const c of await deps.store.connections()) {
    const jira = deps.jira({ id: c.connectionId, cloudId: c.cloudId });
    const ids = c.webhooks.map((w) => w.id);
    try {
      if (!c.projectIds.length) {
        if (ids.length) {
          await jira.deleteWebhooks(ids);
          await deps.store.saveWebhooks(c.connectionId, [], null, null);
        }
        summary.webhooks.push("none_needed");
      } else if (!deps.origin.startsWith("https://")) {
        // Jira only delivers to https. Without it (a local trial) the scans above are the whole sync.
        summary.webhooks.push("not_https");
      } else {
        const jql = webhookJql(c.projectIds);
        if (ids.length && c.webhooks.every((w) => w.jql === jql)) {
          if (c.expiresAtMs !== null && c.expiresAtMs - now() > WEBHOOK_RENEW_BEFORE_MS)
            summary.webhooks.push("current");
          else {
            const expires = await jira.refreshWebhooks(ids);
            await deps.store.saveWebhooks(
              c.connectionId,
              c.webhooks,
              expires ?? new Date(now() + WEBHOOK_LIFETIME_MS).toISOString(),
              null,
            );
            summary.webhooks.push("renewed");
          }
        } else {
          if (ids.length) await jira.deleteWebhooks(ids);
          const events = [...deps.issueEvents, ...(c.sprints ? deps.sprintEvents : [])];
          const created = await jira.registerWebhook(
            `${deps.origin}/api/integrations/jira/webhook/${c.connectionId}`,
            jql,
            events,
          );
          await deps.store.saveWebhooks(
            c.connectionId,
            created.map((id) => ({ id, jql })),
            new Date(now() + WEBHOOK_LIFETIME_MS).toISOString(),
            null,
          );
          summary.webhooks.push("registered");
        }
      }
    } catch (error) {
      deps.log?.(error);
      await deps.store.saveWebhooks(
        c.connectionId,
        c.webhooks,
        c.expiresAtMs === null ? null : new Date(c.expiresAtMs).toISOString(),
        "Jira's event notifications could not be set up or renewed. Changes are still picked up by the regular check.",
      );
      summary.webhooks.push("failed");
    }
    if (touched.has(c.connectionId)) await deps.store.touch(c.connectionId);
  }
  return summary;
}
