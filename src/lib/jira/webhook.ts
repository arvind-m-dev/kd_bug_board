import { z } from "zod";
import type { RemoteActor } from "./processor";

// Reading a webhook from Jira. Pure: no database, no network. Atlassian sends OAuth-app webhooks with a bearer
// token signed with the app's client secret; only a request carrying a valid one is looked at, and from the
// body only a small envelope is kept. The issue itself is always read from Jira later.

/** Issue events that can matter to a synchronized bug. Everything else is acknowledged and dropped. */
export const ISSUE_EVENTS = [
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
] as const;
export const SPRINT_EVENTS = [
  "sprint_created",
  "sprint_updated",
  "sprint_started",
  "sprint_closed",
  "sprint_deleted",
] as const;
/** Larger bodies are refused before parsing. Jira sends the whole issue, so this is generous, not tight. */
export const MAX_WEBHOOK_BYTES = 1_000_000;

const fromBase64Url = (s: string) => {
  const b = atob(
    s
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(s.length / 4) * 4, "="),
  );
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const json = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

/**
 * True only for a JWT signed with this app's client secret (HMAC-SHA256) that has not expired. The algorithm
 * is taken from our side, never from the token: a token naming another algorithm (or "none") is refused.
 */
export async function verifyWebhookToken(
  token: string,
  clientSecret: string,
  now = Date.now(),
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || !clientSecret) return false;
  const [head, body, signature] = parts as [string, string, string];
  try {
    const header = json(fromBase64Url(head)) as { alg?: unknown };
    if (header.alg !== "HS256") return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(clientSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!ok) return false;
    const claims = json(fromBase64Url(body)) as { exp?: unknown; nbf?: unknown };
    const seconds = now / 1000;
    if (typeof claims.exp === "number" && claims.exp < seconds - 60) return false;
    if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) return false;
    return true;
  } catch {
    return false;
  }
}

const jiraId = z.string().regex(/^\d{1,20}$/);
const payloadSchema = z
  .object({
    webhookEvent: z.string().max(64),
    timestamp: z.number().optional(),
    issue: z
      .object({
        id: jiraId,
        key: z.string().max(64).optional(),
        fields: z
          .object({ project: z.object({ id: jiraId }).passthrough().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    user: z
      .object({ accountId: z.string().max(128), displayName: z.string().max(200).optional() })
      .passthrough()
      .optional(),
    sprint: z
      .object({ id: z.number().int(), originBoardId: z.number().int().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type WebhookEnvelope =
  | {
      kind: "issue";
      eventType: string;
      issueId: string;
      issueKey: string | null;
      projectId: string | null;
      eventAt: string | null;
      actor: RemoteActor | null;
    }
  | {
      kind: "sprint";
      eventType: string;
      sprintId: number;
      boardId: number | null;
      eventAt: string | null;
    }
  | { kind: "ignored" };

/** The few facts kept from a webhook body. Null when the body is not a webhook this app understands. */
export function webhookEnvelope(body: unknown): WebhookEnvelope | null {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data;
  const eventAt = p.timestamp ? new Date(p.timestamp).toISOString() : null;
  if ((ISSUE_EVENTS as readonly string[]).includes(p.webhookEvent)) {
    if (!p.issue) return null;
    return {
      kind: "issue",
      eventType: p.webhookEvent,
      issueId: p.issue.id,
      issueKey: p.issue.key ?? null,
      projectId: p.issue.fields?.project?.id ?? null,
      eventAt,
      actor: p.user ? { accountId: p.user.accountId, displayName: p.user.displayName ?? "" } : null,
    };
  }
  if ((SPRINT_EVENTS as readonly string[]).includes(p.webhookEvent)) {
    if (!p.sprint) return null;
    return {
      kind: "sprint",
      eventType: p.webhookEvent,
      sprintId: p.sprint.id,
      boardId: p.sprint.originBoardId ?? null,
      eventAt,
    };
  }
  return { kind: "ignored" };
}

/** Jira's delivery id (the same on every retry) when present, else one derived from the event itself. */
export function deliveryKey(
  header: string | null,
  e: Extract<WebhookEnvelope, { kind: "issue" }>,
): string {
  const id = header?.trim();
  return id && id.length <= 200 ? `wh:${id}` : `ev:${e.eventType}:${e.issueId}:${e.eventAt ?? ""}`;
}
