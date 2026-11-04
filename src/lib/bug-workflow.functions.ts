import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  clientAccessSchema,
  reportSchema,
  bugChangeSchema,
  editSchema,
  optionsSchema,
} from "./bug-workflow";
export const getBugWorkspace = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ access: clientAccessSchema, cursor: z.string().regex(/^\d+$/).optional() })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.workspaceData(data.access, data.cursor));
  });
export const getBugExport = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        access: clientAccessSchema,
        projectId: z.string().uuid().nullable().default(null),
        includeClosed: z.boolean().default(true),
        ids: z
          .array(z.string().regex(/^[1-9]\d{0,17}$/))
          .max(2000)
          .nullable()
          .default(null),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() =>
      s.exportBugs(data.access, {
        projectId: data.projectId,
        includeClosed: data.includeClosed,
        ids: data.ids,
      }),
    );
  });
export const createBug = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: clientAccessSchema, report: reportSchema }).strict().parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.reportBug(data.access, data.report));
  });
export const getBugDetail = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ access: clientAccessSchema, id: z.string().regex(/^\d+$/) })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.bugDetail(data.access, data.id));
  });
export const updateBug = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: clientAccessSchema, change: bugChangeSchema }).strict().parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.changeBug(data.access, data.change));
  });
export const editBug = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: clientAccessSchema, edit: editSchema }).strict().parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.editBugReport(data.access, data.edit));
  });
export const saveOptions = createServerFn({ method: "POST" })
  .validator((v: unknown) => optionsSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.saveDropdownOptions(data));
  });
export const saveTimeZone = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ timeZone: z.string().trim().min(1).max(64) })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.saveWorkspaceTimeZone(data.timeZone));
  });
export const deleteBug = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ id: z.string().regex(/^\d+$/), reason: z.string().trim().max(500).default("") })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.deleteBugReport(data.id, data.reason));
  });
