export const NOTIFICATION_DAYS = 10;
/**
 * File events (attached, removed, restored, renamed, marked up, cleared) are too frequent to notify about: they stay in
 * the activity log and on each bug, but never reach the bell. Bug events (reported, assigned, status, deleted…) do.
 */
export const QUIET_ACTION_PREFIXES = ["bug.media_", "sprint.item_", "backlog.ranked"] as const;
export const isQuietAction = (action: string) =>
  QUIET_ACTION_PREFIXES.some((p) => action.startsWith(p));
export type NotificationItem = {
  id: string;
  action: string;
  bugId: string | null;
  title: string;
  actor: string;
  at: string;
  unread: boolean;
  status: string;
  /** What the entry is about besides a bug, so a click can open and highlight it. */
  portalId: string | null;
  userId: string | null;
  projectId: string | null;
};
const words: Record<string, string> = {
  "bug.created": "New bug reported",
  "bug.sample_created": "Sample bug added",
  "bug.status": "Status changed",
  "bug.priority": "Priority changed",
  "bug.severity": "Severity changed",
  "bug.assign": "Bug assigned",
  "bug.comment": "New comment",
  "bug.verify": "QA verification",
  "bug.edited": "Bug details edited",
  "bug.media_added": "File attached",
  "bug.media_deleted": "File removed",
  "bug.media_renamed": "File renamed",
  "bug.media_cleared": "Files removed from closed bug",
  "settings.media_cleanup": "Media clean-up changed",
  "bug.deleted": "Bug moved to Trash",
  "bug.restored": "Bug restored",
  "bug.purged": "Bug deleted forever",
  "trash.emptied": "Trash emptied",
  "bug.overdue": "Overdue",
  "bug.due_soon": "Due soon",
  "backlog.created": "Backlog item created",
  "backlog.updated": "Backlog item updated",
  "sprint.created": "Sprint created",
  "sprint.updated": "Sprint updated",
  "sprint.started": "Sprint started",
  "sprint.closed": "Sprint closed",
  "settings.dropdowns": "Dropdown options updated",
  "settings.appearance": "Colour theme changed",
  "settings.media_storage": "Media storage changed",
  "settings.media_quota": "Storage limit changed",
  "settings.mcp": "AI access settings changed",
  "settings.sessions": "Other devices signed out",
  "portal.created": "Portal link created",
  "portal.regenerated": "Portal link replaced",
  "portal.revoked": "Portal link revoked",
  "member.updated": "Member profile updated",
  "member.deactivate": "Member deactivated",
  "member.activate": "Member activated",
  "member.delete": "Member moved to Trash",
  "member.restore": "Member restored",
  "member.purge": "Member deleted forever",
  "project.created": "Project created",
  "project.archived": "Project archived",
  "project.restored": "Project restored",
};
/**
 * Where a notification leads (Admin panel). Bugs are handled separately (checked first, then opened and highlighted).
 * Events raised from a member portal land here too, so they open the same Admin pages.
 */
export function notificationHref(n: NotificationItem): string {
  const a = n.action;
  if (a === "member.delete" || a === "member.purge" || a === "trash.emptied" || a === "bug.purged")
    return "/admin/trash";
  if (a.startsWith("member.") || a.startsWith("portal.")) {
    const who = n.portalId ?? n.userId;
    return who ? `/admin/users?member=${encodeURIComponent(who)}` : "/admin/users";
  }
  if (a.startsWith("project."))
    return n.projectId
      ? `/admin/projects?project=${encodeURIComponent(n.projectId)}`
      : "/admin/projects";
  if (a === "settings.appearance") return "/admin/settings/appearance";
  if (a === "settings.dropdowns") return "/admin/settings/options";
  if (a === "settings.mcp") return "/admin/settings/ai";
  if (a.startsWith("settings.media")) return "/admin/settings/storage";
  if (a.startsWith("settings.")) return "/admin/settings";
  if (a.startsWith("sprint.")) return "/admin/sprints";
  if (a.startsWith("backlog.")) return "/admin/backlog";
  return a.startsWith("bug.") ? "/admin/bugs" : "/admin/users";
}
export function notificationLabel(action: string) {
  return (
    words[action] ??
    action
      .replace(/^[a-z]+\./, "")
      .replaceAll("_", " ")
      .replace(/^./, (c) => c.toUpperCase())
  );
}
export function notificationTone(action: string, status = "") {
  if (
    action === "bug.created" ||
    action === "bug.sample_created" ||
    action === "member.delete" ||
    action === "bug.deleted" ||
    action === "portal.revoked" ||
    action === "bug.overdue" ||
    status === "REOPENED"
  )
    return "danger";
  if (
    action === "bug.priority" ||
    action === "member.deactivate" ||
    action === "portal.regenerated" ||
    action === "project.archived"
  )
    return "warning";
  if (
    action === "member.activate" ||
    action === "portal.created" ||
    status === "RESOLVED" ||
    action === "project.created" ||
    action === "project.restored"
  )
    return "success";
  if (action === "member.updated") return "neutral";
  return "info";
}
export function withinWindow(at: string, now = Date.now()) {
  return now - new Date(at).getTime() <= NOTIFICATION_DAYS * 86400000;
}
