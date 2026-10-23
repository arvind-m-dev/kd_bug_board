import { z } from "zod";
import { STATUSES, canTransition, type Status, type Role } from "./bugflow";
import type { MediaConfig } from "./bug-media";
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4", "P5"] as const;
export const priorityNames: Record<string, string> = {
  P0: "Highest",
  P1: "Very high",
  P2: "High",
  P3: "Medium",
  P4: "Low",
  P5: "Lowest",
};
export const DEFAULT_SEVERITIES = ["Critical", "High", "Medium", "Low"];
/** Colour level 1 (most severe) to 5 for a severity, by its position in the configured list (most severe first). */
export function severityLevel(severity: string, list: readonly string[] = DEFAULT_SEVERITIES) {
  const i = list.indexOf(severity);
  if (i < 0) return 5;
  if (list.length <= 1) return 1;
  return 1 + Math.round((i * (Math.min(list.length, 5) - 1)) / (list.length - 1));
}
export const priorityTone = (p: string) =>
  p === "P0" || p === "P1"
    ? "danger"
    : p === "P2"
      ? "warning"
      : p === "P3"
        ? "info"
        : p === "P4"
          ? "success"
          : "neutral";
export const accessSchema = z.union([
  z.object({ kind: z.literal("admin") }).strict(),
  z
    .object({
      kind: z.literal("portal"),
      token: z.string().regex(/^[a-f0-9]{64}$/),
      type: z.enum(["reporter", "qa", "developer", "member"]),
    })
    .strict(),
  z.object({ kind: z.literal("ai"), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type BugAccess = z.infer<typeof accessSchema>;
export const evidenceUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (url.hostname === "drive.google.com" || url.hostname === "docs.google.com")
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS Google Drive or Google Docs link.");
const reportFields = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    title: z.string().trim().max(180).default(""),
    module: z.string().trim().max(100).default(""),
    priority: z.enum(PRIORITIES).default("P3"),
    severity: z.string().trim().min(1).max(40).default("Medium"),
    description: z.string().trim().min(1, "Enter the bug description.").max(8000),
    steps: z
      .array(z.string().trim().min(1).max(2000))
      .min(1, "Add at least one step to replicate.")
      .max(30),
    expected: z.string().trim().max(4000).default(""),
    actual: z.string().trim().max(4000).default(""),
    browserDevice: z.string().trim().max(200).default(""),
    environment: z.string().trim().max(80).default(""),
    evidenceUrls: z.array(evidenceUrlSchema).max(10).default([]),
  })
  .strict();
function completeReport<T extends { title: string; description: string; actual: string }>(
  report: T,
): T {
  return {
    ...report,
    title:
      report.title ||
      report.description.split("\n")[0]?.slice(0, 180) ||
      report.description.slice(0, 180),
    actual: report.actual || report.description.slice(0, 4000),
  };
}
export const reportSchema = reportFields.transform(completeReport);
export const bugChangeSchema = z
  .object({
    requestId: z.string().uuid(),
    id: z.string().regex(/^\d+$/),
    version: z.string().min(1).max(60),
    action: z.enum(["status", "priority", "severity", "assign", "comment", "verify"]),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    severity: z.string().trim().min(1).max(40).optional(),
    assigneeId: z.string().uuid().optional(),
    assigneeIds: z.array(z.string().uuid()).max(20).optional(),
    notes: z.string().trim().max(4000).default(""),
    noteTo: z.string().trim().max(120).default(""),
    passed: z.boolean().optional(),
  })
  .strict();
export type BugChange = z.infer<typeof bugChangeSchema>;
export const editSchema = reportFields
  .omit({ requestId: true, projectId: true })
  .extend({ id: z.string().regex(/^\d+$/), version: z.string().min(1).max(60) })
  .strict()
  .transform(completeReport);
export type BugEdit = z.infer<typeof editSchema>;
export const LOCKED_FOR_EDIT = ["RESOLVED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"];
export function mayEditBug(
  actor: { userId: string; role: string; permissions: string[] },
  bug: { reporterId: string; status: string; assigneeId: string | null },
) {
  if (actor.role === "admin") return true;
  if (LOCKED_FOR_EDIT.includes(bug.status)) return false;
  if (actor.permissions.includes("report") && bug.reporterId === actor.userId) return true;
  return actor.role === "developer" && bug.assigneeId === actor.userId;
}
const optionList = z.array(z.string().trim().min(1).max(80)).max(50);
export const optionsSchema = z
  .object({
    modules: optionList,
    environments: optionList,
    devices: optionList,
    severities: z.array(z.string().trim().min(1).max(40)).max(12).default(DEFAULT_SEVERITIES),
  })
  .strict();
export type DropdownOptions = z.infer<typeof optionsSchema>;
export const DEFAULT_DEVICES = [
  "Chrome · Desktop",
  "Safari · Desktop",
  "Firefox · Desktop",
  "Chrome · Android",
  "Safari · iPhone",
  "Android · Mobile",
  "iOS · Mobile",
  "Tablet · Android / iPad",
];
export const DEFAULT_OPTIONS: DropdownOptions = {
  modules: [],
  environments: ["Development", "Staging", "Production"],
  devices: DEFAULT_DEVICES,
  severities: DEFAULT_SEVERITIES,
};
export function cleanOptions(v: unknown): DropdownOptions {
  const r = optionsSchema.safeParse(v);
  if (!r.success) return DEFAULT_OPTIONS;
  const u = (a: string[]) => [...new Set(a)];
  const severities = u(r.data.severities);
  return {
    modules: u(r.data.modules),
    environments: u(r.data.environments),
    devices: u(r.data.devices),
    severities: severities.length ? severities : DEFAULT_SEVERITIES,
  };
}
export type BugActor = {
  userId: string;
  portalId: string;
  name: string;
  role: Role;
  permissions: string[];
};
/** A bug as exported to a spreadsheet: the live bug plus the latest comments and attachment ids. */
export type ExportBug = LiveBug & { devComment: string; qaComment: string; mediaIds: string[] };
export type LiveBug = {
  id: string;
  code: string;
  title: string;
  projectId: string;
  project: string;
  reporterId: string;
  reporter: string;
  assigneeId: string | null;
  assignee: string;
  assignees?: { id: string; name: string }[];
  status: Status;
  priority: string;
  severity: string;
  description: string;
  expected: string;
  actual: string;
  browserDevice: string;
  environment: string;
  fixNotes: string;
  createdAt: string;
  updatedAt: string;
  version: string;
  steps: string[];
  evidenceUrls: string[];
  module: string;
  lastChange: LastChange;
  statusNote?: StatusNote;
};
/** The reason recorded when the bug moved into its current status (e.g. why it was reopened). */
export type StatusNote = { by: string; at: string; notes: string } | null;
export type BugEvent = {
  id: string;
  bugId: string;
  actor: string;
  action: string;
  detail: Record<string, string>;
  createdAt: string;
};
export type BugWorkspaceData = {
  options: DropdownOptions;
  actor: BugActor;
  projects: { id: string; name: string }[];
  developers: { id: string; name: string; role?: string; projectIds: string[] }[];
  bugs: LiveBug[];
  total: number;
  open: number;
  recheck: number;
  resolved: number;
  unassigned: number;
  statusCounts: StatusCount[];
  nextCursor: string | null;
  media: MediaConfig;
};
export function maySeeBug(actor: BugActor, bug: { reporterId: string; assigneeId: string | null }) {
  return (
    actor.role === "admin" ||
    actor.role === "qa" ||
    actor.permissions.includes("view_all") ||
    bug.reporterId === actor.userId ||
    bug.assigneeId === actor.userId
  );
}
export function mayUpdateStatus(
  actor: BugActor,
  bug: { status: Status; reporterId: string; assigneeId: string | null },
  to: Status,
) {
  if (to === "RESOLVED" || to === "ASSIGNED" || (bug.status === "RECHECK" && to === "REOPENED"))
    return false; // only the verification action may resolve
  if (to === "REOPENED" && bug.status === "RESOLVED")
    return (
      actor.role === "admin" ||
      actor.permissions.includes("verify") ||
      (bug.reporterId === actor.userId && actor.permissions.includes("report"))
    );
  if (
    actor.role === "admin" &&
    to === "VALIDATING" &&
    ["REOPENED", "VALIDATED", "READY_FOR_ASSIGNMENT"].includes(bug.status)
  )
    return true;
  if (actor.role === "admin") return canTransition("admin", bug.status, to);
  if (actor.role === "qa" && actor.permissions.includes("validate"))
    return canTransition("qa", bug.status, to);
  if (bug.assigneeId !== actor.userId) return false;
  if (["NOT_A_BUG", "DUPLICATE", "WONT_FIX"].includes(to))
    return actor.permissions.includes("disposition") && canTransition("developer", bug.status, to);
  return (
    ((to === "IN_PROGRESS" && actor.permissions.includes("progress")) ||
      (to === "RECHECK" && actor.permissions.includes("recheck")) ||
      (to === "NEEDS_INFORMATION" && actor.permissions.includes("progress"))) &&
    canTransition("developer", bug.status, to)
  );
}
/** Steps from the bug's status to the target that this actor may make, e.g. NEW→VALIDATING→VALIDATED→READY_FOR_ASSIGNMENT. */
export function statusPath(
  actor: BugActor,
  bug: { status: Status; reporterId: string; assigneeId: string | null },
  to: Status,
): [string, string][] | null {
  if (bug.status === to) return null;
  const queue: { at: Status; path: [string, string][] }[] = [{ at: bug.status, path: [] }];
  const seen = new Set<string>([bug.status]);
  while (queue.length) {
    const { at, path } = queue.shift()!;
    if (path.length >= 4) continue;
    for (const next of STATUSES) {
      if (seen.has(next) || !mayUpdateStatus(actor, { ...bug, status: at }, next)) continue;
      const p: [string, string][] = [...path, [at, next]];
      if (next === to) return p;
      // Only pass through triage steps; never jump across development or closing statuses implicitly.
      if (["VALIDATING", "VALIDATED", "READY_FOR_ASSIGNMENT"].includes(next)) {
        seen.add(next);
        queue.push({ at: next, path: p });
      }
    }
  }
  return null;
}

export function allowedStatuses(
  actor: BugActor,
  bug: { status: Status; reporterId: string; assigneeId: string | null },
) {
  return STATUSES.filter((to) => mayUpdateStatus(actor, bug, to));
}
/** Pass/fail a QA retest: authorized QA or Admin, never the person who made the fix. */
export function mayVerify(actor: BugActor, bug: { status: Status; assigneeId: string | null }) {
  return (
    (actor.role === "admin" || (actor.role === "qa" && actor.permissions.includes("verify"))) &&
    bug.status === "RECHECK" &&
    bug.assigneeId !== actor.userId
  );
}
export function formatBugCode(id: string) {
  return `BF-${id.padStart(6, "0")}`;
}
export type LastChange = { by: string; via: string; action: string; at: string } | null;
export type StatusCount = { status: string; assigned: boolean; count: number };
/** Dashboard groups: every status belongs to exactly one group so card counts add up to the total. */
export const STATUS_GROUPS = [
  { key: "g:new", label: "New", statuses: ["NEW", "VALIDATING"], tone: "info" },
  {
    key: "g:progress",
    label: "In progress",
    statuses: ["VALIDATED", "READY_FOR_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS"],
    tone: "teal",
  },
  { key: "g:qa", label: "Awaiting QA", statuses: ["RECHECK"], tone: "warning" },
  { key: "g:reopened", label: "Reopened", statuses: ["REOPENED"], tone: "danger" },
  { key: "g:info", label: "Needs info", statuses: ["NEEDS_INFORMATION"], tone: "warning" },
  { key: "g:resolved", label: "Resolved", statuses: ["RESOLVED"], tone: "success" },
  { key: "g:notbug", label: "Not a bug", statuses: ["NOT_A_BUG"], tone: "neutral" },
  {
    key: "g:closed",
    label: "Duplicate / won’t fix",
    statuses: ["DUPLICATE", "WONT_FIX"],
    tone: "neutral",
  },
] as const;
export function groupCounts(counts: StatusCount[], assignedOnly = false) {
  const scoped = counts.filter((c) => !assignedOnly || c.assigned);
  return {
    total: scoped.reduce((n, c) => n + c.count, 0),
    groups: STATUS_GROUPS.map((g) => ({
      ...g,
      count: scoped
        .filter((c) => (g.statuses as readonly string[]).includes(c.status))
        .reduce((n, c) => n + c.count, 0),
    })),
  };
}
export type FilterableBug = {
  status: string;
  assigneeId: string | null;
  reporterId: string;
  assignees?: { id: string }[];
};
/** 'all' | 'mine' | 'owned' | 'open' | 'unassigned' | a status | a 'g:' group, or two of them joined by ':' (e.g. 'owned:RECHECK' = my fixes awaiting QA). */
export function matchesFilter(filter: string, b: FilterableBug, me: string): boolean {
  const sep = filter.indexOf(":");
  if (sep > 0 && !filter.startsWith("g:"))
    return (
      matchesFilter(filter.slice(0, sep), b, me) && matchesFilter(filter.slice(sep + 1), b, me)
    );
  if (filter === "all") return true;
  if (filter === "mine") return b.reporterId === me;
  if (filter === "unassigned") return b.assigneeId === null;
  if (filter === "owned") return b.assigneeId === me || !!b.assignees?.some((a) => a.id === me);
  if (filter === "open")
    return !["RESOLVED", "DUPLICATE", "NOT_A_BUG", "WONT_FIX"].includes(b.status);
  const g = STATUS_GROUPS.find((x) => x.key === filter);
  return g ? (g.statuses as readonly string[]).includes(b.status) : b.status === filter;
}
export type FocusCard = { key: string; label: string; hint: string; filter: string; tone: string };
/** The four "what needs me" cards on a member portal, chosen by what the person does (not just their title). */
export function portalFocus(role: string, permissions: readonly string[]): FocusCard[] {
  if (role === "developer" || permissions.includes("progress"))
    return [
      {
        key: "owned",
        label: "Assigned to me",
        hint: "Everything I own",
        filter: "owned",
        tone: "teal",
      },
      {
        key: "progress",
        label: "In progress",
        hint: "What I am fixing now",
        filter: "owned:IN_PROGRESS",
        tone: "warning",
      },
      {
        key: "qa",
        label: "Awaiting QA",
        hint: "My fixes waiting for a retest",
        filter: "owned:RECHECK",
        tone: "info",
      },
      {
        key: "reopened",
        label: "Sent back",
        hint: "My fixes that failed QA",
        filter: "owned:REOPENED",
        tone: "danger",
      },
    ];
  if (role === "qa" || permissions.includes("validate") || permissions.includes("verify"))
    return [
      {
        key: "new",
        label: "To validate",
        hint: "New reports to check",
        filter: "g:new",
        tone: "info",
      },
      {
        key: "retest",
        label: "To retest",
        hint: "Fixes waiting for me",
        filter: "RECHECK",
        tone: "warning",
      },
      {
        key: "reopened",
        label: "Reopened",
        hint: "Fixes that failed a retest",
        filter: "REOPENED",
        tone: "danger",
      },
      {
        key: "resolved",
        label: "Verified",
        hint: "Fixes that passed",
        filter: "RESOLVED",
        tone: "success",
      },
    ];
  return [
    { key: "mine", label: "My reports", hint: "Bugs I raised", filter: "mine", tone: "teal" },
    { key: "open", label: "Still open", hint: "Not fixed yet", filter: "mine:open", tone: "info" },
    {
      key: "info",
      label: "Need my input",
      hint: "Waiting for details from me",
      filter: "mine:NEEDS_INFORMATION",
      tone: "warning",
    },
    {
      key: "fixed",
      label: "Fixed",
      hint: "Verified by QA",
      filter: "mine:RESOLVED",
      tone: "success",
    },
  ];
}
export const focusCounts = (cards: FocusCard[], bugs: FilterableBug[], me: string) =>
  cards.map((c) => ({ ...c, count: bugs.filter((b) => matchesFilter(c.filter, b, me)).length }));
/** Statuses where a short reason helps the next person; the app asks for one but never requires it. */
export const NOTES_SUGGESTED = [
  "RECHECK",
  "REOPENED",
  "NEEDS_INFORMATION",
  "NOT_A_BUG",
  "DUPLICATE",
  "WONT_FIX",
];
/** @deprecated notes are optional now; kept for older imports. */
export const NOTES_REQUIRED = NOTES_SUGGESTED;
export function attentionBugs<T extends { status: string; assigneeId: string | null }>(bugs: T[]) {
  return bugs.filter(
    (b) =>
      ["NEW", "REOPENED", "RECHECK", "NEEDS_INFORMATION"].includes(b.status) ||
      (["VALIDATED", "READY_FOR_ASSIGNMENT"].includes(b.status) && b.assigneeId === null),
  );
}
