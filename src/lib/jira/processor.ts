import { type SyncPlan, planSync, same } from "./compare";
import {
  JiraApiError,
  JiraAuthError,
  type JiraErrorKind,
  isRetryable,
  safeErrorText,
} from "./errors";
import {
  type InboundChange,
  type InboundContext,
  type InboundReason,
  type ImportDraft,
  importDraft,
  planInbound,
} from "./inbound";
import {
  type JiraSprint,
  type LocalBug,
  MappingError,
  type Remote,
  createBody,
  directions,
  isMarkerLabel,
  localFields,
  markerLabel,
  updateBody,
} from "./mapping";
import type { MappingConfig } from "./schemas";
import type { SyncField, SyncFields } from "./types";

// Keeping one bug and one Jira issue in step, written against small interfaces (the database, Jira) so the
// whole flow runs in tests against fakes. A queue row only says "this bug changed" or "this issue changed":
// the work is always decided from the bug as it is now, the issue as it is now, and the two snapshots of what
// both last agreed on. Whichever side a row came from, the same pass runs: BugFlow-only changes go to Jira,
// Jira-only changes go to BugFlow, equal changes are remembered, different changes to one field wait for a person.

export type OutboxRow = { id: string; mappingId: string; bugId: string; attempts: number };
/** Who made a change in Jira, as far as the event said. Shown to the Admin only. */
export type RemoteActor = { accountId: string; displayName: string };
export type InboxRow = {
  id: string;
  connectionId: string;
  issueId: string;
  /** Jira project of the issue when the event named it. */
  projectId: string | null;
  receivedAt: number;
  attempts: number;
  actor: RemoteActor | null;
};

export type Mapping = {
  id: string;
  connectionId: string;
  cloudId: string;
  /** The BugFlow project. */
  projectId: string;
  jiraProjectId: string;
  issueTypeId: string;
  config: MappingConfig;
  /** False while the mapping or its connection is paused, disconnected or needs sign-in: work waits. */
  live: boolean;
};

export type LinkState =
  | "creating"
  | "linked"
  | "conflict"
  | "remote_missing"
  | "local_trashed"
  /** An Admin unlinked the pair: both records stay, nothing is synchronized, and nothing is re-created. */
  | "disabled";
/**
 * What the comparison cannot know by itself. `push` / `pull`: an Admin's decision on a conflict, waiting to be
 * carried out (send BugFlow's value, or take Jira's). `held`: fields where Jira holds more text than BugFlow
 * can, imported cut short; they stay flagged, and are never written back cut, until either side changes them.
 */
export type Overrides = { push: SyncField[]; pull: SyncField[]; held: SyncField[] };
export const NO_OVERRIDES: Overrides = { push: [], pull: [], held: [] };
export type Link = {
  id: string;
  state: LinkState;
  jiraIssueId: string | null;
  createOpId: string | null;
  baseLocal: SyncFields | null;
  baseRemote: SyncFields | null;
  overrides: Overrides;
  /** When the link row was last written: the earliest a retried create may look for its issue. */
  touchedAt: number;
  /** The row version `touchCreate` compares against. */
  touchedVersion: string;
};

export type ConflictNote = {
  field: string;
  reason:
    | "both_changed"
    | "jira_formatting"
    | "no_transition"
    | "ambiguous_transition"
    | "transition_not_applied"
    | "moved_out_of_project"
    | InboundReason;
  base: unknown;
  local: unknown;
  remote: unknown;
};

export type SyncResult = {
  baseLocal: SyncFields;
  baseRemote: SyncFields;
  state: "linked" | "conflict";
  version: string;
  issueKey: string;
  jiraUpdatedAt: string | null;
  /** Fields this pass wrote to Jira (for the audit entry). */
  exported: SyncField[];
  conflicts: ConflictNote[];
  /** Fields both sides agree on after this pass: an open conflict on one of them is over. */
  settled: SyncField[];
  /** Admin decisions still to carry out. */
  overrides: Overrides;
};

export type InboundMeta = { linkId: string; issueKey: string; actor: RemoteActor | null };

