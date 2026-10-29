import { z } from "zod";
import { CLOSED_STATUSES, type Status } from "./bugflow";

export const WORK_KINDS = ["bug", "story", "task", "epic"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export const KIND_LABEL: Record<WorkKind, string> = {
  bug: "Bug",
  story: "Story",
  task: "Task",
  epic: "Epic",
};

/** Backlog management (creating stories/tasks/epics, ranking, estimates, parents) is Admin or `plan` holders. */
export function mayManageBacklog(actor: { role: string; permissions: readonly string[] }) {
  return actor.role === "admin" || actor.permissions.includes("plan");
}

/** Who may sit under whom: anything but an epic can live in an epic; a task may instead live in a story. */
export function validParent(child: WorkKind, parent: WorkKind): boolean {
  if (child === "epic") return false;
  if (parent === "epic") return true;
  return parent === "story" && child === "task";
}

/** True when making `parentId` the parent of `childId` would create a loop (a → b → a). */
export function wouldCycle(
  items: { id: string; parentId: string | null }[],
  childId: string,
  parentId: string,
): boolean {
  if (childId === parentId) return true;
  const parents = new Map(items.map((i) => [i.id, i.parentId]));
  let cursor: string | null | undefined = parentId;
  for (let hops = 0; cursor && hops < 100; hops++) {
    if (cursor === childId) return true;
    cursor = parents.get(cursor);
  }
  return false;
}

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
/**
 * A rank string strictly between two neighbours (either side may be open), so a reorder writes exactly one row.
 * Lexicographic midpoint in base 36; adjacent ranks grow one character instead of renumbering the list.
 */
export function rankBetween(prev: string | null, next: string | null): string {
  const a = prev ?? "";
  const b = next ?? "";
  let rank = "";
  for (let i = 0; ; i++) {
    const p = i < a.length ? DIGITS.indexOf(a[i]!) : 0;
    const n = i < b.length ? DIGITS.indexOf(b[i]!) : DIGITS.length;
    if (p + 1 < n) return rank + DIGITS[Math.floor((p + n) / 2)];
    rank += DIGITS[p];
  }
}

/** Epic progress over its live children: estimates when every child has one, otherwise plain counts. */
export function epicProgress(children: { status: Status; estimate: number | null }[]): {
  done: number;
  total: number;
} {
  const byEstimate = children.length > 0 && children.every((c) => c.estimate != null);
  const weight = (c: { estimate: number | null }) => (byEstimate ? (c.estimate ?? 0) : 1);
  return {
    done: children
      .filter((c) => CLOSED_STATUSES.includes(c.status))
      .reduce((s, c) => s + weight(c), 0),
    total: children.reduce((s, c) => s + weight(c), 0),
  };
}

export const createWorkItemSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    kind: z.enum(["story", "task", "epic"]),
    title: z.string().trim().min(1, "Name the item.").max(180),
    description: z.string().trim().max(8000).default(""),
    parentId: z.string().regex(/^\d+$/).optional(),
    estimate: z.number().int().min(0).max(1000).nullable().default(null),
  })
  .strict();
export type CreateWorkItem = z.infer<typeof createWorkItemSchema>;

export const updateWorkItemSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    /** Each field optional: the backlog edits one thing at a time (rank, ready, estimate, parent). */
    rank: z
      .string()
      .regex(/^[0-9a-z]{1,64}$/)
      .optional(),
    ready: z.boolean().optional(),
    estimate: z.number().int().min(0).max(1000).nullable().optional(),
    parentId: z.string().regex(/^\d+$/).nullable().optional(),
  })
  .strict();
export type UpdateWorkItem = z.infer<typeof updateWorkItemSchema>;
