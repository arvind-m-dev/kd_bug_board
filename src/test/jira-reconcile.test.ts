import { describe, expect, it } from "vitest";
import { JiraApiError } from "@/lib/jira/errors";
import {
  MAX_PAGES,
  OVERLAP_MS,
  type ReconcileJira,
  type ReconcileStore,
  type ScanTarget,
  type Seen,
  type WebhookState,
  WEBHOOK_RENEW_BEFORE_MS,
  reconcile,
  scanJql,
  webhookJql,
} from "@/lib/jira/reconcile";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const target = (over: Partial<ScanTarget> = {}): ScanTarget => ({
  mappingId: "map-1",
  connectionId: "conn-1",
  cloudId: "cloud",
  jiraProjectId: "10000",
  issueTypeId: "10004",
  cursorMs: NOW - 30 * 60_000,
  fullCheckDue: false,
  ...over,
});
const hook = (over: Partial<WebhookState> = {}): WebhookState => ({
  connectionId: "conn-1",
  cloudId: "cloud",
  projectIds: ["10000"],
  sprints: false,
  webhooks: [],
  expiresAtMs: null,
  ...over,
});
const seen = (n: number, at = NOW - 60_000): Seen => ({
  id: String(20000 + n),
  key: `BFT-${n}`,
  updatedAt: new Date(at + n).toISOString(),
});

function setup(targets: ScanTarget[], hooks: WebhookState[] = [], pages: Seen[][] = [[]]) {
  const log: string[] = [];
  const saved: Record<string, unknown>[] = [];
  const store: ReconcileStore = {
    targets: async () => targets,
    queueSeen: async (_t, issues) => (log.push(`seen:${issues.length}`), issues.length),
    queueLocalDrift: async () => (log.push("drift"), 2),
    queueStaleLinks: async (_t, limit) => (log.push(`stale:${limit}`), 3),
    saveScan: async (t, cursorIso, fullCheckDone) =>
      void saved.push({ mapping: t.mappingId, cursorIso, fullCheckDone }),
    connections: async () => hooks,
    saveWebhooks: async (id, webhooks, expiresIso, problem) =>
      void saved.push({ connection: id, webhooks, expiresIso, problem }),
    touch: async (id) => void log.push(`touch:${id}`),
  };
  const calls: string[] = [];
  let page = 0;
  const jira: ReconcileJira = {
    search: async (jql, token) => {
      calls.push(`search:${token ?? "first"}:${jql}`);
      const issues = pages[page] ?? [];
      page++;
      return { issues, nextPageToken: page < pages.length ? `p${page}` : null };
    },
    registerWebhook: async (url, jql, events) => (
      calls.push(`register:${url}:${jql}:${events.length}`),
      [1001]
    ),
    refreshWebhooks: async (ids) => (
      calls.push(`refresh:${ids}`),
      new Date(NOW + 30 * 86_400_000).toISOString()
    ),
    deleteWebhooks: async (ids) => void calls.push(`delete:${ids}`),
  };
  const run = (origin = "https://bugs.example.test") =>
    reconcile({
      store,
      jira: () => jira,
      origin,
      issueEvents: ["jira:issue_created", "jira:issue_updated", "jira:issue_deleted"],
      sprintEvents: ["sprint_closed"],
      now: () => NOW,
    });
  return { run, log, saved, calls, jira };
}

