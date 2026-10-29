export const STATUSES = [
  "NEW",
  "VALIDATING",
  "VALIDATED",
  "READY_FOR_ASSIGNMENT",
  "ASSIGNED",
  "IN_PROGRESS",
  "RECHECK",
  "RESOLVED",
  "NEEDS_INFORMATION",
  "REOPENED",
  "DUPLICATE",
  "NOT_A_BUG",
  "WONT_FIX",
] as const;
export type Status = (typeof STATUSES)[number];
export type Role = "admin" | "reporter" | "qa" | "developer" | "member";
export const OPEN_STATUSES: readonly Status[] = ["NEW", "VALIDATED", "ASSIGNED", "IN_PROGRESS"];
/** Statuses that end a bug's life: it needs no more work, so a past due date no longer counts as overdue. */
export const CLOSED_STATUSES: readonly Status[] = [
  "RESOLVED",
  "DUPLICATE",
  "NOT_A_BUG",
  "WONT_FIX",
];
/** Dates are plain YYYY-MM-DD; "today" is that date in the workspace time zone, computed once (see workspaceToday). */
export function isOverdue(status: string, dueOn: string | null, today: string): boolean {
  return !!dueOn && !CLOSED_STATUSES.includes(status as Status) && dueOn < today;
}
/** Due today or tomorrow and still open: a gentle "coming up", distinct from overdue. */
export function dueSoon(status: string, dueOn: string | null, today: string): boolean {
  if (!dueOn || CLOSED_STATUSES.includes(status as Status) || dueOn < today) return false;
  const t = new Date(`${today}T00:00:00Z`);
  const tomorrow = new Date(t.getTime() + 86400000).toISOString().slice(0, 10);
  return dueOn === today || dueOn === tomorrow;
}
/** A short badge label for a due date, or null when nothing should show. */
export function dueBadge(
  status: string,
  dueOn: string | null,
  today: string,
): { tone: "danger" | "warning"; text: string } | null {
  if (!dueOn || CLOSED_STATUSES.includes(status as Status)) return null;
  const days = Math.round(
    (new Date(`${dueOn}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86400000,
  );
  if (days < 0) return { tone: "danger", text: `Overdue ${-days}d` };
  if (days === 0) return { tone: "warning", text: "Due today" };
  if (days === 1) return { tone: "warning", text: "Due tomorrow" };
  return null;
}
export type Bug = {
  id: string;
  title: string;
  status: Status;
  priority: string;
  severity: string;
  description: string;
  steps: string[];
  expected: string;
  actual: string;
  assigneeId: string | null;
  comments: string[];
  evidence: { name: string; url: string }[];
};
export function counts(bugs: Bug[]) {
  return {
    total: bugs.length,
    open: bugs.filter((b) => OPEN_STATUSES.includes(b.status)).length,
    unassigned: bugs.filter((b) => b.assigneeId === null).length,
    recheck: bugs.filter((b) => b.status === "RECHECK").length,
  };
}
export function filterBugs(bugs: Bug[], filter: string, query = "") {
  return bugs.filter(
    (b) =>
      (filter === "all" ||
        (filter === "open"
          ? OPEN_STATUSES.includes(b.status)
          : filter === "unassigned"
            ? b.assigneeId === null
            : b.status === filter)) &&
      `${b.id} ${b.title} ${b.description}`.toLowerCase().includes(query.toLowerCase()),
  );
}
const transitions: Record<Status, readonly Status[]> = {
  NEW: ["VALIDATING", "NEEDS_INFORMATION", "DUPLICATE", "NOT_A_BUG"],
  VALIDATING: ["VALIDATED", "NEEDS_INFORMATION", "DUPLICATE", "NOT_A_BUG", "WONT_FIX"],
  VALIDATED: ["READY_FOR_ASSIGNMENT"],
  READY_FOR_ASSIGNMENT: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"],
  IN_PROGRESS: ["RECHECK", "NEEDS_INFORMATION", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"],
  RECHECK: ["RESOLVED", "REOPENED"],
  RESOLVED: ["REOPENED"],
  NEEDS_INFORMATION: ["VALIDATING", "IN_PROGRESS"],
  REOPENED: ["IN_PROGRESS", "ASSIGNED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"],
  DUPLICATE: ["VALIDATING"],
  NOT_A_BUG: ["VALIDATING"],
  WONT_FIX: ["VALIDATING"],
};
export function canTransition(role: Role, from: Status, to: Status, verified = false) {
  if (!transitions[from].includes(to)) return false;
  if (to === "RESOLVED") return role === "qa" && from === "RECHECK" && verified;
  if (role === "reporter" || role === "member") return false;
  if (role === "developer")
    return (
      ((from === "ASSIGNED" || from === "REOPENED") && to === "IN_PROGRESS") ||
      (from === "IN_PROGRESS" && to === "RECHECK") ||
      (["ASSIGNED", "IN_PROGRESS", "REOPENED"].includes(from) &&
        ["NOT_A_BUG", "DUPLICATE", "WONT_FIX"].includes(to))
    );
  return true;
}
export function exportMarkdown(bugs: Bug[]) {
  return bugs
    .map(
      (b) =>
        `# ${b.id}: ${b.title}\n\n- Status: ${b.status}\n- Priority: ${b.priority}\n- Severity: ${b.severity}\n\n## Description\n${b.description}\n\n## Steps to reproduce\n${b.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n## Expected result\n${b.expected}\n\n## Actual result\n${b.actual}\n\n## Comments\n${b.comments.join("\n\n") || "None"}\n\n## Evidence\n${b.evidence.map((e) => `[${e.name}](${e.url})`).join("\n") || "None"}`,
    )
    .join("\n\n---\n\n");
}
// Link previews use one brand title and the dashboard image: shared links land unsigned on /login, and private page details should not leak.
const SHARE_TITLE = "Bug Board";
const SHARE_DESCRIPTION =
  "Report, assign and verify bugs in one shared QA workspace for your team.";
const OG_IMAGE = `${import.meta.env["VITE_SITE_URL"] ?? ""}/og-image.jpg`;
export function pageHead(title: string, description: string) {
  return {
    meta: [
      { title: `${title} · Bug Board` },
      { name: "description", content: description },
      { property: "og:title", content: SHARE_TITLE },
      { property: "og:description", content: SHARE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Bug Board dashboard" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SHARE_TITLE },
      { name: "twitter:description", content: SHARE_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  };
}
