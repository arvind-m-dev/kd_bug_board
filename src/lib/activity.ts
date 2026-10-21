import { z } from 'zod';

/** Client-safe activity types, filter categories and display helpers. */

export type ActivityRow = { id: string; action: string; at: string; bugId: string | null; bugCode: string; bugTitle: string; actor: string; via: string; detail: Record<string, string> };
export type ActivityPage = { rows: ActivityRow[]; nextCursor: string };

export const ACTIVITY_CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'All activity' },
  { key: 'created', label: 'New bugs' },
  { key: 'status', label: 'Status changes' },
  { key: 'priority', label: 'Priority changes' },
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
];

export const activityQuerySchema = z.object({
  cursor: z.string().regex(/^[^|]+\|[0-9a-f-]{36}$/).optional(),
  type: z.string().trim().max(20).default('all'),
  days: z.union([z.literal(0), z.literal(7), z.literal(30)]).default(0),
  query: z.string().trim().max(120).default(''),
}).strict();
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

export function changeText(row: ActivityRow) {
  const d = row.detail; const parts: string[] = [];
  if (d['status'] && d['status'] !== d['previousStatus']) parts.push(`Status ${d['previousStatus'] || '—'} → ${d['status']}`);
  if (d['priority'] && d['priority'] !== d['previousPriority']) parts.push(`Priority ${d['previousPriority'] || '—'} → ${d['priority']}`);
  if (clean(d['assignee'])) parts.push(`Assigned to ${d['assignee']}`);
  if (clean(d['noteTo'])) parts.push(`Note to ${d['noteTo']}`);
  if (clean(d['notes'])) parts.push(d['notes']);
  if (clean(d['title'])) parts.push(d['title']);
  if (clean(d['reason'])) parts.push(d['reason']);
  if (!parts.length) {
    const rest = Object.entries(d)
      .filter(([k, v]) => !['previousStatus', 'previousPriority'].includes(k) && clean(v))
      .map(([, v]) => v);
    parts.push(...rest.slice(0, 3));
  }
  const text = parts.join(' · ');
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