export interface JiraPort {
  getIssue(issueId: string): Promise<Remote>;
  createIssue(body: { fields: Record<string, unknown> }): Promise<{ id: string; key: string }>;
  updateIssue(issueId: string, body: { fields: Record<string, unknown> }): Promise<void>;
  transitions(issueId: string): Promise<{ id: string; to: string }[]>;
  transition(issueId: string, transitionId: string): Promise<void>;
  findByLabel(projectId: string, label: string): Promise<{ id: string; key: string }[]>;
}

export interface SyncStore {
  /** Null when the bug is not a bug any more (purged, or another kind of work item). */
  loadBug(
    bugId: string,
    mapping: Mapping,
  ): Promise<{ bug: LocalBug; trashed: boolean; version: string } | null>;
  loadLink(bugId: string): Promise<Link | null>;
  /** Creates the link in state `creating`, or returns the one that exists. `fresh` only for a new row. */
  beginCreate(bugId: string, mapping: Mapping): Promise<{ link: Link; fresh: boolean }>;
  /** Claims a retried create by rewriting the link row; false when another worker got there first. */
  touchCreate(link: Link): Promise<boolean>;
  finishCreate(link: Link, bugId: string, issue: { id: string; key: string }): Promise<void>;
  saveSync(link: Link, bugId: string, result: SyncResult): Promise<void>;
  setLinkState(linkId: string, state: LinkState): Promise<void>;
  /** The bug an issue is (or was, when `unlinked`) linked to, if any. */
  linkByIssue(
    connectionId: string,
    issueId: string,
  ): Promise<{ bugId: string; mappingId: string; unlinked: boolean } | null>;
  /** What deciding a Jira change needs: the option lists, and the member confirmed for Jira's assignee. */
  inboundContext(
    bugId: string | null,
    mapping: Mapping,
    jira: { assignee: string | null; sprint: string | null },
  ): Promise<InboundContext>;
  /**
   * Jira owns sprints: the ones listed on an issue are mirrored as BugFlow sprints (name, dates, started,
   * closed), within BugFlow's rules: one active sprint per project, and closing never carries bugs over.
   */
  noteSprints(mapping: Mapping, sprints: JiraSprint[]): Promise<void>;
  /**
   * Writes a decided Jira change to the bug as the Jira integration: version-checked, with the same history
   * rows a person's change leaves. Null when the bug changed since `version` was read (nothing was written).
   */
  applyInbound(
    bugId: string,
    version: string,
    change: InboundChange,
    meta: InboundMeta,
  ): Promise<{ version: string } | null>;
  /** Creates the bug for a Jira issue together with its link, once: a repeat returns the same bug. */
  importIssue(
    mapping: Mapping,
    remote: Remote,
    draft: ImportDraft,
    codePrefix: string,
  ): Promise<{ bugId: string }>;
}

/**
 * How long a create that may have reached Jira is left alone before its issue is looked for. Jira's search
 * index trails writes, so an immediate search could miss the issue and a second one would be created.
 */
export const CREATE_SETTLE_MS = 90_000;
export const MAX_ATTEMPTS = 8;
/** How long an event about an issue BugFlow itself created waits for that create to finish linking. */
export const OWN_ISSUE_WAIT_MS = 10 * 60_000;
const MINUTE = 60_000;
export const PAUSED_RECHECK_MS = 5 * MINUTE;

export type Outcome =
  | { kind: "done"; note: string }
  | { kind: "conflict" }
  | { kind: "defer"; ms: number; note: string };
const done = (note: string): Outcome => ({ kind: "done", note });

/** Something a person must fix; trying again unchanged cannot help. */
export class SyncProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncProblem";
  }
}

/** An Admin's "send BugFlow's value" / "take Jira's value" replaces whatever the comparison said for that field. */
function decided(plan: SyncPlan, o: Overrides, local: SyncFields, remote: SyncFields) {
  const differs = (f: SyncField) => !same(local[f], remote[f]);
  const push = o.push.filter(differs);
  const pull = o.pull.filter((f) => differs(f) && !push.includes(f));
  const taken = new Set([...push, ...pull]);
  const rest = (list: SyncField[]) => list.filter((f) => !taken.has(f));
  return {
    plan: {
      push: [...rest(plan.push), ...push],
      pull: [...rest(plan.pull), ...pull],
      ack: rest(plan.ack),
      conflict: rest(plan.conflict),
    },
    forced: new Set(push),
  };
}

