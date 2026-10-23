import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const getNotifications = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ limit: z.number().int().min(1).max(200) })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./notifications.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.listNotifications(data.limit));
  });
export const updateNotifications = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ kind: z.enum(["read", "clear"]) })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./notifications.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.markNotifications(data.kind));
  });
