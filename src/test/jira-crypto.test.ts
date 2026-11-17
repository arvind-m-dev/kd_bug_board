import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jiraKeyConfigured, openToken, sealToken } from "@/lib/jira/crypto.server";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CONNECTION = "7d1f3c1e-2a54-4f0b-9c33-5a0d2b7e9f10";
const OTHER = "11111111-2222-4333-8444-555555555555";
// Long like a real Atlassian access token (a JWT of a few kilobytes).
const TOKEN = `eyJ.${"x".repeat(5000)}.sig`;

describe("Jira token encryption", () => {
  const previous = process.env["JIRA_TOKEN_ENCRYPTION_KEY"];
  beforeEach(() => {
    process.env["JIRA_TOKEN_ENCRYPTION_KEY"] = KEY;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env["JIRA_TOKEN_ENCRYPTION_KEY"];
    else process.env["JIRA_TOKEN_ENCRYPTION_KEY"] = previous;
  });

  it("round-trips a token and never stores it readable", async () => {
    const sealed = await sealToken(TOKEN, CONNECTION, "access");
    expect(sealed.startsWith("v1.")).toBe(true);
    // Neither the token's text nor its base64 form appears. (Long runs, so random ciphertext cannot match by chance.)
    expect(sealed).not.toContain("x".repeat(24));
    expect(sealed).not.toContain(btoa("x".repeat(24)));
    expect(atob(sealed.slice(3))).not.toContain("x".repeat(24));
    expect(await openToken(sealed, CONNECTION, "access")).toBe(TOKEN);
  });

  it("produces a different ciphertext every time", async () => {
    expect(await sealToken("same", CONNECTION, "refresh")).not.toBe(
      await sealToken("same", CONNECTION, "refresh"),
    );
  });

  it("does not open under another connection or purpose", async () => {
    const sealed = await sealToken("secret", CONNECTION, "refresh");
    await expect(openToken(sealed, OTHER, "refresh")).rejects.toThrow();
    await expect(openToken(sealed, CONNECTION, "access")).rejects.toThrow();
  });

  it("rejects a tampered or unknown value", async () => {
    const sealed = await sealToken("secret", CONNECTION, "access");
    const flipped = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(openToken(flipped, CONNECTION, "access")).rejects.toThrow();
    await expect(openToken(sealed.replace(/^v1\./, "v9."), CONNECTION, "access")).rejects.toThrow(
      /unknown format/,
    );
  });

  it("does not open with a different key", async () => {
    const sealed = await sealToken("secret", CONNECTION, "access");
    process.env["JIRA_TOKEN_ENCRYPTION_KEY"] = KEY.replace(/^0/, "f");
    await expect(openToken(sealed, CONNECTION, "access")).rejects.toThrow();
  });

  it("refuses to work without a proper key", async () => {
    for (const bad of ["", "short", "z".repeat(64)]) {
      process.env["JIRA_TOKEN_ENCRYPTION_KEY"] = bad;
      expect(jiraKeyConfigured()).toBe(false);
      await expect(sealToken("secret", CONNECTION, "access")).rejects.toThrow(/not configured/);
    }
    delete process.env["JIRA_TOKEN_ENCRYPTION_KEY"];
    expect(jiraKeyConfigured()).toBe(false);
  });
});
