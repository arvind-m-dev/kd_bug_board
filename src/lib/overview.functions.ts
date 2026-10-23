import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { periodFields, validRange } from "./period";

const schema = z
  .object(periodFields)
  .strict()
  .refine(validRange, "The start date must be on or before the end date.");
export const getOverviewStats = createServerFn({ method: "POST" })
  .validator((v: unknown) => schema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./overview.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.overviewStats(data));
  });
