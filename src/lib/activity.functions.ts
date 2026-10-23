import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { activityQuerySchema } from "./activity";
import { periodFields, validRange } from "./period";

const periodOnly = z
  .object(periodFields)
  .strict()
  .refine(validRange, "The start date must be on or before the end date.");

export const getActivity = createServerFn({ method: "POST" })
  .validator((v: unknown) => activityQuerySchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./activity.server");
    const a = await import("./portal-access.server");
    const { cursor, ...filters } = data;
    return a.databaseCall(() => s.activityStream(cursor, filters));
  });

export const getActivityInsights = createServerFn({ method: "POST" })
  .validator((v: unknown) => activityQuerySchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./activity.server");
    const a = await import("./portal-access.server");
    const { cursor: _cursor, ...filters } = data;
    return a.databaseCall(() => s.activityInsights(filters));
  });

export const getActivityPeople = createServerFn({ method: "GET" }).handler(async () => {
  const s = await import("./activity.server");
  const a = await import("./portal-access.server");
  return a.databaseCall(() => s.activityPeople());
});

export const getTeamPerformance = createServerFn({ method: "POST" })
  .validator((v: unknown) => periodOnly.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./activity.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.teamPerformance(data));
  });
