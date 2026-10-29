import type { Status } from "./bugflow";
import { mediaLinkPath } from "./bug-media";
import type { ExportBug } from "./bug-workflow";

/**
 * Pure rules for the Jira import file: a CSV that Jira Cloud's "Import issues from CSV"
 * (External System Import) accepts as-is. One-way only — BugFlow never reads from Jira.
 *
 * Jira's CSV conventions this follows:
 * - a header row; Summary is the one required field;
 * - fields holding commas, quotes or newlines are double-quoted, quotes doubled;
 * - multi-value fields (Labels) repeat the column header once per value;
 * - dates in one declared format — the import wizard asks for it: use JIRA_DATE_FORMAT.
 */
export const JIRA_DATE_FORMAT = "yyyy-MM-dd HH:mm";

/** Our 13 statuses onto Jira's default workflow, so an import maps cleanly without a custom scheme. */
export const JIRA_STATUS: Record<Status, string> = {
  NEW: "To Do",
  VALIDATING: "To Do",
  VALIDATED: "To Do",
  READY_FOR_ASSIGNMENT: "To Do",
  ASSIGNED: "In Progress",
  IN_PROGRESS: "In Progress",
  RECHECK: "In Progress",
  NEEDS_INFORMATION: "In Progress",
  REOPENED: "In Progress",
  RESOLVED: "Done",
  DUPLICATE: "Done",
  NOT_A_BUG: "Done",
  WONT_FIX: "Done",
};

/** Jira's default priority names; ours pass through where they already match. */
const JIRA_PRIORITY: Record<string, string> = {
  P0: "Highest",
  P1: "Highest",
  P2: "High",
  P3: "Medium",
  P4: "Low",
  P5: "Lowest",
};

const LABEL_COUNT = 3; // bug code + category/module + build/environment
const HEADERS = [
  "Summary",
  "Issue Type",
  "Status",
  "Priority",
  "Reporter",
  "Assignee",
  "Date Created",
  "Due Date",
  "Description",
  ...Array.from({ length: LABEL_COUNT }, () => "Labels"),
];

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
/** Jira labels take no spaces; keep them short and readable. */
const label = (v: string) =>
  v
    .trim()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^\w.-]/g, "")
    .slice(0, 60);
const stamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Everything Jira has no field for goes into the description, under plain headings. */
export function jiraDescription(b: ExportBug, origin: string): string {
  const parts = [
    b.description.trim(),
    b.steps.length
      ? `Steps to reproduce:\n${b.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "",
    b.expected.trim() && `Expected: ${b.expected.trim()}`,
    b.actual.trim() && `Actual: ${b.actual.trim()}`,
    b.browserDevice.trim() && `Browser / device: ${b.browserDevice.trim()}`,
    `Severity: ${b.severity}`,
    `BugFlow: ${b.code} (${b.status}) · ${origin}${mediaLinkPath(b.id)}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function toJiraRow(b: ExportBug, origin: string): string[] {
  const labels = [label(b.code), label(b.module), label(b.environment)];
  while (labels.length < LABEL_COUNT) labels.push("");
  return [
    b.title || b.description.split("\n")[0]?.slice(0, 200) || b.code,
    "Bug",
    JIRA_STATUS[b.status] ?? "To Do",
    JIRA_PRIORITY[b.priority] ?? b.priority,
    b.reporter,
    b.assignee === "Unassigned" ? "" : b.assignee,
    stamp(b.createdAt),
    b.dueOn ? `${b.dueOn} 00:00` : "",
    jiraDescription(b, origin),
    ...labels.slice(0, LABEL_COUNT),
  ];
}

export function buildJiraCsv(bugs: ExportBug[], origin: string): string {
  const lines = [HEADERS, ...bugs.map((b) => toJiraRow(b, origin))];
  // Jira reads UTF-8; the BOM keeps Excel from mangling the preview if someone opens it first.
  return "﻿" + lines.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const jiraFileName = (project: string | null) =>
  `jira-import-${(project ?? "all-projects").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
