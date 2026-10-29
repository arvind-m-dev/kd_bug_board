import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { accessSchema } from "./bug-workflow";
import {
  createSprintSchema,
  updateSprintSchema,
  sprintActionSchema,
  sprintItemSchema,
} from "./sprints";

export const getPortalSprints = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ access: accessSchema }).strict().parse(v))
  .handler(async ({ data }) => {
    const s = await import("./sprints.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.portalSprints(data.access));
  });

export const getSprints = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./sprints.server");
  const a = await import("./portal-access.server");
  return a.databaseCall(() => s.sprintsData());
});

export const createSprintFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => createSprintSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./sprints.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.createSprint(data));
  });

export const updateSprintFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => updateSprintSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./sprints.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.updateSprint(data));
  });

export const startSprintFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => sprintActionSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./sprints.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.startSprint(data));
  });

export const closeSprintFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => sprintActionSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./sprints.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.closeSprint(data));
  });

export const addToSprintFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => sprintItemSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./sprints.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.addToSprint(data));
  });

export const removeFromSprintFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => sprintItemSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./sprints.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.removeFromSprint(data));
  });
