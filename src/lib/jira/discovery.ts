import { z } from "zod";
import { PRIORITIES } from "../bug-workflow";
import type { Status } from "../bugflow";
import { type MappingConfig, mappingConfigSchema } from "./schemas";

// What BugFlow reads from Jira to set up a project mapping, a first suggestion for that mapping, and the checks
// a mapping must pass against the live Jira project before it may be switched on. Pure: the server module does
// the reading. Shapes follow Atlassian's published REST v3 description.

const jiraId = z.string().regex(/^\d{1,20}$/);

/** `GET /rest/api/3/project/search` */
export const projectPageSchema = z.object({
  values: z
    .array(
      z
        .object({ id: jiraId, key: z.string().min(1).max(64), name: z.string().default("") })
        .passthrough(),
    )
    .default([]),
  isLast: z.boolean().optional(),
});
/** `GET /rest/api/3/project/{id}` */
export const projectSchema = z
  .object({ id: jiraId, key: z.string().min(1).max(64), name: z.string().default("") })
  .passthrough();
/** `GET /rest/api/3/project/{id}/statuses`: every issue type of the project with its workflow's statuses. */
export const projectStatusesSchema = z.array(
  z
    .object({
      id: jiraId,
      name: z.string(),
      subtask: z.boolean().default(false),
      statuses: z
        .array(
          z
            .object({
              id: jiraId,
              name: z.string(),
              statusCategory: z.object({ key: z.string() }).passthrough().optional(),
            })
            .passthrough(),
        )
        .default([]),
    })
    .passthrough(),
);
/** `GET /rest/api/3/issue/createmeta/{project}/issuetypes/{type}`: the fields on that type's create screen. */
export const createMetaSchema = z.object({
  fields: z
    .array(
      z
        .object({
          fieldId: z.string().min(1),
          name: z.string().default(""),
          required: z.boolean().default(false),
          hasDefaultValue: z.boolean().default(false),
          allowedValues: z.array(z.unknown()).optional(),
          schema: z.object({ custom: z.string().optional() }).passthrough().optional(),
        })
        .passthrough(),
    )
    .default([]),
  total: z.number().optional(),
});

export type JiraProjectInfo = { id: string; key: string; name: string };
export type JiraStatusInfo = {
  id: string;
  name: string;
  /** Jira's own grouping: To Do, In Progress, Done. */
  category: "new" | "indeterminate" | "done" | "other";
};
export type JiraIssueTypeInfo = { id: string; name: string; statuses: JiraStatusInfo[] };
export type JiraCreateField = {
  id: string;
  name: string;
  required: boolean;
  hasDefault: boolean;
  options: {
    id: string;
    name: string;
  }[]; /** Jira's own type name for a custom field (how the Sprint and Story points fields are recognised). */
  custom: string | null;
};

const CATEGORIES = ["new", "indeterminate", "done"] as const;
export function issueTypes(raw: z.infer<typeof projectStatusesSchema>): JiraIssueTypeInfo[] {
  return raw
    .filter((t) => !t.subtask)
    .map((t) => ({
      id: t.id,
      name: t.name,
      statuses: t.statuses.map((s) => ({
        id: s.id,
        name: s.name,
        category: CATEGORIES.find((c) => c === s.statusCategory?.key) ?? "other",
      })),
    }));
}
/** Only the type literally named Bug is offered by default; any other choice is the Admin's. */
export const bugType = (types: JiraIssueTypeInfo[]) =>
  types.find((t) => t.name.trim().toLowerCase() === "bug") ?? null;

export function createFields(raw: z.infer<typeof createMetaSchema>["fields"]): JiraCreateField[] {
  return raw.map((f) => ({
    id: f.fieldId,
    name: f.name,
    required: f.required,
    hasDefault: f.hasDefaultValue,
    custom: f.schema?.custom ?? null,
    options: (f.allowedValues ?? []).flatMap((v) => {
      const o = v as { id?: unknown; name?: unknown; value?: unknown } | null;
      const label = o?.name ?? o?.value;
      return typeof o?.id === "string" && typeof label === "string"
        ? [{ id: o.id, name: label }]
        : [];
    }),
  }));
}

