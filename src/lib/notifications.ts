export const NOTIFICATION_DAYS = 10;
export type NotificationItem = { id: string; action: string; bugId: string | null; title: string; actor: string; at: string; unread: boolean; status: string };
const words: Record<string, string> = {
  'bug.created': 'New bug reported', 'bug.sample_created': 'Sample bug added', 'bug.status': 'Status changed',
  'bug.priority': 'Priority changed', 'bug.severity': 'Severity changed', 'bug.assign': 'Bug assigned', 'bug.comment': 'New comment', 'bug.verify': 'QA verification', 'bug.edited': 'Bug details edited', 'bug.deleted': 'Bug deleted', 'settings.dropdowns': 'Dropdown options updated', 'settings.appearance': 'Colour theme changed',
  'portal.created': 'Portal link created', 'portal.regenerated': 'Portal link replaced', 'portal.revoked': 'Portal link revoked',
  'member.updated': 'Member profile updated', 'member.deactivate': 'Member deactivated', 'member.activate': 'Member activated', 'member.delete': 'Member deleted',
  'project.created': 'Project created',
};
export function notificationLabel(action: string) {
  return words[action] ?? action.replace(/^[a-z]+\./, '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
}
export function notificationTone(action: string, status = '') {
  if (action === 'bug.created' || action === 'bug.sample_created' || action === 'member.delete' || action === 'bug.deleted' || action === 'portal.revoked' || status === 'REOPENED') return 'danger';
  if (action === 'bug.priority' || action === 'member.deactivate' || action === 'portal.regenerated') return 'warning';
  if (action === 'member.activate' || action === 'portal.created' || status === 'RESOLVED' || action === 'project.created') return 'success';
  if (action === 'member.updated') return 'neutral';
  return 'info';
}
export function withinWindow(at: string, now = Date.now()) {
  return now - new Date(at).getTime() <= NOTIFICATION_DAYS * 86400000;
}
