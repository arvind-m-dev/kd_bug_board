import { describe, expect, it } from "vitest";
import {
  type AdfNode,
  SECTION_TITLES,
  buildDescription,
  cleanText,
  patchDescription,
  readDescription,
} from "@/lib/jira/adf";
import { decide, planSync } from "@/lib/jira/compare";
import {
  MappingError,
  configProblems,
  createBody,
  directions,
  localFields,
  markerLabel,
  remoteFields,
  updateBody,
} from "@/lib/jira/mapping";
import { issueSchema, mappingConfigSchema } from "@/lib/jira/schemas";
import { CONFIG, bug } from "./jira-fixtures";

const PARTS = {
  description: "Clicking Pay does nothing.\nSecond line.\n\nSeen on staging only.",
  steps: ["Open the cart", "Click Pay\nthen wait"],
  expected: "The payment page opens.",
  actual: "Nothing happens.",
  details: ["Severity: High", "Reported by: Asha"],
};
const media: AdfNode = { type: "mediaSingle", content: [{ type: "media", attrs: { id: "abc" } }] };

describe("Jira description format", () => {
  it("reads back exactly the text it was built from", () => {
    const read = readDescription(buildDescription(PARTS));
    expect(read).toMatchObject(PARTS);
    expect(Object.values(read.lossy)).toEqual([false, false, false, false, false]);
  });

  it("builds the same document for the same text, and treats spelling differences as equal", () => {
    expect(buildDescription(PARTS)).toEqual(buildDescription(structuredClone(PARTS)));
    expect(cleanText("a  \r\nb\r\n\r\n\r\n\r\nc \n")).toBe("a\nb\n\nc");
    expect(buildDescription({ ...PARTS, description: `${PARTS.description}  \r\n` })).toEqual(
      buildDescription(PARTS),
    );
  });

  it("leaves out empty sections and reads a missing section as empty", () => {
    const doc = buildDescription({
      description: "Only this.",
      steps: [],
      expected: "",
      actual: "",
      details: [],
    });
    expect(doc.content).toHaveLength(1);
    expect(readDescription(doc)).toMatchObject({
      steps: [],
      expected: "",
      actual: "",
      details: [],
    });
    expect(readDescription(null).description).toBe("");
  });

  it("reads a description written in Jira by hand as free text and flags what plain text cannot hold", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Broken ", marks: [{ type: "strong" }] },
            { type: "text", text: "page" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
            },
          ],
        },
      ],
    };
    const read = readDescription(doc);
    expect(read.description).toBe("Broken page\n\n- one");
    expect(read.lossy.description).toBe(true);
    expect(read.steps).toEqual([]);
  });

  it("finds sections whatever the heading's level or letter case", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "STEPS TO REPRODUCE" }],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Go" }] }],
            },
          ],
        },
      ],
    };
    expect(readDescription(doc).steps).toEqual(["Go"]);
  });

  it("replaces only the named part and returns every other node untouched", () => {
    const built = buildDescription(PARTS);
    const current = { ...built, content: [built.content[0]!, media, ...built.content.slice(1)] };
    const patched = patchDescription(current, { steps: ["Only step"] });
    expect(patched.content.slice(0, 3)).toEqual(current.content.slice(0, 3)); // free text and the image
    expect(readDescription(patched)).toMatchObject({ ...PARTS, steps: ["Only step"] });
    const expectedAt = patched.content.findIndex(
      (n) => n.type === "heading" && n.content?.[0]?.text === SECTION_TITLES.expected,
    );
    expect(patched.content.slice(expectedAt)).toEqual(current.content.slice(expectedAt));
  });

  it("adds a section that was missing and removes one that became empty", () => {
    const doc = patchDescription(buildDescription({ ...PARTS, expected: "" }), {
      expected: "Opens.",
      actual: "",
    });
    const read = readDescription(doc);
    expect(read.expected).toBe("Opens.");
    expect(read.actual).toBe("");
    expect(read.steps).toEqual(PARTS.steps);
  });
});

