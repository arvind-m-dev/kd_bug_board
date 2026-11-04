import { toCsv } from "./export";
import { mediaLinkPath } from "./bug-media";
import { statusLabel } from "./format";
import type { ExportBug } from "./bug-workflow";

/**
 * Jira Cloud CSV import (Settings → System → External System Import → CSV). Pure: one bug → one row in the columns
 * Jira's importer maps automatically. Files are LINKS (in-app, open after sign-in) inside the description, never
 * public bucket URLs, so the CSV can be shared without exposing anything.
 */

/** BugFlow priority → Jira's default priority scheme (Highest, High, Medium, Low, Lowest). */
export const JIRA_PRIORITY: Record<string, string> = {
  P0: "Highest",
  P1: "High",
  P2: "Medium",
  P3: "Low",
  P4: "Lowest",
  P5: "Lowest",
};

/** BugFlow status → the three statuses every Jira board has. The exact BugFlow status also goes in a label. */
export function jiraStatus(status: string): "To Do" | "In Progress" | "Done" {
  if (status === "IN_PROGRESS" || status === "RECHECK") return "In Progress";
  if (["RESOLVED", "DUPLICATE", "NOT_A_BUG", "WONT_FIX"].includes(status)) return "Done";
  return "To Do";
}
/** Jira's default resolutions for closed bugs; empty while the bug is open. */
export function jiraResolution(status: string): string {
  return (
    { RESOLVED: "Done", DUPLICATE: "Duplicate", WONT_FIX: "Won't Do", NOT_A_BUG: "Won't Do" }[
      status
    ] ?? ""
  );
}

/** The date format to type into Jira's importer ("Date format" on the setup step). */
export const JIRA_DATE_FORMAT = "yyyy-MM-dd HH:mm";
const pad = (n: number) => String(n).padStart(2, "0");
/** An ISO timestamp as "2026-11-04 14:05" in the downloader's local time; a plain date gets 00:00. */
export function jiraDate(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} 00:00`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Jira labels are single words: spaces and commas become hyphens, other punctuation is dropped. */
export function jiraLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s,]+/g, "-")
    .replace(/[^\p{L}\p{N}_.-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 255);
}

/**
 * Reporters' text in Jira's text formatting: characters that would turn into links, macros or tables are escaped,
 * and a line that would become a heading or list is kept as plain text.
 */
export function jiraText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/([{}[\]|\\])/g, "\\$1")
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#*-]|h[1-6]\.|bq\.)/, "$1\\$2"))
    .join("\n");
}

/** Jira refuses descriptions over 32,767 characters and summaries over 255. */
const DESCRIPTION_MAX = 32000;
const SUMMARY_MAX = 255;

/** A link Jira shows as clickable text: [name|url]. The name is escaped so it can't break the link. */
const link = (text: string, url: string) =>
  `[${text.replace(/[[\]|]/g, " ").trim() || url}|${url}]`;

export function jiraDescription(b: ExportBug, origin: string): string {
  const parts: string[] = [];
  const section = (title: string, body: string) => {
    if (body.trim()) parts.push(`h3. ${title}\n${body.trim()}`);
  };
  section("What happened", jiraText(b.description || b.title));
  section(
    "Steps to reproduce",
    b.steps
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `# ${jiraText(s)}`)
      .join("\n"),
  );
  section("Expected result", jiraText(b.expected));
  section("Actual result", jiraText(b.actual));
  const assignees = b.assignees?.length ? b.assignees.map((a) => a.name) : [b.assignee];
  const facts: [string, string][] = [
    ["Bug ID", b.code],
    ["Project", b.project],
    ["Module", b.module],
    ["Severity", b.severity],
    ["Priority in Bug Board", b.priority],
    ["Status in Bug Board", statusLabel(b.status)],
    ["Environment / build", b.environment],
    ["Browser / device", b.browserDevice],
    ["Reported by", `${b.reporter} on ${jiraDate(b.createdAt)}`],
    ["Assigned to", assignees.filter((n) => n && n !== "Unassigned").join(", ")],
    ["Due", b.dueOn ?? ""],
  ];
  section(
    "Details",
    facts
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `* *${k}:* ${jiraText(v)}`)
      .join("\n"),
  );
  const notes = [
    b.fixNotes && `* *Fix notes:* ${jiraText(b.fixNotes)}`,
    b.devComment && `* *Latest developer note:* ${jiraText(b.devComment)}`,
    b.qaComment && `* *Latest QA note:* ${jiraText(b.qaComment)}`,
  ].filter(Boolean);
  section("Notes", notes.join("\n"));
  const files = [
    ...(b.media ?? b.mediaIds.map((id, i) => ({ id, name: `Attachment ${i + 1}`, kind: "" }))).map(
      (m) =>
        `* ${link(`${m.kind === "video" ? "Recording" : m.kind === "pdf" ? "PDF" : "Screenshot"}: ${m.name}`, `${origin}${mediaLinkPath(b.id, m.id)}`)}`,
    ),
    ...b.evidenceUrls.map((u) => `* ${link(u, u)}`),
  ];
  section("Files", files.join("\n"));
  parts.push(`----\nOpen in Bug Board: ${link(b.code, `${origin}${mediaLinkPath(b.id)}`)}`);
  const text = parts.join("\n\n");
  return text.length > DESCRIPTION_MAX
    ? `${text.slice(0, DESCRIPTION_MAX)}\n\n… (shortened — open ${b.code} in Bug Board for the full report)`
    : text;
}

