import { statusLabel } from "../format";
import { fieldLabel } from "./labels";

// The sync log: one plain line per thing that moved between Bug Board and Jira, or per setup step, or per error.
// Pure, so the wording is tested once and the server only gathers rows.

export type SyncLogKind = "to_jira" | "from_jira" | "decision" | "setup" | "error";
export type SyncLogFilter = "all" | SyncLogKind;

/** One activity row (or queue error) as the server reads it. */
export type SyncLogRaw = {
  id: string;
  at: string;
  action: string;
  detail: Record<string, unknown>;
  /** "jira-sync" for the integration actor, "admin" for the Admin, otherwise the person's name. */
  actor: string;
  /** The person whose Bug Board change was sent (for to-Jira rows), when known. */
  changedBy?: string | null;
  /** Assignee name for an assignment taken from Jira. */
  assigneeName?: string | null;
  bugId?: string | null;
  bugCode?: string | null;
};

export type SyncLogEntry = {
  id: string;
  at: string;
  kind: SyncLogKind;
  /** Who caused it, as people know them: a member's name, "Bug Board Admin", or "Jira". */
  who: string;
  text: string;
  bugId: string | null;
  bugCode: string | null;
  issueKey: string | null;
};

const ADMIN = "Bug Board Admin";
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const list = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const fieldsText = (v: unknown) => {
  // "note" is the Raised in / Reported by block Bug Board keeps on the Jira issue; not a field people edit.
  const names = list(v)
    .filter((f) => f !== "note")
    .map((f) => fieldLabel(f).toLowerCase());
  return names.length ? names.join(", ") : "who raised it";
};
const person = (actor: string) =>
  actor === "admin" ? ADMIN : actor === "jira-sync" ? "Bug Board" : actor;

const SETUP: Record<string, string> = {
  "jira.connected": "Connected to Jira",
  "jira.reconnected": "Signed in to Jira again",
  "jira.disconnected": "Disconnected from Jira",
  "jira.site_pending": "Signed in; waiting for a Jira site to be chosen",
  "jira.paused": "Paused all syncing",
  "jira.resumed": "Resumed syncing",
  "jira.mapping_saved": "Saved the project settings",
  "jira.mapping_activated": "Turned syncing on for a project",
  "jira.mapping_paused": "Paused syncing for a project",
  "jira.retry": "Put stopped work back in the queue",
};
const DECISION: Record<string, string> = {
  use_bugflow: "use Bug Board's",
  use_jira: "use Jira's",
  ignore: "leave both as they are",
  unlink: "unlink the bug from its Jira issue",
};

function fromJira(raw: SyncLogRaw): string {
  const d = raw.detail;
  switch (raw.action) {
    case "bug.created":
      return "Created in Bug Board from Jira";
    case "bug.edited":
      return `Took ${fieldsText(d["fields"])} from Jira`;
    case "bug.status": {
      const from = str(d["previousStatus"]);
      const to = str(d["status"]);
      return `Status ${from ? `${statusLabel(from)} → ` : "→ "}${to ? statusLabel(to) : "changed"} from Jira`;
    }
    case "bug.assign":
      return raw.assigneeName
        ? `Assigned to ${raw.assigneeName} from Jira`
        : list(d["assignees"]).length || str(d["assignee"])
          ? "Assignment changed from Jira"
          : "Unassigned from Jira";
    case "bug.verify":
      return "Verified from Jira (it was waiting for recheck)";
    case "bug.sprint":
      return "Sprint changed from Jira";
    case "bug.deleted":
      return "Moved to Trash from Jira";
    default:
      return `${raw.action.replace(/^bug\./, "").replace(/_/g, " ")} from Jira`;
  }
}

export function describeSyncLog(raw: SyncLogRaw): SyncLogEntry {
  const d = raw.detail;
  const base = {
    id: raw.id,
    at: raw.at,
    bugId: raw.bugId ?? null,
    bugCode: raw.bugCode ?? null,
    issueKey: str(d["issueKey"]),
  };
  if (raw.action === "queue.error") {
    const parked = d["state"] === "dead";
    const out = d["direction"] === "to_jira";
    return {
      ...base,
      kind: "error",
      who: out ? "Bug Board → Jira" : "Jira → Bug Board",
      text: `${out ? "Could not send to Jira" : "Could not take from Jira"}: ${str(d["error"]) ?? "no reason recorded"}${parked ? " (stopped — use Retry)" : " (will retry by itself)"}`,
    };
  }
  if (raw.action === "member.updated") {
    return {
      ...base,
      kind: "setup",
      who: person(raw.actor),
      text: `Renamed ${str(d["previousName"]) ?? "a member"} to ${str(d["name"]) ?? "their Jira name"} (name from Jira)`,
    };
  }
  if (!raw.action.startsWith("jira.")) {
    // A bug change made by the Jira Sync actor: it came from Jira.
    return {
      ...base,
      kind: "from_jira",
      who: str(d["jiraReporter"]) ?? str(d["jiraActor"]) ?? "Jira",
      text: fromJira(raw),
    };
  }
  switch (raw.action) {
    case "jira.created":
      return {
        ...base,
        kind: "to_jira",
        who: raw.changedBy ? person(raw.changedBy) : "Bug Board",
        text: `Created Jira issue ${base.issueKey ?? ""}`.trim(),
      };
    case "jira.exported":
      return {
        ...base,
        kind: "to_jira",
        who:
          raw.changedBy && fieldsText(d["fields"]) !== "who raised it"
            ? person(raw.changedBy)
            : "Bug Board",
        text: `Sent ${fieldsText(d["fields"])} to Jira`,
      };
    case "jira.conflict_resolved":
      return {
        ...base,
        kind: "decision",
        who: person(raw.actor),
        text: `Decided ${fieldLabel(str(d["field"]) ?? "field").toLowerCase()}: ${DECISION[str(d["resolution"]) ?? ""] ?? "resolved"}`,
      };
    case "jira.person_linked":
      return {
        ...base,
        kind: "setup",
        who: d["by"] === "email" ? "Automatic (same email)" : person(raw.actor),
        text: `Linked ${str(d["jiraName"]) ?? "a member"} to their Jira account`,
      };
    case "jira.person_unlinked":
      return {
        ...base,
        kind: "setup",
        who: person(raw.actor),
        text: `Unlinked ${str(d["jiraName"]) ?? "a member"} from Jira`,
      };
    case "jira.duplicate_linked":
      return {
        ...base,
        kind: "decision",
        who: person(raw.actor),
        text: `Linked to Jira issue ${base.issueKey ?? ""} (the same bug was entered in both)`.replace(
          "  ",
          " ",
        ),
      };
    case "jira.duplicate_ignored":
      return {
        ...base,
        kind: "decision",
        who: person(raw.actor),
        text: "Marked same-title bugs as not duplicates",
      };
    case "jira.initial_sync": {
      const n = Number(d["fromJira"] ?? 0);
      return {
        ...base,
        kind: "setup",
        who: person(raw.actor),
        text: `Started “Sync existing bugs” for ${str(d["jiraProject"]) ?? "a project"}${n ? ` (${n} from Jira)` : ""}`,
      };
    }
    default:
      return {
        ...base,
        kind: "setup",
        who: person(raw.actor),
        text: SETUP[raw.action] ?? raw.action.replace(/^jira\./, "").replace(/_/g, " "),
      };
  }
}

export const LOG_FILTERS: { value: SyncLogFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "to_jira", label: "To Jira" },
  { value: "from_jira", label: "From Jira" },
  { value: "decision", label: "Decisions" },
  { value: "setup", label: "Setup & people" },
  { value: "error", label: "Errors" },
];
