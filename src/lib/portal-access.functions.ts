import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { unlockSchema, saveMemberSchema, portalReadSchema } from "./portal-access";

export const getAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.adminStatus);
});
export const unlockAdminAccess = createServerFn({ method: "POST" })
  .validator((data: unknown) => unlockSchema.parse(data))
  .handler(async ({ data }) => {
    const s = await import("./portal-access.server");
    return s.databaseCall(() => s.unlockAdmin(data));
  });
export const demoAdminAccess = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.demoUnlockAdmin);
});
export const lockAdminAccess = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.lockAdmin);
});
export const getAdminSessions = createServerFn({ method: "GET" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.listAdminSessions);
});
export const lockOtherDevices = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.signOutOtherDevices);
});
export const getMembers = createServerFn({ method: "GET" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.listMembers);
});
export const getProjects = createServerFn({ method: "GET" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.listProjects);
});
export const getProjectSummary = createServerFn({ method: "GET" }).handler(async () => {
  const s = await import("./portal-access.server");
  return s.databaseCall(s.projectSummary);
});
export const addProject = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(data),
  )
  .handler(async ({ data }) => {
    const s = await import("./portal-access.server");
    return s.databaseCall(() => s.createProject(data.name));
  });
export const archiveProject = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), archived: z.boolean() }).strict().parse(data),
  )
  .handler(async ({ data }) => {
    const s = await import("./portal-access.server");
    return s.databaseCall(() => s.setProjectArchived(data.id, data.archived));
  });
export const createMemberPortal = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveMemberSchema.parse(data))
  .handler(async ({ data }) => {
    const s = await import("./portal-access.server");
    return s.databaseCall(() => s.saveMember(data));
  });
export const manageMemberPortal = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), regenerate: z.boolean() }).strict().parse(data),
  )
  .handler(async ({ data }) => {
    const s = await import("./portal-access.server");
    return s.databaseCall(() => s.changePortal(data.id, data.regenerate));
  });
export const getMemberPortal = createServerFn({ method: "POST" })
  .validator((data: unknown) => portalReadSchema.parse(data))
  .handler(async ({ data }) => {
    const s = await import("./portal-access.server");
    return s.databaseCall(() => s.readPortal(data));
  });
