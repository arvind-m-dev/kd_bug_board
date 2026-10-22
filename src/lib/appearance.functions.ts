import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { appearanceSchema } from './appearance';

export const getAppearance = createServerFn({ method: 'GET' }).handler(async () => {
  const s = await import('./appearance.server');
  const a = await import('./portal-access.server');
  return a.databaseCall(() => s.readAppearance());
});

export const saveAppearance = createServerFn({ method: 'POST' })
  .validator((v: unknown) => z.object({ appearance: appearanceSchema, forAllPortals: z.boolean().default(false) }).strict().parse(v))
  .handler(async ({ data }) => {
    const s = await import('./appearance.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.writeAppearance(data.appearance, data.forAllPortals));
  });
