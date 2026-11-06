import { STATUSES } from "@/lib/bugflow";
import { DEFAULT_OPTIONS, type DropdownOptions } from "@/lib/bug-workflow";
import { JiraApiError } from "@/lib/jira/errors";
import type { ImportDraft, InboundChange } from "@/lib/jira/inbound";
import { type JiraSprint, type LocalBug, type Remote, remoteFields } from "@/lib/jira/mapping";
import type {
  InboundMeta,
  InboxRow,
  JiraPort,
  Link,
  LinkState,
  Mapping,
  OutboxRow,
  SyncResult,
  SyncStore,
} from "@/lib/jira/processor";
import { issueSchema, mappingConfigSchema } from "@/lib/jira/schemas";

// Shared by the Jira sync tests: a mapping shaped like a small Jira board, a fake Jira that keeps issues the
// way the REST API returns them (so the real parsing runs), and an in-memory stand-in for the database.

/** Jira statuses of the test board: 1 To Do, 2 In Progress, 3 In Review, 4 Done. */
const TO: Record<string, string> = {
  ASSIGNED: "2",
  IN_PROGRESS: "2",
  REOPENED: "2",
  RECHECK: "3",
  RESOLVED: "4",
  DUPLICATE: "4",
  NOT_A_BUG: "4",
  WONT_FIX: "4",
};
export const CONFIG = mappingConfigSchema.parse({
  statusOut: Object.fromEntries(STATUSES.map((s) => [s, TO[s] ?? "1"])),
  statusIn: { "1": "NEW", "2": "IN_PROGRESS", "3": "RECHECK", "4": "RESOLVED" },
  priorityOut: { P0: "1", P1: "1", P2: "2", P3: "3", P4: "4", P5: "5" },
  priorityIn: { "1": "P1", "2": "P2", "3": "P3", "4": "P4", "5": "P5" },
});

export const MAPPING: Mapping = {
  id: "map-1",
  connectionId: "conn-1",
  cloudId: "11111111-2222-4333-8444-555555555555",
  projectId: "bbbbbbbb-0000-4000-8000-000000000001",
  jiraProjectId: "10000",
  issueTypeId: "10004",
  config: CONFIG,
  live: true,
};

export const bug = (over: Partial<LocalBug> = {}): LocalBug => ({
  id: "41",
  code: "BF-41",
  url: "https://bugs.example.test/admin/bugs?bug=41",
  title: "TRIAL-JIRA-Checkout button does nothing",
  description: "Clicking Pay does nothing.\n\nSeen on staging only.",
  steps: ["Open the cart", "Click Pay"],
  expected: "The payment page opens.",
  actual: "Nothing happens.",
  priority: "P2",
  severity: "High",
  status: "NEW",
  dueOn: "2026-11-20",
  environment: "Staging",
  module: "Checkout",
  reporterId: "aaaaaaaa-0000-4000-8000-0000000000a1",
  assigneeId: null,
  reporterName: "Asha",
  reporterAccountId: null,
  assigneeNames: [],
  assigneeAccountId: null,
  sprintJiraId: null,
  estimate: null,
  ...over,
});

type RawIssue = { id: string; key: string; fields: Record<string, unknown> };

export const FAKE_SPRINT_FIELD = "customfield_10020";
export class FakeJira implements JiraPort {
  issues = new Map<string, RawIssue>();
  calls: string[] = [];
  /** Errors to throw, in order, the next times a method is called. */
  fail: Partial<Record<keyof JiraPort, unknown[]>> = {};
  /** The create request reaches Jira, but its reply is lost. */
  loseCreateReply = false;
  /** Transitions Jira offers, by current status; default: every other status, one transition each. */
  workflow: Record<string, { id: string; to: string }[]> | null = null;
  lastUpdate: Record<string, unknown> | null = null;
  private next = 1;

  constructor(private config = CONFIG) {}

  private enter(method: keyof JiraPort) {
    this.calls.push(method);
    const error = this.fail[method]?.shift();
    if (error) throw error;
  }
  raw(id: string) {
    const issue = this.issues.get(id);
    if (!issue) throw new JiraApiError("not_found", 404);
    return issue;
  }
  count = (method: keyof JiraPort) => this.calls.filter((c) => c === method).length;

