import {
  type BugActor,
  type DropdownOptions,
  PRIORITIES,
  mayUpdateStatus,
  statusPath,
} from "../bug-workflow";
import { type Status, isCalendarDate } from "../bugflow";
import type { Remote } from "./mapping";
import type { MappingConfig } from "./schemas";
import { JIRA_SYNC_USER_ID, type SyncField, type SyncFields } from "./types";

// What a change made in Jira may do to a BugFlow bug. Pure: it only decides. Every decision goes through the
// same 13-status rules people are held to; nothing here can resolve a bug without a retest, assign someone who
// is not a member of the project, or store text BugFlow itself would refuse.

/**
 * The integration as an actor for the status rules. It has the triage and development moves of the workflow
 * and nothing else: `statusPath` already refuses Resolved (verification only) and Assigned (assignment only)
 * to everyone, and this actor holds no permission that would open another door.
 */
export const JIRA_ACTOR: BugActor = {
  userId: JIRA_SYNC_USER_ID,
  portalId: "",
  name: "Jira Sync",
  role: "admin",
  permissions: [],
};

export type InboundReason =
  | "too_long_for_bugflow"
  | "empty_in_jira"
  | "not_a_bugflow_option"
  | "unmapped_priority"
  | "invalid_date"
  | "unassign_not_supported"
  | "unmapped_assignee"
  | "assignee_not_on_project"
  | "unmapped_status"
  | "needs_qa_verification"
  | "needs_assignment"
  | "not_allowed_in_bugflow"
  | "unknown_sprint"
  | "sprint_not_open"
  | "in_another_sprint"
  | "not_a_bugflow_estimate";

export type InboundEdit = {
  title?: string;
  description?: string;
  steps?: string[];
  expected?: string;
  actual?: string;
  environment?: string;
  module?: string;
  priority?: string;
  severity?: string;
  dueOn?: string | null;
  estimate?: number | null;
};
export type InboundChange = {
  edit: InboundEdit | null;
  /** `hops`: status steps that come with the assignment (triage up to Ready, then Assigned). */
  assign: { userId: string; status: Status; hops: [string, string][] } | null;
  /** `verify`: the move is a passed retest and is recorded as one. */
  status: { from: Status; target: Status; hops: [string, string][]; verify: boolean } | null;
  /** The pulled fields this change covers. */
  /** Move into this BugFlow sprint, or out of its sprint (`to: null`). */
  sprint: { to: string | null } | null;
  fields: SyncField[];
};
export type InboundContext = {
  options: DropdownOptions;
  /** The BugFlow member confirmed for Jira's assignee, and whether they are on the bug's project. */
  assignee: { userId: string; onProject: boolean } | null;
  sprint: {
    /** The BugFlow sprint that mirrors Jira's sprint, when there is one. */
    target: { sprintId: string; open: boolean } | null;
    /** The bug sits in an open BugFlow sprint that Jira does not have. */
    elsewhere: boolean;
  };
};
export type Rejection = { field: SyncField; reason: InboundReason };

const LIMITS = {
  title: 180,
  description: 8000,
  expected: 4000,
  actual: 4000,
  environment: 80,
  module: 100,
};
const STEP_LIMIT = 2000;
const MAX_STEPS = 30;
const ASSIGNABLE: readonly Status[] = [
  "VALIDATED",
  "READY_FOR_ASSIGNMENT",
  "ASSIGNED",
  "REOPENED",
  "IN_PROGRESS",
];
const estimateFits = (n: number) => Number.isInteger(n) && n >= 0 && n <= 1000;
const option = (list: string[], value: string) =>
  list.find((o) => o.toLowerCase() === value.toLowerCase()) ?? null;

/**
 * The legal steps from the bug's status to the one Jira's new status means. Assigned, Reopened and In progress
 * often share one Jira column, so a Jira move out of that column can find the bug not started yet: "start work"
 * is then taken as a first step, for a bug that has an assignee. That is the only step Jira cannot see that is
 * ever added; every step is a move the workflow permits and each is written to the status history.
 */
