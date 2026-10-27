import { z } from "zod";
import { collaboratorSchema } from "./onboarding";

export const portalTypesByRole = {
  tester: "reporter",
  developer: "developer",
  qa: "qa",
  other: "member",
} as const;
/** Server messages for a missing or expired Admin session; the client sends the person back to sign-in on these. */
export const ADMIN_SIGNED_OUT = "Unlock private Admin access in Settings first.";
export const ADMIN_EXPIRED = "Admin access has expired or was revoked. Unlock access in Settings.";
export const isAdminSessionError = (e: unknown) =>
  e instanceof Error && (e.message === ADMIN_SIGNED_OUT || e.message === ADMIN_EXPIRED);
export const unlockSchema = z
  .object({ password: z.string().min(1).max(256), email: z.string().trim().email().max(254) })
  .strict();
export const saveMemberSchema = z
  .object({
    collaborator: collaboratorSchema,
    projectIds: z.array(z.string().uuid()).min(1).max(100),
    welcome: z.string().trim().max(12000),
  })
  .strict();
export const portalReadSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    type: z.enum(["reporter", "developer", "qa", "member"]),
  })
  .strict();
export async function hashToken(token: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function equalSecret(left: string, right: string) {
  const a = await hashToken(left);
  const b = await hashToken(right);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
