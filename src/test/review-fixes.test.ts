import { describe, expect, it } from "vitest";
import { parseBugRef, clientAccessSchema, accessSchema } from "@/lib/bug-workflow";
import { isCalendarDate } from "@/lib/bugflow";
import { toCsv, neutralizeFormula } from "@/lib/export";
import { allowedRedirectUri } from "@/lib/oauth.server";
import { consentPage } from "@/lib/oauth-consent";
import {
  TOO_MANY_ATTEMPTS,
  beginSignInAttempt,
  clearSignInFailures,
} from "@/lib/sign-in-throttle.server";
import { audited } from "@/lib/audit.server";

describe("bug references with any workspace prefix", () => {
  it.each([
    ["51", "51"],
    ["#51", "51"],
    ["BF-000051", "51"],
    ["bf000051", "51"],
    ["DEPLOY-000123", "123"],
    ["PROD2-000051", "51"],
    [" 42 ", "42"],
  ])("%s → %s", (input, id) => expect(parseBugRef(input)).toBe(id));
  it.each(["", "0", "BF-0", "abc", "BF-12x", "TOOLONGPREFIX1-5"])("rejects %s", (input) =>
    expect(parseBugRef(input)).toBeNull(),
  );
});

describe("calendar dates", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("26-01-01")).toBe(false);
  });
});

describe("CSV formula injection", () => {
  it("neutralises cells a spreadsheet would run as formulas", () => {
    expect(neutralizeFormula('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(neutralizeFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("-cmd")).toBe("'-cmd");
  });
  it("leaves ordinary text and negative numbers alone", () => {
    expect(neutralizeFormula("Login fails")).toBe("Login fails");
    expect(neutralizeFormula("-12.5")).toBe("-12.5");
    expect(toCsv(["n"], [[-3]])).toBe("n\r\n-3");
  });
});

describe("OAuth redirect URIs", () => {
  it("allows https anywhere and http only on loopback", () => {
    expect(allowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(allowedRedirectUri("http://localhost:6274/callback")).toBe(true);
    expect(allowedRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(allowedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(allowedRedirectUri("https://a.example/cb#frag")).toBe(false);
    expect(allowedRedirectUri(`https://a.example/${"x".repeat(2100)}`)).toBe(false);
    expect(allowedRedirectUri("javascript:alert(1)")).toBe(false);
  });
  it("shows where approval sends access on the consent page", () => {
    const html = consentPage({
      clientName: "Claude",
      params: { redirect_uri: "https://evil.example/cb", client_id: "bf_x" },
    });
    expect(html).toContain("evil.example");
  });
});

describe("browser server functions", () => {
  it("refuse AI-token access, which only /api/mcp resolves", () => {
    const ai = { kind: "ai", token: "a".repeat(64) };
    expect(accessSchema.safeParse(ai).success).toBe(true);
    expect(clientAccessSchema.safeParse(ai).success).toBe(false);
    expect(clientAccessSchema.safeParse({ kind: "admin" }).success).toBe(true);
  });
});

describe("sign-in attempts", () => {
  it("count before the password check, so parallel attempts cannot all pass", () => {
    const key = "192.0.2.77";
    for (let i = 0; i < 10; i++) beginSignInAttempt(key);
    expect(() => beginSignInAttempt(key)).toThrow(TOO_MANY_ATTEMPTS);
    clearSignInFailures(key);
    expect(() => beginSignInAttempt(key)).not.toThrow();
    clearSignInFailures(key);
  });
});

describe("audited mutations", () => {
  it("append the audit parameters after the mutation's own", () => {
    const q = audited("update t set x=$2 where id=$1 returning id", ["1", "y"], {
      actorId: "u",
      bugId: "9",
      action: "sprint.updated",
      detail: { a: 1 },
    });
    expect(q.query).toContain("$3::uuid,$4::bigint,$5,$6::jsonb");
    expect(q.params).toEqual(["1", "y", "u", "9", "sprint.updated", '{"a":1}']);
  });
});
