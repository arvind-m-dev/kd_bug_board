import { z } from "zod";

export const permissionLabels = {
  view: "View scoped bugs",
  view_all: "View all project bugs (read only)",
  report: "Report bugs",
  comment: "Comment on bugs",
  evidence: "View evidence",
  validate: "Validate bugs",
  assign: "Assign developers",
  verify: "Verify fixes",
  progress: "Update assigned bugs",
  recheck: "Request QA retest",
  disposition: "Close as not a bug, duplicate or won’t fix",
  plan: "Plan work: set due dates and sprints",
} as const;
export type Permission = keyof typeof permissionLabels;
export const rolePermissions: Record<string, Permission[]> = {
  tester: ["view", "view_all", "report", "comment", "evidence"],
  developer: [
    "view",
    "view_all",
    "report",
    "comment",
    "evidence",
    "progress",
    "recheck",
    "disposition",
  ],
  qa: ["view", "view_all", "report", "comment", "evidence", "validate", "assign", "verify", "plan"],
  other: ["view", "view_all", "report", "comment", "evidence"],
};
export const collaboratorSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    role: z.enum(["tester", "developer", "qa", "other"]),
    scope: z.string().trim().min(1).max(300),
    context: z.string().trim().max(1000),
    permissions: z
      .array(
        z.enum([
          "view",
          "view_all",
          "report",
          "comment",
          "evidence",
          "validate",
          "assign",
          "verify",
          "progress",
          "recheck",
          "disposition",
          "plan",
        ]),
      )
      .max(11),
  })
  .strict()
  .superRefine((value, ctx) => {
    const allowed = rolePermissions[value.role] ?? [];
    if (value.permissions.some((permission) => !allowed.includes(permission))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "These permissions are not available for the selected role.",
      });
    }
  });
export type Collaborator = z.infer<typeof collaboratorSchema>;
export function onboardingContext(value: Collaborator) {
  // Email is needed for member details, not for AI personalization.
  return {
    name: value.name,
    role: value.role,
    scope: value.scope,
    context: value.context,
    permissions: value.permissions.map((permission) => permissionLabels[permission]),
  };
}
