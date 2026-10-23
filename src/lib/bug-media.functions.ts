import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { accessSchema } from "./bug-workflow";
import {
  clearMediaSchema,
  deleteMediaSchema,
  finishMediaSchema,
  mediaCleanupSchema,
  mediaQuotaSchema,
  mediaStatusSchema,
  mediaStorageSchema,
  prepareMediaSchema,
  renameMediaSchema,
  saveMarksSchema,
} from "./bug-media";

const run = async <T>(work: (s: typeof import("./bug-media.server")) => Promise<T>) => {
  const s = await import("./bug-media.server");
  const a = await import("./portal-access.server");
  return a.databaseCall(() => work(s));
};
export const prepareMediaUpload = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, upload: prepareMediaSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.prepareUpload(data.access, data.upload)));
export const finishMediaUpload = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, upload: finishMediaSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.finishUpload(data.access, data.upload)));
export const saveVideoMarks = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, media: saveMarksSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.saveVideoMarks(data.access, data.media)));
export const restoreMedia = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, media: deleteMediaSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.restoreMedia(data.access, data.media.id)));
export const deleteMediaForever = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, media: deleteMediaSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.deleteMediaForever(data.access, data.media.id)));
export const getMediaTrash = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ access: accessSchema }).strict().parse(v))
  .handler(({ data }) => run((s) => s.listMediaTrash(data.access)));
export const deleteMedia = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, media: deleteMediaSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.deleteMedia(data.access, data.media.id)));
export const renameMedia = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, media: renameMediaSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.renameMedia(data.access, data.media)));
export const getMediaLibrary = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ access: accessSchema }).strict().parse(v))
  .handler(({ data }) => run((s) => s.listLibrary(data.access)));
export const saveMediaStorage = createServerFn({ method: "POST" })
  .validator((v: unknown) => mediaStorageSchema.parse(v))
  .handler(({ data }) => run((s) => s.saveMediaStorage(data)));
export const clearBugMedia = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ access: accessSchema, media: clearMediaSchema }).strict().parse(v),
  )
  .handler(({ data }) => run((s) => s.clearBugMedia(data.access, data.media.bugId)));
export const getMediaUsage = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ refresh: z.boolean().default(false) })
      .strict()
      .parse(v),
  )
  .handler(({ data }) => run((s) => s.mediaUsage(data.refresh)));
export const saveMediaQuota = createServerFn({ method: "POST" })
  .validator((v: unknown) => mediaQuotaSchema.parse(v))
  .handler(({ data }) => run((s) => s.saveMediaQuota(data.gb)));
export const saveMediaCleanup = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.union([mediaCleanupSchema, z.object({ now: z.literal(true) }).strict()]).parse(v),
  )
  .handler(({ data }) => run((s) => s.saveMediaCleanup(data)));
export const getMediaStatus = createServerFn({ method: "POST" })
  .validator((v: unknown) => mediaStatusSchema.parse(v))
  .handler(({ data }) => run((s) => s.mediaStatus(data.test)));
