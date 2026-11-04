import { describe, expect, it } from "vitest";
import {
  JIRA_HEADERS,
  jiraDate,
  jiraDescription,
  jiraFileName,
  jiraLabel,
  jiraResolution,
  jiraRow,
  jiraStatus,
  jiraText,
  toJiraCsv,
} from "@/lib/jira-csv";
import type { ExportBug } from "@/lib/bug-workflow";

const origin = "https://bugs.example.com";
const bug: ExportBug = {
  id: "12",
  code: "DEPLOY-000012",
  title: "Login button misaligned",
  projectId: "p",
  project: "Checkout App",
  reporterId: "r",
  reporter: "Priya",
  assigneeId: "a",
  assignee: "Krishna",
  assignees: [
    { id: "a", name: "Krishna" },
    { id: "b", name: "John" },
  ],
  status: "IN_PROGRESS",
  priority: "P1",
  severity: "Major",
  description: "The button sits 4px low.\n* not a list",
  expected: "Aligned",
  actual: "Low [see screenshot]",
  browserDevice: "Chrome on Windows",
  environment: "Build 4",
  fixNotes: "",
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
  version: "v",
  dueOn: "2026-11-20",
  steps: ["Open login", "Look at the button"],
  evidenceUrls: ["https://drive.google.com/x"],
  module: "Sign in",
  lastChange: null as never,
  devComment: "Will merge Monday",
  qaComment: "",
  mediaIds: ["m1", "m2"],
  media: [
    { id: "m1", name: "login.png", kind: "image" },
    { id: "m2", name: "repro.mp4", kind: "video" },
  ],
  reporterEmail: "priya@example.com",
  assigneeEmails: ["krishna@example.com", "john@example.com"],
};

describe("Jira CSV mapping", () => {
  it("maps statuses onto every board's To Do / In Progress / Done", () => {
    expect(jiraStatus("NEW")).toBe("To Do");
    expect(jiraStatus("NEEDS_INFORMATION")).toBe("To Do");
    expect(jiraStatus("RECHECK")).toBe("In Progress");
    expect(jiraStatus("WONT_FIX")).toBe("Done");
    expect(jiraResolution("DUPLICATE")).toBe("Duplicate");
    expect(jiraResolution("IN_PROGRESS")).toBe("");
  });
  it("writes dates in the importer's format", () => {
    expect(jiraDate("2026-11-20")).toBe("2026-11-20 00:00");
    expect(jiraDate(null)).toBe("");
    expect(jiraDate("2026-10-10T09:00:00.000Z")).toMatch(/^2026-10-1\d \d{2}:\d{2}$/);
  });
  it("makes single-word labels", () => {
    expect(jiraLabel("Checkout App")).toBe("checkout-app");
    expect(jiraLabel(" Sign in, Web ")).toBe("sign-in-web");
  });
  it("escapes reporters' text so it can't become links, macros or lists", () => {
    expect(jiraText("{code} [x|y]")).toBe("\\{code\\} \\[x\\|y\\]");
    expect(jiraText("# one\n- two")).toBe("\\# one\n\\- two");
  });
});

describe("Jira CSV row", () => {
  it("fills the columns Jira maps automatically", () => {
    const row = jiraRow(bug, origin);
    const at = (h: string) => row[JIRA_HEADERS.indexOf(h)];
    expect(row).toHaveLength(JIRA_HEADERS.length);
    expect(at("Summary")).toBe("Login button misaligned");
    expect(at("Issue Type")).toBe("Bug");
    expect(at("Priority")).toBe("High");
    expect(at("Status")).toBe("In Progress");
    expect(at("Reporter")).toBe("priya@example.com");
    expect(at("Assignee")).toBe("krishna@example.com");
    expect(at("Due Date")).toBe("2026-11-20 00:00");
    expect(at("Component/s")).toBe("Sign in");
    expect(at("Bug Board ID")).toBe("DEPLOY-000012");
    expect(at("Bug Board link")).toBe(`${origin}/media/12`);
    const labels = row.filter((_, i) => JIRA_HEADERS[i] === "Labels").filter(Boolean);
    expect(labels).toEqual([
      "bugboard",
      "checkout-app",
      "sign-in",
      "severity-major",
      "status-in_progress",
    ]);
  });
  it("puts the whole report and file links in the description", () => {
    const d = jiraDescription(bug, origin);
    expect(d).toContain("h3. What happened");
    expect(d).toContain("\\* not a list");
    expect(d).toContain("# Open login\n# Look at the button");
    expect(d).toContain("h3. Actual result\nLow \\[see screenshot\\]");
    expect(d).toContain("* *Assigned to:* Krishna, John");
    expect(d).toContain(`[Screenshot: login.png|${origin}/media/12?m=m1]`);
    expect(d).toContain(`[Recording: repro.mp4|${origin}/media/12?m=m2]`);
    expect(d).toContain("[https://drive.google.com/x|https://drive.google.com/x]");
    expect(d).toContain(`Open in Bug Board: [DEPLOY-000012|${origin}/media/12]`);
  });
  it("leaves people empty when the export has no emails (member panels)", () => {
    const row = jiraRow({ ...bug, reporterEmail: "", assigneeEmails: [] }, origin);
    expect(row[JIRA_HEADERS.indexOf("Reporter")]).toBe("");
    expect(row[JIRA_HEADERS.indexOf("Assignee")]).toBe("");
  });
  it("keeps summaries within Jira's 255 characters and on one line", () => {
    const long = jiraRow({ ...bug, title: `${"a ".repeat(200)}\nb` }, origin)[0]!;
    expect(long.length).toBeLessThanOrEqual(255);
    expect(long).not.toContain("\n");
  });
});

describe("Jira CSV file", () => {
  it("has one header row and quotes multi-line descriptions", () => {
    const csv = toJiraCsv([bug], origin);
    const [header] = csv.split("\r\n");
    expect(header).toBe(JIRA_HEADERS.join(","));
    expect(csv).toContain('"h3. What happened');
    expect(csv.startsWith("﻿")).toBe(false);
  });
  it("names the file after the project and count", () => {
    expect(jiraFileName("Checkout App", 12, new Date("2026-11-04T10:00:00Z"))).toBe(
      "bugboard-jira-checkout-app-2026-11-04-12-bugs.csv",
    );
    expect(jiraFileName(null, 1, new Date("2026-11-04T10:00:00Z"))).toBe(
      "bugboard-jira-2026-11-04-1-bug.csv",
    );
  });
});
