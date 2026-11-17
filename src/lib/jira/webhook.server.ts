import { neonExecute } from "../neon.server";
import { jiraEnv } from "./auth.server";
import { persistEvent } from "./inbox.server";
import { MAX_WEBHOOK_BYTES, deliveryKey, verifyWebhookToken, webhookEnvelope } from "./webhook";

// The webhook receiver: check the sender, keep a small envelope, answer fast. No cookie and no same-origin
// check apply here: the only authority is Atlassian's signed token. Nothing is processed in this request.

const reply = (status: number, body: object) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function handleJiraWebhook(request: Request, connectionId: string): Promise<Response> {
  const { config } = jiraEnv();
  if (!config) return reply(503, { error: "not_configured" });
  if (!UUID.test(connectionId)) return reply(404, { error: "not_found" });
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!(await verifyWebhookToken(token, config.clientSecret)))
    return reply(401, { error: "unauthorized" });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES)
    return reply(413, { error: "too_large" });
  const text = await request.text();
  if (text.length > MAX_WEBHOOK_BYTES) return reply(413, { error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "invalid_body" });
  }
  const envelope = webhookEnvelope(body);
  if (!envelope) return reply(400, { error: "invalid_body" });

  // Only a live connection takes events. A paused one still does: they wait in the inbox until it resumes.
  const { rows } = await neonExecute(
    `update bugflow.jira_connections set last_event_at=now() where id=$1 and disconnected_at is null and cloud_id is not null returning id`,
    [connectionId],
  );
  if (!rows.length) return reply(404, { error: "not_found" });
  if (envelope.kind === "ignored") return reply(200, { ok: true, kept: false });
  if (envelope.kind === "sprint") {
    const { noteSprintEvent } = await import("./sprints.server");
    await noteSprintEvent(connectionId, envelope);
    return reply(200, { ok: true, kept: true });
  }
  const kept = await persistEvent(connectionId, {
    dedupKey: deliveryKey(request.headers.get("x-atlassian-webhook-identifier"), envelope),
    eventType: envelope.eventType,
    source: "webhook",
    issueId: envelope.issueId,
    issueKey: envelope.issueKey,
    projectId: envelope.projectId,
    eventAt: envelope.eventAt,
    actor: envelope.actor,
  });
  return reply(200, { ok: true, kept });
}