  async getIssue(id: string): Promise<Remote> {
    this.enter("getIssue");
    return remoteFields(issueSchema.parse(structuredClone(this.raw(id))), this.config);
  }
  async createIssue(body: { fields: Record<string, unknown> }) {
    this.enter("createIssue");
    const n = this.next++;
    const issue: RawIssue = {
      id: String(20000 + n),
      key: `BFT-${n}`,
      fields: {
        status: { id: "1" },
        updated: "2026-11-06T10:00:00.000+0530",
        ...structuredClone(body.fields),
      },
    };
    this.issues.set(issue.id, issue);
    if (this.loseCreateReply) throw new JiraApiError("transient", 0);
    return { id: issue.id, key: issue.key };
  }
  /** An issue a person wrote in Jira (no BugFlow label, plain description). */
  written(fields: Record<string, unknown> = {}) {
    const n = this.next++;
    const issue: RawIssue = {
      id: String(20000 + n),
      key: `BFT-${n}`,
      fields: {
        summary: "TRIAL-JIRA-Login page is blank",
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Nothing renders after sign-in." }],
            },
          ],
        },
        status: { id: "1" },
        priority: { id: "2" },
        project: { id: MAPPING.jiraProjectId },
        issuetype: { id: MAPPING.issueTypeId },
        labels: [],
        updated: "2026-11-06T10:00:00.000+0530",
        ...fields,
      },
    };
    this.issues.set(issue.id, issue);
    return issue;
  }
  async updateIssue(id: string, body: { fields: Record<string, unknown> }) {
    this.enter("updateIssue");
    this.lastUpdate = body.fields;
    const fields = structuredClone(body.fields);
    // Jira takes a sprint as its number and shows it back as a list of sprint objects.
    const sprint = fields[FAKE_SPRINT_FIELD];
    if (typeof sprint === "number")
      fields[FAKE_SPRINT_FIELD] = [
        { id: sprint, name: `Sprint ${sprint}`, state: "active", boardId: 3 },
      ];
    Object.assign(this.raw(id).fields, fields);
  }
  async transitions(id: string) {
    this.enter("transitions");
    const at = (this.raw(id).fields["status"] as { id: string }).id;
    return (
      this.workflow?.[at] ??
      ["1", "2", "3", "4"].filter((s) => s !== at).map((to) => ({ id: `t${to}`, to }))
    );
  }
  async transition(id: string, transitionId: string) {
    this.enter("transition");
    this.raw(id).fields["status"] = { id: transitionId.replace(/^\D+/, "").slice(0, 1) };
  }
  async findByLabel(projectId: string, label: string) {
    this.enter("findByLabel");
    return [...this.issues.values()]
      .filter(
        (i) =>
          (i.fields["project"] as { id: string }).id === projectId &&
          (i.fields["labels"] as string[] | undefined)?.includes(label),
      )
      .map(({ id, key }) => ({ id, key }));
  }
}

export class MemoryStore implements SyncStore {
  bugs = new Map<string, { bug: LocalBug; trashed: boolean; version: string }>();
  links = new Map<string, Link>();
  saved: SyncResult[] = [];
  created: { bugId: string; issue: { id: string; key: string } }[] = [];
  clock = 1_000_000;

  put(b: LocalBug, trashed = false) {
    this.bugs.set(b.id, { bug: b, trashed, version: `v${this.bugs.size}-${Math.random()}` });
  }
  async loadBug(bugId: string) {
    return this.bugs.get(bugId) ?? null;
  }
  async loadLink(bugId: string) {
    const link = this.links.get(bugId);
    return link ? { ...link } : null;
  }
  async beginCreate(bugId: string) {
    const existing = this.links.get(bugId);
    if (existing) return { link: { ...existing }, fresh: false };
    const link: Link = {
      id: `link-${bugId}`,
      state: "creating",
      jiraIssueId: null,
      createOpId: "0a1b2c3d-0000-4000-8000-000000000000",
      baseLocal: null,
      baseRemote: null,
      overrides: { push: [], pull: [], held: [] },
      touchedAt: this.clock,
      touchedVersion: "t0",
    };
    this.links.set(bugId, link);
    return { link: { ...link }, fresh: true };
  }
  async touchCreate(link: Link) {
    const current = [...this.links.values()].find((l) => l.id === link.id);
    if (!current || current.touchedVersion !== link.touchedVersion) return false;
    current.touchedAt = this.clock;
    current.touchedVersion = `t${this.clock}`;
    return true;
  }
  async finishCreate(link: Link, bugId: string, issue: { id: string; key: string }) {
    Object.assign(this.links.get(bugId)!, { state: "linked", jiraIssueId: issue.id });
    this.created.push({ bugId, issue });
  }
  async saveSync(link: Link, bugId: string, result: SyncResult) {
    Object.assign(this.links.get(bugId)!, {
      state: result.state,
      baseLocal: result.baseLocal,
      baseRemote: result.baseRemote,
      overrides: result.overrides,
    });
    this.saved.push(result);
  }
  async setLinkState(linkId: string, state: LinkState) {
    for (const link of this.links.values()) if (link.id === linkId) link.state = state;
  }

