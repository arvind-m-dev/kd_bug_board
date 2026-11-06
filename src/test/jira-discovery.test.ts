import { describe, expect, it } from "vitest";
import {
  bugType,
  createFields,
  createMetaSchema,
  deriveStatusIn,
  issueTypes,
  planningFields,
  projectStatusesSchema,
  shapeProblems,
  suggestConfig,
} from "@/lib/jira/discovery";
import { configProblems } from "@/lib/jira/mapping";
import { CREATE_META_REPLY, PRIORITIES_REPLY, STATUSES_REPLY } from "./jira-shapes";

const types = issueTypes(projectStatusesSchema.parse(STATUSES_REPLY));
const bug = bugType(types)!;
const fields = createFields(createMetaSchema.parse(CREATE_META_REPLY).fields);
const board = (...extra: [string, string, "new" | "indeterminate" | "done"][]) => [
  ...bug.statuses,
  ...extra.map(([id, name, category]) => ({ id, name, category })),
];

describe("reading a Jira project", () => {
  it("offers the Bug type and leaves sub-tasks out", () => {
    expect(types.map((t) => t.name)).toEqual(["Bug", "Task"]);
    expect(bug).toMatchObject({ id: "10004" });
    expect(bug.statuses.map((s) => s.category)).toEqual([
      "new",
      "indeterminate",
      "indeterminate",
      "done",
    ]);
    expect(bugType(types.filter((t) => t.name !== "Bug"))).toBeNull();
  });

  it("reads the choices of a field whether Jira calls them name or value", () => {
    expect(fields.find((f) => f.id === "priority")!.options).toEqual(PRIORITIES_REPLY);
    const options = createFields([
      {
        fieldId: "customfield_10050",
        name: "Severity",
        required: false,
        hasDefaultValue: false,
        allowedValues: [{ id: "7", value: "High" }, "junk"],
      },
    ]);
    expect(options[0]!.options).toEqual([{ id: "7", name: "High" }]);
  });
});

describe("the suggested mapping", () => {
  it("places the 13 statuses on a four-column board and passes its own rules", () => {
    const config = suggestConfig(bug.statuses, PRIORITIES_REPLY)!;
    expect(configProblems(config)).toEqual([]);
    expect(config.statusOut).toMatchObject({
      NEW: "10000",
      ASSIGNED: "10000",
      REOPENED: "10000",
      IN_PROGRESS: "10001",
      RECHECK: "10002",
      RESOLVED: "10003",
      WONT_FIX: "10003",
    });
    expect(config.statusIn).toEqual({
      "10000": "NEW",
      "10001": "IN_PROGRESS",
      "10002": "RECHECK",
      "10003": "RESOLVED",
    });
    expect(config.priorityOut).toEqual({ P0: "1", P1: "1", P2: "2", P3: "3", P4: "4", P5: "5" });
    expect(config.priorityIn).toMatchObject({ "1": "P1", "5": "P5" });
  });

  it("works on the plain three-column board: retest shares In Progress", () => {
    const plain = bug.statuses.filter((s) => s.name !== "In Review");
    const config = suggestConfig(plain, PRIORITIES_REPLY)!;
    expect(configProblems(config)).toEqual([]);
    expect(config.statusOut.RECHECK).toBe("10001");
    expect(config.statusIn["10001"]).toBe("IN_PROGRESS");
  });

  it("uses a Won't-do status for the three dispositions, and never reads plain Done as one of them", () => {
    const config = suggestConfig(board(["10010", "Won't Do", "done"]), [])!;
    expect(configProblems(config)).toEqual([]);
    expect(config.statusOut).toMatchObject({
      RESOLVED: "10003",
      DUPLICATE: "10010",
      NOT_A_BUG: "10010",
      WONT_FIX: "10010",
    });
    expect(config.statusIn).toMatchObject({ "10003": "RESOLVED", "10010": "WONT_FIX" });
  });

  it("gives an extra finished-looking status no BugFlow meaning", () => {
    const config = suggestConfig(
      board(["10011", "Closed", "done"], ["10012", "Blocked", "indeterminate"]),
      [],
    )!;
    expect(config.statusIn["10011"]).toBeUndefined();
    expect(config.statusIn["10012"]).toBe("IN_PROGRESS");
    expect(configProblems(config)).toEqual([]);
  });

  it("leaves priority unmapped when Jira offers none, squeezes into fewer levels, and needs To Do and Done", () => {
    expect(suggestConfig(bug.statuses, [])!.priorityOut).toEqual({});
    const three = suggestConfig(bug.statuses, PRIORITIES_REPLY.slice(1, 4))!;
    expect(three.priorityOut).toEqual({ P0: "2", P1: "2", P2: "3", P3: "4", P4: "4", P5: "4" });
    expect(configProblems(three)).toEqual([]);
    expect(
      suggestConfig(
        bug.statuses.filter((s) => s.category !== "done"),
        [],
      ),
    ).toBeNull();
  });
});

