import { z } from "zod";
import { CLOSED_STATUSES, type Status } from "./bugflow";

export const SPRINT_STATES = ["planned", "active", "closed"] as const;
export type SprintState = (typeof SPRINT_STATES)[number];

/** Planning (sprints and due dates) is Admin or anyone granted the `plan` permission. */
export function maySprint(actor: { role: string; permissions: readonly string[] }) {
  return actor.role === "admin" || actor.permissions.includes("plan");
}

/** Allowed sprint moves: plan → start, active → close. No reopening a closed sprint; a closed sprint is read-only. */
export function canChangeSprintState(from: SprintState, to: SprintState): boolean {
  return (from === "planned" && to === "active") || (from === "active" && to === "closed");
}

export type SprintItem = {
  bugId: string;
  code: string;
  title: string;
  status: Status;
  priority: string;
  assignee: string;
  dueOn: string | null;
  addedAt: string;
  removedAt: string | null;
  carriedFromSprintId: string | null;
};

export type Sprint = {
  id: string;
  projectId: string;
  project: string;
  name: string;
  goal: string;
  startsOn: string | null;
  endsOn: string | null;
  state: SprintState;
  startedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

export type SprintSummary = {
  total: number;
  committed: number;
  added: number;
  done: number;
  open: number;
  carried: number;
};

/**
 * Sprint counts from its live items (not removed): committed = present when it started, added = joined after the
 * start (added scope), done = resolved, open = not in a closed status, carried = came in from an earlier sprint.
 * Before a sprint starts everything counts as committed.
 */
export function summarizeSprint(items: SprintItem[], startedAt: string | null): SprintSummary {
  const live = items.filter((i) => !i.removedAt);
  const added = startedAt ? live.filter((i) => i.addedAt > startedAt).length : 0;
  return {
    total: live.length,
    committed: live.length - added,
    added,
    done: live.filter((i) => i.status === "RESOLVED").length,
    open: live.filter((i) => !CLOSED_STATUSES.includes(i.status)).length,
    carried: live.filter((i) => i.carriedFromSprintId).length,
  };
}

/** A bug still needing work when a sprint closes — a candidate to carry into the next sprint. */
export function carryCandidates(items: SprintItem[]): SprintItem[] {
  return items.filter((i) => !i.removedAt && !CLOSED_STATUSES.includes(i.status));
}

export const createSprintSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1, "Name the sprint.").max(120),
    goal: z.string().trim().max(2000).default(""),
    startsOn: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
      .default("")
      .transform((v) => v || null),
    endsOn: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
      .default("")
      .transform((v) => v || null),
  })
  .strict();
export type CreateSprint = z.infer<typeof createSprintSchema>;

export const updateSprintSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(2000).default(""),
    startsOn: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
      .default("")
      .transform((v) => v || null),
    endsOn: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
      .default("")
      .transform((v) => v || null),
  })
  .strict();

export const sprintActionSchema = z
  .object({
    id: z.string().uuid(),
    /** On close only: an optional planned/active sprint to carry still-open bugs into. */
    carryTo: z.string().uuid().optional(),
  })
  .strict();

export const sprintItemSchema = z
  .object({
    sprintId: z.string().uuid(),
    bugId: z.string().regex(/^\d+$/),
  })
  .strict();
