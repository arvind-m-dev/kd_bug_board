import { JIRA_CALLBACK_PATH } from "./oauth";

/**
 * Jira routes answered outside the Start runtime because the caller is not a signed-in browser: the OAuth
 * callback (Atlassian sends the browser back), the webhook receiver (Jira calls it) and the two job endpoints a
 * scheduler calls. Admin operations are
 * server functions (jira.functions.ts) so they keep the shared session and same-origin checks.
 */
export const JIRA_PROCESS_PATH = "/api/internal/jira/process";
export const JIRA_RECONCILE_PATH = "/api/internal/jira/reconcile";
/** Jira posts events here; the connection id in the path says whose they are, the signed token proves the sender. */
const WEBHOOK_PATH = /^\/api\/integrations\/jira\/webhook\/([0-9a-f-]{36})$/;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
/** Compares the two secrets through their hashes, so the time taken does not depend on where they differ. */
async function sameSecret(given: string, expected: string) {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Job endpoints are authorized only by `Authorization: Bearer <secret>`: `JIRA_JOB_SECRET`, or Vercel Cron's
 * `CRON_SECRET` (Vercel sends it on its scheduled calls). Cookies are never looked at, so a signed-in browser has
 * no authority here, and without a configured secret (32+ characters) the endpoint stays closed.
 */
export async function jobAuthorized(
  request: Request,
  secrets: (string | undefined)[] = [process.env["JIRA_JOB_SECRET"], process.env["CRON_SECRET"]],
) {
  const expected = secrets.map((s) => s?.trim() ?? "").filter((s) => s.length >= 32);
  if (!expected.length) return "not_configured" as const;
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!given) return "denied" as const;
  for (const e of expected) if (await sameSecret(given, e)) return "ok" as const;
  return "denied" as const;
}

export async function handleJiraRoute(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === JIRA_CALLBACK_PATH && request.method === "GET") {
    const { handleJiraCallback } = await import("./auth.server");
    return handleJiraCallback(request);
  }
  const webhook = WEBHOOK_PATH.exec(path);
  if (webhook && request.method === "POST") {
    const { handleJiraWebhook } = await import("./webhook.server");
    return handleJiraWebhook(request, webhook[1] ?? "");
  }
  // POST from any scheduler; GET as well, because that is how Vercel Cron calls (with its secret).
  if (
    (path === JIRA_PROCESS_PATH || path === JIRA_RECONCILE_PATH) &&
    (request.method === "POST" || request.method === "GET")
  ) {
    const auth = await jobAuthorized(request);
    if (auth === "not_configured") return json({ error: "not_configured" }, 503);
    if (auth === "denied") return json({ error: "unauthorized" }, 401);
    const { processJira, reconcileAndProcess } = await import("./jobs.server");
    return json(path === JIRA_PROCESS_PATH ? await processJira() : await reconcileAndProcess());
  }
  return json({ error: "not_found" }, 404);
}
