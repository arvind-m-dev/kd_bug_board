import type { JiraSite } from "./oauth";

export type JiraConnectionState =
  "pending_site" | "connected" | "paused" | "reauthorization_required" | "revoked" | "error";

/** What the Admin page may know about the connection. Tokens and ids never leave the server. */
export type JiraConnectionView = {
  state: JiraConnectionState;
  siteName: string | null;
  siteUrl: string | null;
  /** Display name of the Atlassian account that authorized the connection. */
  account: string | null;
  scopes: string[];
  /** When a read from Jira last succeeded; a connection is only described as working from this. */
  lastVerifiedAt: string | null;
  lastError: string | null;
  connectedAt: string;
  /** Only while state is `pending_site`: the sites to choose from. */
  pendingSites: JiraSite[];
};

export type JiraStatus =
  | {
      available: false;
      /** `not_configured`: server settings missing. `database_not_ready`: migration 027 not applied. */
      reason: "not_configured" | "database_not_ready";
      /** Names of missing settings, never their values. */
      missing: string[];
    }
  | {
      available: true;
      /** The public address Jira must be connected from. */
      origin: string;
      callbackUrl: string;
      allowedSite: string | null;
      connection: JiraConnectionView | null;
    };

export const JIRA_STATE_LABEL: Record<JiraConnectionState, string> = {
  pending_site: "Choose a site",
  connected: "Connected",
  paused: "Paused",
  reauthorization_required: "Sign-in needed",
  revoked: "Disconnected",
  error: "Problem",
};

/** The "Jira Sync" user (migration 027): never signs in; sync bookkeeping and inbound changes are attributed to it. */
export const JIRA_SYNC_USER_ID = "00000000-0000-4000-8000-00006a697261";

/**
 * The fields both systems are compared on, each already normalized to one shape (mapping.ts). Status and priority
 * are compared as Jira ids: BugFlow has more statuses and priorities than Jira, so several map to one Jira value
 * and a move between two of those is not a change Jira can show.
 */
export type SyncFields = {
  title: string;
  description: string;
  steps: string[];
  expected: string;
  actual: string;
  /** Jira priority id; null when priority is not mapped. */
  priority: string | null;
  severity: string;
  /** Jira status id. */
  status: string;
  /** Atlassian account id; null when unassigned or the person has no confirmed Jira account. */
  assignee: string | null;
  dueOn: string | null;
  environment: string;
  module: string;
  /** Names and the Bug Board link as plain text lines. Written to Jira, never read back into BugFlow. */
  note: string;
  /** Id of the open Jira sprint the issue is in; null when in none (or sprints are not synchronized). */
  sprint: string | null;
  estimate: number | null;
};
export type SyncField = keyof SyncFields;
export const SYNC_FIELDS: readonly SyncField[] = [
  "title",
  "description",
  "steps",
  "expected",
  "actual",
  "priority",
  "severity",
  "status",
  "assignee",
  "dueOn",
  "environment",
  "module",
  "note",
  "sprint",
  "estimate",
];
