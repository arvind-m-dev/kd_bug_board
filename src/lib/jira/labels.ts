// Plain words for what the sync reports, shared by the Admin screens. No Jira or database terms.

const FIELDS: Record<string, string> = {
  title: "Title",
  description: "Description",
  steps: "Steps",
  expected: "Expected result",
  actual: "Actual result",
  priority: "Priority",
  severity: "Severity",
  status: "Status",
  assignee: "Assignee",
  dueOn: "Due date",
  environment: "Environment",
  module: "Module",
  note: "Bug Board details",
  sprint: "Sprint",
  estimate: "Estimate",
  link: "Link",
};
export const fieldLabel = (field: string) => FIELDS[field] ?? field;

const REASONS: Record<string, string> = {
  both_changed: "Changed in both places, to different values.",
  jira_formatting:
    "Jira's text has formatting or images that Bug Board's plain text would replace.",
  no_transition: "Jira's workflow has no step from the issue's status to this one.",
  ambiguous_transition: "Jira offers more than one step to this status.",
  transition_not_applied: "Jira did not end up in the status Bug Board asked for.",
  moved_out_of_project: "The issue was moved to another Jira project or issue type.",
  too_long_for_bugflow: "Jira holds more than Bug Board can store for this field.",
  empty_in_jira: "It was emptied in Jira, and Bug Board needs a value.",
  not_a_bugflow_option: "Jira's value is not in Bug Board's list.",
  unmapped_priority: "Jira's priority has no Bug Board priority in the mapping.",
  invalid_date: "Jira's date is not a valid calendar date.",
  unassign_not_supported:
    "It was unassigned in Jira; Bug Board keeps bugs assigned once work is planned.",
  unmapped_assignee: "Jira's assignee is not linked to a Bug Board member.",
  assignee_not_on_project: "Jira's assignee is a member, but not on this bug's project.",
  unmapped_status: "Jira's status has no meaning in the mapping.",
  needs_qa_verification: "Jira says done; in Bug Board a bug is resolved by a passed retest.",
  needs_assignment: "This status needs someone assigned first.",
  not_allowed_in_bugflow:
    "Bug Board's workflow does not allow this step from the bug's current status.",
  unknown_sprint: "Bug Board does not know this Jira sprint yet.",
  sprint_not_open: "That sprint is closed in Bug Board.",
  in_another_sprint: "The bug is in a Bug Board sprint that Jira does not have.",
  not_a_bugflow_estimate: "Bug Board estimates are whole numbers from 0 to 1000.",
};
export const reasonText = (reason: string) =>
  REASONS[reason] ?? "The two sides could not be brought in step.";

/** What "use Jira's value" can do for a conflict: some can only wait for a change, or be unlinked. */
export function conflictChoices(field: string, reason: string) {
  const comparable = field !== "link";
  return {
    useBugflow: comparable && reason !== "too_long_for_bugflow",
    useJira: comparable,
    ignore: comparable,
  };
}