/** One comparison of a linked bug and its issue, with everything it allows carried out. */
async function pass(
  bugId: string,
  mapping: Mapping,
  store: SyncStore,
  jira: JiraPort,
  actor: RemoteActor | null,
): Promise<{ outcome: Outcome; again: boolean }> {
  const end = (outcome: Outcome) => ({ outcome, again: false });
  const loaded = await store.loadBug(bugId, mapping);
  if (!loaded) return end(done("not_a_bug"));
  const link = await store.loadLink(bugId);
  const issueId = link?.jiraIssueId;
  if (link?.state === "disabled") return end(done("unlinked"));
  if (!link || !issueId || link.state === "creating") return end(done("not_linked"));
  if (link.state === "remote_missing") return end(done("remote_missing"));
  if (loaded.trashed) {
    // Trash never deletes in Jira, and nothing is taken from Jira for a trashed bug: the link records it.
    if (link.state !== "local_trashed") await store.setLinkState(link.id, "local_trashed");
    return end(done("trashed"));
  }
  const { config } = mapping;
  const local = localFields(loaded.bug, config);

  let remote: Remote;
  try {
    remote = await jira.getIssue(issueId);
  } catch (error) {
    if (!(error instanceof JiraApiError) || error.kind !== "not_found") throw error;
    await store.setLinkState(link.id, "remote_missing");
    return end(done("remote_missing"));
  }
  // No snapshot yet (just created or adopted): Jira's current values are the starting point on both sides, so
  // whatever BugFlow holds differently counts as a BugFlow change and is sent.
  const baseLocal = link.baseLocal ?? remote.fields;
  const baseRemote = link.baseRemote ?? remote.fields;
  let version = loaded.version;
  const save = async (
    r: Omit<SyncResult, "version" | "issueKey" | "jiraUpdatedAt">,
    at: Remote,
  ): Promise<Outcome> => {
    await store.saveSync(link, bugId, {
      ...r,
      version,
      issueKey: at.key,
      jiraUpdatedAt: at.updatedAt,
    });
    return r.conflicts.length ? { kind: "conflict" } : done("synced");
  };
  if (remote.projectId !== mapping.jiraProjectId || remote.issueTypeId !== mapping.issueTypeId)
    return end(
      await save(
        {
          baseLocal,
          baseRemote,
          state: "conflict",
          exported: [],
          settled: [],
          overrides: link.overrides,
          conflicts: [
            {
              field: "link",
              reason: "moved_out_of_project",
              base: null,
              local: null,
              remote: remote.key,
            },
          ],
        },
        remote,
      ),
    );

  if (remote.sprints.length) await store.noteSprints(mapping, remote.sprints);
  const dirs = directions(config);
  const { plan, forced } = decided(
    planSync(baseLocal, baseRemote, local, remote.fields, dirs),
    link.overrides,
    local,
    remote.fields,
  );
  const conflicts: ConflictNote[] = plan.conflict.map((field) => ({
    field,
    reason: "both_changed",
    base: baseLocal[field],
    local: local[field],
    remote: remote.fields[field],
  }));
  const note = (field: SyncField, reason: ConflictNote["reason"], at: Remote) =>
    conflicts.push({
      field,
      reason,
      base: baseLocal[field],
      local: local[field],
      remote: at.fields[field],
    });

  // Jira → BugFlow: what the workflow rules allow is written as the Jira integration; the rest waits for a person.
  let pulled: SyncField[] = [];
  if (plan.pull.length) {
    const ctx = await store.inboundContext(bugId, mapping, {
      assignee: remote.fields.assignee,
      sprint: remote.fields.sprint,
    });
    const { change, rejected } = planInbound(plan.pull, remote.fields, loaded.bug, config, ctx);
    for (const r of rejected) note(r.field, r.reason, remote);
    if (change) {
      const applied =
        change.edit || change.assign || change.status || change.sprint
          ? await store.applyInbound(bugId, version, change, {
              linkId: link.id,
              issueKey: remote.key,
              actor,
            })
          : { version };
      // Someone changed the bug in BugFlow meanwhile: nothing was written; look again with fresh eyes.
      if (!applied) return end({ kind: "defer", ms: 5_000, note: "bug_changed" });
      pulled = change.fields;
    }
  }

  // BugFlow → Jira, fields: one edit carrying only what BugFlow changed. A part of the description that holds
  // Jira formatting or media is not rewritten from plain text unless an Admin decided so.
  const fields = plan.push.filter((f) => f !== "status");
  const send = fields.filter((f) => !remote.lossy[f] || forced.has(f));
  for (const f of fields) if (!send.includes(f)) note(f, "jira_formatting", remote);
  const values = { ...remote.fields };
  for (const f of send) Object.assign(values, { [f]: local[f] });
  const body = updateBody(send, values, remote.description, config);
  if (body) await jira.updateIssue(issueId, body);

  // BugFlow → Jira, status: only through one of the transitions Jira offers for this issue right now.
  let moved = false;
  let stuck: ConflictNote["reason"] | null = null;
  if (plan.push.includes("status")) {
    const options = (await jira.transitions(issueId)).filter((t) => t.to === local.status);
    if (options.length === 1) {
      await jira.transition(issueId, options[0]!.id);
      moved = true;
    } else stuck = options.length ? "ambiguous_transition" : "no_transition";
  }

  // What both now agree on is taken from fresh reads of both sides, not from what was sent.
  const after = body || moved ? await jira.getIssue(issueId) : remote;
  let localNow = local;
  if (pulled.length) {
    const again = await store.loadBug(bugId, mapping);
    if (!again) return end(done("not_a_bug"));
    localNow = localFields(again.bug, config);
    version = again.version;
  }
  const nextLocal = { ...baseLocal };
  const nextRemote = { ...baseRemote };
  const settled: SyncField[] = [];
  const agree = (f: SyncField) => {
    Object.assign(nextLocal, { [f]: localNow[f] });
    Object.assign(nextRemote, { [f]: after.fields[f] });
    settled.push(f);
  };
  [...plan.ack, ...send, ...pulled].forEach(agree);
  const exported: SyncField[] = [...send];
  if (moved) {
    if (after.fields.status === local.status) {
      agree("status");
      exported.push("status");
    } else stuck = "transition_not_applied";
  }
  if (stuck) note("status", stuck, after);
  const held = link.overrides.held.filter((f) => !settled.includes(f));
  for (const f of held)
    if (!conflicts.some((c) => c.field === f))
      conflicts.push({
        field: f,
        reason: "too_long_for_bugflow",
        base: null,
        local: localNow[f],
        remote: after.fields[f],
      });
  const open = (f: SyncField) => !settled.includes(f) && !same(localNow[f], after.fields[f]);
  const outcome = await save(
    {
      baseLocal: nextLocal,
      baseRemote: nextRemote,
      state: conflicts.length ? "conflict" : "linked",
      exported,
      conflicts,
      settled,
      overrides: {
        push: link.overrides.push.filter(open),
        pull: link.overrides.pull.filter(open),
        held,
      },
    },
    after,
  );
  // Taking Jira's change can move something else in BugFlow (assigning sets the status). One more pass sends it.
  const again =
    pulled.length > 0 &&
    planSync(nextLocal, nextRemote, localNow, after.fields, dirs).push.length > 0;
  return { outcome, again };
}

