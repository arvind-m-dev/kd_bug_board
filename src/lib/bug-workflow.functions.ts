import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  accessSchema,
  reportSchema,
  bugChangeSchema,
  editSchema,
  optionsSchema,
} from "./bug-workflow";
export const getBugWorkspace = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ access: accessSchema, cursor: z.string().regex(/^\d+$/).optional() })
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
        access: accessSchema,
        projectId: z.string().uuid().nullable().default(null),
        includeClosed: z.boolean().default(true),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() =>
      s.exportBugs(data.access, { projectId: data.projectId, includeClosed: data.includeClosed }),
    );
  });
export const createBug = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, report: reportSchema }).strict().parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.reportBug(data.access, data.report));
  });
export const getBugDetail = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ access: accessSchema, id: z.string().regex(/^\d+$/) })
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
    z.object({ access: accessSchema, change: bugChangeSchema }).strict().parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./bug-workflow.server");
    const a = await import("./portal-access.server");
    return a.databaseCall(() => s.changeBug(data.access, data.change));
  });
export const editBug = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ access: accessSchema, edit: editSchema }).strict().parse(v))
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
