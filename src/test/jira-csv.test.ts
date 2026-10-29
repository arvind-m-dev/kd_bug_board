import { describe, expect, it } from "vitest";
import { buildJiraCsv, JIRA_STATUS, jiraFileName, toJiraRow } from "@/lib/jira-csv";
import { STATUSES } from "@/lib/bugflow";
import type { ExportBug } from "@/lib/bug-workflow";

const bug: ExportBug = {
  id: "12",
  code: "BF-000012",
  title: "Login button misaligned",
  projectId: "p",
  project: "Keydemand",
  reporterId: "r",
  reporter: "Priya",
  assigneeId: "a",
  assignee: "Krishna",
  status: "RECHECK",
  priority: "P2",
  severity: "Medium",
  description: 'The button, sits "4px" low.',
  expected: "Aligned",
  actual: "Low",
  browserDevice: "Chrome on Windows",
  environment: "Build 4",
  fixNotes: "",
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
  version: "v",
  dueOn: "2026-11-01",
  steps: ["Open login", "Look"],
  evidenceUrls: [],
  module: "Functionality",
  lastChange: null as never,
  devComment: "",
  qaComment: "",
  mediaIds: [],
};

describe("Jira CSV export", () => {
  it("maps every BugFlow status onto Jira's default workflow", () => {
    for (const s of STATUSES) expect(["To Do", "In Progress", "Done"]).toContain(JIRA_STATUS[s]);
  });
  it("builds a row Jira accepts: summary, Bug type, mapped status and priority, labels without spaces", () => {
    const row = toJiraRow(bug, "https://bugs.example.com");
    expect(row[0]).toBe("Login button misaligned");
    expect(row[1]).toBe("Bug");
    expect(row[2]).toBe("In Progress");
    expect(row[3]).toBe("High");
    expect(row[4]).toBe("Priya");
    expect(row[5]).toBe("Krishna");
    expect(row[6]).toMatch(/^2026-10-10 \d{2}:\d{2}$/);
    expect(row[7]).toBe("2026-11-01 00:00");
    expect(row.slice(9)).toEqual(["BF-000012", "Functionality", "Build-4"]);
  });
  it("folds steps, expected/actual, device, severity and the bug link into the description", () => {
    const d = toJiraRow(bug, "https://bugs.example.com")[8]!;
    expect(d).toContain("Steps to reproduce:\n1. Open login\n2. Look");
    expect(d).toContain("Expected: Aligned");
    expect(d).toContain("Actual: Low");
    expect(d).toContain("Severity: Medium");
    expect(d).toContain("BF-000012 (RECHECK)");
    expect(d).toContain("https://bugs.example.com");
  });
  it("quotes and escapes CSV cells, repeats the Labels header, and leaves the unassigned column empty", () => {
    const csv = buildJiraCsv([{ ...bug, assignee: "Unassigned" }], "https://x.test");
    const header = csv.split("\r\n")[0]!;
    expect(header).toBe(
      "﻿Summary,Issue Type,Status,Priority,Reporter,Assignee,Date Created,Due Date,Description,Labels,Labels,Labels",
    );
    expect(csv).toContain('"The button, sits ""4px"" low.');
    expect(csv).toContain(",Priya,,2026-10-10");
  });
  it("names the file after the project and day", () => {
    expect(jiraFileName("Keydemand")).toMatch(/^jira-import-keydemand-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(jiraFileName(null)).toMatch(/^jira-import-all-projects-/);
  });
});