describe("sprint and story points fields", () => {
  const planning = createFields(
    createMetaSchema.parse({
      fields: [
        {
          fieldId: "customfield_10020",
          name: "Sprint",
          schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint" },
        },
        {
          fieldId: "customfield_10016",
          name: "Story point estimate",
          schema: { type: "number", custom: "com.pyxis.greenhopper.jira:jsw-story-points" },
        },
        {
          fieldId: "customfield_10030",
          name: "Budget",
          schema: {
            type: "number",
            custom: "com.atlassian.jira.plugin.system.customfieldtypes:float",
          },
        },
      ],
    }).fields,
  );

  it("are recognised by Jira's own type, not by a guess at the name", () => {
    expect(planningFields(planning)).toEqual({
      sprintField: "customfield_10020",
      estimateField: "customfield_10016",
    });
    expect(planningFields(fields)).toEqual({ sprintField: undefined, estimateField: undefined });
    const config = suggestConfig(bug.statuses, [], [...fields, ...planning])!;
    expect(config).toMatchObject({
      sprintField: "customfield_10020",
      estimateField: "customfield_10016",
    });
    expect(shapeProblems(config, bug, [...fields, ...planning])).toEqual([]);
    expect(shapeProblems(config, bug, fields).join(" ")).toMatch(
      /Sprint field.*story points field/,
    );
    expect(suggestConfig(bug.statuses, [], fields)!.sprintField).toBeUndefined();
  });
});

describe("what a Jira status means, from the outgoing mapping", () => {
  const config = suggestConfig(bug.statuses, PRIORITIES_REPLY)!;

  it("keeps the suggestion while it still fits and follows an Admin's change", () => {
    expect(deriveStatusIn(config.statusOut, config.statusIn)).toEqual(config.statusIn);
    // the Admin sends Assigned to In Progress instead of To Do: nothing breaks
    const moved = { ...config.statusOut, ASSIGNED: "10001" };
    const next = deriveStatusIn(moved, config.statusIn);
    expect(next).toEqual(config.statusIn);
    expect(configProblems({ ...config, statusOut: moved, statusIn: next })).toEqual([]);
  });

  it("never reads a shared status as a closing decision, and gives a new target a meaning", () => {
    // everything that used to go to In Review now goes to Done, and Done is also used for Won't fix
    const out = { ...config.statusOut, RECHECK: "10003" };
    const next = deriveStatusIn(out, { ...config.statusIn, "10003": "WONT_FIX" });
    expect(next["10003"]).toBe("RECHECK"); // first non-closing status sent there
    expect(next["10002"]).toBe("RECHECK"); // no longer a target: keeps what it meant
    const own = deriveStatusIn(
      { ...config.statusOut, WONT_FIX: "10010", DUPLICATE: "10010", NOT_A_BUG: "10010" },
      config.statusIn,
    );
    expect(own["10010"]).toBe("DUPLICATE");
    expect(
      configProblems({
        ...config,
        statusOut: {
          ...config.statusOut,
          WONT_FIX: "10010",
          DUPLICATE: "10010",
          NOT_A_BUG: "10010",
        },
        statusIn: own,
      }),
    ).toEqual([]);
  });
});

describe("checking a mapping against the live project", () => {
  const config = suggestConfig(bug.statuses, PRIORITIES_REPLY)!;
  const without = (id: string) => fields.filter((f) => f.id !== id);

  it("passes the usual Bug create screen", () => {
    expect(shapeProblems(config, bug, fields)).toEqual([]);
  });

  it("names each thing Jira is missing", () => {
    expect(shapeProblems(config, null, fields)).toEqual([
      "The chosen issue type is not in this Jira project any more.",
    ]);
    expect(shapeProblems(config, bug, without("labels"))[0]).toMatch(/no Labels field/);
    expect(shapeProblems(config, bug, without("duedate"))[0]).toMatch(/Due date/);
    expect(shapeProblems({ ...config, dueOn: false }, bug, without("duedate"))).toEqual([]);
    expect(shapeProblems(config, { ...bug, statuses: bug.statuses.slice(0, 3) }, fields)).toEqual([
      "Jira status 10003 is not in this project's Bug workflow.",
    ]);
    const fewer = fields.map((f) =>
      f.id === "priority" ? { ...f, options: f.options.slice(0, 4) } : f,
    );
    expect(shapeProblems(config, bug, fewer)).toEqual([
      "Jira priority 5 is not offered for Bug in this project.",
    ]);
  });

  it("stops on a field Jira requires that BugFlow cannot fill, but not on Reporter", () => {
    const team = {
      id: "customfield_10099",
      name: "Team",
      required: true,
      hasDefault: false,
      options: [],
      custom: null,
    };
    expect(shapeProblems(config, bug, [...fields, team])).toEqual([
      'Jira requires "Team" to create a Bug, and BugFlow cannot always fill it.',
    ]);
    expect(shapeProblems(config, bug, [...fields, { ...team, hasDefault: true }])).toEqual([]);
  });
});
