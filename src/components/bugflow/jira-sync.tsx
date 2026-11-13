import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Copy,
  FolderSync,
  RefreshCw,
  ScrollText,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PRIORITIES, priorityNames } from "@/lib/bug-workflow";
import { STATUSES, type Status } from "@/lib/bugflow";
import { statusLabel, timeAgo } from "@/lib/format";
import type { ConflictResolution, JiraConflictView, JiraOverview } from "@/lib/jira/admin.server";
import { deriveStatusIn, planningFields } from "@/lib/jira/discovery";
import {
  activateJiraMappingFn,
  applyJiraNameFn,
  findJiraAccountsFn,
  getJiraDuplicatesFn,
  getJiraOnlyPeopleFn,
  getJiraOverviewFn,
  getJiraPeopleFn,
  getJiraProjectShapeFn,
  getJiraResourcesFn,
  getJiraSyncLogFn,
  ignoreJiraDuplicateFn,
  linkJiraDuplicateFn,
  linkJiraPersonByEmailFn,
  linkJiraPersonFn,
  pauseJiraMappingFn,
  previewJiraInitialSyncFn,
  previewJiraMappingFn,
  resolveJiraConflictFn,
  retryJiraParkedFn,
  saveJiraMappingFn,
  syncJiraMembersFn,
  startJiraInitialSyncFn,
  syncJiraNowFn,
  unlinkJiraPersonFn,
} from "@/lib/jira/jira.functions";
import { duplicateCount } from "@/lib/jira/duplicates";
import { conflictChoices, fieldLabel, reasonText } from "@/lib/jira/labels";
import { LOG_FILTERS, type SyncLogFilter, type SyncLogKind } from "@/lib/jira/log";
import { configProblems } from "@/lib/jira/mapping";
import type {
  InitialSyncCount,
  JiraMappingView,
  ProjectDuplicates,
} from "@/lib/jira/mapping.server";
import { peopleReport, reportIssues } from "@/lib/jira/people";
import type { JiraAccount, JiraOnlyPerson, JiraPerson } from "@/lib/jira/people.server";
import type { MappingConfig } from "@/lib/jira/schemas";
import { actionError, ConfirmAction, ErrorNotice } from "./action-feedback";
import { CollaboratorOnboarding } from "./collaborator-onboarding";
import { RoleTag } from "./role-tag";

// Settings → Jira, below the connection: which project goes with which Jira project, who is who, and how the
// running sync is doing. Everything listed from Jira is read from Jira at that moment; when it cannot be read
// the panel says so and offers a retry. Nothing here shows a success it did not get back from the server.

const SELECT = "h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm";
const MAPPING_TONE: Record<JiraMappingView["state"], string> = {
  active: "text-success",
  paused: "text-warning",
  draft: "",
};
const MAPPING_LABEL: Record<JiraMappingView["state"], string> = {
  active: "On",
  paused: "Paused",
  draft: "Draft",
};

function useAction() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function run(kind: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(actionError(cause, "That did not work. Please try again."));
    } finally {
      setBusy("");
    }
  }
  return { busy, error, run };
}

function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="py-6 text-center text-sm text-muted-foreground">
      {what}
    </p>
  );
}

// ---------------------------------------------------------------- projects

