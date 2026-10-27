import { redirect } from "@tanstack/react-router";
import { getAdminStatus } from "./portal-access.functions";

// Client-side navigation cache only: every server function still verifies the Admin session.
const TTL = 5 * 60_000;
let verifiedAt = 0;
export function forgetWorkspaceAccess() {
  verifiedAt = 0;
}
/** A same-site path to return to after sign-in; anything else (other hosts, protocol-relative, the login page) is dropped. */
export function safeReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (/^\/login(?:[/?#]|$)/.test(value)) return undefined;
  return value;
}
export async function requireWorkspaceAccess(opts?: { location?: { href?: string } }) {
  const browser = typeof window !== "undefined";
  if (browser && Date.now() - verifiedAt < TTL) return;
  const status = await getAdminStatus();
  if (!status.unlocked) {
    verifiedAt = 0;
    // Keep where the person was going so a shared /admin link opens after sign-in.
    const back = safeReturnPath(opts?.location?.href);
    throw redirect({ to: "/login", search: back ? { redirect: back } : {}, replace: true });
  }
  if (browser) verifiedAt = Date.now();
}
