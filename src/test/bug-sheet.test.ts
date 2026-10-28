import { describe, expect, it } from "vitest";
import {
  SHEET_COLUMNS,
  SHEET_CORE_COLUMNS,
  SHEET_STATUS,
  bandLabel,
  platformOf,
  priorityLabel,
  sheetFileName,
  toSheetRow,
} from "@/lib/bug-sheet";
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
  assignees: [
    { id: "a", name: "Krishna" },
    { id: "b", name: "John" },
  ],
  status: "RECHECK",
  priority: "P2",
  severity: "Medium",
  description: "The button sits 4px low.",
  expected: "Aligned",
  actual: "Low",
  browserDevice: "Chrome on Windows + Android app",
  environment: "Build 4",
  fixNotes: "Fixed padding",
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
  version: "v",
  dueOn: null,
  steps: ["Open login", "Look"],
  evidenceUrls: ["https://drive.google.com/x"],
  module: "Functionality",
  lastChange: null as never,
  devComment: "Will merge Monday",
  qaComment: "Need clarity",
  mediaIds: ["m1", "m2"],
};

describe("bug sheet export rules", () => {
  it("keeps the team layout in A–M and adds BugFlow fields after", () => {
    expect(SHEET_COLUMNS.slice(0, SHEET_CORE_COLUMNS).map((c) => c.header)).toEqual([
      "Ticket No",
      "Web/Mobile",
      "Category",
      "Build",
      "Date",
      "Status",
      "Priority",
      "Assigened To",
      "Issue/Bug",
      "Steps To Replicate/ Action To Be Taken",
      "Media/URL",
      "Dev Comments",
      "QA Comment",
    ]);
    expect(SHEET_COLUMNS.length).toBeGreaterThan(SHEET_CORE_COLUMNS);
  });
  it("reads the platform from the device text and labels priorities", () => {
    expect(platformOf("Chrome on Windows")).toBe("Web");
    expect(platformOf("iPhone 15, iOS 18")).toBe("Mobile");
    expect(platformOf("Chrome on Windows + Android app")).toBe("Web + Mobile");
    expect(platformOf("")).toBe("Web");
    expect(priorityLabel("P2")).toBe("P2 - High");
    expect(priorityLabel("X")).toBe("X");
    expect(SHEET_STATUS["RECHECK"]).toBe("Yet to Merge");
  });
  it("maps a bug to a row with numbered steps, both assignees, links and comments", () => {
    const row = toSheetRow(bug, "https://bugs.example.com");
    expect(row.ticket).toBe("BF-000012");
    expect(row.platform).toBe("Web + Mobile");
    expect(row.category).toBe("Functionality");
    expect(row.build).toBe("Build 4");
    expect(row.status).toBe("Yet to Merge");
    expect(row.priority).toBe("P2 - High");
    expect(row.assignee).toBe("Krishna, John");
    expect(row.issue).toBe("Login button misaligned\nThe button sits 4px low.");
    expect(row.steps).toBe("1. Open login\n2. Look");
    expect(row.mediaLinks).toHaveLength(3);
    expect(row.mediaLinks[1]!.url).toBe("https://bugs.example.com/media/12?m=m1");
    expect(row.bugUrl).toBe("https://bugs.example.com/media/12");
    expect(row.dev).toBe("Fixed padding\n\nWill merge Monday");
    expect(row.qa).toBe("Need clarity");
  });
  it("names bands and files sensibly", () => {
    expect(bandLabel("2026-10-10T09:00:00.000Z")).toMatch(/^Bugs added 10 October 2026$/);
    expect(sheetFileName("Keydemand App")).toMatch(/^bugs-keydemand-app-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sheetFileName(null)).toMatch(/^bugs-all-projects-/);
  });
});
