// Pure classification of Jira REST failures, shared by the client, the processors and their tests.

export type JiraErrorKind =
  | "auth" // 401: token rejected — refresh once, then reauthorize
  | "forbidden" // 403: the authorizing account lacks a permission; permanent until that changes
  | "not_found" // 404: gone, moved, or no longer visible to the account
  | "validation" // 400/422: mapping or payload problem; never retry unchanged
  | "conflict" // 409: state changed under us; re-read and re-evaluate once
  | "rate_limited" // 429: wait at least Retry-After
  | "transient" // 5xx, network, timeout: retry with backoff
  | "unexpected";

export class JiraApiError extends Error {
  constructor(
    readonly kind: JiraErrorKind,
    readonly status: number,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Jira request failed (${kind}, HTTP ${status})`);
    this.name = "JiraApiError";
  }
}

export type JiraAuthCode =
  "not_connected" | "reauthorization_required" | "refresh_failed" | "refresh_busy";
/** The saved authorization cannot produce an access token right now. */
export class JiraAuthError extends Error {
  constructor(readonly code: JiraAuthCode) {
    super(`Jira authorization unavailable (${code})`);
    this.name = "JiraAuthError";
  }
}

export function classifyStatus(status: number): JiraErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "validation";
  if (status === 0 || status === 408 || status >= 500) return "transient";
  return "unexpected";
}

/** Only these are worth another attempt without a human changing something. */
export const isRetryable = (kind: JiraErrorKind) =>
  kind === "transient" || kind === "rate_limited" || kind === "conflict";

/** `Retry-After` as milliseconds: the header carries seconds, or an HTTP date. Null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const v = header.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Delay before attempt n+1 (n = attempts already made), following Atlassian's rate-limit guidance: double from a
 * 2 s base to a 30 s cap, spread by a 0.7–1.3 factor, and never sooner than the server's Retry-After.
 */
export function backoffMs(attempt: number, retryAfter: number | null = null, random = Math.random) {
  const base = Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));
  return Math.max(retryAfter ?? 0, Math.round(base * (0.7 + random() * 0.6)));
}

/** A short line that is safe to show an Admin; the detailed error stays in the server log. */
export function safeErrorText(error: unknown): string {
  if (error instanceof JiraAuthError)
    return error.code === "reauthorization_required"
      ? "Atlassian no longer accepts the saved authorization. Reconnect Jira."
      : error.code === "not_connected"
        ? "Jira is not connected."
        : "Jira's sign-in service could not refresh the authorization. It will be tried again.";
  if (error instanceof JiraApiError)
    switch (error.kind) {
      case "auth":
        return "Jira rejected the saved authorization. Reconnect Jira.";
      case "forbidden":
        return "The connected Atlassian account is not allowed to do this in Jira.";
      case "not_found":
        return "Jira could not find this, or the connected account can no longer see it.";
      case "rate_limited":
        return "Jira is limiting requests right now. It will be tried again shortly.";
      case "validation":
        return "Jira rejected the request. The mapping needs checking.";
      case "conflict":
        return "Jira changed while this was being saved. It will be re-read.";
      default:
        return "Jira could not be reached. It will be tried again.";
    }
  return "Jira could not be reached. It will be tried again.";
}