async function syncPair(
  bugId: string,
  mapping: Mapping,
  store: SyncStore,
  jira: JiraPort,
  actor: RemoteActor | null,
): Promise<Outcome> {
  for (let i = 0; i < 3; i++) {
    const { outcome, again } = await pass(bugId, mapping, store, jira, actor);
    if (!again) return outcome;
  }
  return { kind: "defer", ms: MINUTE, note: "still_settling" };
}

/** A BugFlow bug changed: make sure it exists in Jira (once), then bring the pair in step. */
export async function syncBug(
  row: OutboxRow,
  mapping: Mapping,
  store: SyncStore,
  jira: JiraPort,
  now: () => number = Date.now,
): Promise<Outcome> {
  const loaded = await store.loadBug(row.bugId, mapping);
  if (!loaded) return done("not_a_bug");
  const { bug, trashed } = loaded;
  let link = await store.loadLink(row.bugId);
  if (link?.state === "remote_missing") return done("remote_missing");
  if (link?.state === "disabled") return done("unlinked");
  if (trashed) {
    // A bug never sent is not sent now; a linked one is marked by the pass below.
    if (!link || link.state === "creating") return done("trashed");
  } else if (!link || link.state === "creating") {
    let fresh = false;
    if (!link) ({ link, fresh } = await store.beginCreate(row.bugId, mapping));
    if (link.state === "creating") {
      const marker = markerLabel(bug.id, link.createOpId ?? link.id);
      let issue: { id: string; key: string } | undefined;
      if (!fresh) {
        // An earlier attempt may have created the issue without us learning its id. Wait for Jira's search to
        // catch up, take the row, and adopt the issue carrying this attempt's label instead of making a second.
        const wait = CREATE_SETTLE_MS - (now() - link.touchedAt);
        if (wait > 0) return { kind: "defer", ms: wait, note: "create_settling" };
        if (!(await store.touchCreate(link)))
          return { kind: "defer", ms: CREATE_SETTLE_MS, note: "create_busy" };
        const found = await jira.findByLabel(mapping.jiraProjectId, marker);
        if (found.length > 1)
          throw new SyncProblem("More than one Jira issue carries this bug's label.");
        issue = found[0];
      }
      issue ??= await jira.createIssue(
        createBody(
          bug,
          localFields(bug, mapping.config),
          { projectId: mapping.jiraProjectId, issueTypeId: mapping.issueTypeId },
          mapping.config,
          marker,
        ),
      );
      await store.finishCreate(link, row.bugId, issue);
    }
  }
  return syncPair(row.bugId, mapping, store, jira, null);
}

