// Jira replies shaped like Atlassian's published REST v3 description, for a small Scrum project "BFT":
// To Do → In Progress → In Review → Done, one Bug type, the usual create-screen fields.

const status = (id: string, name: string, key: string) => ({ id, name, statusCategory: { key } });
export const STATUSES_REPLY = [
  {
    id: "10004",
    name: "Bug",
    subtask: false,
    statuses: [
      status("10000", "To Do", "new"),
      status("10001", "In Progress", "indeterminate"),
      status("10002", "In Review", "indeterminate"),
      status("10003", "Done", "done"),
    ],
  },
  { id: "10005", name: "Subtask", subtask: true, statuses: [status("10000", "To Do", "new")] },
  { id: "10001", name: "Task", subtask: false, statuses: [status("10000", "To Do", "new")] },
];
export const PRIORITIES_REPLY = [
  { id: "1", name: "Highest" },
  { id: "2", name: "High" },
  { id: "3", name: "Medium" },
  { id: "4", name: "Low" },
  { id: "5", name: "Lowest" },
];
const field = (fieldId: string, name: string, more: Record<string, unknown> = {}) => ({
  fieldId,
  key: fieldId,
  name,
  required: false,
  hasDefaultValue: false,
  ...more,
});
export const CREATE_META_REPLY = {
  startAt: 0,
  maxResults: 100,
  total: 9,
  fields: [
    field("summary", "Summary", { required: true }),
    field("issuetype", "Issue Type", { required: true }),
    field("project", "Project", { required: true }),
    field("reporter", "Reporter", { required: true }),
    field("description", "Description"),
    field("labels", "Labels"),
    field("priority", "Priority", { hasDefaultValue: true, allowedValues: PRIORITIES_REPLY }),
    field("duedate", "Due date"),
    field("assignee", "Assignee"),
  ],
};
export const PROJECT_REPLY = { id: "10000", key: "BFT", name: "BugFlow Trial", style: "next-gen" };
export const PROJECT_PAGE_REPLY = {
  isLast: true,
  startAt: 0,
  maxResults: 50,
  total: 1,
  values: [PROJECT_REPLY],
};
