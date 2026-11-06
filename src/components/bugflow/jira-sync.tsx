import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, FolderSync, RefreshCw, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRIORITIES, priorityNames } from "@/lib/bug-workflow";
import { STATUSES, type Status } from "@/lib/bugflow";
import { statusLabel, timeAgo } from "@/lib/format";
import type { ConflictResolution, JiraConflictView, JiraOverview } from "@/lib/jira/admin.server";
import { deriveStatusIn, planningFields } from "@/lib/jira/discovery";
import {
  activateJiraMappingFn,
  findJiraAccountsFn,
  getJiraOverviewFn,
  getJiraPeopleFn,
  getJiraProjectShapeFn,
  getJiraResourcesFn,
  linkJiraPersonFn,
  pauseJiraMappingFn,
  previewJiraMappingFn,
  resolveJiraConflictFn,
  retryJiraParkedFn,
  saveJiraMappingFn,
  syncJiraNowFn,
  unlinkJiraPersonFn,
} from "@/lib/jira/jira.functions";
import { conflictChoices, fieldLabel, reasonText } from "@/lib/jira/labels";
import { configProblems } from "@/lib/jira/mapping";
import type { JiraMappingView } from "@/lib/jira/mapping.server";
import type { JiraAccount, JiraPerson } from "@/lib/jira/people.server";
import type { MappingConfig } from "@/lib/jira/schemas";
import { actionError, ConfirmAction, ErrorNotice } from "./action-feedback";

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

export function JiraProjects({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient();
  const readResources = useServerFn(getJiraResourcesFn);
  const readShape = useServerFn(getJiraProjectShapeFn);
  const save = useServerFn(saveJiraMappingFn);
  const preview = useServerFn(previewJiraMappingFn);
  const activate = useServerFn(activateJiraMappingFn);
  const pause = useServerFn(pauseJiraMappingFn);
  const { busy, error, run } = useAction();
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
  const { busy, error, run } = useAction();
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
  const apply = (next: JiraPerson[]) => client.setQueryData(["jira-people"], next);

  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <Users size={18} />
          People
        </h2>
      </div>
      <p className="px-5 pt-4 text-sm text-muted-foreground">
        Link a member to their own Jira account and Jira shows them as assignee and reporter.
        Without a link their name still appears on the issue as text. Linking never creates or
        invites anyone.
      </p>
      {people.isError && (
        <ErrorNotice
          message={actionError(people.error, "The members could not be read.")}
          onRetry={() => void people.refetch()}
          retrying={people.isFetching}
        />
      )}
      {error && <ErrorNotice message={error} />}
      {!people.data && people.isPending && <Loading what="Reading members…" />}
      {people.data?.length === 0 && <Loading what="No members yet. Add members first." />}
      {people.data?.map((p) => (
        <div className="bf-setting-row" key={p.userId}>
          <div className="min-w-0 flex-1">
            <h3>
              {p.name} <span className="font-normal text-muted-foreground">· {p.role}</span>
            </h3>
            <p>
              {p.accountId
                ? `Jira account: ${p.jiraName || "linked"}`
                : "Not linked: shown in Jira by name only."}
            </p>
            {open?.userId === p.userId && (
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
                  {open.found?.map((a) => (
                    <Button
                      key={a.accountId}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() =>
                        void run("link", async () => {
                          apply(
                            await link({
                              data: { userId: p.userId, accountId: a.accountId, name: a.name },
                            }),
                          );
                          setOpen(null);
                        })
                      }
                    >
                      This is {a.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {open?.userId !== p.userId && (
            <div className="flex flex-wrap gap-2">
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
                      apply(await unlink({ data: { userId: p.userId } }));
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