  // ---- Jira → BugFlow ----
  /** BugFlow members with a confirmed Atlassian account, by account id. */
  members = new Map<string, { userId: string; name: string; onProject: boolean }>();
  options: DropdownOptions = DEFAULT_OPTIONS;
  /** Every change written to a bug on Jira's behalf. */
  inbound: { bugId: string; change: InboundChange; meta: InboundMeta }[] = [];
  imported: string[] = [];
  /** The next write finds the bug changed by someone else. */
  staleOnce = false;

  async linkByIssue(_connectionId: string, issueId: string) {
    for (const [bugId, link] of this.links)
      if (link.jiraIssueId === issueId)
        return { bugId, mappingId: MAPPING.id, unlinked: link.state === "disabled" };
    return null;
  }
  /** BugFlow sprints that mirror a Jira sprint, by Jira sprint id. */
  mirrors = new Map<string, { sprintId: string; open: boolean; name: string }>();
  /** The bug sits in an open BugFlow sprint Jira does not have. */
  elsewhere = false;
  async inboundContext(
    _bugId: string | null,
    _mapping: Mapping,
    jira: { assignee: string | null; sprint: string | null },
  ) {
    const member = jira.assignee ? this.members.get(jira.assignee) : undefined;
    const mirror = jira.sprint ? this.mirrors.get(jira.sprint) : undefined;
    return {
      options: this.options,
      assignee: member ? { userId: member.userId, onProject: member.onProject } : null,
      sprint: {
        target: mirror ? { sprintId: mirror.sprintId, open: mirror.open } : null,
        elsewhere: this.elsewhere,
      },
    };
  }
  async noteSprints(_mapping: Mapping, sprints: JiraSprint[]) {
    for (const s of sprints) {
      const mirror = this.mirrors.get(s.id);
      if (mirror) Object.assign(mirror, { open: s.state !== "closed", name: s.name });
      else if (s.state !== "closed")
        this.mirrors.set(s.id, { sprintId: `sprint-${s.id}`, open: true, name: s.name });
    }
  }
  async applyInbound(bugId: string, version: string, change: InboundChange, meta: InboundMeta) {
    const held = this.bugs.get(bugId)!;
    if (this.staleOnce || held.version !== version) {
      this.staleOnce = false;
      return null;
    }
    const b = { ...held.bug, ...(change.edit ?? {}) } as LocalBug;
    if (change.assign) {
      const [accountId, member] = [...this.members].find(
        ([, m]) => m.userId === change.assign!.userId,
      )!;
      Object.assign(b, {
        assigneeId: member.userId,
        assigneeAccountId: accountId,
        assigneeNames: [member.name],
        status: change.assign.status,
      });
    }
    if (change.status) b.status = change.status.target;
    if (change.sprint) {
      const to = change.sprint.to;
      b.sprintJiraId = to
        ? ([...this.mirrors].find(([, m]) => m.sprintId === to)?.[0] ?? null)
        : null;
    }
    this.inbound.push({ bugId, change, meta });
    this.put(b);
    return { version: this.bugs.get(bugId)!.version };
  }
  async importIssue(_mapping: Mapping, remote: Remote, draft: ImportDraft, codePrefix: string) {
    const existing = await this.linkByIssue("", remote.id);
    if (existing) return { bugId: existing.bugId };
    const id = String(900 + this.imported.length);
    const { misfits: _misfits, ...fields } = draft;
    const member = remote.reporter ? this.members.get(remote.reporter.accountId) : undefined;
    this.put({
      ...fields,
      id,
      code: `${codePrefix}-${id}`,
      url: `https://bugs.example.test/admin/bugs?bug=${id}`,
      status: "NEW",
      reporterId: member?.userId ?? "jira-sync",
      assigneeId: null,
      reporterName: member?.name ?? "Jira Sync",
      reporterAccountId: member ? remote.reporter!.accountId : null,
      assigneeNames: [],
      assigneeAccountId: null,
      sprintJiraId: null,
    });
    this.links.set(id, {
      id: `link-${id}`,
      state: "linked",
      jiraIssueId: remote.id,
      createOpId: null,
      baseLocal: null,
      baseRemote: null,
      overrides: { push: [], pull: [], held: [] },
      touchedAt: this.clock,
      touchedVersion: "t0",
    });
    this.imported.push(id);
    return { bugId: id };
  }
}

export const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "row-1",
  mappingId: MAPPING.id,
  bugId: "41",
  attempts: 0,
  ...over,
});

export const event = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: "event-1",
  connectionId: MAPPING.connectionId,
  issueId: "20001",
  projectId: MAPPING.jiraProjectId,
  receivedAt: 1_000_000,
  attempts: 0,
  actor: { accountId: "acc-jira-user", displayName: "Jordan (Jira)" },
  ...over,
});
export const DIRECTORY = {
  mappingById: async () => MAPPING,
  mappingForProject: async (_c: string, jiraProjectId: string) =>
    jiraProjectId === MAPPING.jiraProjectId ? MAPPING : null,
};