const FIXED = /^(done|resolved|closed|fixed|complete)/i;
const REVIEW = /review|recheck|retest|verif|test|qa/i;
const DECLINED = /won.?t|not a bug|invalid|declin|reject|cancel|duplicate|obsolete/i;

/**
 * A starting mapping for an Admin to adjust, from the statuses and priorities Jira really has. Null when the
 * workflow has no To Do or no Done status to anchor on. Jira statuses nobody is sent to are left without a
 * BugFlow meaning when they are in Done, so a finished-looking status never resolves a bug by guesswork.
 */
const SPRINT_TYPE = "com.pyxis.greenhopper.jira:gh-sprint";
const POINTS_TYPE = "com.pyxis.greenhopper.jira:jsw-story-points";
const NUMBER_TYPE = "com.atlassian.jira.plugin.system.customfieldtypes:float";
/** Jira's Sprint field and its story-points field, when the issue type has them. */
export function planningFields(fields: JiraCreateField[]) {
  const sprint = fields.find((f) => f.custom === SPRINT_TYPE);
  const points =
    fields.find((f) => f.custom === POINTS_TYPE) ??
    fields.find((f) => f.custom === NUMBER_TYPE && /story points?/i.test(f.name));
  return { sprintField: sprint?.id, estimateField: points?.id };
}

export function suggestConfig(
  statuses: JiraStatusInfo[],
  priorities: { id: string; name: string }[],
  fields: JiraCreateField[] = [],
): MappingConfig | null {
  const of = (c: JiraStatusInfo["category"]) => statuses.filter((s) => s.category === c);
  const todo = of("new")[0];
  const finished = of("done");
  const done =
    finished.find((s) => FIXED.test(s.name)) ??
    finished.find((s) => !DECLINED.test(s.name)) ??
    finished[0];
  if (!todo || !done) return null;
  const progress =
    of("indeterminate").find((s) => !REVIEW.test(s.name)) ?? of("indeterminate")[0] ?? todo;
  const review =
    of("indeterminate").find((s) => REVIEW.test(s.name) && s.id !== progress.id) ?? progress;
  const declined = finished.find((s) => DECLINED.test(s.name) && s.id !== done.id) ?? done;

  const statusOut: Record<Status, string> = {
    NEW: todo.id,
    VALIDATING: todo.id,
    VALIDATED: todo.id,
    READY_FOR_ASSIGNMENT: todo.id,
    NEEDS_INFORMATION: todo.id,
    ASSIGNED: todo.id,
    REOPENED: todo.id,
    IN_PROGRESS: progress.id,
    RECHECK: review.id,
    RESOLVED: done.id,
    DUPLICATE: declined.id,
    NOT_A_BUG: declined.id,
    WONT_FIX: declined.id,
  };
  // Later entries win, so the most specific meaning is written last.
  const statusIn: Record<string, Status> = {};
  for (const s of statuses)
    if (s.category === "new") statusIn[s.id] = "NEW";
    else if (s.category === "indeterminate") statusIn[s.id] = "IN_PROGRESS";
  statusIn[todo.id] = "NEW";
  if (progress.id !== todo.id) statusIn[progress.id] = "IN_PROGRESS";
  if (review.id !== progress.id) statusIn[review.id] = "RECHECK";
  statusIn[done.id] = "RESOLVED";
  if (declined.id !== done.id) statusIn[declined.id] = "WONT_FIX";

  // Jira lists priorities highest first. P0 and P1 share the top one; the rest step down and stop at the last.
  const priorityOut: Record<string, string> = {};
  const priorityIn: Record<string, string> = {};
  if (priorities.length)
    PRIORITIES.forEach((p, i) => {
      const jira = priorities[Math.min(Math.max(i - 1, 0), priorities.length - 1)]!.id;
      priorityOut[p] = jira;
      // The top Jira priority reads back as P1, never as P0 (a blocker is declared in BugFlow).
      if (!priorityIn[jira] || p === "P1") priorityIn[jira] = p;
    });
  const planning = planningFields(fields);
  return mappingConfigSchema.parse({
    statusOut,
    statusIn,
    priorityOut,
    priorityIn,
    ...(planning.sprintField ? { sprintField: planning.sprintField } : {}),
    ...(planning.estimateField ? { estimateField: planning.estimateField } : {}),
  });
}

