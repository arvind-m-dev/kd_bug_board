import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // Settings the Jira code reads; none of them points at a real service.
  process.env["JIRA_CLIENT_ID"] = "test-client";
  process.env["JIRA_CLIENT_SECRET"] = "test-client-secret";
  process.env["JIRA_TOKEN_ENCRYPTION_KEY"] = "0123456789abcdef".repeat(4);
  process.env["JIRA_PUBLIC_ORIGIN"] = "https://bugs.example.test";
});
vi.mock("@/lib/neon.server", async () => (await import("./local")).neon);
vi.mock("@/lib/portal-access.server", async () => (await import("./local")).session);
import { neonDirectory, neonInbox } from "@/lib/jira/inbox.server";
import { neonQueue, neonStore } from "@/lib/jira/outbox.server";
import { runInbox, runOutbox } from "@/lib/jira/processor";
import { type ReconcileJira, type Seen, reconcile } from "@/lib/jira/reconcile";
import { neonReconcileStore } from "@/lib/jira/reconcile.server";
import { ISSUE_EVENTS, SPRINT_EVENTS } from "@/lib/jira/webhook";
import { handleJiraWebhook } from "@/lib/jira/webhook.server";
import { CONFIG, FakeJira } from "@/test/jira-fixtures";
import { signed } from "@/test/jira-jwt";
import { change, create } from "./common";
import { CONN, MAP, pool, q, seed } from "./local";

const jira = new FakeJira();
const deps = { store: neonStore, jira: () => jira };
const work = async () => ({
  inbox: await runInbox({
    queue: neonInbox,
    directory: neonDirectory,
    owner: crypto.randomUUID(),
    ...deps,
  }),
  outbox: await runOutbox({ queue: neonQueue, owner: crypto.randomUUID(), ...deps }),
});
const iso = (v: unknown) =>
  new Date(String(v).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString();
const registered: string[] = [];
/** Jira's search, answered from the fake's issues, oldest change first. */
const search: ReconcileJira = {
  search: async () => ({
    issues: [...jira.issues.values()].map((i): Seen => ({
      id: i.id,
      key: i.key,
      updatedAt: iso(i.fields["updated"]),
    })),
    nextPageToken: null,
  }),
  registerWebhook: async (url, jql) => (registered.push(`${url} ${jql}`), [5001]),
  refreshWebhooks: async () => null,
  deleteWebhooks: async () => undefined,
};
const scan = (origin = "https://bugs.example.test") =>
  reconcile({
    store: neonReconcileStore,
    jira: () => search,
    origin,
    issueEvents: ISSUE_EVENTS,
    sprintEvents: SPRINT_EVENTS,
  });
const touch = (issueId: string, minutes: number) => {
  jira.raw(issueId).fields["updated"] = new Date(
    Date.parse("2026-11-06T10:00:00+05:30") + minutes * 60_000,
  ).toISOString();
};
const post = async (body: unknown, headers: Record<string, string> = {}, connection = CONN) =>
  handleJiraWebhook(
    new Request(`https://bugs.example.test/api/integrations/jira/webhook/${connection}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signed({}, "test-client-secret")}`,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    connection,
  );
const inboxRows = () =>
  q(
    "select dedup_key,event_type,source,jira_issue_id,envelope,state from bugflow.jira_inbox order by received_at",
  );

beforeAll(() => seed(true, CONFIG));
afterAll(() => pool.end());

describe("the webhook receiver", () => {
  const event = {
    webhookEvent: "jira:issue_updated",
    timestamp: 1_800_000_000_000,
    issue: {
      id: "29001",
      key: "BFT-901",
      fields: { project: { id: "10000" }, summary: "Private text" },
    },
    user: { accountId: "acc-1", displayName: "Jordan" },
  };

  it("refuses a caller without Atlassian's signed token, whatever cookies it has", async () => {
    expect((await post(event, { authorization: "" })).status).toBe(401);
    expect(
      (await post(event, { authorization: `Bearer ${await signed({}, "wrong-secret")}` })).status,
    ).toBe(401);
    expect(
      (await post(event, { authorization: "", cookie: "bugflow_admin=anything" })).status,
    ).toBe(401);
    expect(await inboxRows()).toEqual([]);
  });

  it("stores a small envelope once and answers at once", async () => {
    const first = await post(event, { "x-atlassian-webhook-identifier": "delivery-1" });
    expect([first.status, await first.json()]).toEqual([200, { ok: true, kept: true }]);
    const retry = await post(event, {
      "x-atlassian-webhook-identifier": "delivery-1",
      "x-atlassian-webhook-retry": "1",
    });
    expect(await retry.json()).toEqual({ ok: true, kept: false });
    expect(await inboxRows()).toEqual([
      {
        dedup_key: "wh:delivery-1",
        event_type: "jira:issue_updated",
        source: "webhook",
        jira_issue_id: "29001",
        envelope: { projectId: "10000", actor: { accountId: "acc-1", displayName: "Jordan" } },
        state: "pending",
      },
    ]);
    expect(
      (await q("select last_event_at from bugflow.jira_connections where id=$1", [CONN]))[0]![
        "last_event_at"
      ],
    ).not.toBeNull();
  });

  it("refuses what is not a webhook, too large, or for a connection that does not exist", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ webhookEvent: "jira:issue_updated" })).status).toBe(400);
    expect((await post(event, { "content-length": "5000000" })).status).toBe(413);
    expect((await post(event, {}, "cccccccc-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect((await post(event, {}, "not-a-uuid")).status).toBe(404);
    expect(
      await (await post({ webhookEvent: "comment_created", issue: event.issue })).json(),
    ).toEqual({ ok: true, kept: false });
    expect(await inboxRows()).toHaveLength(1);
    await work(); // the stored event names an issue that does not exist: it is settled as gone
    expect((await inboxRows())[0]!["state"]).toBe("done");
  });
});

