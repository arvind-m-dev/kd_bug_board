import { redirect } from "@tanstack/react-router";
import { getAdminStatus } from "./portal-access.functions";

// Client-side navigation cache only: every server function still verifies the Admin session.
const TTL = 5 * 60_000;
let verifiedAt = 0;
export function forgetWorkspaceAccess() {
  verifiedAt = 0;
}
export async function requireWorkspaceAccess() {
  const browser = typeof window !== "undefined";
  if (browser && Date.now() - verifiedAt < TTL) return;
  const status = await getAdminStatus();
  if (!status.unlocked) {
    verifiedAt = 0;
    throw redirect({ to: "/login", replace: true });
  }
  if (browser) verifiedAt = Date.now();
}