describe("asking Jira what changed", () => {
  it("asks in minutes back from now, so nobody's time zone matters, and re-reads an overlap", async () => {
    expect(scanJql(target(), NOW - 30 * 60_000, NOW)).toBe(
      'project = 10000 AND issuetype = 10004 AND updated >= "-30m" ORDER BY updated ASC',
    );
    const { run, calls } = setup([target()]);
    await run();
    expect(calls[0]).toContain(`updated >= "-${30 + OVERLAP_MS / 60_000}m"`);
  });

  it("queues what it saw, looks for missed BugFlow changes, and moves the cursor to when the scan began", async () => {
    const { run, log, saved } = setup([target()], [], [[seen(1), seen(2)]]);
    expect(await run()).toMatchObject({
      mappings: 1,
      seen: 2,
      fromJira: 2,
      fromBugFlow: 2,
      linkChecks: 0,
      failed: 0,
    });
    expect(log).toEqual(["seen:2", "drift"]);
    expect(saved).toEqual([
      { mapping: "map-1", cursorIso: new Date(NOW).toISOString(), fullCheckDone: false },
    ]);
  });

  it("stops after a bounded number of pages and continues next run from the newest change it read", async () => {
    const pages = Array.from({ length: MAX_PAGES + 2 }, (_, i) => [seen(i)]);
    const { run, calls, saved } = setup([target()], [], pages);
    expect((await run()).seen).toBe(MAX_PAGES);
    expect(calls.filter((c) => c.startsWith("search"))).toHaveLength(MAX_PAGES);
    expect(saved[0]!["cursorIso"]).toBe(seen(MAX_PAGES - 1).updatedAt);
  });

  it("checks old links once a day, a bounded number at a time", async () => {
    const { run, log, saved } = setup([target({ fullCheckDue: true })]);
    expect((await run()).linkChecks).toBe(3);
    expect(log).toContain("stale:200");
    expect(saved[0]).toMatchObject({ fullCheckDone: true });
  });

  it("leaves the cursor alone when Jira fails, and stops the run on a rate limit", async () => {
    const { run, saved, jira } = setup([target(), target({ mappingId: "map-2" })]);
    jira.search = async () => {
      throw new JiraApiError("rate_limited", 429, 60_000);
    };
    expect(await run()).toMatchObject({ mappings: 1, failed: 1 });
    expect(saved).toEqual([]);
  });
});

describe("keeping Jira's notifications registered", () => {
  it("registers for the mapped projects on https, and only then", async () => {
    expect(webhookJql(["10002", "10000"])).toBe("project in (10000, 10002)");
    const a = setup([], [hook()]);
    expect((await a.run()).webhooks).toEqual(["registered"]);
    expect(a.calls).toEqual([
      "register:https://bugs.example.test/api/integrations/jira/webhook/conn-1:project in (10000):3",
    ]);
    expect(a.saved[0]).toMatchObject({
      webhooks: [{ id: 1001, jql: "project in (10000)" }],
      problem: null,
    });

    const local = setup([], [hook()]);
    expect((await local.run("http://localhost:8081")).webhooks).toEqual(["not_https"]);
    expect(local.calls).toEqual([]);
  });

  it("renews before expiry, leaves a fresh one alone, and re-registers when the projects changed", async () => {
    const current = [{ id: 7, jql: "project in (10000)" }];
    const fresh = setup(
      [],
      [hook({ webhooks: current, expiresAtMs: NOW + WEBHOOK_RENEW_BEFORE_MS + 60_000 })],
    );
    expect((await fresh.run()).webhooks).toEqual(["current"]);
    expect(fresh.calls).toEqual([]);

    const due = setup([], [hook({ webhooks: current, expiresAtMs: NOW + 86_400_000 })]);
    expect((await due.run()).webhooks).toEqual(["renewed"]);
    expect(due.calls).toEqual(["refresh:7"]);

    const changed = setup(
      [],
      [
        hook({
          webhooks: current,
          expiresAtMs: NOW + 20 * 86_400_000,
          projectIds: ["10000", "10002"],
          sprints: true,
        }),
      ],
    );
    expect((await changed.run()).webhooks).toEqual(["registered"]);
    expect(changed.calls).toEqual([
      "delete:7",
      "register:https://bugs.example.test/api/integrations/jira/webhook/conn-1:project in (10000, 10002):4",
    ]);
  });

  it("removes the registration when nothing is mapped, and records a failure without stopping the sync", async () => {
    const none = setup([], [hook({ projectIds: [], webhooks: [{ id: 7, jql: "x" }] })]);
    expect((await none.run()).webhooks).toEqual(["none_needed"]);
    expect(none.calls).toEqual(["delete:7"]);

    const broken = setup([target()], [hook()]);
    broken.jira.registerWebhook = async () => {
      throw new JiraApiError("forbidden", 403);
    };
    expect(await broken.run()).toMatchObject({ webhooks: ["failed"], failed: 0, mappings: 1 });
    expect(broken.saved.at(-1)!["problem"]).toMatch(/regular check/);
    expect(broken.log).toContain("touch:conn-1");
  });
});
