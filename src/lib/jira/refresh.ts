import { JiraAuthError } from "./errors";

// The rotating-refresh protocol, written against a small store interface so the race rules are unit-tested without
// a database. The database store lives in auth.server.ts.
//
// Atlassian replaces the refresh token on every use and disables the one that was used. The app talks to Neon over
// HTTP, so no database lock can be held across the call to Atlassian. Instead:
//   1. a lease column lets one caller refresh at a time (it expires by itself if that caller dies);
//   2. the save is conditional on the generation that was read, so a stale caller can never overwrite newer tokens;
//   3. callers that lose the lease wait briefly and re-read instead of refreshing too.
// If a caller dies after Atlassian rotated but before the save, the old refresh token still works for Atlassian's
// 10-minute reuse window, so the next caller recovers.

export type TokenSet = { accessToken: string; refreshToken: string; expiresAt: number };
export type StoredTokens = TokenSet & { generation: number };
export interface TokenStore {
  /** The live connection's tokens, or null when there is none (never connected, disconnected, tokens wiped). */
  read(): Promise<StoredTokens | null>;
  /** True when this caller now holds the refresh lease for exactly this generation. */
  acquireLease(generation: number, ttlMs: number): Promise<boolean>;
  /** Stores the rotated pair and bumps the generation; false when the generation had already moved on. */
  saveRotated(generation: number, next: TokenSet): Promise<boolean>;
  releaseLease(generation: number): Promise<void>;
  /** Atlassian refused the refresh token: the Admin has to sign in again. */
  requireReauthorization(generation: number): Promise<void>;
}
export type RefreshResult =
  { ok: true; tokens: TokenSet } | { ok: false; kind: "invalid_grant" | "transient" };
export type RefreshCall = (refreshToken: string) => Promise<RefreshResult>;

/** Refresh this long before expiry, so a token is never sent with only seconds left. */
export const EXPIRY_SKEW_MS = 60_000;
export const LEASE_MS = 30_000;

export async function freshAccessToken(
  store: TokenStore,
  refresh: RefreshCall,
  opts: {
    /** A generation Jira just answered 401 for: refresh even if its expiry looks fine. */
    rejectedGeneration?: number | undefined;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    waitMs?: number;
  } = {},
): Promise<{ token: string; generation: number }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (opts.waitMs ?? 8_000);
  for (;;) {
    const cur = await store.read();
    if (!cur) throw new JiraAuthError("not_connected");
    const stale =
      cur.expiresAt - now() <= EXPIRY_SKEW_MS || cur.generation === opts.rejectedGeneration;
    if (!stale) return { token: cur.accessToken, generation: cur.generation };
    if (await store.acquireLease(cur.generation, LEASE_MS)) {
      let result: RefreshResult;
      try {
        result = await refresh(cur.refreshToken);
      } catch {
        result = { ok: false, kind: "transient" };
      }
      if (result.ok) {
        if (await store.saveRotated(cur.generation, result.tokens))
          return { token: result.tokens.accessToken, generation: cur.generation + 1 };
        continue; // newer tokens were saved meanwhile: use those
      }
      if (result.kind === "invalid_grant") {
        await store.requireReauthorization(cur.generation);
        throw new JiraAuthError("reauthorization_required");
      }
      await store.releaseLease(cur.generation);
      throw new JiraAuthError("refresh_failed");
    }
    if (now() >= deadline) throw new JiraAuthError("refresh_busy");
    await sleep(250);
  }
}