export interface MappingDirectory {
  mappingById(mappingId: string): Promise<Mapping | null>;
  /** The mapping (on or paused) that covers a Jira project on this connection. */
  mappingForProject(connectionId: string, jiraProjectId: string): Promise<Mapping | null>;
}

/** A Jira issue changed: bring its bug in step, or create the bug if this is a new Jira Bug. */
export async function syncIssue(
  row: InboxRow,
  directory: MappingDirectory,
  store: SyncStore,
  jiraFor: (mapping: Mapping) => JiraPort,
  now: () => number = Date.now,
): Promise<Outcome> {
  const waiting: Outcome = { kind: "defer", ms: PAUSED_RECHECK_MS, note: "paused" };
  const known = await store.linkByIssue(row.connectionId, row.issueId);
  if (known?.unlinked) return done("unlinked");
  if (known) {
    const mapping = await directory.mappingById(known.mappingId);
    if (!mapping) return done("mapping_gone");
    if (!mapping.live) return waiting;
    return syncPair(known.bugId, mapping, store, jiraFor(mapping), row.actor);
  }
  if (!row.projectId) return done("no_project");
  const mapping = await directory.mappingForProject(row.connectionId, row.projectId);
  if (!mapping) return done("not_mapped");
  if (!mapping.live) return waiting;
  const jira = jiraFor(mapping);
  let remote: Remote;
  try {
    // The event is only a hint. What is imported is the issue as Jira holds it now.
    remote = await jira.getIssue(row.issueId);
  } catch (error) {
    if (!(error instanceof JiraApiError) || error.kind !== "not_found") throw error;
    return done("gone");
  }
  if (remote.projectId !== mapping.jiraProjectId || remote.issueTypeId !== mapping.issueTypeId)
    return done("not_a_mapped_bug");
  if (remote.labels.some(isMarkerLabel))
    // BugFlow created this issue. Its link is being finished by the worker that created it; if it never
    // appears (an Admin unlinked the pair), the issue is left alone rather than imported as a second bug.
    return now() - row.receivedAt < OWN_ISSUE_WAIT_MS
      ? { kind: "defer", ms: MINUTE, note: "own_issue" }
      : done("own_issue");

  const ctx = await store.inboundContext(null, mapping, { assignee: null, sprint: null });
  const draft = importDraft(remote, mapping.config, ctx.options);
  const { bugId } = await store.importIssue(
    mapping,
    remote,
    draft,
    ctx.options.prefixes[0] ?? "BF",
  );
  const loaded = await store.loadBug(bugId, mapping);
  const link = await store.loadLink(bugId);
  if (loaded && link && !link.baseLocal) {
    // First snapshot. Jira's values are the starting point, so what BugFlow added (its link, defaults) is sent.
    // Status, assignee and sprint start from BugFlow's side instead, so Jira's are taken through BugFlow's
    // rules rather than Jira being moved back to "new", "unassigned" and "no sprint". Text that had to be cut
    // is never sent back cut.
    const local = localFields(loaded.bug, mapping.config);
    const baseRemote = {
      ...remote.fields,
      status: local.status,
      assignee: local.assignee,
      sprint: local.sprint,
    };
    const baseLocal = { ...baseRemote };
    for (const f of draft.misfits) {
      Object.assign(baseLocal, { [f]: local[f] });
      Object.assign(baseRemote, { [f]: remote.fields[f] });
    }
    await store.saveSync(link, bugId, {
      baseLocal,
      baseRemote,
      state: draft.misfits.length ? "conflict" : "linked",
      version: loaded.version,
      issueKey: remote.key,
      jiraUpdatedAt: remote.updatedAt,
      exported: [],
      settled: [],
      overrides: { ...link.overrides, held: draft.misfits },
      conflicts: draft.misfits.map((field) => ({
        field,
        reason: "too_long_for_bugflow",
        base: null,
        local: local[field],
        remote: remote.fields[field],
      })),
    });
  }
  return syncPair(bugId, mapping, store, jira, row.actor);
}

