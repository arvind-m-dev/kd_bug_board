import { describe, expect, it } from 'vitest';
import { acceptanceRate, outcomeCounts, passRate, personReportQuerySchema, reportFocus, type PersonMetrics } from '@/lib/person-reports';

const base: PersonMetrics = { id: 'x', name: 'X', role: 'reporter', current: true, raised: 0, raisedByPriority: {}, raisedBySeverity: {}, raisedByStatus: {}, raisedReopened: 0, raisedRevalidated: 0, owned: 0, ownedOpen: 0, ownedByPriority: {}, sentToQa: 0, fixed: 0, avgFixDays: null, ownedReopened: 0, validated: 0, rejected: 0, revalidated: 0, needsInfo: 0, qaPassed: 0, qaFailed: 0, changes: 0 };

describe('person reports', () => {
  it('groups raised bugs into outcomes', () => {
    expect(outcomeCounts({ RESOLVED: 2, NEW: 1, IN_PROGRESS: 2, NOT_A_BUG: 1, DUPLICATE: 1, WONT_FIX: 1 })).toEqual({ fixed: 2, open: 3, notabug: 1, duplicate: 1, wontfix: 1 });
  });
  it('accepts every raised bug that was not rejected as not-a-bug or duplicate', () => {
    expect(acceptanceRate({ raised: 0, raisedByStatus: {} })).toBeNull();
    expect(acceptanceRate({ raised: 4, raisedByStatus: { RESOLVED: 2, NOT_A_BUG: 1, NEW: 1 } })).toBe(75);
  });
  it('computes the QA pass rate', () => {
    expect(passRate({ qaPassed: 0, qaFailed: 0 })).toBeNull();
    expect(passRate({ qaPassed: 3, qaFailed: 1 })).toBe(75);
  });
  it('picks the report focus from the role', () => {
    expect(reportFocus({ ...base, role: 'developer' })).toBe('developer');
    expect(reportFocus({ ...base, role: 'qa' })).toBe('qa');
    expect(reportFocus({ ...base, role: 'member' })).toBe('tester');
  });
  it('only accepts a valid person id', () => {
    expect(personReportQuerySchema.safeParse({ person: 'not-an-id' }).success).toBe(false);
    expect(personReportQuerySchema.safeParse({ person: crypto.randomUUID(), days: 30 }).success).toBe(true);
  });
});