describe("three-way decision", () => {
  it("covers every case without using time", () => {
    expect(decide("a", "a", "a", "a", "both")).toBe("none");
    expect(decide("a", "a", "b", "a", "both")).toBe("push");
    expect(decide("a", "a", "a", "b", "both")).toBe("pull");
    expect(decide("a", "a", "b", "b", "both")).toBe("ack");
    expect(decide("a", "a", "b", "c", "both")).toBe("conflict");
    // a difference that existed at the last agreement is nobody's change
    expect(decide("a", "b", "a", "b", "both")).toBe("none");
    expect(decide(["x"], ["x"], ["x"], ["x"], "both")).toBe("none");
  });

  it("lets BugFlow own a one-way field: Jira's edit is neither taken nor a conflict", () => {
    expect(decide("a", "a", "a", "b", "out")).toBe("none");
    expect(decide("a", "a", "c", "b", "out")).toBe("push");
  });

  it("plans different-field changes as a merge", () => {
    const base = localFields(bug(), CONFIG);
    const plan = planSync(
      base,
      base,
      { ...base, title: "New title", priority: "1" },
      { ...base, expected: "Jira edit", priority: "5" },
      directions(CONFIG),
    );
    expect(plan).toEqual({
      push: ["title", "priority"],
      pull: ["expected"],
      ack: [],
      conflict: [],
    });
  });
});

