import { describe, it, expect, afterEach } from "vitest";
import { demoLoginEnabled, demoUnlockAdmin } from "@/lib/portal-access.server";

const KEY = "BUGFLOW_DEMO_LOGIN";
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("temporary demo login", () => {
  it("is on only when the flag is exactly '1'", () => {
    for (const [v, want] of [
      ["1", true],
      ["true", false],
      ["0", false],
      ["", false],
    ] as const) {
      process.env[KEY] = v;
      expect(demoLoginEnabled()).toBe(want);
    }
    delete process.env[KEY];
    expect(demoLoginEnabled()).toBe(false);
  });
  it("refuses one-click sign-in while the flag is off", async () => {
    delete process.env[KEY];
    await expect(demoUnlockAdmin()).rejects.toThrow(/turned off/);
  });
});