/**
 * What each Jira status means when a change comes from Jira, worked out from the outgoing mapping an Admin
 * edits. A Jira status that receives BugFlow statuses means one of those: the suggested meaning if it is still
 * among them, else the first that is not a closing decision (so a shared Done reads as Resolved, never as
 * Duplicate / Not a bug / Won't fix). Jira statuses nothing is sent to keep the meaning they had.
 */
export function deriveStatusIn(
  statusOut: MappingConfig["statusOut"],
  previous: MappingConfig["statusIn"],
): MappingConfig["statusIn"] {
  const closing: Status[] = ["DUPLICATE", "NOT_A_BUG", "WONT_FIX"];
  const sources = new Map<string, Status[]>();
  for (const [status, jira] of Object.entries(statusOut) as [Status, string][])
    sources.set(jira, [...(sources.get(jira) ?? []), status]);
  const out: MappingConfig["statusIn"] = {};
  for (const [jira, meaning] of Object.entries(previous))
    if (!sources.has(jira)) out[jira] = meaning;
  for (const [jira, from] of sources) {
    const kept = previous[jira];
    const mixed = from.some((s) => !closing.includes(s));
    const ok = kept && from.includes(kept) && !(mixed && closing.includes(kept));
    out[jira] = ok ? kept : (from.find((s) => !closing.includes(s)) ?? from[0]!);
  }
  return out;
}

/** Fields BugFlow fills on every create (and Reporter, which Jira fills with the calling account). */
const ALWAYS_SENT = new Set([
  "project",
  "issuetype",
  "summary",
  "description",
  "labels",
  "reporter",
]);

/**
 * What stops this mapping from working against the Jira project as it is now, in words an Admin can act on.
 * Empty means the live project can take what BugFlow will send.
 */
export function shapeProblems(
  config: MappingConfig,
  type: JiraIssueTypeInfo | null,
  fields: JiraCreateField[],
): string[] {
  if (!type) return ["The chosen issue type is not in this Jira project any more."];
  const problems: string[] = [];
  const known = new Set(type.statuses.map((s) => s.id));
  for (const id of new Set(Object.values(config.statusOut)))
    if (!known.has(id))
      problems.push(`Jira status ${id} is not in this project's ${type.name} workflow.`);
  const field = new Map(fields.map((f) => [f.id, f]));
  const need = (id: string, why: string) => {
    if (!field.has(id)) problems.push(`Jira's ${type.name} create screen has no ${why}`);
  };
  need("summary", "Summary field.");
  need("description", "Description field; BugFlow writes steps and details there.");
  need("labels", "Labels field; BugFlow needs it to never create the same issue twice.");
  const priorities = new Set(Object.values(config.priorityOut));
  if (priorities.size) {
    need("priority", "Priority field. Add it, or leave priority unmapped.");
    const offered = new Set(field.get("priority")?.options.map((o) => o.id));
    for (const id of priorities)
      if (field.has("priority") && !offered.has(id))
        problems.push(`Jira priority ${id} is not offered for ${type.name} in this project.`);
  }
  if (config.dueOn) need("duedate", "Due date field. Add it, or turn due dates off.");
  if (config.assignee) need("assignee", "Assignee field. Add it, or turn assignee off.");
  const custom = Object.values(config.fields).flatMap((p) =>
    p.mode === "custom" ? [p.fieldId] : [],
  );
  for (const id of custom) need(id, `field ${id}.`);
  if (config.sprintField)
    need(config.sprintField, "Sprint field. Add it, or turn sprint sync off.");
  if (config.estimateField)
    need(config.estimateField, "story points field. Add it, or turn estimate sync off.");
  const filled = new Set([...ALWAYS_SENT, ...custom]);
  for (const f of fields)
    if (f.required && !f.hasDefault && !filled.has(f.id))
      problems.push(
        `Jira requires "${f.name || f.id}" to create a ${type.name}, and BugFlow cannot always fill it.`,
      );
  return problems;
}
