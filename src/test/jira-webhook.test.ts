import { describe, expect, it } from "vitest";
import {
  MAX_WEBHOOK_BYTES,
  deliveryKey,
  verifyWebhookToken,
  webhookEnvelope,
} from "@/lib/jira/webhook";
import { SECRET, b64, signed } from "./jira-jwt";

const NOW = 1_800_000_000_000;

describe("who may send a webhook", () => {
  it("accepts a token signed with the app's client secret", async () => {
    expect(
      await verifyWebhookToken(await signed({ iss: "jira", exp: NOW / 1000 + 300 }), SECRET, NOW),
    ).toBe(true);
    expect(await verifyWebhookToken(await signed({ iss: "jira" }), SECRET, NOW)).toBe(true);
  });

  it("refuses another secret, a changed body, an expired token and nonsense", async () => {
    const token = await signed({ exp: NOW / 1000 + 300 });
    expect(
      await verifyWebhookToken(
        await signed({ exp: NOW / 1000 + 300 }, "another-secret"),
        SECRET,
        NOW,
      ),
    ).toBe(false);
    const [h, , s] = token.split(".");
    expect(
      await verifyWebhookToken(
        `${h}.${b64(JSON.stringify({ exp: NOW / 1000 + 999_999 }))}.${s}`,
        SECRET,
        NOW,
      ),
    ).toBe(false);
    expect(await verifyWebhookToken(await signed({ exp: NOW / 1000 - 600 }), SECRET, NOW)).toBe(
      false,
    );
    for (const junk of ["", "a.b", "a.b.c", "....", token.slice(0, -4)])
      expect(await verifyWebhookToken(junk, SECRET, NOW)).toBe(false);
    expect(await verifyWebhookToken(token, "", NOW)).toBe(false);
  });

  it("never lets the token choose its own algorithm", async () => {
    const none = `${b64(JSON.stringify({ alg: "none" }))}.${b64(JSON.stringify({ exp: NOW / 1000 + 300 }))}.`;
    expect(await verifyWebhookToken(none, SECRET, NOW)).toBe(false);
    expect(await verifyWebhookToken(await signed({}, SECRET, { alg: "HS512" }), SECRET, NOW)).toBe(
      false,
    );
  });
});

describe("what is kept from a webhook", () => {
  const issue = {
    id: "20001",
    key: "BFT-1",
    fields: {
      project: { id: "10000" },
      summary: "A long private summary",
      description: { type: "doc" },
    },
  };

  it("keeps which issue, which project and who, and nothing of the content", () => {
    const e = webhookEnvelope({
      webhookEvent: "jira:issue_updated",
      timestamp: NOW,
      issue,
      user: { accountId: "acc-1", displayName: "Jordan", emailAddress: "j@example.test" },
      changelog: { items: [{ field: "summary" }] },
    });
    expect(e).toEqual({
      kind: "issue",
      eventType: "jira:issue_updated",
      issueId: "20001",
      issueKey: "BFT-1",
      projectId: "10000",
      eventAt: new Date(NOW).toISOString(),
      actor: { accountId: "acc-1", displayName: "Jordan" },
    });
    expect(JSON.stringify(e)).not.toMatch(/private summary|example\.test|changelog/);
  });

  it("reads sprint events, acknowledges unrelated ones, and refuses bodies that are not webhooks", () => {
    expect(
      webhookEnvelope({
        webhookEvent: "sprint_closed",
        timestamp: NOW,
        sprint: { id: 7, originBoardId: 3, name: "S" },
      }),
    ).toEqual({
      kind: "sprint",
      eventType: "sprint_closed",
      sprintId: 7,
      boardId: 3,
      eventAt: new Date(NOW).toISOString(),
    });
    expect(webhookEnvelope({ webhookEvent: "comment_created", issue })).toEqual({
      kind: "ignored",
    });
    expect(webhookEnvelope({ webhookEvent: "jira:issue_updated" })).toBeNull();
    expect(
      webhookEnvelope({ webhookEvent: "jira:issue_updated", issue: { id: "not-a-number" } }),
    ).toBeNull();
    expect(webhookEnvelope("hello")).toBeNull();
    expect(MAX_WEBHOOK_BYTES).toBeGreaterThan(100_000);
  });

  it("uses Jira's delivery id to recognise a retry, and falls back to the event itself", () => {
    const e = webhookEnvelope({ webhookEvent: "jira:issue_updated", timestamp: NOW, issue });
    if (e?.kind !== "issue") throw new Error("expected an issue event");
    expect(deliveryKey("abc-123", e)).toBe("wh:abc-123");
    expect(deliveryKey(null, e)).toBe(`ev:jira:issue_updated:20001:${new Date(NOW).toISOString()}`);
    expect(deliveryKey("x".repeat(500), e)).toMatch(/^ev:/);
  });
});
