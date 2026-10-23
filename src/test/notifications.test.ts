import { describe, it, expect } from "vitest";
import { NOTIFICATION_DAYS, withinWindow } from "@/lib/notifications";
describe("notifications window", () => {
  it("covers the last 10 days", () => {
    expect(NOTIFICATION_DAYS).toBe(10);
  });
  it("excludes items older than 10 days", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    expect(withinWindow("2026-10-04T00:00:00Z", now)).toBe(true);
    expect(withinWindow("2026-10-02T00:00:00Z", now)).toBe(false);
  });
});
import { notificationTone } from "@/lib/notifications";
import { priorityNames, priorityTone } from "@/lib/bug-workflow";
describe("colours and priority order", () => {
  it("new bugs are red, activation green, priority change amber", () => {
    expect(notificationTone("bug.created")).toBe("danger");
    expect(notificationTone("member.activate")).toBe("success");
    expect(notificationTone("bug.priority")).toBe("warning");
  });
  it("P0 is highest and P5 lowest", () => {
    expect(priorityNames["P0"]).toBe("Highest");
    expect(priorityNames["P5"]).toBe("Lowest");
    expect(priorityTone("P0")).toBe("danger");
    expect(priorityTone("P5")).toBe("neutral");
  });
});