// ---- what to do with a failed row ----

export type Settlement = {
  state: "retry" | "dead";
  delayMs: number;
  /** False when the failure says nothing about this row (rate limit, sign-in): it does not use up an attempt. */
  counts: boolean;
  /** Stop the run: every other row would hit the same wall. */
  stop: boolean;
  error: string;
};

/** Queue delay before attempt n+1: 30 s doubling to an hour, spread ±30 %, never sooner than Retry-After. */
export function queueDelayMs(
  attempts: number,
  retryAfter: number | null = null,
  random = Math.random,
) {
  const base = Math.min(60 * MINUTE, 30_000 * 2 ** Math.max(0, attempts));
  return Math.max(retryAfter ?? 0, Math.round(base * (0.7 + random() * 0.6)));
}

export function settle(error: unknown, attempts: number, random = Math.random): Settlement {
  const text = safeErrorText(error);
  if (error instanceof JiraAuthError) {
    const signIn = error.code === "reauthorization_required" || error.code === "not_connected";
    return {
      state: "retry",
      delayMs: signIn ? 15 * MINUTE : 30_000,
      counts: false,
      stop: true,
      error: text,
    };
  }
  if (error instanceof MappingError || error instanceof SyncProblem)
    return { state: "dead", delayMs: 0, counts: true, stop: false, error: error.message };
  const kind: JiraErrorKind | "internal" = error instanceof JiraApiError ? error.kind : "internal";
  if (kind === "auth")
    return { state: "retry", delayMs: 15 * MINUTE, counts: false, stop: true, error: text };
  if (kind === "rate_limited") {
    const wait = error instanceof JiraApiError ? error.retryAfterMs : null;
    return {
      state: "retry",
      delayMs: queueDelayMs(attempts, wait, random),
      counts: false,
      stop: true,
      error: text,
    };
  }
  if (kind === "internal" || isRetryable(kind)) {
    if (attempts + 1 >= MAX_ATTEMPTS)
      return { state: "dead", delayMs: 0, counts: true, stop: false, error: text };
    return {
      state: "retry",
      delayMs: queueDelayMs(attempts, null, random),
      counts: true,
      stop: false,
      error:
        kind === "internal" ? "BugFlow could not finish this step. It will be tried again." : text,
    };
  }
  // forbidden, validation, not_found, unexpected: the same request would fail the same way.
  return { state: "dead", delayMs: 0, counts: true, stop: false, error: text };
}

