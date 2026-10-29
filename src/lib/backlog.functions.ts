import { createServerFn } from "@tanstack/react-start";
import { createWorkItemSchema, updateWorkItemSchema } from "./backlog";

export const getBacklog = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./backlog.server");
  const a = await import("./portal-access.server");
  return a.databaseCall(() => s.backlogData());
});

export const createWorkItemFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => createWorkItemSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./backlog.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.createWorkItem(data));
  });

export const updateWorkItemFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => updateWorkItemSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./backlog.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.updateWorkItem(data));
  });
