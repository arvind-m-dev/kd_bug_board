import { z } from "zod";

/**
 * Pure rules for the Trash. Deleted bugs, members and individually removed files stay restorable for TRASH_DAYS; after
 * that, or on "Delete forever", they leave the Trash and their files leave storage. Files removed by the clean-up or
 * "Remove all files" leave storage at once and are listed for the record only.
 */
export const TRASH_DAYS = 30;
export const trashItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bug"), id: z.string().regex(/^[1-9]\d*$/) }).strict(),
  z.object({ kind: z.literal("member"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("file"), id: z.string().uuid() }).strict(),
]);
export type TrashItemRef = z.infer<typeof trashItemSchema>;
export type TrashBug = {
  id: string;
  code: string;
  title: string;
  project: string;
  status: string;
  deletedAt: string;
  deletedBy: string;
  files: number;
};
export type TrashMember = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  deletedAt: string;
  deletedBy: string;
};
export type TrashFile = {
  id: string;
  name: string;
  kind: string;
  size: number;
  bugId: string;
  bugCode: string;
  bugTitle: string;
  deletedAt: string;
  deletedBy: string;
  /** Removed on its own within the last 30 days: still in storage, so it can be restored or deleted forever. */
  restorable: boolean;
};
export type TrashData = {
  days: number;
  bugs: TrashBug[];
  members: TrashMember[];
  files: TrashFile[];
};

/** Whole days left before an item in the Trash is deleted forever (never negative). */
export function daysLeft(deletedAt: string, now = Date.now(), days = TRASH_DAYS) {
  const t = new Date(deletedAt).getTime();
  if (Number.isNaN(t)) return days;
  return Math.max(0, Math.ceil((t + days * 86_400_000 - now) / 86_400_000));
}
export const daysLeftLabel = (n: number) =>
  n <= 0
    ? "Deleted forever today"
    : n === 1
      ? "Deleted forever tomorrow"
      : `Deleted forever in ${n} days`;
