import { describe, expect, it } from "vitest";
import {
  JIRA_CALLBACK_PATH,
  JIRA_SCOPES,
  authorizeUrl,
  callbackUrl,
  isCallbackOutcome,
  jiraSites,
  publicOrigin,
  resourcesSchema,
  siteAllowed,
  tokenResponseSchema,
} from "@/lib/jira/oauth";
import {
  JiraApiError,
  JiraAuthError,
  backoffMs,
  classifyStatus,
  isRetryable,
  retryAfterMs,
  safeErrorText,
} from "@/lib/jira/errors";

describe("Jira public address", () => {
  it("accepts https and reduces it to the origin", () => {
    expect(publicOrigin("https://bugs.example.com/some/path?x=1")).toBe("https://bugs.example.com");
    expect(publicOrigin("  https://trial.example.dev  ")).toBe("https://trial.example.dev");
  });
  it("allows plain http only on this computer", () => {
    expect(publicOrigin("http://localhost:8080")).toBe("http://localhost:8080");
    expect(publicOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(publicOrigin("http://bugs.example.com")).toBeNull();
  });
  it("rejects anything that is not a web address", () => {
    expect(publicOrigin(undefined)).toBeNull();
    expect(publicOrigin("")).toBeNull();
    expect(publicOrigin("not a url")).toBeNull();
    expect(publicOrigin("ftp://bugs.example.com")).toBeNull();
  });
  it("builds the callback under that origin", () => {
    expect(callbackUrl("https://bugs.example.com")).toBe(
      `https://bugs.example.com${JIRA_CALLBACK_PATH}`,
    );
  });
});

describe("Atlassian authorize address", () => {
  const url = new URL(
    authorizeUrl({
      clientId: "client-123",
      redirectUri: "https://bugs.example.com/api/integrations/jira/callback",
      state: "a".repeat(64),
    }),
  );
  it("targets Atlassian with the documented parameters", () => {
    expect(url.origin + url.pathname).toBe("https://auth.atlassian.com/authorize");
    expect(url.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("a".repeat(64));
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://bugs.example.com/api/integrations/jira/callback",
    );
  });
  it("asks for a refresh token and never for configuration rights", () => {
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual([...JIRA_SCOPES]);
    expect(scopes).toContain("offline_access");
    expect(scopes.some((s) => s.includes("configuration") || s.includes("admin"))).toBe(false);
  });
  it("carries no secret", () => {
    expect(url.toString()).not.toMatch(/secret/i);
  });
});

describe("Atlassian responses", () => {
  it("needs a refresh token to be usable", () => {
    expect(
      tokenResponseSchema.safeParse({ access_token: "a", refresh_token: "r", expires_in: 3600 })
        .success,
    ).toBe(true);
    expect(tokenResponseSchema.safeParse({ access_token: "a", expires_in: 3600 }).success).toBe(
      false,
    );
    expect(
      tokenResponseSchema.safeParse({ access_token: "a", refresh_token: "r", expires_in: 0 })
        .success,
    ).toBe(false);
  });
  it("lists only sites reachable with Jira scopes", () => {
    const resources = resourcesSchema.parse([
      {
        id: "11111111-2222-4333-8444-555555555555",
        url: "https://trial.atlassian.net",
        name: "trial",
        scopes: ["read:jira-work", "write:jira-work"],
      },
      {
        id: "99999999-2222-4333-8444-555555555555",
        url: "https://wiki.atlassian.net",
        name: "wiki",
        scopes: ["read:confluence-content.all"],
      },
    ]);
    expect(jiraSites(resources)).toEqual([
      {
        id: "11111111-2222-4333-8444-555555555555",
        url: "https://trial.atlassian.net",
        name: "trial",
      },
    ]);
  });
  it("rejects a site id that is not a cloud id", () => {
    expect(
      resourcesSchema.safeParse([{ id: "../evil", url: "https://x.atlassian.net", name: "x" }])
        .success,
    ).toBe(false);
  });
});

describe("allowed Jira site guard", () => {
  it("allows any site when no guard is set", () => {
    expect(siteAllowed("https://anything.atlassian.net", null)).toBe(true);
  });
  it("allows only the named site when set", () => {
    expect(siteAllowed("https://trial.atlassian.net", "https://trial.atlassian.net/")).toBe(true);
    expect(siteAllowed("https://company.atlassian.net", "https://trial.atlassian.net")).toBe(false);
  });
  it("fails closed on an unreadable guard value", () => {
    expect(siteAllowed("https://trial.atlassian.net", "trial")).toBe(false);
  });
});

describe("callback outcome codes", () => {
  it("accepts only known codes", () => {
    expect(isCallbackOutcome("connected")).toBe(true);
    expect(isCallbackOutcome("state_invalid")).toBe(true);
    expect(isCallbackOutcome("<script>")).toBe(false);
    expect(isCallbackOutcome(undefined)).toBe(false);
  });
});

describe("Jira error classification", () => {
  it("maps HTTP statuses to what the sync should do", () => {
    expect(classifyStatus(401)).toBe("auth");
    expect(classifyStatus(403)).toBe("forbidden");
    expect(classifyStatus(404)).toBe("not_found");
    expect(classifyStatus(409)).toBe("conflict");
    expect(classifyStatus(429)).toBe("rate_limited");
    expect(classifyStatus(400)).toBe("validation");
    expect(classifyStatus(503)).toBe("transient");
    expect(classifyStatus(0)).toBe("transient");
  });
  it("retries only what can succeed unchanged", () => {
    expect(isRetryable("transient")).toBe(true);
    expect(isRetryable("rate_limited")).toBe(true);
    expect(isRetryable("forbidden")).toBe(false);
    expect(isRetryable("validation")).toBe(false);
    expect(isRetryable("auth")).toBe(false);
  });
  it("reads Retry-After as seconds or as a date", () => {
    expect(retryAfterMs("7")).toBe(7000);
    expect(retryAfterMs("1.5")).toBe(1500);
    const now = Date.parse("2026-11-06T10:00:00Z");
    expect(retryAfterMs("Fri, 06 Nov 2026 10:00:30 GMT", now)).toBe(30_000);
    expect(retryAfterMs("Fri, 06 Nov 2026 09:00:00 GMT", now)).toBe(0);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
  it("backs off within bounds and never sooner than the server asked", () => {
    expect(backoffMs(0, null, () => 0)).toBe(1400);
    expect(backoffMs(0, null, () => 1)).toBe(2600);
    expect(backoffMs(10, null, () => 0.5)).toBe(30_000);
    expect(backoffMs(0, 45_000, () => 0)).toBe(45_000);
  });
  it("describes failures for an Admin without technical detail", () => {
    const text = [
      safeErrorText(new JiraApiError("forbidden", 403)),
      safeErrorText(new JiraApiError("transient", 502)),
      safeErrorText(new JiraAuthError("reauthorization_required")),
      safeErrorText(new Error("ECONNRESET at socket 10.0.0.1")),
    ].join(" ");
    expect(text).not.toMatch(/403|502|ECONNRESET|10\.0\.0\.1/);
    expect(safeErrorText(new JiraAuthError("reauthorization_required"))).toMatch(/Reconnect/);
  });
});
