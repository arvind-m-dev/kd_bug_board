import { STATUSES, type Status } from "../bugflow";
import { PRIORITIES } from "../bug-workflow";
import {
  type DescriptionParts,
  buildDescription,
  cleanLine,
  cleanText,
  detail,
  docList,
  docText,
  listDoc,
  patchDescription,
  plainDoc,
  readDescription,
} from "./adf";
import type { Direction } from "./compare";
import type { FieldPlace, JiraIssue, MappingConfig } from "./schemas";
import type { SyncField, SyncFields } from "./types";

// Pure translation between a BugFlow bug, a Jira issue and the one shape both are compared in (SyncFields).
// No network, no database: the processor hands rows in and sends the bodies built here.

/** A bug as the sync reads it from the database. */
export type LocalBug = {
  id: string;
  code: string;
  /** Signed-in address of the bug in Bug Board. */
  url: string;
  title: string;
  description: string;
  steps: string[];
  expected: string;
  actual: string;
  priority: string;
  severity: string;
  status: Status;
  dueOn: string | null;
  environment: string;
  module: string;
  reporterId: string;
  assigneeId: string | null;
  reporterName: string;
  /** Confirmed Atlassian accounts only; null when the person has none. */
  reporterAccountId: string | null;
  assigneeNames: string[];
  assigneeAccountId: string | null;
  /** The Jira sprint linked to the open BugFlow sprint the bug is in; null when in none, or in one Jira does not have. */
  sprintJiraId: string | null;
  estimate: number | null;
};

export type JiraSprint = {
  id: string;
  name: string;
  state: "future" | "active" | "closed";
  boardId: string | null;
  startDate: string | null;
  endDate: string | null;
  goal: string;
};

export type Remote = {
  id: string;
  key: string;
  projectId: string;
  issueTypeId: string;
  updatedAt: string | null;
  labels: string[];
  /** Who Jira names as reporter; kept for attribution, never turned into a BugFlow member by itself. */
  reporter: { accountId: string; displayName: string } | null;
  fields: SyncFields;
  /** Fields whose Jira content holds formatting or media that plain text would lose if rewritten. */
  lossy: Partial<Record<SyncField, boolean>>;
  /** The description exactly as Jira returned it, for patching. */
  description: unknown;
  /** Every sprint Jira lists on the issue (open and closed), as Jira describes them. */
  sprints: JiraSprint[];
};

/** The mapping cannot express this bug; a person has to change the mapping. */
export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

const DISPOSITIONS: readonly Status[] = ["DUPLICATE", "NOT_A_BUG", "WONT_FIX"];
const DETAIL_LABELS = {
  severity: "Severity",
  environment: "Environment",
  module: "Module",
} as const;
type DetailField = keyof typeof DETAIL_LABELS;
const DETAIL_FIELDS = Object.keys(DETAIL_LABELS) as DetailField[];

/** Everything wrong with a mapping, in words an Admin can act on. Empty means it can be activated. */
export function configProblems(config: MappingConfig): string[] {
  const problems: string[] = [];
  const sources = new Map<string, Status[]>();
  for (const status of STATUSES) {
    const jira = config.statusOut[status];
    if (!jira) problems.push(`BugFlow status ${status} has no Jira status.`);
    else sources.set(jira, [...(sources.get(jira) ?? []), status]);
  }
  for (const [jira, from] of sources) {
    const canonical = config.statusIn[jira];
    if (!canonical)
      problems.push(
        `Jira status ${jira} is used for ${from.join(", ")} but means no BugFlow status.`,
      );
    else if (!from.includes(canonical))
      problems.push(
        `Jira status ${jira} means ${canonical}, which is sent to a different Jira status.`,
      );
    // A "Done" that also receives fixed or open bugs must never be read back as Duplicate / Not a bug / Won't
    // fix. A Jira status used only for those three (a "Won't do") may name one of them.
    else if (DISPOSITIONS.includes(canonical) && from.some((s) => !DISPOSITIONS.includes(s)))
      problems.push(
        `${canonical} needs a Jira status of its own; ${jira} is shared with ${from.filter((s) => !DISPOSITIONS.includes(s)).join(", ")}.`,
      );
  }
  const mapped = PRIORITIES.filter((p) => config.priorityOut[p]);
  if (mapped.length && mapped.length < PRIORITIES.length)
    problems.push(
      `Priorities without a Jira priority: ${PRIORITIES.filter((p) => !config.priorityOut[p]).join(", ")}.`,
    );
  if (config.inbound.priority)
    for (const id of new Set(mapped.map((p) => config.priorityOut[p]!))) {
      const canonical = config.priorityIn[id];
      if (!canonical || config.priorityOut[canonical] !== id)
        problems.push(`Jira priority ${id} needs one BugFlow priority that is also sent to it.`);
    }
  const custom = Object.values(config.fields).flatMap((p) =>
    p.mode === "custom" ? [p.fieldId] : [],
  );
  if (new Set(custom).size !== custom.length)
    problems.push("A Jira custom field is used for two BugFlow fields.");
  if (config.fields.steps.mode === "custom" && config.fields.steps.type !== "paragraph")
    problems.push("Steps need a paragraph (rich text) custom field.");
  return problems;
}

