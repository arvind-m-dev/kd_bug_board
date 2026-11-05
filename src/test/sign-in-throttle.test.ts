import { describe, expect, it } from "vitest";
import {
  TOO_MANY_ATTEMPTS,
  assertSignInAllowed,
  clearSignInFailures,
  clientKey,
  recordSignInFailure,
} from "@/lib/sign-in-throttle.server";

describe("Admin sign-in attempt limit", () => {
  it("refuses an address after 10 wrong passwords and lets others through", () => {
    for (let i = 0; i < 10; i++) {
      assertSignInAllowed("203.0.113.9");
      recordSignInFailure("203.0.113.9");
    }
    expect(() => assertSignInAllowed("203.0.113.9")).toThrow(TOO_MANY_ATTEMPTS);
    expect(() => assertSignInAllowed("198.51.100.4")).not.toThrow();
    clearSignInFailures("203.0.113.9");
    expect(() => assertSignInAllowed("203.0.113.9")).not.toThrow();
  });
  it("trusts proxy headers only on Vercel; elsewhere keys on the socket address", () => {
    const req = (headers: Record<string, string>, ip?: string) =>
      Object.assign(new Request("http://x/", { headers }), ip ? { ip } : {});
    expect(clientKey(req({ "x-real-ip": "203.0.113.9" }), true)).toBe("203.0.113.9");
    expect(clientKey(req({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }), true)).toBe(
      "198.51.100.4",
    );
    // Off Vercel a spoofed header must not change the key.
    expect(clientKey(req({ "x-forwarded-for": "198.51.100.8" }, "127.0.0.1"), false)).toBe(
      "127.0.0.1",
    );
    expect(clientKey(req({}), false)).toBe("local");
  });
});