describe("reconciliation", () => {
  let id = "";
  let issueId = "";

  it("finds nothing to do when both sides agree, and registers Jira's notifications on https", async () => {
    id = await create();
    await work();
    issueId = (
      await q("select jira_issue_id from bugflow.jira_issue_links where bug_id=$1", [id])
    )[0]!["jira_issue_id"];
    expect(await scan()).toMatchObject({
      mappings: 1,
      seen: 1,
      fromJira: 0,
      fromBugFlow: 0,
      webhooks: ["registered"],
      failed: 0,
    });
    expect(registered).toEqual([
      `https://bugs.example.test/api/integrations/jira/webhook/${CONN} project in (10000)`,
    ]);
    const c = (
      await q(
        "select webhooks,webhook_expires_at,last_reconciled_at from bugflow.jira_connections where id=$1",
        [CONN],
      )
    )[0]!;
    expect(c["webhooks"]).toEqual([{ id: 5001, jql: "project in (10000)" }]);
    expect(c["webhook_expires_at"]).not.toBeNull();
    expect(c["last_reconciled_at"]).not.toBeNull();
    expect(
      (
        await q("select reconcile_cursor from bugflow.jira_project_mappings where id=$1", [MAP])
      )[0]!["reconcile_cursor"],
    ).not.toBeNull();
    expect((await scan()).webhooks).toEqual(["current"]);
  });

  it("repairs a change whose webhook never arrived", async () => {
    jira.raw(issueId).fields["summary"] = "TRIAL-JIRA-Changed in Jira, webhook lost";
    touch(issueId, 5);
    expect(await scan()).toMatchObject({ fromJira: 1 });
    expect(await scan()).toMatchObject({ fromJira: 0 }); // the overlap re-reads it; the same change is queued once
    expect((await work()).inbox).toMatchObject({ done: 1 });
    expect((await q("select title from bugflow.bugs where id=$1", [id]))[0]).toEqual({
      title: "TRIAL-JIRA-Changed in Jira, webhook lost",
    });
    expect(await scan()).toMatchObject({ fromJira: 0 });
  });

  it("brings in a Jira bug that was created while nothing was listening", async () => {
    const issue = jira.written({ summary: "TRIAL-JIRA-Made in Jira, no webhook" });
    touch(issue.id, 6);
    expect(await scan()).toMatchObject({ fromJira: 1 });
    await work();
    expect(
      await q("select origin,state from bugflow.jira_issue_links where jira_issue_id=$1", [
        issue.id,
      ]),
    ).toEqual([{ origin: "jira", state: "linked" }]);
    // the link line BugFlow wrote back changed the issue; that is BugFlow's own echo, not news
    expect(await scan()).toMatchObject({ fromJira: 0 });
  });

  it("finds a BugFlow change that no outbox entry covers", async () => {
    await change(id, {
      action: "comment",
      notes: "TRIAL-JIRA a comment bumps the bug without an entry",
    });
    expect(await scan()).toMatchObject({ fromBugFlow: 1 });
    expect(await scan()).toMatchObject({ fromBugFlow: 0 });
    expect((await work()).outbox).toMatchObject({ done: 1 });
    expect(await scan()).toMatchObject({ fromBugFlow: 0 });
  });

  it("re-checks links nobody looked at for a day, and so finds an issue deleted in Jira", async () => {
    await q(
      "update bugflow.jira_issue_links set last_synced_at=now()-interval '2 days' where bug_id=$1",
      [id],
    );
    await q("update bugflow.jira_project_mappings set full_scan_at=null where id=$1", [MAP]);
    jira.issues.delete(issueId);
    expect(await scan()).toMatchObject({ linkChecks: 1 });
    await work();
    expect(
      (await q("select state from bugflow.jira_issue_links where bug_id=$1", [id]))[0],
    ).toEqual({ state: "remote_missing" });
    expect(
      (await q("select full_scan_at from bugflow.jira_project_mappings where id=$1", [MAP]))[0]![
        "full_scan_at"
      ],
    ).not.toBeNull();
    expect((await q("select deleted_at from bugflow.bugs where id=$1", [id]))[0]).toEqual({
      deleted_at: null,
    }); // the bug stays
  });

  it("skips paused mappings and does not register notifications without https", async () => {
    await q(
      "update bugflow.jira_connections set webhooks='[]',webhook_expires_at=null where id=$1",
      [CONN],
    );
    expect((await scan("http://localhost:8081")).webhooks).toEqual(["not_https"]);
    await q("update bugflow.jira_project_mappings set state='paused' where id=$1", [MAP]);
    expect(await scan()).toMatchObject({ mappings: 0, webhooks: ["none_needed"] });
  });
});
