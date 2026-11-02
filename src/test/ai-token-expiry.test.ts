import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_TOKEN_IDLE_DAYS,
  OAUTH_TOKENS_PER_PORTAL,
  aiTokenExpiryLabel,
  aiTokenState,
} from "@/lib/ai-tokens";

// The database is replaced by a recorder: the code exchange returns one valid code, the token batch is captured.
const db = vi.hoisted(() => ({
  batches: [] as { query: string; params?: unknown[] }[][],
  challenge: "",
}));
vi.mock("@/lib/neon.server", () => ({
  neonQuery: vi.fn(async () => ({ rows: [] })),
  neonExecute: vi.fn(async (q: string | { query: string; params?: unknown[] }[]) => {
    if (typeof q === "string")
      return {
        rows: q.includes("oauth_codes")
          ? [
              {
                portal_id: "11111111-1111-4111-8111-111111111111",
                user_id: "22222222-2222-4222-8222-222222222222",
                code_challenge: db.challenge,
                label: "claude.ai",
              },
            ]
          : [],
      };
    db.batches.push(q);
    return { results: q.map(() => ({ rows: [] })) };
  }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    throw new Error("no request");
  },
  getCookie: () => undefined,
  setCookie: () => undefined,
  deleteCookie: () => undefined,
  setResponseHeader: () => undefined,
}));
import { exchangeCode } from "@/lib/oauth.server";

const DAY = 86_400_000;
const now = Date.parse("2026-11-03T12:00:00Z");
const at = (ms: number) => new Date(now + ms).toISOString();

describe("AI token expiry rules", () => {
  it("is active, then expiring in the last two weeks, then expired", () => {
    expect(aiTokenState(at(AI_TOKEN_IDLE_DAYS * DAY), now)).toBe("active");
    expect(aiTokenState(at(10 * DAY), now)).toBe("expiring");
    expect(aiTokenState(at(0), now)).toBe("expired");
    expect(aiTokenState(at(-DAY), now)).toBe("expired");
    expect(aiTokenState("not a date", now)).toBe("expired");
  });
  it("labels the time left", () => {
    expect(aiTokenExpiryLabel(at(-1), now)).toBe("expired");
    expect(aiTokenExpiryLabel(at(3 * 3_600_000), now)).toBe("expires today");
    expect(aiTokenExpiryLabel(at(DAY + 1000), now)).toBe("expires in 1 day");
    expect(aiTokenExpiryLabel(at(90 * DAY), now)).toBe("expires in 90 days");
  });
});

describe("OAuth token exchange", () => {
  beforeEach(() => {
    db.batches = [];
  });
  it("issues an expiring OAuth token and trims the panel to the newest connections in the same transaction, audited", async () => {
    const verifier = "v".repeat(50);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    db.challenge = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const r = await exchangeCode({
      code: "c",
      redirectUri: "https://claude.ai/cb",
      clientId: "x",
      codeVerifier: verifier,
    });
    expect(r.access_token).toMatch(/^bf_ai_[a-f0-9]{64}$/);
    const [lock, insert, trim] = db.batches[0]!;
    expect(lock!.query).toContain("pg_advisory_xact_lock");
    expect(insert!.query).toContain("'oauth'");
    expect(insert!.query).toContain("make_interval(days=>$5)");
    expect(insert!.params![4]).toBe(AI_TOKEN_IDLE_DAYS);
    expect(trim!.query).toContain("source='oauth'");
    expect(trim!.query).toContain("offset $2");
    expect(trim!.query).toContain("insert into bugflow.activity");
    expect(trim!.params!.slice(0, 2)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      OAUTH_TOKENS_PER_PORTAL,
    ]);
    expect(trim!.params).toContain("ai_token.oauth_limit");
    expect(trim!.params).toContain("22222222-2222-4222-8222-222222222222");
  });
  it("refuses a wrong PKCE verifier without issuing a token", async () => {
    db.challenge = "nope";
    await expect(
      exchangeCode({ code: "c", redirectUri: "r", clientId: "x", codeVerifier: "w".repeat(50) }),
    ).rejects.toThrow("invalid_grant");
    expect(db.batches).toHaveLength(0);
  });
});
