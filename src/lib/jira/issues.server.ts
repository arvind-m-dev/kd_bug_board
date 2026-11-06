import type { z } from "zod";
import { jiraFetch } from "./auth.server";
import { JiraApiError } from "./errors";
import { remoteFields } from "./mapping";
import type { JiraPort, Mapping } from "./processor";
import { createdIssueSchema, issueSchema, searchSchema, transitionsSchema } from "./schemas";

// The Jira REST calls the sync makes for issues, as the connection's authorizing account. Every reply is parsed
// before use; a reply in an unexpected shape is an error, never a guess.

const ISSUE_FIELDS = [
  "summary",
  "description",
  "status",
  "priority",
  "assignee",
  "reporter",
  "duedate",
  "labels",
  "project",
  "issuetype",
  "updated",
];

function parsed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new JiraApiError("unexpected", 200);
  return result.data;
}

export function jiraPort(mapping: Mapping): JiraPort {
  const connection = { id: mapping.connectionId, cloudId: mapping.cloudId };
  const custom = Object.values(mapping.config.fields).flatMap((p) =>
    p.mode === "custom" ? [p.fieldId] : [],
  );
  const extra = [mapping.config.sprintField, mapping.config.estimateField].filter(
    (f) => f !== undefined,
  );
  const fields = [...ISSUE_FIELDS, ...custom, ...extra].join(",");
  const issue = (id: string) => `/rest/api/3/issue/${encodeURIComponent(id)}`;
  return {
    async getIssue(id) {
      const raw = await jiraFetch(connection, `${issue(id)}?fields=${fields}`);
      return remoteFields(parsed(issueSchema, raw), mapping.config);
    },
    async createIssue(body) {
      return parsed(
        createdIssueSchema,
        await jiraFetch(connection, "/rest/api/3/issue", { method: "POST", body }),
      );
    },
    async updateIssue(id, body) {
      await jiraFetch(connection, issue(id), { method: "PUT", body });
    },
    async transitions(id) {
      const raw = await jiraFetch(connection, `${issue(id)}/transitions`);
      return parsed(transitionsSchema, raw).transitions.map((t) => ({ id: t.id, to: t.to.id }));
    },
    async transition(id, transitionId) {
      await jiraFetch(connection, `${issue(id)}/transitions`, {
        method: "POST",
        body: { transition: { id: transitionId } },
      });
    },
    async findByLabel(projectId, label) {
      // Both values go into a query string, so only the shapes BugFlow itself produces are let through.
      if (!/^\d{1,20}$/.test(projectId) || !/^[a-z0-9-]{1,64}$/.test(label))
        throw new JiraApiError("validation", 400);
      const raw = await jiraFetch(connection, "/rest/api/3/search/jql", {
        method: "POST",
        body: {
          jql: `project = ${projectId} AND labels = "${label}"`,
          fields: ["summary"],
          maxResults: 5,
        },
      });
      return parsed(searchSchema, raw).issues.map(({ id, key }) => ({ id, key }));
    },
  };
}