/** Which way each field may travel. `out`: BugFlow owns it and a Jira edit is not taken. */
export function directions(config: MappingConfig): Record<SyncField, Direction> {
  return {
    title: "both",
    description: "both",
    steps: "both",
    expected: "both",
    actual: "both",
    priority: config.inbound.priority ? "both" : "out",
    severity: config.inbound.severity ? "both" : "out",
    status: "both",
    assignee: "both",
    dueOn: config.inbound.dueOn ? "both" : "out",
    environment: "both",
    module: "both",
    note: "out",
    sprint: "both",
    estimate: "both",
  };
}

const on = (place: FieldPlace) => place.mode !== "off";

/** Jira needs a summary; a bug reported without a title is named by the start of its description. */
function summary(bug: LocalBug): string {
  const title = cleanLine(bug.title);
  if (title) return title;
  const first = cleanLine(cleanText(bug.description).split("\n")[0] ?? "");
  return first ? (first.length > 120 ? `${first.slice(0, 117)}...` : first) : bug.code;
}

export function localFields(bug: LocalBug, config: MappingConfig): SyncFields {
  const status = config.statusOut[bug.status];
  if (!status) throw new MappingError(`BugFlow status ${bug.status} has no Jira status.`);
  const note = [
    `Reported by: ${cleanLine(bug.reporterName)}`,
    ...(bug.assigneeNames.length
      ? [`Assigned to: ${bug.assigneeNames.map(cleanLine).join(", ")}`]
      : []),
    `Bug Board: ${bug.code} ${bug.url}`,
  ];
  return {
    title: summary(bug),
    description: cleanText(bug.description),
    steps: on(config.fields.steps) ? bug.steps.map(cleanText).filter(Boolean) : [],
    expected: on(config.fields.expected) ? cleanText(bug.expected) : "",
    actual: on(config.fields.actual) ? cleanText(bug.actual) : "",
    priority: config.priorityOut[bug.priority as (typeof PRIORITIES)[number]] ?? null,
    severity: on(config.fields.severity) ? cleanLine(bug.severity) : "",
    status,
    assignee: config.assignee ? bug.assigneeAccountId : null,
    dueOn: config.dueOn ? bug.dueOn : null,
    environment: on(config.fields.environment) ? cleanLine(bug.environment) : "",
    module: on(config.fields.module) ? cleanLine(bug.module) : "",
    note: note.join("\n"),
    sprint: config.sprintField ? bug.sprintJiraId : null,
    estimate: config.estimateField ? bug.estimate : null,
  };
}

function readCustom(raw: unknown, type: "text" | "option" | "paragraph") {
  if (type === "paragraph") return docText(raw);
  const value = type === "option" ? (raw as { value?: unknown } | null)?.value : raw;
  return { text: typeof value === "string" ? cleanText(value) : "", lossy: false };
}

