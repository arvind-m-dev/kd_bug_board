import { priorityNames, type ExportBug } from "./bug-workflow";
import { mediaLinkPath } from "./bug-media";

/**
 * Pure rules for the spreadsheet export: the column layout of the team's bug sheet (A–M), the extra columns after it,
 * how each bug maps onto a row, and the colours. No Excel library here; bug-sheet-client.ts does the writing.
 */
export const SHEET_COLUMNS = [
  { key: "ticket", header: "Ticket No", width: 12 },
  { key: "platform", header: "Web/Mobile", width: 13 },
  { key: "category", header: "Category", width: 15 },
  { key: "build", header: "Build", width: 13 },
  { key: "date", header: "Date", width: 12 },
  { key: "status", header: "Status", width: 14 },
  { key: "priority", header: "Priority", width: 13 },
  { key: "assignee", header: "Assigened To", width: 15 },
  { key: "issue", header: "Issue/Bug", width: 52 },
  { key: "steps", header: "Steps To Replicate/ Action To Be Taken", width: 52 },
  { key: "media", header: "Media/URL", width: 36 },
  { key: "dev", header: "Dev Comments", width: 32 },
  { key: "qa", header: "QA Comment", width: 32 },
  // Everything BugFlow knows beyond the team sheet goes after column M.
  { key: "title", header: "Title", width: 36 },
  { key: "severity", header: "Severity", width: 12 },
  { key: "reporter", header: "Reporter", width: 15 },
  { key: "project", header: "Project", width: 18 },
  { key: "expected", header: "Expected result", width: 36 },
  { key: "actual", header: "Actual result", width: 36 },
  { key: "device", header: "Browser / device", width: 18 },
  { key: "fix", header: "Fix notes", width: 32 },
  { key: "updated", header: "Last updated", width: 14 },
  { key: "link", header: "Open in BugFlow", width: 18 },
] as const;
export type SheetKey = (typeof SHEET_COLUMNS)[number]["key"];
export const SHEET_CORE_COLUMNS = 13; // A–M match the team's sheet exactly

/** The team's status words where ours map cleanly; ours otherwise. */
export const SHEET_STATUS: Record<string, string> = {
  NEW: "To Do",
  VALIDATING: "Validating",
  VALIDATED: "Validated",
  READY_FOR_ASSIGNMENT: "To Do",
  ASSIGNED: "To Do",
  IN_PROGRESS: "In Progress",
  RECHECK: "Yet to Merge",
  RESOLVED: "Resolved",
  REOPENED: "Re-opened",
  NEEDS_INFORMATION: "Need Info",
  DUPLICATE: "Duplicate",
  NOT_A_BUG: "Not a Bug",
  WONT_FIX: "Won't Fix",
};
export const PLATFORMS = ["Web", "Mobile", "Web + Mobile"] as const;
/** Web, Mobile or both, read from the free-text browser/device field. */
export function platformOf(browserDevice: string): (typeof PLATFORMS)[number] {
  const t = browserDevice.toLowerCase();
  const mobile = /\b(mobile|android|ios|iphone|ipad|app)\b/.test(t);
  const web =
    /\b(web|chrome|safari|firefox|edge|desktop|browser|windows|mac)\b/.test(t) || t.includes("+");
  return mobile && web ? "Web + Mobile" : mobile ? "Mobile" : "Web";
}
export const priorityLabel = (p: string) => (priorityNames[p] ? `${p} - ${priorityNames[p]}` : p);
/** Band row text above each day's bugs, like "Client bugs added 10 October". */
export const bandLabel = (iso: string) =>
  `Bugs added ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
export const dayKey = (iso: string) => iso.slice(0, 10);

/** Light fills (hex without #) that read like the sheet's coloured chips. */
export const FILLS = {
  header: "D9D2E9",
  band: "B6D7A8",
  platform: { Web: "CFE2F3", Mobile: "D9EAD3", "Web + Mobile": "D9D2E9" } as Record<string, string>,
  status: {
    "To Do": "FCE5CD",
    Validating: "FFF2CC",
    Validated: "FFF2CC",
    "In Progress": "CFE2F3",
    "Yet to Merge": "D9D2E9",
    Resolved: "B6D7A8",
    "Re-opened": "F4CCCC",
    "Need Info": "FFE599",
    Duplicate: "EFEFEF",
    "Not a Bug": "EFEFEF",
    "Won't Fix": "EFEFEF",
  } as Record<string, string>,
  priority: {
    P0: "990000",
    P1: "E06666",
    P2: "FFE599",
    P3: "B6D7A8",
    P4: "CFE2F3",
    P5: "EFEFEF",
  } as Record<string, string>,
  people: ["D9D2E9", "D9EAD3", "CFE2F3", "FCE5CD", "FFF2CC", "EAD1DC"],
} as const;
export const priorityTextIsLight = (p: string) => p === "P0";

export type SheetRow = Record<SheetKey, string> & {
  mediaLinks: { text: string; url: string }[];
  bugUrl: string;
  createdAt: string;
};
/** One bug → one row. Links are in-app (they open for whoever has access) plus whatever Drive links the report carries. */
export function toSheetRow(b: ExportBug, origin: string): SheetRow {
  const mediaLinks = [
    ...b.evidenceUrls.map((u) => ({ text: u, url: u })),
    ...b.mediaIds.map((id, i) => ({
      text: `Attachment ${i + 1}`,
      url: `${origin}${mediaLinkPath(b.id, id)}`,
    })),
  ];
  const bugUrl = `${origin}${mediaLinkPath(b.id)}`;
  return {
    ticket: b.code,
    platform: platformOf(b.browserDevice),
    category: b.module,
    build: b.environment,
    date: b.createdAt,
    status: SHEET_STATUS[b.status] ?? b.status,
    priority: priorityLabel(b.priority),
    assignee: (b.assignees?.length ? b.assignees.map((a) => a.name) : [b.assignee])
      .filter((n) => n && n !== "Unassigned")
      .join(", "),
    issue: b.description.trim()
      ? b.title && !b.description.includes(b.title)
        ? `${b.title}\n${b.description}`
        : b.description
      : b.title,
    steps: b.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    media: mediaLinks.map((l) => l.text).join("\n"),
    dev: [b.fixNotes, b.devComment].filter(Boolean).join("\n\n"),
    qa: [b.statusNote?.notes, b.qaComment].filter(Boolean).join("\n\n"),
    title: b.title,
    severity: b.severity,
    reporter: b.reporter,
    project: b.project,
    expected: b.expected,
    actual: b.actual,
    device: b.browserDevice,
    fix: b.fixNotes,
    updated: b.updatedAt,
    link: "Open bug",
    mediaLinks,
    bugUrl,
    createdAt: b.createdAt,
  };
}
export const sheetFileName = (project: string | null) =>
  `bugs-${(project ?? "all-projects").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
