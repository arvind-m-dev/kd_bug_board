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
  it("keys on the proxy-reported client address", () => {
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe(
      "198.51.100.4",
    );
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
