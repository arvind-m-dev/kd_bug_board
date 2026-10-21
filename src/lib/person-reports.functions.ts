import { createServerFn } from '@tanstack/react-start';
import { personReportQuerySchema } from './person-reports';

export const getPersonOverview = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => personReportQuerySchema.pick({ days: true }).parse(v))
  .handler(async ({ data }) => {
    const s = await import('./person-reports.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.personOverview(data.days));
  });

export const getPersonDetail = createServerFn({ method: 'POST' })
  .inputValidator((v: unknown) => personReportQuerySchema.required({ person: true }).parse(v))
  .handler(async ({ data }) => {
    const s = await import('./person-reports.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.personDetail(data.days, data.person));
  });
