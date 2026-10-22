import { createServerFn } from '@tanstack/react-start';
import { appearanceSchema } from './appearance';

export const getAppearance = createServerFn({ method: 'GET' }).handler(async () => {
  const s = await import('./appearance.server');
  const a = await import('./portal-access.server');
  return a.databaseCall(() => s.readAppearance());
});

export const saveAppearance = createServerFn({ method: 'POST' })
  .validator((v: unknown) => appearanceSchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import('./appearance.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.writeAppearance(data));
  });
