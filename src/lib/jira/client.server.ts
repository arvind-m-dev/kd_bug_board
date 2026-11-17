import { z } from "zod";
import { JiraApiError, classifyStatus, retryAfterMs } from "./errors";
import {
  JIRA_API_BASE,
  JIRA_RESOURCES_URL,
  cloudIdSchema,
  jiraSites,
  resourcesSchema,
} from "./oauth";

// Low-level Jira HTTP: one request with an access token that the caller already holds. No database, no refresh —
// `jiraFetch` in auth.server.ts adds those. Requests go only to api.atlassian.com; the site id is validated and
// the path must be a REST path, so nothing a person typed can redirect a call elsewhere.

const TIMEOUT_MS = 15_000;

async function send(url: string, token: string, init: { method?: string; body?: unknown } = {}) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new JiraApiError("transient", 0);
  }
  if (!response.ok)
    throw new JiraApiError(
      classifyStatus(response.status),
      response.status,
      retryAfterMs(response.headers.get("retry-after")),
    );
  if (response.status === 204) return null;
  return (await response.json().catch(() => null)) as unknown;
}

export async function jiraCall(
  cloudId: string,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  if (!cloudIdSchema.safeParse(cloudId).success || !/^\/rest\/(api|agile)\//.test(path))
    throw new JiraApiError("validation", 400);
  return send(`${JIRA_API_BASE}/${cloudId}${path}`, token, init);
}

/** The Jira sites this authorization can reach. */
export async function accessibleSites(token: string) {
  const parsed = resourcesSchema.safeParse(await send(JIRA_RESOURCES_URL, token));
  if (!parsed.success) throw new JiraApiError("unexpected", 200);
  return jiraSites(parsed.data);
}

const myselfSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().default(""),
});
/** A live read as the authorizing account: proves the token works against this site and names who authorized. */
export async function myself(cloudId: string, token: string) {
  const parsed = myselfSchema.safeParse(await jiraCall(cloudId, token, "/rest/api/3/myself"));
  if (!parsed.success) throw new JiraApiError("unexpected", 200);
  return parsed.data;
}
