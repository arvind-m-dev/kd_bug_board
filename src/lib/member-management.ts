import { z } from "zod";
import { saveMemberSchema } from "./portal-access";
export const editMemberSchema = saveMemberSchema.extend({ id: z.string().uuid() }).strict();
export const memberActionSchema = z
  .object({ id: z.string().uuid(), action: z.enum(["deactivate", "activate", "delete", "copy"]) })
  .strict();
export function memberState(deleted: boolean, active: boolean, portalActive: boolean) {
  return deleted
    ? "Deleted"
    : !active
      ? "Deactivated"
      : portalActive
        ? "Active"
        : "Revoked / expired";
}
