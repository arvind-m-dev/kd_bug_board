import { createServerFn } from '@tanstack/react-start';
import { personReportQuerySchema } from './person-reports';

export const getPersonOverview = createServerFn({ method: 'POST' })
  .validator((v: unknown) => personReportQuerySchema.parse(v))
  .handler(async ({ data }) => {
    const s = await import('./person-reports.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.personOverview(data));
  });

export const getPersonDetail = createServerFn({ method: 'POST' })
  .validator((v: unknown) => { const d = personReportQuerySchema.parse(v); if (!d.person) throw new Error('Choose a person.'); return { ...d, person: d.person }; })
  .handler(async ({ data }) => {
    const s = await import('./person-reports.server');
    const a = await import('./portal-access.server');
    return a.databaseCall(() => s.personDetail(data, data.person));
  });

export const getTeamDetail = createServerFn({ method: 'POST' }).handler(async () => {
  const s = await import('./person-reports.server');
  const a = await import('./portal-access.server');
  return a.databaseCall(() => s.teamDetail());
});
