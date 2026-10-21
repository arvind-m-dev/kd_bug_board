import { z } from 'zod';

/** Client-safe types and helpers for per-person reports. */

export const personReportQuerySchema = z.object({
  days: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)]).default(0),
  person: z.string().uuid().optional(),
}).strict();

export type Counts = Record<string, number>;
export type PersonMetrics = {
  id: string; name: string; role: string; current: boolean;
  // As a reporter: bugs they raised (current state of each).
  raised: number; raisedByPriority: Counts; raisedBySeverity: Counts; raisedByStatus: Counts; raisedReopened: number; raisedRevalidated: number;
  // As an owner (developer): bugs assigned to them.
  owned: number; ownedOpen: number; ownedByPriority: Counts; sentToQa: number; fixed: number; avgFixDays: number | null; ownedReopened: number;
  // Decisions they made: validations, rejections, revalidations, info requests, QA retests.
  validated: number; rejected: number; revalidated: number; needsInfo: number; qaPassed: number; qaFailed: number;
  changes: number;
};
export type PersonTrendWeek = { week: string; raised: number; fixed: number };
export type PersonRecentBug = { id: string; code: string; title: string; status: string; priority: string; severity: string; relation: 'raised' | 'assigned' | 'both'; updatedAt: string };
export type PersonDetail = { metrics: PersonMetrics; trend: PersonTrendWeek[]; recent: PersonRecentBug[] };

const CLOSED = ['RESOLVED', 'NOT_A_BUG', 'DUPLICATE', 'WONT_FIX'];

/** What happened to the bugs a person raised, grouped into outcomes (fixed order for colour). */
export const OUTCOMES = [
  { key: 'fixed', label: 'Fixed', statuses: ['RESOLVED'] },
  { key: 'open', label: 'Still open', statuses: [] as string[] },
  { key: 'notabug', label: 'Not a bug', statuses: ['NOT_A_BUG'] },
  { key: 'duplicate', label: 'Duplicate', statuses: ['DUPLICATE'] },
  { key: 'wontfix', label: 'Won’t fix', statuses: ['WONT_FIX'] },
] as const;
export function outcomeCounts(byStatus: Counts) {
  const out: Record<(typeof OUTCOMES)[number]['key'], number> = { fixed: 0, open: 0, notabug: 0, duplicate: 0, wontfix: 0 };
  for (const [status, n] of Object.entries(byStatus)) {
    const o = OUTCOMES.find(x => (x.statuses as readonly string[]).includes(status));
    out[o ? o.key : CLOSED.includes(status) ? 'wontfix' : 'open'] += n;
  }
  return out;
}

/** Share of raised bugs that were real (not rejected as not-a-bug or duplicate), or null with nothing raised. */
export function acceptanceRate(m: Pick<PersonMetrics, 'raised' | 'raisedByStatus'>) {
  if (!m.raised) return null;
  const o = outcomeCounts(m.raisedByStatus);
  return Math.round(((m.raised - o.notabug - o.duplicate) / m.raised) * 100);
}

/** QA retest pass rate in %, or null with no retests. */
export function passRate(m: Pick<PersonMetrics, 'qaPassed' | 'qaFailed'>) {
  const t = m.qaPassed + m.qaFailed;
  return t ? Math.round((m.qaPassed / t) * 100) : null;
}

/** Which report focus fits this person: their role, or what they actually did most. */
export function reportFocus(m: PersonMetrics): 'tester' | 'developer' | 'qa' | 'admin' {
  if (m.role === 'developer') return 'developer';
  if (m.role === 'qa') return 'qa';
  if (m.role === 'admin') return 'admin';
  return 'tester';
}