describe("mapping rules", () => {
  it("accepts the test board and compares the 13 statuses in Jira's status space", () => {
    expect(configProblems(CONFIG)).toEqual([]);
    expect(localFields(bug({ status: "NEW" }), CONFIG).status).toBe("1");
    expect(localFields(bug({ status: "VALIDATING" }), CONFIG).status).toBe("1");
    expect(localFields(bug({ status: "RECHECK" }), CONFIG).status).toBe("3");
  });

  it("reports an incomplete or contradictory status mapping", () => {
    const { NEW: _dropped, ...rest } = CONFIG.statusOut;
    expect(configProblems({ ...CONFIG, statusOut: rest })).toContain(
      "BugFlow status NEW has no Jira status.",
    );
    expect(configProblems({ ...CONFIG, statusIn: { ...CONFIG.statusIn, "3": "NEW" } })[0]).toMatch(
      /means NEW/,
    );
    expect(() => localFields(bug(), { ...CONFIG, statusOut: rest })).toThrow(MappingError);
  });

  it("never lets a shared Done be read back as Duplicate, Not a bug or Won't fix", () => {
    const problems = configProblems({
      ...CONFIG,
      statusIn: { ...CONFIG.statusIn, "4": "WONT_FIX" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/WONT_FIX needs a Jira status of its own/);
    // with its own Jira status it is fine
    const own = {
      ...CONFIG,
      statusOut: { ...CONFIG.statusOut, WONT_FIX: "9" },
      statusIn: { ...CONFIG.statusIn, "9": "WONT_FIX" as const },
    };
    expect(configProblems(own)).toEqual([]);
  });

  it("needs all priorities mapped, or none", () => {
    expect(configProblems({ ...CONFIG, priorityOut: { P0: "1" } })[0]).toMatch(
      /P1, P2, P3, P4, P5/,
    );
    const none = mappingConfigSchema.parse({
      statusOut: CONFIG.statusOut,
      statusIn: CONFIG.statusIn,
    });
    expect(configProblems(none)).toEqual([]);
    expect(localFields(bug(), none).priority).toBeNull();
  });

  it("names an untitled bug by the start of its description", () => {
    expect(localFields(bug({ title: "" }), CONFIG).title).toBe("Clicking Pay does nothing.");
    expect(localFields(bug({ title: "", description: "" }), CONFIG).title).toBe("BF-41");
  });

  it("builds a create request Jira can be asked twice about", () => {
    const b = bug({
      assigneeNames: ["Ravi", "Meera"],
      assigneeAccountId: "acc-ravi",
      reporterAccountId: "acc-asha",
    });
    const marker = markerLabel(b.id, "0a1b2c3d-0000-4000-8000-000000000000");
    expect(marker).toBe("bf-41-0a1b2c3d");
    const { fields } = createBody(
      b,
      localFields(b, CONFIG),
      { projectId: "10000", issueTypeId: "10004" },
      CONFIG,
      marker,
    );
    expect(fields).toMatchObject({
      project: { id: "10000" },
      issuetype: { id: "10004" },
      summary: b.title,
      labels: [marker],
      priority: { id: "2" },
      duedate: "2026-11-20",
      assignee: { accountId: "acc-ravi" },
      reporter: { accountId: "acc-asha" },
    });
    expect(fields).not.toHaveProperty("status");
    expect(readDescription(fields["description"]).details).toEqual([
      "Severity: High",
      "Environment: Staging",
      "Module: Checkout",
      "Reported by: Asha",
      "Assigned to: Ravi, Meera",
      "Bug Board: BF-41 https://bugs.example.test/admin/bugs?bug=41",
    ]);
  });

  it("reads an issue back into the same values it was created from", () => {
    const b = bug();
    const local = localFields(b, CONFIG);
    const { fields } = createBody(
      b,
      local,
      { projectId: "10000", issueTypeId: "10004" },
      CONFIG,
      "bf-41-x",
    );
    const issue = issueSchema.parse({
      id: "20001",
      key: "BFT-1",
      fields: { ...fields, status: { id: "1" }, updated: "2026-11-06T10:00:00.000+0530" },
    });
    const remote = remoteFields(issue, CONFIG);
    expect(remote.fields).toEqual(local);
    expect(remote).toMatchObject({ projectId: "10000", issueTypeId: "10004", key: "BFT-1" });
  });

  it("sends only the changed fields and never status as a field", () => {
    const local = localFields(bug({ title: "Renamed", severity: "Low" }), CONFIG);
    const current = buildDescription({
      ...PARTS,
      details: ["Severity: High", "Environment: Prod", "Reported by: Asha"],
    });
    const remote = {
      ...local,
      severity: "High",
      environment: "Prod",
      module: "",
      note: "Reported by: Asha",
    };
    const body = updateBody(
      ["title", "severity", "status"],
      { ...remote, title: local.title, severity: "Low" },
      current,
      CONFIG,
    );
    expect(Object.keys(body!.fields).sort()).toEqual(["description", "summary"]);
    const read = readDescription(body!.fields["description"]);
    // the changed line is rewritten; Jira's own value for Environment stays
    expect(read.details).toEqual(["Severity: Low", "Environment: Prod", "Reported by: Asha"]);
    expect(read).toMatchObject({ description: cleanText(PARTS.description), steps: PARTS.steps });
    expect(updateBody(["status"], local, current, CONFIG)).toBeNull();
  });

  it("writes mapped custom fields instead of description sections", () => {
    const config = mappingConfigSchema.parse({
      ...CONFIG,
      fields: {
        severity: { mode: "custom", fieldId: "customfield_10050", type: "option" },
        expected: { mode: "custom", fieldId: "customfield_10051", type: "paragraph" },
        module: { mode: "off" },
      },
    });
    expect(configProblems(config)).toEqual([]);
    const b = bug();
    const local = localFields(b, config);
    expect(local.module).toBe("");
    const { fields } = createBody(
      b,
      local,
      { projectId: "10000", issueTypeId: "10004" },
      config,
      "m",
    );
    expect(fields["customfield_10050"]).toEqual({ value: "High" });
    const read = readDescription(fields["description"]);
    expect(read.expected).toBe("");
    expect(read.details[0]).toBe("Environment: Staging");
    const issue = issueSchema.parse({
      id: "20001",
      key: "BFT-1",
      fields: { ...fields, status: { id: "1" } },
    });
    expect(remoteFields(issue, config).fields).toEqual(local);
    expect(updateBody(["severity"], { ...local, severity: "" }, null, config)).toEqual({
      fields: { customfield_10050: null },
    });
  });
});
