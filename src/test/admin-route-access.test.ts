import { describe, it, expect, vi, beforeEach } from "vitest";
const { status } = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/lib/portal-access.functions", () => ({ getAdminStatus: status }));
import {
  forgetWorkspaceAccess,
  requireWorkspaceAccess,
  safeReturnPath,
} from "@/lib/admin-route-access";
import { ADMIN_EXPIRED, ADMIN_SIGNED_OUT, isAdminSessionError } from "@/lib/portal-access";

describe("Workspace sign-in access", () => {
  beforeEach(() => {
    status.mockReset();
    forgetWorkspaceAccess();
  });
  it("redirects signed-out visitors to the standalone login page", async () => {
    status.mockResolvedValue({ unlocked: false, name: "" });
    await expect(requireWorkspaceAccess()).rejects.toMatchObject({
      options: { to: "/login", replace: true, search: {} },
    });
  });
  it("keeps the page a signed-out visitor was opening, so the shared link opens after sign-in", async () => {
    status.mockResolvedValue({ unlocked: false, name: "" });
    await expect(
      requireWorkspaceAccess({ location: { href: "/admin/bugs?bug=42" } }),
    ).rejects.toMatchObject({
      options: { to: "/login", search: { redirect: "/admin/bugs?bug=42" } },
    });
  });
  it("allows a verified Admin to enter the workspace", async () => {
    status.mockResolvedValue({ unlocked: true, name: "Admin" });
    await expect(requireWorkspaceAccess()).resolves.toBeUndefined();
  });
});

describe("Return path after sign-in", () => {
  it("accepts same-site paths only", () => {
    expect(safeReturnPath("/admin/bugs?bug=42")).toBe("/admin/bugs?bug=42");
    expect(safeReturnPath("/media/12?m=x")).toBe("/media/12?m=x");
    for (const bad of [
      "https://evil.example/admin",
      "//evil.example/admin",
      "/\\evil.example",
      "javascript:alert(1)",
      "admin",
      "/login",
      "/login?redirect=/admin",
      "/" + "a".repeat(2001),
      42,
      undefined,
    ])
      expect(safeReturnPath(bad)).toBeUndefined();
  });
});

describe("Ended Admin sessions", () => {
  it("are recognised by their server message only", () => {
    expect(isAdminSessionError(new Error(ADMIN_SIGNED_OUT))).toBe(true);
    expect(isAdminSessionError(new Error(ADMIN_EXPIRED))).toBe(true);
    expect(isAdminSessionError(new Error("This bug changed. Refresh."))).toBe(false);
    expect(isAdminSessionError(ADMIN_EXPIRED)).toBe(false);
  });
});