function inboundPath(
  bug: { status: Status; reporterId: string; assigneeId: string | null },
  target: Status,
  config: MappingConfig,
): [string, string][] | null {
  const direct = statusPath(JIRA_ACTOR, bug, target);
  if (direct) return direct;
  const waiting = bug.status === "ASSIGNED" || bug.status === "REOPENED";
  if (
    !waiting ||
    !bug.assigneeId ||
    config.statusOut["IN_PROGRESS"] !== config.statusOut[bug.status] ||
    !mayUpdateStatus(JIRA_ACTOR, bug, "IN_PROGRESS")
  )
    return null;
  const rest = statusPath(JIRA_ACTOR, { ...bug, status: "IN_PROGRESS" }, target);
  return rest ? [[bug.status, "IN_PROGRESS"], ...rest] : null;
}

export function planInbound(
  pull: readonly SyncField[],
  remote: SyncFields,
  bug: { status: Status; reporterId: string; assigneeId: string | null },
  config: MappingConfig,
  ctx: InboundContext,
): { change: InboundChange | null; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const edit: InboundEdit = {};
  const fields: SyncField[] = [];
  const no = (field: SyncField, reason: InboundReason) => void rejected.push({ field, reason });
  let assign: InboundChange["assign"] = null;
  let status: InboundChange["status"] = null;

  for (const field of pull) {
    switch (field) {
      case "title":
      case "description":
      case "expected":
      case "actual":
      case "environment":
      case "module": {
        const value = remote[field];
        if (value.length > LIMITS[field]) no(field, "too_long_for_bugflow");
        else if (!value && (field === "title" || field === "description"))
          no(field, "empty_in_jira");
        else {
          edit[field] = value;
          fields.push(field);
        }
        break;
      }
      case "steps":
        if (remote.steps.length > MAX_STEPS || remote.steps.some((s) => s.length > STEP_LIMIT))
          no("steps", "too_long_for_bugflow");
        else {
          edit.steps = remote.steps;
          fields.push("steps");
        }
        break;
      case "priority": {
        const priority = remote.priority ? config.priorityIn[remote.priority] : undefined;
        if (!priority) no("priority", "unmapped_priority");
        else {
          edit.priority = priority;
          fields.push("priority");
        }
        break;
      }
      case "severity": {
        const severity = option(ctx.options.severities, remote.severity);
        if (!severity) no("severity", remote.severity ? "not_a_bugflow_option" : "empty_in_jira");
        else {
          edit.severity = severity;
          fields.push("severity");
        }
        break;
      }
      case "dueOn":
        if (remote.dueOn !== null && !isCalendarDate(remote.dueOn)) no("dueOn", "invalid_date");
        else {
          edit.dueOn = remote.dueOn;
          fields.push("dueOn");
        }
        break;
      case "estimate":
        // BugFlow estimates are whole numbers from 0 to 1000; Jira allows halves and more.
        if (remote.estimate !== null && !estimateFits(remote.estimate))
          no("estimate", "not_a_bugflow_estimate");
        else {
          edit.estimate = remote.estimate;
          fields.push("estimate");
        }
        break;
      default:
        break; // assignee, status and sprint below; `note` never comes from Jira
    }
  }

  // Assignment first: it can move the status (to Assigned), which the status step then starts from.
  let current = bug.status;
  if (pull.includes("assignee")) {
    if (!remote.assignee) no("assignee", "unassign_not_supported");
    else if (!ctx.assignee) no("assignee", "unmapped_assignee");
    else if (!ctx.assignee.onProject) no("assignee", "assignee_not_on_project");
    else {
      const triage = ASSIGNABLE.includes(bug.status)
        ? []
        : statusPath(JIRA_ACTOR, bug, "READY_FOR_ASSIGNMENT");
      if (!triage) no("assignee", "not_allowed_in_bugflow");
      else {
        const hops = [...triage];
        if (bug.status !== "IN_PROGRESS" && bug.status !== "ASSIGNED") {
          hops.push([hops.length ? "READY_FOR_ASSIGNMENT" : bug.status, "ASSIGNED"]);
          current = "ASSIGNED";
        }
        assign = { userId: ctx.assignee.userId, status: current, hops };
        fields.push("assignee");
      }
    }
  }

  if (pull.includes("status")) {
    const target = config.statusIn[remote.status];
    if (!target) no("status", "unmapped_status");
    else if (config.statusOut[current] === remote.status)
      fields.push("status"); // already there (several BugFlow statuses share it)
    else if (target === "RESOLVED") {
      // Jira's Done is not a retest. It may close a bug that is waiting for one only when the Admin allowed it.
      if (current === "RECHECK" && config.inbound.resolveFromRecheck) {
        status = { from: current, target, hops: [["RECHECK", "RESOLVED"]], verify: true };
        fields.push("status");
      } else no("status", "needs_qa_verification");
    } else if (target === "ASSIGNED") no("status", "needs_assignment");
    else {
      const hops = inboundPath({ ...bug, status: current }, target, config);
      if (!hops) no("status", "not_allowed_in_bugflow");
      else {
        status = { from: current, target, hops, verify: false };
        fields.push("status");
      }
    }
  }

  // Sprint membership keeps BugFlow's rule of one open sprint per bug: Jira's move replaces the membership in
  // the sprint Jira knows, and is refused while the bug sits in a BugFlow sprint Jira has never heard of.
  let sprint: InboundChange["sprint"] = null;
  if (pull.includes("sprint")) {
    if (ctx.sprint.elsewhere) no("sprint", "in_another_sprint");
    else if (remote.sprint === null) {
      sprint = { to: null };
      fields.push("sprint");
    } else if (!ctx.sprint.target) no("sprint", "unknown_sprint");
    else if (!ctx.sprint.target.open) no("sprint", "sprint_not_open");
    else {
      sprint = { to: ctx.sprint.target.sprintId };
      fields.push("sprint");
    }
  }

  const any = Object.keys(edit).length > 0 || assign || status || sprint;
  return {
    change:
      any || fields.length
        ? { edit: Object.keys(edit).length ? edit : null, assign, status, sprint, fields }
        : null,
    rejected,
  };
}