const LABEL_COLUMNS = 5;
export const JIRA_HEADERS = [
  "Summary",
  "Issue Type",
  "Priority",
  "Status",
  "Resolution",
  "Description",
  "Environment",
  "Component/s",
  "Due Date",
  "Created",
  "Reporter",
  "Assignee",
  // Jira reads repeated columns with the same name as several values.
  ...Array.from({ length: LABEL_COLUMNS }, () => "Labels"),
  "Bug Board ID",
  "Bug Board link",
];

export function jiraRow(b: ExportBug, origin: string): string[] {
  const summary = (b.title || b.description).replace(/\s+/g, " ").trim();
  const labels = [
    "bugboard",
    jiraLabel(b.project),
    b.module ? jiraLabel(b.module) : "",
    `severity-${jiraLabel(b.severity)}`,
    `status-${jiraLabel(b.status)}`,
  ].filter(Boolean);
  return [
    summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
    "Bug",
    JIRA_PRIORITY[b.priority] ?? "Medium",
    jiraStatus(b.status),
    jiraResolution(b.status),
    jiraDescription(b, origin),
    [b.environment, b.browserDevice].filter(Boolean).join(" · "),
    b.module,
    jiraDate(b.dueOn),
    jiraDate(b.createdAt),
    b.reporterEmail ?? "",
    // Jira holds one assignee; the first one (the primary owner) goes here, all are listed in the description.
    b.assigneeEmails?.[0] ?? "",
    ...Array.from({ length: LABEL_COLUMNS }, (_, i) => labels[i] ?? ""),
    b.code,
    `${origin}${mediaLinkPath(b.id)}`,
  ];
}

/** The whole file: headers plus one row per bug. */
export function toJiraCsv(bugs: ExportBug[], origin: string): string {
  return toCsv(
    JIRA_HEADERS,
    bugs.map((b) => jiraRow(b, origin)),
  );
}

/** "bugboard-jira-checkout-app-2026-11-04-12-bugs.csv" */
export function jiraFileName(project: string | null, count: number, today = new Date()) {
  const slug = project ? `-${jiraLabel(project) || "project"}` : "";
  return `bugboard-jira${slug}-${today.toISOString().slice(0, 10)}-${count}-${count === 1 ? "bug" : "bugs"}.csv`;
}
