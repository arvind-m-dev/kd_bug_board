import { describe, expect, it } from 'vitest';
import { periodLabel, periodWindow } from '@/lib/period';
import { activityQuerySchema } from '@/lib/activity';
import { personReportQuerySchema } from '@/lib/person-reports';

describe('reporting periods', () => {
  it('labels presets and ranges', () => {
    expect(periodLabel({ days: 0 })).toBe('all time');
    expect(periodLabel({ days: 60 })).toBe('last 60 days');
    expect(periodLabel({ days: 365 })).toBe('last 12 months');
    expect(periodLabel({ days: 0, from: '2026-10-13', to: '2026-10-13' })).toBe('13 Oct 2026');
    expect(periodLabel({ days: 0, from: '2026-10-01', to: '2026-10-21' })).toBe('1 Oct 2026 – 21 Oct 2026');
  });
  it('builds parameterised SQL for days and inclusive date ranges', () => {
    const a: unknown[] = []; expect(periodWindow({ days: 0 }, a)('x')).toBe('true'); expect(a).toEqual([]);
    const b: unknown[] = []; expect(periodWindow({ days: 60 }, b)('a.created_at')).toBe("a.created_at>=now()-($1::int||' days')::interval"); expect(b).toEqual([60]);
    const c: unknown[] = ['earlier']; const w = periodWindow({ days: 30, from: '2026-10-01', to: '2026-10-21', tz: 'Asia/Kolkata' }, c);
    expect(w('t')).toBe('t>=($3::date)::timestamp at time zone $2 and t<(($4::date)+1)::timestamp at time zone $2');
    expect(c).toEqual(['earlier', 'Asia/Kolkata', '2026-10-01', '2026-10-21']);
  });
  it('rejects bad dates and reversed ranges', () => {
    expect(activityQuerySchema.safeParse({ from: '2026-10-21', to: '2026-10-01' }).success).toBe(false);
    expect(activityQuerySchema.safeParse({ from: "2026-10-01'; drop" }).success).toBe(false);
    expect(personReportQuerySchema.safeParse({ days: 60, tz: 'Asia/Kolkata' }).success).toBe(true);
  });
});
