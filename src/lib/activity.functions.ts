import { createServerFn } from '@tanstack/react-start';
import { activityQuerySchema } from './activity';

export const getActivity = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => activityQuerySchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import('./activity.server');
    const a = await import('./portal-access.server');
    const { cursor, ...filters } = data;
    return a.databaseCall(() => s.activityStream(cursor, filters));
  });

export const getActivityInsights = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => activityQuerySchema.omit({ cursor: true }).parse(v))
  .handler(async ({ data }) => {
    const s = await import('./activity.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.activityInsights(data));
  });

export const getActivityPeople = createServerFn({ method: 'GET' }).handler(async () => {
  const s = await import('./activity.server');
  const a = await import('./portal-access.server');
  return a.databaseCall(() => s.activityPeople());
});

export const getTeamPerformance = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => activityQuerySchema.pick({ days: true }).parse(v))
  .handler(async ({ data }) => {
    const s = await import('./activity.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.teamPerformance(data.days));
  });
