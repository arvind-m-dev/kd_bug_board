import { describe, expect, it } from "vitest";
import { overallState, usageLevel, worse } from "@/lib/system-health";

describe("System health summary", () => {
  it("is as bad as the worst check", () => {
    expect(overallState([{ state: "ok" }, { state: "warn" }, { state: "fail" }])).toBe("fail");
    expect(overallState([{ state: "ok" }, { state: "warn" }])).toBe("warn");
    expect(overallState([{ state: "ok" }])).toBe("ok");
  });
  it("ignores optional services that are switched off", () => {
    expect(overallState([{ state: "ok" }, { state: "off" }])).toBe("ok");
  });
});

describe("Storage meters", () => {
  const GB = 1024 ** 3;
  it("turn amber at 75% and red at 90% of the limit", () => {
    expect(usageLevel({ usedBytes: 0.5 * GB, limitBytes: GB })).toBe("ok");
    expect(usageLevel({ usedBytes: 0.75 * GB, limitBytes: GB })).toBe("warn");
    expect(usageLevel({ usedBytes: 0.9 * GB, limitBytes: GB })).toBe("fail");
    expect(usageLevel({ usedBytes: 2 * GB, limitBytes: GB })).toBe("fail");
  });
  it("never alarm without a known limit", () => {
    expect(usageLevel({ usedBytes: 50 * GB, limitBytes: null })).toBe("ok");
  });
  it("keep the worse of connection and usage states", () => {
    expect(worse("ok", "warn")).toBe("warn");
    expect(worse("warn", "fail")).toBe("fail");
    expect(worse("ok", "ok")).toBe("ok");
  });
});