export function remoteFields(issue: JiraIssue, config: MappingConfig): Remote {
  const f = issue.fields as JiraIssue["fields"] & Record<string, unknown>;
  const parsed = readDescription(f.description);
  const lossy: Partial<Record<SyncField, boolean>> = { description: parsed.lossy.description };
  const text = (field: "expected" | "actual" | DetailField, fromSection: string) => {
    const place = config.fields[field];
    if (place.mode === "off") return "";
    if (place.mode === "section") return fromSection;
    const read = readCustom(f[place.fieldId], place.type);
    lossy[field] = read.lossy;
    return read.text;
  };
  let steps: string[] = [];
  if (config.fields.steps.mode === "section") {
    steps = parsed.steps;
    lossy.steps = parsed.lossy.steps;
  } else if (config.fields.steps.mode === "custom") {
    const list = docList(f[config.fields.steps.fieldId]);
    steps = list.items;
    lossy.steps = list.lossy;
  }
  if (config.fields.expected.mode === "section") lossy.expected = parsed.lossy.expected;
  if (config.fields.actual.mode === "section") lossy.actual = parsed.lossy.actual;
  const labels = DETAIL_FIELDS.map((k) => `${DETAIL_LABELS[k].toLowerCase()}:`);
  const hasPriority = PRIORITIES.some((p) => config.priorityOut[p]);
  const sprints = config.sprintField ? readSprints(f[config.sprintField]) : [];
  const estimate = config.estimateField ? f[config.estimateField] : null;
  return {
    id: issue.id,
    key: issue.key,
    projectId: f.project.id,
    issueTypeId: f.issuetype.id,
    updatedAt: f.updated ?? null,
    labels: f.labels ?? [],
    reporter: f.reporter
      ? { accountId: f.reporter.accountId, displayName: f.reporter.displayName ?? "" }
      : null,
    description: f.description,
    sprints,
    lossy,
    fields: {
      title: cleanLine(f.summary ?? ""),
      description: parsed.description,
      steps,
      expected: text("expected", parsed.expected),
      actual: text("actual", parsed.actual),
      priority: hasPriority ? (f.priority?.id ?? null) : null,
      severity: cleanLine(text("severity", detail(parsed.details, DETAIL_LABELS.severity))),
      status: f.status.id,
      assignee: config.assignee ? (f.assignee?.accountId ?? null) : null,
      dueOn: config.dueOn ? (f.duedate ?? null) : null,
      environment: cleanLine(
        text("environment", detail(parsed.details, DETAIL_LABELS.environment)),
      ),
      module: cleanLine(text("module", detail(parsed.details, DETAIL_LABELS.module))),
      note: parsed.details
        .filter((l) => !labels.some((p) => l.toLowerCase().startsWith(p)))
        .join("\n"),
      // An issue is in at most one open sprint; the active one counts if Jira ever lists two.
      sprint:
        (sprints.find((s) => s.state === "active") ?? sprints.find((s) => s.state === "future"))
          ?.id ?? null,
      estimate: typeof estimate === "number" && Number.isFinite(estimate) ? estimate : null,
    },
  };
}

/** Jira's Sprint field: a list of sprint objects. Anything not shaped like one is ignored. */
function readSprints(raw: unknown): JiraSprint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v): JiraSprint[] => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const id = typeof o["id"] === "number" || typeof o["id"] === "string" ? String(o["id"]) : "";
    const state = o["state"];
    if (!/^\d{1,18}$/.test(id) || (state !== "future" && state !== "active" && state !== "closed"))
      return [];
    const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
    return [
      {
        id,
        name: cleanLine(text("name") ?? `Sprint ${id}`).slice(0, 80),
        state,
        boardId: typeof o["boardId"] === "number" ? String(o["boardId"]) : null,
        startDate: text("startDate"),
        endDate: text("endDate"),
        goal: (text("goal") ?? "").slice(0, 500),
      },
    ];
  });
}

