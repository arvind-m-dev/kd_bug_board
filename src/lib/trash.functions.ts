import { createServerFn } from '@tanstack/react-start';
import { trashItemSchema } from './trash';

const run = async <T>(work: (s: typeof import('./trash.server')) => Promise<T>) => { const s = await import('./trash.server'); const a = await import('./portal-access.server'); return a.databaseCall(() => work(s)); };
export const getTrash = createServerFn({ method: 'GET' }).handler(() => run(s => s.listTrash()));
export const restoreFromTrash = createServerFn({ method: 'POST' }).validator((v: unknown) => trashItemSchema.parse(v)).handler(({ data }) => run(s => s.restoreTrashItem(data)));
export const deleteForever = createServerFn({ method: 'POST' }).validator((v: unknown) => trashItemSchema.parse(v)).handler(({ data }) => run(s => s.deleteTrashItemForever(data)));
export const emptyTrash = createServerFn({ method: 'POST' }).handler(() => run(s => s.emptyTrash()));
