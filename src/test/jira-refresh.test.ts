import { describe, expect, it } from "vitest";
import { JiraAuthError } from "@/lib/jira/errors";
import {
  EXPIRY_SKEW_MS,
  freshAccessToken,
  type RefreshCall,
  type StoredTokens,
  type TokenStore,
} from "@/lib/jira/refresh";

const NOW = 1_000_000_000;
/** An in-memory stand-in for the connection row, with the same conditional writes as the database store. */
function memoryStore(initial: StoredTokens | null, clock: { now: number } = { now: NOW }) {
  let row = initial ? { ...initial, leaseUntil: 0, reauthorize: false } : null;
  const store: TokenStore = {
    read: async () =>
      row && {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        expiresAt: row.expiresAt,
        generation: row.generation,
      },
    acquireLease: async (generation, ttlMs) => {
      if (!row || row.generation !== generation || row.leaseUntil > clock.now) return false;
      row.leaseUntil = clock.now + ttlMs;
      return true;
    },
    saveRotated: async (generation, next) => {
      if (!row || row.generation !== generation) return false;
      row = { ...row, ...next, generation: generation + 1, leaseUntil: 0 };
      return true;
    },
    releaseLease: async (generation) => {
      if (row && row.generation === generation) row.leaseUntil = 0;
    },
    requireReauthorization: async (generation) => {
      if (row && row.generation === generation) {
        row.reauthorize = true;
        row.leaseUntil = 0;
      }
    },
  };
  return { store, row: () => row, clock };
}
const valid: StoredTokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: NOW + 3_600_000,
  generation: 0,
};
const expiring: StoredTokens = { ...valid, expiresAt: NOW + EXPIRY_SKEW_MS - 1 };
const rotate =
  (calls: string[]): RefreshCall =>
  async (refreshToken) => {
    calls.push(refreshToken);
    return {
      ok: true,
      tokens: { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: NOW + 3_600_000 },
    };
  };
const now = () => NOW;

describe("Jira access token refresh", () => {
  it("uses a token that is still good without calling Atlassian", async () => {
    const calls: string[] = [];
    const { store } = memoryStore(valid);
    expect(await freshAccessToken(store, rotate(calls), { now })).toEqual({
      token: "access-1",
      generation: 0,
    });
    expect(calls).toEqual([]);
  });

  it("refreshes shortly before expiry and stores both rotated tokens", async () => {
    const calls: string[] = [];
    const { store, row } = memoryStore(expiring);
    expect(await freshAccessToken(store, rotate(calls), { now })).toEqual({
      token: "access-2",
      generation: 1,
    });
    expect(calls).toEqual(["refresh-1"]);
    expect(row()).toMatchObject({ refreshToken: "refresh-2", generation: 1, leaseUntil: 0 });
  });

  it("lets only one of several simultaneous callers spend the refresh token", async () => {
    const calls: string[] = [];
    const { store } = memoryStore(expiring);
    const slow: RefreshCall = async (refreshToken) => {
      calls.push(refreshToken);
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        tokens: { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: NOW + 3_600_000 },
      };
    };
    const sleep = () => new Promise<void>((r) => setTimeout(r, 2));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => freshAccessToken(store, slow, { now, sleep })),
    );
    expect(calls).toEqual(["refresh-1"]);
    expect(results.every((r) => r.token === "access-2" && r.generation === 1)).toBe(true);
  });

  it("refreshes a token Jira just rejected, but not twice", async () => {
    const calls: string[] = [];
    const { store } = memoryStore(valid);
    const first = await freshAccessToken(store, rotate(calls), { now, rejectedGeneration: 0 });
    expect(first).toEqual({ token: "access-2", generation: 1 });
    // A second caller that saw the same rejection finds the newer generation and does not refresh again.
    const second = await freshAccessToken(store, rotate(calls), { now, rejectedGeneration: 0 });
    expect(second).toEqual({ token: "access-2", generation: 1 });
    expect(calls).toEqual(["refresh-1"]);
  });

  it("asks for a new sign-in when Atlassian refuses the refresh token", async () => {
    const { store, row } = memoryStore(expiring);
    const refused: RefreshCall = async () => ({ ok: false, kind: "invalid_grant" });
    await expect(freshAccessToken(store, refused, { now })).rejects.toMatchObject({
      code: "reauthorization_required",
    });
    expect(row()).toMatchObject({ reauthorize: true, leaseUntil: 0, refreshToken: "refresh-1" });
  });

  it("keeps the tokens and frees the lease on a temporary failure", async () => {
    const { store, row } = memoryStore(expiring);
    const down: RefreshCall = async () => {
      throw new Error("network");
    };
    await expect(freshAccessToken(store, down, { now })).rejects.toBeInstanceOf(JiraAuthError);
    expect(row()).toMatchObject({ reauthorize: false, leaseUntil: 0, generation: 0 });
    // The next attempt can take the lease and succeed.
    const calls: string[] = [];
    expect((await freshAccessToken(store, rotate(calls), { now })).token).toBe("access-2");
  });

  it("gives up rather than refresh in parallel while another caller holds the lease", async () => {
    const clock = { now: NOW };
    const { store } = memoryStore(expiring, clock);
    expect(await store.acquireLease(0, 30_000)).toBe(true); // a caller that never finishes
    const calls: string[] = [];
    await expect(
      freshAccessToken(store, rotate(calls), {
        now: () => clock.now,
        sleep: async (ms) => {
          clock.now += ms;
        },
        waitMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "refresh_busy" });
    expect(calls).toEqual([]);
  });

  it("takes over once a dead caller's lease has expired", async () => {
    const clock = { now: NOW };
    const { store } = memoryStore({ ...expiring, expiresAt: NOW }, clock);
    expect(await store.acquireLease(0, 500)).toBe(true);
    const calls: string[] = [];
    const result = await freshAccessToken(store, rotate(calls), {
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      waitMs: 5_000,
    });
    expect(result.token).toBe("access-2");
    expect(calls).toEqual(["refresh-1"]);
  });

  it("reports no connection when the tokens are gone", async () => {
    const { store } = memoryStore(null);
    await expect(freshAccessToken(store, rotate([]), { now })).rejects.toMatchObject({
      code: "not_connected",
    });
  });
});
