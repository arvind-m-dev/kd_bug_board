import { afterEach, describe, expect, it } from "vitest";
import { demoLoginEnabled, demoUnlockAdmin } from "@/lib/portal-access.server";

describe("one-click demo sign-in", () => {
  afterEach(() => {
    delete process.env["BUGFLOW_DEMO_LOGIN"];
  });
  it("is off unless BUGFLOW_DEMO_LOGIN is exactly 1", () => {
    expect(demoLoginEnabled()).toBe(false);
    process.env["BUGFLOW_DEMO_LOGIN"] = "true";
    expect(demoLoginEnabled()).toBe(false);
    process.env["BUGFLOW_DEMO_LOGIN"] = "1";
    expect(demoLoginEnabled()).toBe(true);
  });
  it("refuses to sign in while turned off", async () => {
    await expect(demoUnlockAdmin()).rejects.toThrow("One-click sign-in is turned off.");
  });
});
