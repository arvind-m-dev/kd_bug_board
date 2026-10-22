import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { accessSchema } from './bug-workflow';
import { deleteMediaSchema, finishMediaSchema, mediaStatusSchema, prepareMediaSchema } from './bug-media';

const run = async <T>(work: (s: typeof import('./bug-media.server')) => Promise<T>) => { const s = await import('./bug-media.server'); const a = await import('./portal-access.server'); return a.databaseCall(() => work(s)); };
export const prepareMediaUpload = createServerFn({ method: 'POST' }).validator((v: unknown) => z.object({ access: accessSchema, upload: prepareMediaSchema }).strict().parse(v)).handler(({ data }) => run(s => s.prepareUpload(data.access, data.upload)));
export const finishMediaUpload = createServerFn({ method: 'POST' }).validator((v: unknown) => z.object({ access: accessSchema, upload: finishMediaSchema }).strict().parse(v)).handler(({ data }) => run(s => s.finishUpload(data.access, data.upload)));
export const deleteMedia = createServerFn({ method: 'POST' }).validator((v: unknown) => z.object({ access: accessSchema, media: deleteMediaSchema }).strict().parse(v)).handler(({ data }) => run(s => s.deleteMedia(data.access, data.media.id)));
export const getMediaStatus = createServerFn({ method: 'POST' }).validator((v: unknown) => mediaStatusSchema.parse(v)).handler(({ data }) => run(s => s.mediaStatus(data.test)));
