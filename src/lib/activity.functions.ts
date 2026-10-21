import { createServerFn } from '@tanstack/react-start';
import { activityQuerySchema } from './activity';

export const getActivity = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => activityQuerySchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import('./activity.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.activityStream(data.cursor, data.type, data.days, data.query));
  });