function detailLines(values: SyncFields, config: MappingConfig): string[] {
  return [
    ...DETAIL_FIELDS.flatMap((k) =>
      config.fields[k].mode === "section" && values[k] ? [`${DETAIL_LABELS[k]}: ${values[k]}`] : [],
    ),
    ...values.note.split("\n").filter(Boolean),
  ];
}
function descriptionParts(values: SyncFields, config: MappingConfig): DescriptionParts {
  const section = (k: "steps" | "expected" | "actual") => config.fields[k].mode === "section";
  return {
    description: values.description,
    steps: section("steps") ? values.steps : [],
    expected: section("expected") ? values.expected : "",
    actual: section("actual") ? values.actual : "",
    details: detailLines(values, config),
  };
}
function customValue(
  field: SyncField,
  values: SyncFields,
  place: FieldPlace & { mode: "custom" },
): unknown {
  if (field === "steps") return values.steps.length ? listDoc(values.steps) : null;
  const value = String(values[field] ?? "");
  if (!value) return null;
  return place.type === "text" ? value : place.type === "option" ? { value } : plainDoc(value);
}
const PLACED = ["steps", "expected", "actual", "severity", "environment", "module"] as const;

/** The label that finds a created issue again when the reply to the create request was lost. */
export const isMarkerLabel = (label: string) => /^bf-\d+-[0-9a-f]{8}$/.test(label);
export const markerLabel = (bugId: string, createOpId: string) =>
  `bf-${bugId}-${createOpId.replace(/-/g, "").slice(0, 8)}`;

/** Body for `POST /rest/api/3/issue`. Status is not set here: Jira starts the issue and a transition moves it. */
export function createBody(
  bug: LocalBug,
  local: SyncFields,
  target: { projectId: string; issueTypeId: string },
  config: MappingConfig,
  marker: string,
) {
  const fields: Record<string, unknown> = {
    project: { id: target.projectId },
    issuetype: { id: target.issueTypeId },
    summary: local.title,
    description: buildDescription(descriptionParts(local, config)),
    labels: [marker],
  };
  if (local.priority) fields["priority"] = { id: local.priority };
  if (local.dueOn) fields["duedate"] = local.dueOn;
  if (local.assignee) fields["assignee"] = { accountId: local.assignee };
  if (bug.reporterAccountId) fields["reporter"] = { accountId: bug.reporterAccountId };
  if (config.sprintField && local.sprint) fields[config.sprintField] = Number(local.sprint);
  if (config.estimateField && local.estimate !== null)
    fields[config.estimateField] = local.estimate;
  for (const k of PLACED) {
    const place = config.fields[k];
    if (place.mode !== "custom") continue;
    const value = customValue(k, local, place);
    if (value !== null) fields[place.fieldId] = value;
  }
  return { fields };
}

/**
 * Body for `PUT /rest/api/3/issue/{id}` that changes only the pushed fields. `values` holds BugFlow's value for
 * those and Jira's current value for the rest, so a rebuilt details section keeps what Jira has for the others.
 * Null when nothing but status was pushed (status moves by transition, never as a field).
 */
export function updateBody(
  push: readonly SyncField[],
  values: SyncFields,
  currentDescription: unknown,
  config: MappingConfig,
) {
  const fields: Record<string, unknown> = {};
  const changes: Partial<DescriptionParts> = {};
  let details = false;
  for (const field of push) {
    if (field === "title") fields["summary"] = values.title;
    else if (field === "description") changes.description = values.description;
    else if (field === "note") details = true;
    else if (field === "priority") {
      if (values.priority) fields["priority"] = { id: values.priority };
    } else if (field === "assignee")
      fields["assignee"] = values.assignee ? { accountId: values.assignee } : null;
    else if (field === "dueOn") fields["duedate"] = values.dueOn;
    else if (field === "sprint") {
      // Jira's Sprint field takes the sprint's number; empty takes the issue out of its sprint.
      if (config.sprintField)
        fields[config.sprintField] = values.sprint ? Number(values.sprint) : null;
    } else if (field === "estimate") {
      if (config.estimateField) fields[config.estimateField] = values.estimate;
    } else if (field !== "status") {
      const place = config.fields[field];
      if (place.mode === "custom") fields[place.fieldId] = customValue(field, values, place);
      else if (place.mode === "section") {
        if (field === "steps") changes.steps = values.steps;
        else if (field === "expected" || field === "actual") changes[field] = values[field];
        else details = true;
      }
    }
  }
  if (details) changes.details = detailLines(values, config);
  if (Object.keys(changes).length)
    fields["description"] = patchDescription(currentDescription, changes);
  return Object.keys(fields).length ? { fields } : null;
}