type Draft = {
  projectId: string;
  jiraProjectId: string;
  issueTypeId: string;
  config: MappingConfig | null;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** The confirmation text for a first sync: what goes each way, and what is left out and why. */
function firstSyncText(c: InitialSyncCount) {
  const out = c.toJiraOpen + c.toJiraFinished;
  const parts = [
    `${plural(out, "Bug Board bug")} will be created in Jira (${c.toJiraOpen} open, ${c.toJiraFinished} finished; finished ones are moved to the Jira status they map to).`,
    `${plural(c.fromJira, "Jira issue")} will be created in Bug Board.`,
  ];
  if (c.fromJiraDoneSkipped)
    parts.push(
      `${plural(c.fromJiraDoneSkipped, "Jira issue")} already Done in Jira stay out: Bug Board cannot count Jira's Done as fixed without QA.`,
    );
  if (c.more) parts.push("Jira holds more issues than one run reads; run it again afterwards.");
  parts.push(
    "Each bug is created once on each side, however often this is run. Nothing is deleted.",
  );
  return parts.join(" ");
}

export function JiraProjects({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient();
  const readResources = useServerFn(getJiraResourcesFn);
  const readShape = useServerFn(getJiraProjectShapeFn);
  const save = useServerFn(saveJiraMappingFn);
  const preview = useServerFn(previewJiraMappingFn);
  const activate = useServerFn(activateJiraMappingFn);
  const pause = useServerFn(pauseJiraMappingFn);
  const previewFirst = useServerFn(previewJiraInitialSyncFn);
  const startFirst = useServerFn(startJiraInitialSyncFn);
  const { busy, error, run } = useAction();
  // First sync: the counts shown before confirming, then what was queued.
  const [first, setFirst] = useState<{ projectId: string; count: InitialSyncCount } | null>(null);
  const [queued, setQueued] = useState<{ projectId: string; count: InitialSyncCount } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checked, setChecked] = useState<{
    projectId: string;
    problems: string[];
    bugs: number;
  } | null>(null);

  const resources = useQuery({
    queryKey: ["jira-resources"],
    queryFn: () => readResources(),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const shape = useQuery({
    queryKey: ["jira-shape", draft?.jiraProjectId, draft?.issueTypeId],
    queryFn: () =>
      readShape({
        data: {
          jiraProjectId: draft!.jiraProjectId,
          ...(draft!.issueTypeId ? { issueTypeId: draft!.issueTypeId } : {}),
        },
      }),
    enabled: !!draft?.jiraProjectId,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  // The suggestion fills the form once Jira's statuses are known; a mapping being edited keeps its own rules.
  useEffect(() => {
    if (!shape.data || !draft || draft.config) return;
    setDraft({
      ...draft,
      issueTypeId: shape.data.issueTypeId ?? "",
      config: shape.data.suggestion,
    });
  }, [shape.data, draft]);

  const refresh = () => client.invalidateQueries({ queryKey: ["jira-resources"] });
  const r = resources.data;
  const type = shape.data?.issueTypes.find((t) => t.id === draft?.issueTypeId) ?? null;
  const priorities = shape.data?.fields.find((f) => f.id === "priority")?.options ?? [];
  const planning = planningFields(shape.data?.fields ?? []);
  const config = draft?.config ?? null;
  const problems = config ? configProblems(config) : [];
  const set = (change: Partial<MappingConfig>) =>
    setDraft((d) => (d?.config ? { ...d, config: { ...d.config, ...change } } : d));
  const setStatus = (status: Status, jira: string) => {
    if (!config) return;
    const statusOut = { ...config.statusOut, [status]: jira };
    set({ statusOut, statusIn: deriveStatusIn(statusOut, config.statusIn) });
  };
  const setPriority = (priority: string, jira: string) => {
    if (!config) return;
    const priorityOut = { ...config.priorityOut };
    if (jira) Object.assign(priorityOut, { [priority]: jira });
    else delete (priorityOut as Record<string, string>)[priority];
    set({ priorityOut });
  };

  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <FolderSync size={18} />
          Projects
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={resources.isFetching}
          onClick={() => void resources.refetch()}
        >
          <RefreshCw className={resources.isFetching ? "animate-spin" : undefined} />
          {resources.isFetching ? "Reading Jira…" : "Refresh"}
        </Button>
      </div>
      {resources.isError && (
        <ErrorNotice
          message={actionError(resources.error, "The projects could not be read from Jira.")}
          onRetry={() => void resources.refetch()}
          retrying={resources.isFetching}
        />
      )}
      {error && <ErrorNotice message={error} />}
      {!r && resources.isPending && <Loading what="Reading projects from Jira…" />}

      {r?.mappings.map((m) => (
        <div className="bf-setting-row" key={m.projectId}>
          <div className="min-w-0 flex-1">
            <h3>
              {m.projectName} ↔ Jira {m.jiraProjectKey}
            </h3>
            <p>
              {m.state === "active"
                ? "Bugs reported or changed on either side are kept in step."
                : m.state === "paused"
                  ? "Paused: changes are collected and sent when it is switched on again."
                  : "Saved, not switched on. Nothing is synchronized yet."}
            </p>
            <p className="text-xs text-muted-foreground">
              {m.queue.waiting} waiting · {m.queue.parked} stopped · {m.queue.conflicts} need a
              decision
            </p>
            {checked?.projectId === m.projectId &&
              (checked.problems.length ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-destructive">
                  {checked.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-success">
                  Checked against Jira just now: ready. {checked.bugs} bug
                  {checked.bugs === 1 ? "" : "s"} in this project; each is sent when it is next
                  changed.
                </p>
              ))}
            {queued?.projectId === m.projectId && (
              <p className="mt-2 text-sm text-success">
                Queued: {queued.count.toJiraOpen + queued.count.toJiraFinished} to Jira ·{" "}
                {queued.count.fromJira} from Jira. They go through the regular sync over the next
                minutes; the counts above show what is still waiting.
                {queued.count.more &&
                  " Jira holds more issues than one run reads: run it again later."}
              </p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() =>
                    void run(`check-${m.projectId}`, async () => {
                      const c = await preview({ data: { projectId: m.projectId } });
                      setChecked({ projectId: m.projectId, problems: c.problems, bugs: c.bugs });
                    })
                  }
                >
                  {busy === `check-${m.projectId}` ? "Checking…" : "Check against Jira"}
                </Button>
                {m.state !== "active" && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void run(`on-${m.projectId}`, async () => {
                        const c = await activate({ data: { projectId: m.projectId } });
                        setChecked({ projectId: m.projectId, problems: c.problems, bugs: c.bugs });
                        await refresh();
                      })
                    }
                  >
                    {busy === `on-${m.projectId}` ? "Checking and switching on…" : "Switch on"}
                  </Button>
                )}
                {m.state === "active" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void run(`first-${m.projectId}`, async () => {
                        const count = await previewFirst({ data: { projectId: m.projectId } });
                        setQueued(null);
                        setFirst({ projectId: m.projectId, count });
                      })
                    }
                  >
                    {busy === `first-${m.projectId}` ? "Counting…" : "Sync existing bugs"}
                  </Button>
                )}
                {m.state === "active" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void run(`pause-${m.projectId}`, async () => {
                        await pause({ data: { projectId: m.projectId } });
                        await refresh();
                      })
                    }
                  >
                    {busy === `pause-${m.projectId}` ? "Pausing…" : "Pause"}
                  </Button>
                )}
                {m.state !== "active" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      setDraft({
                        projectId: m.projectId,
                        jiraProjectId: m.jiraProjectId,
                        issueTypeId: m.issueTypeId,
                        config: m.config,
                      })
                    }
                  >
                    Edit rules
                  </Button>
                )}
              </div>
            )}
          </div>
          <span className={`bf-tag ${MAPPING_TONE[m.state]}`}>{MAPPING_LABEL[m.state]}</span>
        </div>
      ))}
      <ConfirmAction
        open={!!first}
        onOpenChange={(open) => !open && setFirst(null)}
        title="Sync the bugs that already exist?"
        description={first ? firstSyncText(first.count) : ""}
        confirmLabel="Sync existing bugs"
        onConfirm={async () => {
          if (!first) return;
          const count = await startFirst({ data: { projectId: first.projectId } });
          setQueued({ projectId: first.projectId, count });
          setFirst(null);
          await refresh();
        }}
      />
      {r && r.mappings.length === 0 && !draft && (
        <div className="bf-setting-row">
          <div className="min-w-0">
            <h3>No project is synchronized yet</h3>
            <p>Choose a Bug Board project and the Jira project it should stay in step with.</p>
          </div>
        </div>
      )}

      {r && canEdit && !draft && (
        <div className="px-5 pb-5 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft({ projectId: "", jiraProjectId: "", issueTypeId: "", config: null })
            }
          >
            Map a project
          </Button>
        </div>
      )}

      {r && draft && (
        <div className="grid gap-4 border-t border-border p-5">
          <div className="bf-form-grid">
            <label className="bf-field">
              Bug Board project
              <select
                className={SELECT}
                value={draft.projectId}
                onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
              >
                <option value="">Choose…</option>
                {r.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="bf-field">
              Jira project
              <select
                className={SELECT}
                value={draft.jiraProjectId}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    jiraProjectId: e.target.value,
                    issueTypeId: "",
                    config: null,
                  })
                }
              >
                <option value="">Choose…</option>
                {r.jiraProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} · {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {r.jiraProjects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              The connected Atlassian account can see no Jira project. Give it access in Jira, then
              refresh.
            </p>
          )}
          {shape.isError && (
            <ErrorNotice
              message={actionError(shape.error, "This Jira project could not be read.")}
              onRetry={() => void shape.refetch()}
              retrying={shape.isFetching}
            />
          )}
          {draft.jiraProjectId && shape.isPending && (
            <Loading what="Reading the project's statuses and fields from Jira…" />
          )}
          {shape.data && !shape.data.issueTypeId && (
            <p className="text-sm text-destructive">
              This Jira project has no issue type named Bug. Add one in Jira, or choose another
              project.
            </p>
          )}
          {shape.data && shape.data.issueTypeId && !config && (
            <p className="text-sm text-destructive">
              No mapping could be suggested: the Bug workflow in Jira needs at least one To Do and
              one Done status.
            </p>
          )}

          {config && type && (
            <>
              <div>
                <h3 className="mb-1 text-sm font-semibold">Statuses</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Where each Bug Board status shows in Jira ({type.name}). Several may share one
                  Jira status.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STATUSES.map((status) => (
                    <label key={status} className="flex items-center justify-between gap-3 text-sm">
                      <span>{statusLabel(status)}</span>
                      <select
                        className={`${SELECT} w-44`}
                        aria-label={`Jira status for ${statusLabel(status)}`}
                        value={config.statusOut[status] ?? ""}
                        onChange={(e) => setStatus(status, e.target.value)}
                      >
                        {type.statuses.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
              {priorities.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Priority</h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Map all six, or leave all empty to keep priority out.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PRIORITIES.map((p) => (
                      <label key={p} className="flex items-center justify-between gap-3 text-sm">
                        <span>
                          {p} · {priorityNames[p] ?? p}
                        </span>
                        <select
                          className={`${SELECT} w-44`}
                          aria-label={`Jira priority for ${p}`}
                          value={config.priorityOut[p] ?? ""}
                          onChange={(e) => setPriority(p, e.target.value)}
                        >
                          <option value="">Not sent</option>
                          {priorities.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-2 text-sm">
                <h3 className="text-sm font-semibold">What else is kept in step</h3>
                <Toggle checked={config.assignee} onChange={(v) => set({ assignee: v })}>
                  Assignee (for members linked to a Jira account below)
                </Toggle>
                <Toggle checked={config.dueOn} onChange={(v) => set({ dueOn: v })}>
                  Due date
                </Toggle>
                <Toggle checked={!!config.nameLabels} onChange={(v) => set({ nameLabels: v })}>
                  Name labels for people without a Jira account (reported-by-…, assigned-to-…), so
                  the Jira board can be filtered by them
                </Toggle>
                <h3 className="pt-2 text-sm font-semibold">Deleting</h3>
                <Toggle checked={!!config.trashCloses} onChange={(v) => set({ trashCloses: v })}>
                  A bug moved to Bug Board's Trash closes its Jira issue (as Won't fix, labelled
                  bugboard-trashed); restoring it reopens the issue. Jira issues are never deleted.
                </Toggle>
                <Toggle
                  checked={!!config.followJiraDeletes}
                  onChange={(v) => set({ followJiraDeletes: v })}
                >
                  A Jira issue deleted in Jira moves its bug to Bug Board's Trash (restorable for 30
                  days)
                </Toggle>
                {planning.sprintField && (
                  <Toggle
                    checked={!!config.sprintField}
                    onChange={(v) => {
                      const { sprintField: _off, ...rest } = config;
                      setDraft({
                        ...draft,
                        config: v
                          ? { ...config, sprintField: planning.sprintField! }
                          : (rest as MappingConfig),
                      });
                    }}
                  >
                    Sprints (Jira owns the sprints; Bug Board mirrors them)
                  </Toggle>
                )}
                {planning.estimateField && (
                  <Toggle
                    checked={!!config.estimateField}
                    onChange={(v) => {
                      const { estimateField: _off, ...rest } = config;
                      setDraft({
                        ...draft,
                        config: v
                          ? { ...config, estimateField: planning.estimateField! }
                          : (rest as MappingConfig),
                      });
                    }}
                  >
                    Estimate (story points)
                  </Toggle>
                )}
                <Toggle
                  checked={config.inbound.priority}
                  onChange={(v) => set({ inbound: { ...config.inbound, priority: v } })}
                >
                  A priority changed in Jira updates Bug Board
                </Toggle>
                <Toggle
                  checked={config.inbound.severity}
                  onChange={(v) => set({ inbound: { ...config.inbound, severity: v } })}
                >
                  A severity changed in Jira updates Bug Board
                </Toggle>
                {config.dueOn && (
                  <Toggle
                    checked={config.inbound.dueOn}
                    onChange={(v) => set({ inbound: { ...config.inbound, dueOn: v } })}
                  >
                    A due date changed in Jira updates Bug Board
                  </Toggle>
                )}
                <Toggle
                  checked={config.inbound.resolveFromRecheck}
                  onChange={(v) => set({ inbound: { ...config.inbound, resolveFromRecheck: v } })}
                >
                  Moving an issue to Done in Jira may resolve a bug that is waiting for retest
                </Toggle>
                <p className="text-xs text-muted-foreground">
                  Off: Jira's Done never resolves a bug; it shows as a decision for QA or Admin
                  instead.
                </p>
              </div>
              {problems.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-destructive">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                !!busy || !config || !draft.projectId || !draft.issueTypeId || problems.length > 0
              }
              onClick={() =>
                void run("save", async () => {
                  await save({
                    data: {
                      projectId: draft.projectId,
                      jiraProjectId: draft.jiraProjectId,
                      issueTypeId: draft.issueTypeId,
                      config: config!,
                    },
                  });
                  setDraft(null);
                  setChecked(null);
                  await refresh();
                })
              }
            >
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Saving does not start anything. Use "Switch on" on the saved mapping; it is checked
            against Jira first.
          </p>
        </div>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

// ---------------------------------------------------------------- people

export function JiraPeople({ canSearch }: { canSearch: boolean }) {
  const client = useQueryClient();
  const read = useServerFn(getJiraPeopleFn);
  const find = useServerFn(findJiraAccountsFn);
  const link = useServerFn(linkJiraPersonFn);
  const unlink = useServerFn(unlinkJiraPersonFn);
  const syncMembers = useServerFn(syncJiraMembersFn);
  const linkNew = useServerFn(linkJiraPersonByEmailFn);
  const readJiraOnly = useServerFn(getJiraOnlyPeopleFn);
  const takeJiraName = useServerFn(applyJiraNameFn);
  const { busy, error, run } = useAction();
  const [synced, setSynced] = useState<{ linked: number; at: number } | null>(null);
  const [adding, setAdding] = useState<JiraOnlyPerson | null>(null);
  const [tab, setTab] = useState<"members" | "jira">("members");
  const [show, setShow] = useState<"all" | "unlinked" | "linked">("all");
  const [role, setRole] = useState("all");
  const [query, setQuery] = useState("");
  const [jiraShow, setJiraShow] = useState<"all" | "in" | "out">("all");
  const [open, setOpen] = useState<{
    userId: string;
    query: string;
    found: JiraAccount[] | null;
  } | null>(null);
  const people = useQuery({
    queryKey: ["jira-people"],
    queryFn: () => read(),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const jiraOnly = useQuery({
    queryKey: ["jira-only-people"],
    queryFn: () => readJiraOnly(),
    enabled: canSearch,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const apply = (next: JiraPerson[]) => client.setQueryData(["jira-people"], next);
  const relink = async (next: JiraPerson[]) => {
    apply(next);
    if (canSearch) await jiraOnly.refetch();
  };
  const syncNow = () =>
    run("sync", async () => {
      const r = await syncMembers();
      apply(r.people);
      client.setQueryData(["jira-only-people"], r.jira);
      setSynced({ linked: r.linked, at: Date.now() });
    });
  const members = people.data ?? [];
  const jira = jiraOnly.data ?? [];
  const report = peopleReport(members, jira);
  const issues = reportIssues(report);
  const q = query.trim().toLowerCase();
  const matches = (name: string, extra = "") => !q || `${name} ${extra}`.toLowerCase().includes(q);
  const roles = [...new Set(members.map((p) => p.role).filter(Boolean))].sort();
  const shown = members.filter(
    (p) =>
      (show === "all" ? true : show === "linked" ? !!p.accountId : !p.accountId) &&
      (role === "all" || p.role === role) &&
      matches(p.name, p.jiraName ?? ""),
  );
  const jiraShown = jira.filter(
    (j) =>
      (jiraShow === "all" ? true : jiraShow === "in" ? !!j.member : !j.member) &&
      matches(j.name, `${j.member ?? ""} ${j.email ?? ""}`),
  );
  const pick = (next: "linked" | "unlinked" | "jira") => {
    setQuery("");
    if (next === "jira") {
      setTab("jira");
      setJiraShow(jiraShow === "out" ? "all" : "out");
    } else {
      setTab("members");
      setShow(show === next ? "all" : next);
    }
  };

  const linkForm = (p: JiraPerson) =>
    open?.userId === p.userId && (
      <div className="mt-3 grid gap-2">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("find", async () => {
              const found = await find({ data: { query: open.query } });
              setOpen({ ...open, found });
            });
          }}
        >
          <input
            className={`${SELECT} w-56`}
            aria-label={`Name in Jira for ${p.name}`}
            value={open.query}
            minLength={2}
            onChange={(e) => setOpen({ ...open, query: e.target.value, found: null })}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={!!busy || open.query.trim().length < 2}
          >
            {busy === "find" ? "Searching Jira…" : "Search Jira"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(null)}>
            Cancel
          </Button>
        </form>
        {open.found?.length === 0 && (
          <p className="text-xs">
            Jira found nobody by that name. Try the name exactly as it shows in Jira.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {open.found?.map((acc) => (
            <Button
              key={acc.accountId}
              type="button"
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void run("link", async () => {
                  await relink(
                    await link({
                      data: { userId: p.userId, accountId: acc.accountId, name: acc.name },
                    }),
                  );
                  setOpen(null);
                })
              }
            >
              This is {acc.name}
            </Button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <Users size={18} />
          People
        </h2>
        <Button
          type="button"
          size="sm"
          disabled={!!busy || !canSearch}
          onClick={() => void syncNow()}
        >
          <RefreshCw className={busy === "sync" ? "animate-spin" : undefined} />
          {busy === "sync" ? "Syncing members…" : "Sync members"}
        </Button>
      </div>
      <p className="px-5 pt-4 text-sm text-muted-foreground">
        Each Bug Board member is linked to their own Jira account, so Jira shows them as assignee
        and reporter and notifies them itself. Members whose email matches a Jira account are linked
        every hour, or now with "Sync members". Nothing is merged or deleted automatically.
      </p>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <button
          type="button"
          className="bf-count-chip"
          data-tone="success"
          aria-pressed={tab === "members" && show === "linked"}
          onClick={() => pick("linked")}
        >
          <strong>{report.linked}</strong> linked
        </button>
        <button
          type="button"
          className="bf-count-chip"
          data-tone="warning"
          aria-pressed={tab === "members" && show === "unlinked"}
          onClick={() => pick("unlinked")}
        >
          <strong>{report.onlyInBugBoard}</strong> only in Bug Board
        </button>
        {canSearch && (
          <button
            type="button"
            className="bf-count-chip"
            data-tone="info"
            aria-pressed={tab === "jira" && jiraShow === "out"}
            onClick={() => pick("jira")}
          >
            <strong>{report.onlyInJira}</strong> only in Jira
          </button>
        )}
        {synced && (
          <span className="text-xs text-muted-foreground">
            Synced {timeAgo(new Date(synced.at).toISOString())}
            {synced.linked
              ? ` · linked ${synced.linked} member${synced.linked === 1 ? "" : "s"} by email`
              : " · nobody new to link by email"}
          </span>
        )}
      </div>

      {issues > 0 && (
        <div className="mx-5 mt-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert size={15} /> Check these ({issues})
          </p>
          <ul className="mt-2 grid gap-1.5">
            {report.likelySame.map((d) => (
              <li key={d.userId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="mr-2 text-success">●</span>
                  <strong>{d.member}</strong> in Bug Board and <strong>{d.jiraName}</strong> in Jira
                  look like the same person but are not linked.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() =>
                    void run(`pair-${d.userId}`, async () => {
                      await relink(
                        await link({
                          data: { userId: d.userId, accountId: d.accountId, name: d.jiraName },
                        }),
                      );
                    })
                  }
                >
                  Link them
                </Button>
              </li>
            ))}
            {report.nameDiffers.map((d) => (
              <li
                key={`n-${d.userId}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  <span className="mr-2 text-info">●</span>
                  <strong>{d.member}</strong> is <strong>{d.jiraName}</strong> in Jira. Jira owns
                  names.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  aria-label={`Use Jira name ${d.jiraName} for ${d.member}`}
                  onClick={() =>
                    void run(`name-${d.userId}`, async () => {
                      await relink((await takeJiraName({ data: { userId: d.userId } })).people);
                    })
                  }
                >
                  {busy === `name-${d.userId}` ? "Renaming…" : "Use Jira name"}
                </Button>
              </li>
            ))}
            {report.sameNameMembers.map((d) => (
              <li key={`m-${d.name}`}>
                <span className="mr-2 text-warning">●</span>
                {d.count} Bug Board members are named <strong>{d.name}</strong>. If they are one
                person, delete the extra one in Team &amp; access.
              </li>
            ))}
            {report.extraLinks.map((d) => (
              <li key={`l-${d.name}`}>
                <span className="mr-2 text-warning">●</span>
                <strong>{d.name}</strong> has {d.links} working portal links. Revoke the extra ones
                in Team &amp; access.
              </li>
            ))}
            {report.sameNameInJira.map((d) => (
              <li key={`j-${d.name}`}>
                <span className="mr-2 text-info">●</span>
                {d.count} Jira people are named <strong>{d.name}</strong>. Check you link the right
                one.
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-5 pt-4" role="tablist">
        <Button
          type="button"
          role="tab"
          aria-selected={tab === "members"}
          variant={tab === "members" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setTab("members")}
        >
          Bug Board members ({members.length})
        </Button>
        {canSearch && (
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "jira"}
            variant={tab === "jira" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab("jira")}
          >
            People in Jira ({jira.length})
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-1 pt-3">
        <input
          className={`${SELECT} min-w-0 flex-1 sm:max-w-xs`}
          type="search"
          aria-label="Search people"
          placeholder={tab === "members" ? "Search members or Jira name…" : "Search Jira people…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {tab === "members" ? (
          <>
            <select
              className={`${SELECT} w-36`}
              aria-label="Filter by role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="all">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r === "qa"
                    ? "QA"
                    : r === "reporter"
                      ? "Tester"
                      : r[0]!.toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
            <select
              className={`${SELECT} w-36`}
              aria-label="Show members"
              value={show}
              onChange={(e) => setShow(e.target.value as typeof show)}
            >
              <option value="all">Linked or not</option>
              <option value="linked">Linked</option>
              <option value="unlinked">Not linked</option>
            </select>
          </>
        ) : (
          <select
            className={`${SELECT} w-44`}
            aria-label="Show Jira people"
            value={jiraShow}
            onChange={(e) => setJiraShow(e.target.value as typeof jiraShow)}
          >
            <option value="all">Everyone in Jira</option>
            <option value="in">In Bug Board</option>
            <option value="out">Not in Bug Board</option>
          </select>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          Showing {tab === "members" ? shown.length : jiraShown.length} of{" "}
          {tab === "members" ? members.length : jira.length}
        </span>
      </div>

      {error && <ErrorNotice message={error} />}
      {tab === "members" && (
        <>
          {people.isError && (
            <ErrorNotice
              message={actionError(people.error, "The members could not be read.")}
              onRetry={() => void people.refetch()}
              retrying={people.isFetching}
            />
          )}
          {!people.data && people.isPending && <Loading what="Reading members…" />}
          {people.data?.length === 0 && <Loading what="No members yet. Add members first." />}
          {people.data && people.data.length > 0 && shown.length === 0 && (
            <Loading what="Nobody here." />
          )}
          {shown.map((p) => (
            <div className="bf-setting-row items-center" key={p.userId}>
              <span className="bf-avatar shrink-0" data-role={p.role}>
                {p.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="bf-people-name">
                  {p.name} <RoleTag role={p.role} />
                </h3>
                <p className="mt-1">
                  {p.accountId ? (
                    <span className="bf-link-pill" data-state="linked">
                      ✓ Jira account: {p.jiraName || "linked"}
                    </span>
                  ) : (
                    <span className="bf-link-pill" data-state="unlinked">
                      Not linked: shown in Jira by name only.
                    </span>
                  )}
                </p>
                {linkForm(p)}
              </div>
              {open?.userId !== p.userId && (
                <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy || !canSearch}
                    onClick={() => setOpen({ userId: p.userId, query: p.name, found: null })}
                  >
                    {p.accountId ? "Change" : "Link to Jira"}
                  </Button>
                  {p.accountId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() =>
                        void run(`unlink-${p.userId}`, async () => {
                          await relink(await unlink({ data: { userId: p.userId } }));
                        })
                      }
                    >
                      Unlink
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {tab === "jira" && canSearch && (
        <>
          <p className="px-5 pt-3 text-xs text-muted-foreground">
            Everyone who can be given work in the synchronized Jira projects. Adding one makes them
            a Bug Board member with the role you pick; nobody is added automatically.
          </p>
          {jiraOnly.isError && (
            <ErrorNotice
              message={actionError(jiraOnly.error, "Jira's people could not be read.")}
              onRetry={() => void jiraOnly.refetch()}
              retrying={jiraOnly.isFetching}
            />
          )}
          {!jiraOnly.data && jiraOnly.isPending && <Loading what="Reading people from Jira…" />}
          {jiraOnly.data?.length === 0 && (
            <Loading what="Jira lists nobody who can be given work in these projects." />
          )}
          {jira.length > 0 && jiraShown.length === 0 && <Loading what="Nobody here." />}
          {jiraShown.map((j) => (
            <div className="bf-setting-row items-center" key={j.accountId}>
              <span className="bf-avatar shrink-0">{j.name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <h3 className="bf-people-name">{j.name}</h3>
                <p className="mt-1">
                  {j.member ? (
                    <span className="bf-link-pill" data-state="linked">
                      In Bug Board as {j.member}
                    </span>
                  ) : (
                    <span className="bf-link-pill" data-state="jira">
                      Not in Bug Board
                    </span>
                  )}
                  {!j.member && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {j.email ?? "Email hidden by Jira; type it when adding."}
                    </span>
                  )}
                </p>
              </div>
              <div className="ml-auto shrink-0">
                {j.member ? (
                  <span className="bf-tag text-success">✓ Added to Bug Board</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => setAdding(j)}
                  >
                    Add to Bug Board
                  </Button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <Dialog open={!!adding} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add {adding?.name} to Bug Board</DialogTitle>
            <DialogDescription>
              Pick their role and projects. Once saved, they are linked to this Jira account. Jira
              keeps most people's email private, so type the one they use.
            </DialogDescription>
          </DialogHeader>
          {adding && (
            <CollaboratorOnboarding
              initial={{ name: adding.name, email: adding.email ?? "" }}
              onSaved={({ email }) => {
                // The form stays open: it now shows the new member's portal link to copy.
                const account = adding;
                void run("link-new", async () => {
                  await relink(
                    await linkNew({
                      data: { email, accountId: account.accountId, name: account.name },
                    }),
                  );
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- health and conflicts

const when = (iso: string | null, never: string) => (iso ? timeAgo(iso) : never);

export function JiraHealth() {
  const client = useQueryClient();
  const read = useServerFn(getJiraOverviewFn);
  const syncNow = useServerFn(syncJiraNowFn);
  const retry = useServerFn(retryJiraParkedFn);
  const resolve = useServerFn(resolveJiraConflictFn);
  const { busy, error, run } = useAction();
  const [unlink, setUnlink] = useState<JiraConflictView | null>(null);
  const [ran, setRan] = useState("");
  const q = useQuery({
    queryKey: ["jira-overview"],
    queryFn: () => read(),
    // The sync runs in the background every minute; the panel follows it instead of showing a stale time.
    refetchInterval: 30_000,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const apply = (next: JiraOverview) => {
    client.setQueryData(["jira-overview"], next);
    void client.invalidateQueries({ queryKey: ["jira-resources"] });
  };
  const decide = (c: JiraConflictView, resolution: ConflictResolution) =>
    run(`${resolution}-${c.id}`, async () => {
      apply(await resolve({ data: { conflictId: c.id, resolution } }));
    });
  const o = q.data;

  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <Activity size={18} />
          Sync
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className={q.isFetching ? "animate-spin" : undefined} />
          {q.isFetching ? "Loading…" : "Refresh"}
        </Button>
      </div>
      {q.isError && (
        <ErrorNotice
          message={actionError(q.error, "The sync status could not be read.")}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      )}
      {error && <ErrorNotice message={error} />}
      {!o && q.isPending && <Loading what="Reading the sync status…" />}
      {o && (
        <>
          <div className="bf-setting-row">
            <div className="min-w-0 flex-1">
              <h3>
                {o.linked} bug{o.linked === 1 ? "" : "s"} linked to Jira issues
              </h3>
              <p>
                Waiting to go to Jira: {o.queue.toJira} · waiting from Jira: {o.queue.fromJira} ·
                stopped: {o.queue.parked} · need a decision: {o.conflicts.length}
              </p>
              <p className="text-xs text-muted-foreground">
                Last change reported by Jira {when(o.lastEventAt, "never")} · last full check{" "}
                {when(o.lastReconciledAt, "never")}
                {" · "}
                {o.notificationsUntil
                  ? "Jira notifies Bug Board of changes"
                  : "Jira does not notify Bug Board here; changes are picked up by the regular check"}
              </p>
              {ran && <p className="text-xs text-success">{ran}</p>}
              <div className="flex flex-wrap gap-2 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() =>
                    void run("sync", async () => {
                      const { overview } = await syncNow();
                      apply(overview);
                      setRan("Checked both sides just now.");
                    })
                  }
                >
                  {busy === "sync" ? "Checking both sides…" : "Sync now"}
                </Button>
                {o.queue.parked > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void run("retry", async () => {
                        apply((await retry()).overview);
                      })
                    }
                  >
                    {busy === "retry" ? "Queuing…" : "Try stopped work again"}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {o.conflicts.map((c) => {
            const can = conflictChoices(c.field, c.reason);
            return (
              <div className="bf-setting-row" key={c.id}>
                <span className="bf-stat-icon bf-tone-warning">
                  <TriangleAlert size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3>
                    <a href={`/admin/bugs?bug=${c.bugId}`}>{c.bugCode}</a> · {fieldLabel(c.field)}
                    {c.issueKey && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · Jira {c.issueKey}
                      </span>
                    )}
                  </h3>
                  <p className="truncate">{c.bugTitle}</p>
                  <p>{reasonText(c.reason)}</p>
                  {c.field !== "link" && (
                    <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">Bug Board</dt>
                        <dd className="whitespace-pre-wrap break-words">{c.local || "—"}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">Jira</dt>
                        <dd className="whitespace-pre-wrap break-words">{c.remote || "—"}</dd>
                      </div>
                    </dl>
                  )}
                  <div className="flex flex-wrap gap-2 pt-3">
                    {can.useBugflow && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void decide(c, "use_bugflow")}
                      >
                        Use Bug Board's
                      </Button>
                    )}
                    {can.useJira && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void decide(c, "use_jira")}
                      >
                        Use Jira's
                      </Button>
                    )}
                    {can.ignore && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void decide(c, "ignore")}
                      >
                        Leave both as they are
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => setUnlink(c)}
                    >
                      Unlink
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          {o.parked.map((p) => (
            <div className="bf-setting-row" key={p.id}>
              <div className="min-w-0 flex-1">
                <h3>
                  {p.direction === "to_jira"
                    ? "Could not send to Jira"
                    : "Could not take from Jira"}{" "}
                  · {p.subject}
                </h3>
                <p>{p.error || "No reason was recorded."}</p>
              </div>
              <span className="bf-tag text-destructive">Stopped</span>
            </div>
          ))}
        </>
      )}
      <ConfirmAction
        open={!!unlink}
        onOpenChange={(open) => !open && setUnlink(null)}
        title="Unlink this bug from its Jira issue?"
        description="They stop being kept in step. Neither is deleted or changed, and they are not linked again automatically."
        confirmLabel="Unlink"
        destructive
        onConfirm={async () => {
          if (unlink)
            apply(await resolve({ data: { conflictId: unlink.id, resolution: "unlink" } }));
          setUnlink(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- sync log

const LOG_ARROW: Record<SyncLogKind, string> = {
  to_jira: "→ Jira",
  from_jira: "← Jira",
  decision: "Decision",
  setup: "Setup",
  error: "Error",
};

export function JiraSyncLog() {
  const read = useServerFn(getJiraSyncLogFn);
  const retry = useServerFn(retryJiraParkedFn);
  const client = useQueryClient();
  const [filter, setFilter] = useState<SyncLogFilter>("all");
  const [search, setSearch] = useState("");
  const [done, setDone] = useState("");
  const { busy, error, run } = useAction();
  const q = useQuery({
    queryKey: ["jira-sync-log", filter],
    queryFn: () => read({ data: { filter } }),
    refetchInterval: 30_000,
    staleTime: 0,
    retry: false,
  });
  const needle = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter(
    (e) =>
      !needle ||
      [e.text, e.who, e.bugCode ?? "", e.issueKey ?? ""].some((s) =>
        s.toLowerCase().includes(needle),
      ),
  );
  const stopped = (q.data ?? []).some((e) => e.kind === "error" && e.text.includes("use Retry"));

  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <ScrollText size={18} />
          Sync log
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className={q.isFetching ? "animate-spin" : undefined} />
          {q.isFetching ? "Loading…" : "Refresh"}
        </Button>
      </div>
      <p className="px-1 pb-2 text-sm text-muted-foreground">
        Everything that moved between Bug Board and Jira, newest first: which way, who caused it,
        and every error.
      </p>
      <div className="flex flex-wrap items-center gap-2 pb-3" role="group" aria-label="Show">
        {LOG_FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
        <input
          className={`${SELECT} ml-auto w-48`}
          aria-label="Search the log"
          placeholder="Search bug, issue, name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {stopped && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              void run("retry", async () => {
                const r = await retry();
                setDone(`${plural(r.retried, "item")} put back in the queue.`);
                client.setQueryData(["jira-overview"], r.overview);
                await q.refetch();
              })
            }
          >
            {busy === "retry" ? "Queuing…" : "Retry stopped work"}
          </Button>
          {done && <span className="text-xs text-success">{done}</span>}
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      {q.isError && (
        <ErrorNotice
          message={actionError(q.error, "The sync log could not be read.")}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      )}
      {!q.data && q.isPending && <Loading what="Reading the sync log…" />}
      {q.data && rows.length === 0 && <Loading what="Nothing to show here yet." />}
      {rows.length > 0 && (
        <ol className="bf-sync-log" aria-label="Sync log">
          {rows.map((e) => (
            <li key={e.id} data-kind={e.kind}>
              <span className="bf-sync-kind">{LOG_ARROW[e.kind]}</span>
              <div className="min-w-0 flex-1">
                <p className="bf-sync-text">
                  {e.bugCode && e.bugId && (
                    <>
                      <a href={`/admin/bugs?bug=${e.bugId}`}>{e.bugCode}</a>
                      {e.issueKey ? ` · ${e.issueKey}` : ""}
                      {" — "}
                    </>
                  )}
                  {!e.bugCode && e.issueKey ? `${e.issueKey} — ` : ""}
                  {e.text}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.who} · <time dateTime={e.at}>{timeAgo(e.at)}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {q.data && (
        <p className="pt-2 text-xs text-muted-foreground">
          Showing {rows.length} of {q.data.length}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- duplicate bugs

type DupPair = ProjectDuplicates["pairs"][number] & { projectId: string };

export function JiraDuplicates({ canSearch }: { canSearch: boolean }) {
  const read = useServerFn(getJiraDuplicatesFn);
  const ignore = useServerFn(ignoreJiraDuplicateFn);
  const linkPair = useServerFn(linkJiraDuplicateFn);
  const client = useQueryClient();
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState<DupPair | null>(null);
  const q = useQuery({
    queryKey: ["jira-duplicates"],
    queryFn: () => read(),
    enabled: canSearch,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const apply = (next: ProjectDuplicates[]) => client.setQueryData(["jira-duplicates"], next);
  const skip = (key: string) =>
    run(`ignore-${key}`, async () => {
      apply(await ignore({ data: { key } }));
    });
  const found = (q.data ?? []).reduce((n, p) => n + duplicateCount(p), 0);

  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <Copy size={18} />
          Same bug twice?
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canSearch || q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className={q.isFetching ? "animate-spin" : undefined} />
          {q.isFetching ? "Checking…" : "Check again"}
        </Button>
      </div>
      <p className="px-1 pb-2 text-sm text-muted-foreground">
        Bugs with the same title in Bug Board and in Jira (ignoring case and punctuation). Nothing
        is merged or deleted here.
      </p>
      {!canSearch && <Loading what="Connect Jira to check for duplicates." />}
      {error && <ErrorNotice message={error} />}
      {q.isError && (
        <ErrorNotice
          message={actionError(q.error, "Jira could not be read to check for duplicates.")}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      )}
      {canSearch && !q.data && q.isPending && <Loading what="Comparing Bug Board and Jira…" />}
      {q.data && found === 0 && (
        <p role="status" className="py-4 text-center text-sm text-success">
          ✓ No bug appears twice.
        </p>
      )}
      {q.data?.map((p) => (
        <div key={p.projectId} className="grid gap-2 pb-2">
          {q.data.length > 1 && duplicateCount(p) > 0 && (
            <h3 className="text-sm font-semibold">
              {p.projectName} ↔ {p.jiraProjectKey}
            </h3>
          )}
          {p.pairs.map((d) => (
            <div className="bf-setting-row" key={d.key}>
              <span className="bf-stat-icon bf-tone-warning">
                <TriangleAlert size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <h3>
                  <a href={`/admin/bugs?bug=${d.bugId}`}>{d.code}</a> and Jira {d.issueKey}
                </h3>
                <p className="truncate">“{d.title}”: same title, not linked.</p>
                <div className="flex flex-wrap gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => setConfirm({ ...d, projectId: p.projectId })}
                  >
                    Link these
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => void skip(d.key)}
                  >
                    Not the same bug
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {p.inBugBoard.map((g) => (
            <div className="bf-setting-row" key={g.key}>
              <div className="min-w-0 flex-1">
                <h3>
                  {g.bugs.length} Bug Board bugs titled “{g.title}”
                </h3>
                <p>
                  {g.bugs.map((x, i) => (
                    <span key={x.bugId}>
                      {i > 0 && ", "}
                      <a href={`/admin/bugs?bug=${x.bugId}`}>{x.code}</a>
                      {x.issueKey && x.issueKey !== "…" ? ` (${x.issueKey})` : ""}
                    </span>
                  ))}
                  . If one is a copy, mark it Duplicate in Bug Board.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => void skip(g.key)}
              >
                Not duplicates
              </Button>
            </div>
          ))}
          {p.inJira.map((g) => (
            <div className="bf-setting-row" key={g.key}>
              <div className="min-w-0 flex-1">
                <h3>
                  {g.issues.length} Jira issues titled “{g.title}”
                </h3>
                <p>
                  {g.issues.map((x) => x.key).join(", ")}. If one is a copy, close it in Jira as a
                  duplicate.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => void skip(g.key)}
              >
                Not duplicates
              </Button>
            </div>
          ))}
          {p.more && (
            <p className="text-xs text-muted-foreground">
              Only the first 1,000 Jira issues were compared.
            </p>
          )}
        </div>
      ))}
      <ConfirmAction
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? `Link ${confirm.code} to Jira ${confirm.issueKey}?` : "Link these?"}
        description="From now on they are kept in step as one bug. Where they differ, Bug Board's details are sent to the Jira issue on the next sync. Nothing is deleted on either side."
        confirmLabel="Link these"
        onConfirm={async () => {
          if (confirm)
            apply(
              await linkPair({
                data: {
                  projectId: confirm.projectId,
                  bugId: confirm.bugId,
                  issueId: confirm.issueId,
                },
              }),
            );
          setConfirm(null);
        }}
      />
    </div>
  );
}
