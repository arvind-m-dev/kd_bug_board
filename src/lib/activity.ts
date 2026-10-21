import { z } from 'zod';

/** Client-safe activity types, filter categories and display helpers. */

export type ActivityRow = { id: string; action: string; at: string; bugId: string | null; bugCode: string; bugTitle: string; actor: string; via: string; detail: Record<string, string> };
export type ActivityPage = { rows: ActivityRow[]; nextCursor: string };

export const ACTIVITY_CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'All activity' },
  { key: 'created', label: 'New bugs' },
  { key: 'status', label: 'Status changes' },
  { key: 'priority', label: 'Priority & severity' },
  { key: 'assign', label: 'Assignments' },
  { key: 'verify', label: 'QA verifications' },
  { key: 'comment', label: 'Comments & notes' },
  { key: 'edited', label: 'Bug edits' },
  { key: 'deleted', label: 'Bug deletions' },
  { key: 'team', label: 'Team & portals' },
];

export const ACTIVITY_PERIODS: { value: string; label: string }[] = [
  { value: '0', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export const ACTIVITY_SOURCES: { value: string; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'admin', label: 'Admin' }, { value: 'reporter', label: 'Reporter portal' }, { value: 'qa', label: 'QA portal' },
  { value: 'developer', label: 'Developer portal' }, { value: 'member', label: 'Member portal' },
];

/** Chart series, in fixed colour order. */
export const ACTIVITY_SERIES = [
  { key: 'reported', label: 'Bugs reported' },
  { key: 'status', label: 'Status & QA' },
  { key: 'assign', label: 'Assignments' },
  { key: 'other', label: 'Other updates' },
] as const;
export type ActivitySeriesKey = typeof ACTIVITY_SERIES[number]['key'];
export type ActivityInsights = {
  totals: { events: number; bugs: number; people: number; reopened: number; resolved: number };
  daily: ({ day: string } & Record<ActivitySeriesKey, number>)[];
  categories: { key: string; count: number }[];
  people: { id: string; name: string; count: number }[];
  windowDays: number;
};

export const activityQuerySchema = z.object({
  cursor: z.string().regex(/^[^|]+\|[0-9a-f-]{36}$/).optional(),
  type: z.string().trim().max(20).default('all'),
  days: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)]).default(0),
  query: z.string().trim().max(120).default(''),
  actor: z.string().uuid().optional(),
  via: z.enum(['admin', 'reporter', 'qa', 'developer', 'member']).optional(),
  tz: z.string().regex(/^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/).max(60).default('UTC'),
}).strict();
export type ActivityFilters = Omit<ActivityQuery, 'cursor'>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const VIA_LABELS: Record<string, string> = {
  admin: 'Admin', reporter: 'Reporter', qa: 'QA', developer: 'Developer', member: 'Member',
};
export function viaLabel(via: string) { return VIA_LABELS[via] ?? 'Workspace'; }

export function formatWhen(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** One-line summary of what changed, from the stored detail keys. */
const UUID = /^[0-9a-f-]{36}$/i;
function clean(value: string | undefined): value is string { return !!value && value !== 'null' && !UUID.test(value) && !/^[[{]/.test(value); }

export function statusText(v: string | undefined) {
  if (!v) return '—';
  return v === 'RECHECK' ? 'Ready for QA retest' : v.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
}

export function changeText(row: ActivityRow) {
  const d = row.detail; const parts: string[] = [];
  if (d['status'] && d['status'] !== d['previousStatus']) parts.push(`${statusText(d['previousStatus'])} → ${statusText(d['status'])}`);
  if (d['severity'] && d['previousSeverity'] && d['severity'] !== d['previousSeverity']) parts.push(`Severity ${d['previousSeverity']} → ${d['severity']}`);
  if (d['priority'] && d['priority'] !== d['previousPriority']) parts.push(d['previousPriority'] ? `Priority ${d['previousPriority']} → ${d['priority']}` : `Priority ${d['priority']}`);
  if (clean(d['assignee'])) parts.push(`Assigned to ${d['assignee']}`);
  if (clean(d['noteTo'])) parts.push(`Note to ${d['noteTo']}`);
  if (clean(d['notes'])) parts.push(d['notes']);
  if (clean(d['title'])) parts.push(d['title']);
  if (clean(d['reason'])) parts.push(d['reason']);
  if (!parts.length) {
    const rest = Object.entries(d)
      .filter(([k, v]) => !['previousStatus', 'previousPriority', 'previousSeverity', 'severity', 'priority', 'status', 'historyPreserved'].includes(k) && clean(v) && v !== 'true' && v !== 'false')
      .map(([, v]) => v);
    parts.push(...rest.slice(0, 3));
  }
  const text = parts.join(' · ');
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