export type ImportDraft = {
  title: string;
  description: string;
  steps: string[];
  expected: string;
  actual: string;
  priority: string;
  severity: string;
  environment: string;
  module: string;
  dueOn: string | null;
  estimate: number | null;
  /** Fields where Jira holds more than BugFlow can: imported cut short, and never written back cut. */
  misfits: SyncField[];
};

/** A Jira issue as a new BugFlow bug: what fits is copied, what BugFlow needs and Jira lacks gets a default. */
export function importDraft(
  remote: Remote,
  config: MappingConfig,
  options: DropdownOptions,
): ImportDraft {
  const r = remote.fields;
  const misfits: SyncField[] = [];
  const cut = (field: keyof typeof LIMITS, value: string) => {
    if (value.length <= LIMITS[field]) return value;
    misfits.push(field);
    return value.slice(0, LIMITS[field]);
  };
  const steps = r.steps.slice(0, MAX_STEPS).map((s) => s.slice(0, STEP_LIMIT));
  if (steps.length !== r.steps.length || steps.some((s, i) => s !== r.steps[i]))
    misfits.push("steps");
  const priority = r.priority ? config.priorityIn[r.priority] : undefined;
  const estimate = r.estimate !== null && estimateFits(r.estimate) ? r.estimate : null;
  if (r.estimate !== null && estimate === null) misfits.push("estimate");
  return {
    title: cut("title", r.title),
    // BugFlow requires a description; a Jira issue without one is described by its summary.
    description: cut("description", r.description || r.title),
    steps,
    expected: cut("expected", r.expected),
    actual: cut("actual", r.actual),
    priority: priority && PRIORITIES.includes(priority) ? priority : "P3",
    severity:
      option(options.severities, r.severity) ??
      option(options.severities, "Medium") ??
      options.severities[0] ??
      "Medium",
    environment: cut("environment", r.environment),
    module: cut("module", r.module),
    dueOn: r.dueOn && isCalendarDate(r.dueOn) ? r.dueOn : null,
    estimate,
    misfits,
  };
}
