import { STATUSES, type Status } from "./bugflow";
import { allowedStatuses, mayVerify, type BugActor } from "./bug-workflow";

/**
 * Scrum board columns. Every status lives in exactly one column, so the board is just another view of the existing
 * workflow — moving a card never bypasses transition rules.
 */
export const BOARD_COLUMNS = [
  {
    key: "todo",
    label: "To do",
    statuses: [
      "NEW",
      "VALIDATING",
      "VALIDATED",
      "READY_FOR_ASSIGNMENT",
      "NEEDS_INFORMATION",
      "REOPENED",
    ] as readonly Status[],
  },
  { key: "assigned", label: "Assigned", statuses: ["ASSIGNED"] as readonly Status[] },
  { key: "progress", label: "In progress", statuses: ["IN_PROGRESS"] as readonly Status[] },
  { key: "retest", label: "Retest", statuses: ["RECHECK"] as readonly Status[] },
  {
    key: "done",
    label: "Done",
    statuses: ["RESOLVED", "DUPLICATE", "NOT_A_BUG", "WONT_FIX"] as readonly Status[],
  },
] as const;
export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]["key"];

export function boardColumn(status: Status): BoardColumnKey {
  return (BOARD_COLUMNS.find((c) => c.statuses.includes(status)) ?? BOARD_COLUMNS[0]).key;
}

export type BoardBug = { status: Status; reporterId: string; assigneeId: string | null };

/**
 * What dropping a card onto a column does:
 * - { kind: "status", status }: exactly one plain transition the actor may make — apply it directly.
 * - { kind: "open", reason }: the move needs the bug panel (assigning, verifying a retest, or choosing between
 *   several closing statuses with a note), so the drop opens the bug instead of guessing.
 * - null: this actor cannot move the bug there at all — the column dims while dragging.
 */
export function dropAction(
  actor: BugActor,
  bug: BoardBug,
  column: BoardColumnKey,
): { kind: "status"; status: Status } | { kind: "open"; reason: string } | null {
  if (boardColumn(bug.status) === column) return null; // same column: nothing to do
  const columnStatuses = BOARD_COLUMNS.find((c) => c.key === column)?.statuses ?? [];
  const direct = allowedStatuses(actor, bug).filter((s) => columnStatuses.includes(s));
  if (direct.length === 1) return { kind: "status", status: direct[0]! };
  if (direct.length > 1) return { kind: "open", reason: "Choose the exact status on the bug." };
  // No plain move: the column may still be reachable through an action that needs its own dialog.
  if (
    column === "assigned" &&
    (actor.role === "admin" || actor.permissions.includes("assign")) &&
    ["READY_FOR_ASSIGNMENT", "REOPENED"].includes(bug.status)
  )
    return { kind: "open", reason: "Assign the bug to someone first." };
  if ((column === "done" || column === "todo") && mayVerify(actor, bug))
    return { kind: "open", reason: "Record the retest verdict on the bug." };
  return null;
}

/** True when this actor has at least one board move for the bug — otherwise its card does not drag at all. */
export function mayDragCard(actor: BugActor, bug: BoardBug): boolean {
  return BOARD_COLUMNS.some((c) => dropAction(actor, bug, c.key) !== null);
}

/** Exhaustiveness guard used by tests: every workflow status appears in exactly one column. */
export function unmappedStatuses(): Status[] {
  return STATUSES.filter((s) => BOARD_COLUMNS.filter((c) => c.statuses.includes(s)).length !== 1);
}
