import { z } from "zod";
import { STATUSES } from "../bugflow";
import { PRIORITIES } from "../bug-workflow";

// Shapes that cross a boundary: the mapping an Admin saves, and what Jira's REST API returns. Everything read
// from Jira is parsed here before any rule looks at it.

/** Jira status, priority, project and issue-type ids are numeric strings. */
const jiraId = z.string().regex(/^\d{1,20}$/);

const customFieldId = z.string().regex(/^customfield_\d{1,12}$/);
/** Where a BugFlow field lives in Jira: a section of the description, a custom field, or nowhere. */
const place = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("section") }),
  z.object({ mode: z.literal("off") }),
  z.object({
    mode: z.literal("custom"),
    fieldId: customFieldId,
    type: z.enum(["text", "option", "paragraph"]),
  }),
]);
export type FieldPlace = z.infer<typeof place>;
const section = { mode: "section" } as const;

export const mappingConfigSchema = z.object({
  /** BugFlow status → Jira status id. All 13 are required (mapping.ts checks). */
  statusOut: z.record(z.enum(STATUSES), jiraId),
  /** Jira status id → the one BugFlow status it means when the change comes from Jira. */
  statusIn: z.record(jiraId, z.enum(STATUSES)),
  /** BugFlow priority → Jira priority id. Empty: priority is not synchronized. */
  priorityOut: z.record(z.enum(PRIORITIES), jiraId).default({}),
  priorityIn: z.record(jiraId, z.enum(PRIORITIES)).default({}),
  fields: z
    .object({
      steps: place.default(section),
      expected: place.default(section),
      actual: place.default(section),
      severity: place.default(section),
      environment: place.default(section),
      module: place.default(section),
    })
    .default({}),
  assignee: z.boolean().default(true),
  dueOn: z.boolean().default(true),
  /** Jira's Sprint field. Set: sprint membership is synchronized (Jira owns the sprints themselves). */
  sprintField: customFieldId.optional(),
  /** Jira's story-points field. Set: the estimate is synchronized. */
  estimateField: customFieldId.optional(),
  /** Fields a Jira edit may change in BugFlow. Off: BugFlow owns the field and Jira only receives it. */
  inbound: z
    .object({
      priority: z.boolean().default(false),
      severity: z.boolean().default(false),
      dueOn: z.boolean().default(false),
      /**
       * A Jira move to the status that means Resolved may resolve a bug that is waiting for retest (and only
       * then), recorded as a verification by the Jira integration. Off: it always waits for BugFlow's QA.
       */
      resolveFromRecheck: z.boolean().default(false),
    })
    .default({}),
});
export type MappingConfig = z.infer<typeof mappingConfigSchema>;

/** One Jira issue as the sync reads it. Unknown fields (custom fields) are kept for the mapped ones. */
export const issueSchema = z.object({
  id: jiraId,
  key: z.string().min(1).max(64),
  fields: z
    .object({
      summary: z.string().nullish(),
      description: z.unknown(),
      status: z.object({ id: jiraId }),
      priority: z.object({ id: jiraId }).nullish(),
      assignee: z.object({ accountId: z.string().min(1) }).nullish(),
      reporter: z
        .object({ accountId: z.string().min(1), displayName: z.string().nullish() })
        .nullish(),
      duedate: z.string().nullish(),
      labels: z.array(z.string()).nullish(),
      project: z.object({ id: jiraId }),
      issuetype: z.object({ id: jiraId }),
      updated: z.string().nullish(),
    })
    .passthrough(),
});
export type JiraIssue = z.infer<typeof issueSchema>;

export const createdIssueSchema = z.object({ id: jiraId, key: z.string().min(1).max(64) });

export const transitionsSchema = z.object({
  transitions: z
    .array(z.object({ id: z.string().min(1), to: z.object({ id: jiraId }) }).passthrough())
    .default([]),
});

export const searchSchema = z.object({
  issues: z
    .array(z.object({ id: jiraId, key: z.string().min(1).max(64) }).passthrough())
    .default([]),
});
