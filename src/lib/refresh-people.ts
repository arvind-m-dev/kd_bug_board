import type { QueryClient } from '@tanstack/react-query';

/** Everything that shows a member's status, so a change (activate, deactivate, delete, new link, edit) shows everywhere at once. */
const PEOPLE_QUERIES = ['members', 'member-profile', 'bug-workspace', 'person-overview', 'person-detail', 'team-detail', 'activity-people', 'activity-insights', 'activity', 'team-performance', 'overview-stats'];
export function refreshPeople(client: QueryClient) {
  return Promise.all(PEOPLE_QUERIES.map(k => client.invalidateQueries({ queryKey: [k] })));
}