// ---- one bounded run over claimed rows ----

type QueueRow = { id: string; attempts: number };
export interface WorkQueue<R extends QueueRow> {
  claim(owner: string, limit: number): Promise<R[]>;
  finish(
    row: R,
    owner: string,
    state: "done" | "conflict" | "dead",
    error: string | null,
  ): Promise<void>;
  /** Back to waiting. `counts` adds one to the row's attempts. */
  later(
    row: R,
    owner: string,
    delayMs: number,
    counts: boolean,
    error: string | null,
  ): Promise<void>;
}
export interface OutboxQueue extends WorkQueue<OutboxRow> {
  mapping(mappingId: string): Promise<Mapping | null>;
}
export type InboxQueue = WorkQueue<InboxRow>;

export type RunSummary = {
  claimed: number;
  done: number;
  conflict: number;
  retry: number;
  dead: number;
  waiting: number;
};
type RunOptions<R> = {
  owner: string;
  limit?: number;
  budgetMs?: number;
  now?: () => number;
  log?: (error: unknown, row: R) => void;
};

/** Works through one claimed batch within a time budget; a row that was not started is handed straight back. */
async function drain<R extends QueueRow>(
  queue: WorkQueue<R>,
  handle: (row: R) => Promise<Outcome>,
  options: RunOptions<R>,
): Promise<RunSummary> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 20_000);
  const rows = await queue.claim(options.owner, options.limit ?? 10);
  const summary: RunSummary = {
    claimed: rows.length,
    done: 0,
    conflict: 0,
    retry: 0,
    dead: 0,
    waiting: 0,
  };
  let stopped = false;
  for (const row of rows) {
    if (stopped || now() >= deadline) {
      await queue.later(row, options.owner, 0, false, null);
      summary.waiting++;
      continue;
    }
    try {
      const outcome = await handle(row);
      if (outcome.kind === "defer") {
        await queue.later(row, options.owner, outcome.ms, false, null);
        summary.waiting++;
      } else {
        await queue.finish(row, options.owner, outcome.kind, null);
        summary[outcome.kind]++;
      }
    } catch (error) {
      options.log?.(error, row);
      const s = settle(error, row.attempts);
      if (s.state === "dead") await queue.finish(row, options.owner, "dead", s.error);
      else await queue.later(row, options.owner, s.delayMs, s.counts, s.error);
      summary[s.state]++;
      stopped ||= s.stop;
    }
  }
  return summary;
}

/** The mapping this bug's row belongs to went away with its connection: nothing can be sent for it. */
class MappingGone extends SyncProblem {
  constructor() {
    super("The Jira mapping for this bug no longer exists.");
  }
}

export function runOutbox(
  deps: {
    queue: OutboxQueue;
    store: SyncStore;
    jira: (mapping: Mapping) => JiraPort;
  } & RunOptions<OutboxRow>,
): Promise<RunSummary> {
  const now = deps.now ?? Date.now;
  const mappings = new Map<string, Mapping | null>();
  return drain(
    deps.queue,
    async (row) => {
      if (!mappings.has(row.mappingId))
        mappings.set(row.mappingId, await deps.queue.mapping(row.mappingId));
      const mapping = mappings.get(row.mappingId);
      if (!mapping) throw new MappingGone();
      if (!mapping.live) return { kind: "defer", ms: PAUSED_RECHECK_MS, note: "paused" };
      return syncBug(row, mapping, deps.store, deps.jira(mapping), now);
    },
    deps,
  );
}

export function runInbox(
  deps: {
    queue: InboxQueue;
    directory: MappingDirectory;
    store: SyncStore;
    jira: (mapping: Mapping) => JiraPort;
  } & RunOptions<InboxRow>,
): Promise<RunSummary> {
  const now = deps.now ?? Date.now;
  return drain(
    deps.queue,
    (row) => syncIssue(row, deps.directory, deps.store, deps.jira, now),
    deps,
  );
}
