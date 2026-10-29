import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Play, Flag, X, CalendarRange, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  getSprints,
  createSprintFn,
  startSprintFn,
  closeSprintFn,
  addToSprintFn,
  removeFromSprintFn,
  getPortalSprints,
} from "@/lib/sprints.functions";
import type { SprintsData } from "@/lib/sprints.server";
import type { BugAccess } from "@/lib/bug-workflow";
import { ThemedSelect } from "./themed-select";
import { ErrorNotice, actionError } from "./action-feedback";
import { SkeletonRows } from "./loading";
import { toast } from "sonner";

const STATE_LABEL: Record<string, string> = {
  planned: "Planned",
  active: "Active",
  closed: "Closed",
};
const pretty = (s: string) =>
  s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

type Sprint = SprintsData["sprints"][number];

export function SprintsView() {
  const client = useQueryClient();
  const fetch = useServerFn(getSprints);
  const q = useQuery({
    queryKey: ["sprints"],
    queryFn: () => fetch(),
    retry: false,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const [creating, setCreating] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["sprints"] });

  if (q.isLoading) return <SkeletonRows />;
  if (q.isError || !q.data)
    return (
      <ErrorNotice
        message="Sprints could not be loaded."
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );

  const { projects, sprints } = q.data;
  return (
    <section className="grid gap-4">
      <div className="bf-section-heading">
        <div className="flex items-center gap-2">
          <CalendarRange size={18} className="text-primary" />
          <h2>Sprints</h2>
        </div>
        <Button size="sm" disabled={!projects.length} onClick={() => setCreating(true)}>
          <Plus />
          New sprint
        </Button>
      </div>
      {!projects.length && (
        <p className="text-sm text-muted-foreground">
          Add a project first, then plan a sprint for it.
        </p>
      )}
      {sprints.length === 0 && projects.length > 0 && (
        <p className="text-sm text-muted-foreground">
          No sprints yet. Create one to start planning.
        </p>
      )}
      <div className="grid gap-3">
        {sprints.map((s) => (
          <SprintCard key={s.id} sprint={s} openSprints={sprints} onChanged={refresh} />
        ))}
      </div>
      {creating && (
        <CreateSprintDialog
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function SprintCard({
  sprint,
  openSprints,
  onChanged,
}: {
  sprint: Sprint;
  openSprints: Sprint[];
  onChanged: () => Promise<unknown> | void;
}) {
  const start = useServerFn(startSprintFn);
  const close = useServerFn(closeSprintFn);
  const add = useServerFn(addToSprintFn);
  const remove = useServerFn(removeFromSprintFn);
  const [bugId, setBugId] = useState("");
  const [carryTo, setCarryTo] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = sprint.state === "closed";

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
      toast.success(done);
    } catch (e) {
      toast.error(actionError(e, "That action could not be completed."));
    } finally {
      setBusy(false);
    }
  };

  // Other open sprints in the same project are the places still-open bugs can carry into.
  const carryOptions = openSprints.filter(
    (o) => o.id !== sprint.id && o.projectId === sprint.projectId && o.state !== "closed",
  );

  return (
    <div className="bf-panel" data-state={sprint.state}>
      <div className="bf-panel-heading">
        <div className="min-w-0">
          <h2 className="truncate">
            {sprint.name}
            <span className="bf-sprint-state" data-state={sprint.state}>
              {STATE_LABEL[sprint.state]}
            </span>
          </h2>
          <span className="text-xs text-muted-foreground">
            {sprint.project}
            {sprint.startsOn || sprint.endsOn
              ? ` · ${sprint.startsOn ?? "…"} → ${sprint.endsOn ?? "…"}`
              : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sprint.state === "planned" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void run(() => start({ data: { id: sprint.id } }), "Sprint started")}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Play />}
              Start
            </Button>
          )}
          {sprint.state === "active" && (
            <>
              {carryOptions.length > 0 && (
                <ThemedSelect
                  label="Carry unfinished bugs to"
                  value={carryTo}
                  onChange={setCarryTo}
                  options={[
                    { value: "", label: "Carry to… (optional)" },
                    ...carryOptions.map((o) => ({ value: o.id, label: o.name })),
                  ]}
                />
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => close({ data: { id: sprint.id, carryTo: carryTo || undefined } }),
                    "Sprint closed",
                  )
                }
              >
                <Flag />
                Close
              </Button>
            </>
          )}
        </div>
      </div>
      {sprint.goal && <p className="px-4 pb-1 text-sm">{sprint.goal}</p>}
      <div className="bf-sprint-stats">
        <Stat label="Committed" value={sprint.summary.committed} />
        <Stat label="Added" value={sprint.summary.added} />
        <Stat label="Open" value={sprint.summary.open} />
        <Stat label="Done" value={sprint.summary.done} />
        {sprint.summary.carried > 0 && <Stat label="Carried in" value={sprint.summary.carried} />}
      </div>
      <div className="bf-sprint-items">
        {sprint.items.length === 0 ? (
          <p className="px-4 py-2 text-sm text-muted-foreground">No bugs in this sprint.</p>
        ) : (
          <table className="bf-table">
            <tbody>
              {sprint.items.map((it) => (
                <tr key={it.bugId}>
                  <td className="bf-cell-nowrap font-mono text-xs">{it.code}</td>
                  <td>
                    {it.title}
                    {it.carriedFromSprintId && <span className="bf-sprint-carry">carried</span>}
                  </td>
                  <td className="bf-cell-nowrap text-xs">{pretty(it.status)}</td>
                  <td className="bf-cell-nowrap text-xs">{it.priority}</td>
                  <td className="bf-cell-nowrap text-xs text-muted-foreground">{it.assignee}</td>
                  <td className="bf-cell-action">
                    {!closed && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Remove from sprint"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => remove({ data: { sprintId: sprint.id, bugId: it.bugId } }),
                            "Removed from sprint",
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!closed && (
        <form
          className="bf-sprint-add"
          onSubmit={(e) => {
            e.preventDefault();
            const id = bugId.replace(/\D/g, "");
            if (!id) return;
            void run(() => add({ data: { sprintId: sprint.id, bugId: id } }), "Bug added").then(
              () => setBugId(""),
            );
          }}
        >
          <Input
            aria-label="Bug number to add"
            placeholder="Add a bug by number (e.g. 42)"
            value={bugId}
            onChange={(e) => setBugId(e.target.value)}
            inputMode="numeric"
          />
          <Button size="sm" variant="outline" type="submit" disabled={busy || !bugId.trim()}>
            <Plus />
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bf-sprint-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function CreateSprintDialog({
  projects,
  onClose,
  onCreated,
}: {
  projects: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = useServerFn(createSprintFn);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: (data: {
      projectId: string;
      name: string;
      goal: string;
      startsOn: string;
      endsOn: string;
    }) => create({ data }),
    onSuccess: onCreated,
    onError: (e) => setError(actionError(e, "The sprint could not be created.")),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New sprint</DialogTitle>
          <DialogDescription>Group bugs of one project for a fixed period.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            const f = new FormData(e.currentTarget);
            m.mutate({
              projectId,
              name: String(f.get("name") ?? ""),
              goal: String(f.get("goal") ?? ""),
              startsOn: String(f.get("startsOn") ?? ""),
              endsOn: String(f.get("endsOn") ?? ""),
            });
          }}
        >
          <label className="bf-field">
            Project
            <ThemedSelect
              label="Project"
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
          <label className="bf-field">
            Name
            <Input name="name" maxLength={120} placeholder="e.g. Sprint 12" required />
          </label>
          <label className="bf-field">
            Goal<span className="bf-opt">Optional</span>
            <textarea name="goal" maxLength={2000} placeholder="What this sprint aims to clear" />
          </label>
          <div className="bf-form-grid">
            <label className="bf-field">
              Starts<span className="bf-opt">Optional</span>
              <Input type="date" name="startsOn" />
            </label>
            <label className="bf-field">
              Ends<span className="bf-opt">Optional</span>
              <Input type="date" name="endsOn" />
            </label>
          </div>
          {error && <ErrorNotice message={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              <X />
              Cancel
            </Button>
            <Button type="submit" disabled={m.isPending}>
              {m.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Read-only sprint view for member portals: the open sprints of the projects this portal can see. */
export function PortalSprints({ access }: { access: BugAccess }) {
  const fetch = useServerFn(getPortalSprints);
  const q = useQuery({
    queryKey: ["portal-sprints", access],
    queryFn: () => fetch({ data: { access } }),
    retry: false,
    staleTime: 15000,
    refetchInterval: 30000,
  });
  if (q.isLoading) return <SkeletonRows />;
  if (q.isError || !q.data)
    return (
      <ErrorNotice
        message="Sprints could not be loaded."
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  if (!q.data.length)
    return (
      <p className="bf-panel p-5 text-sm text-muted-foreground">
        No open sprint for your projects right now.
      </p>
    );
  return (
    <div className="grid gap-3">
      {q.data.map((s) => (
        <div key={s.id} className="bf-panel">
          <div className="bf-panel-heading">
            <div className="min-w-0">
              <h2 className="truncate">
                {s.name}
                <span className="bf-sprint-state" data-state={s.state}>
                  {STATE_LABEL[s.state]}
                </span>
              </h2>
              <span className="text-xs text-muted-foreground">
                {s.project}
                {s.startsOn || s.endsOn ? ` · ${s.startsOn ?? "…"} → ${s.endsOn ?? "…"}` : ""}
              </span>
            </div>
          </div>
          {s.goal && <p className="px-4 pb-1 text-sm">{s.goal}</p>}
          <div className="bf-sprint-stats">
            <Stat label="Committed" value={s.summary.committed} />
            <Stat label="Added" value={s.summary.added} />
            <Stat label="Open" value={s.summary.open} />
            <Stat label="Done" value={s.summary.done} />
          </div>
          <div className="bf-sprint-items">
            <table className="bf-table">
              <tbody>
                {s.items.map((it) => (
                  <tr key={it.bugId}>
                    <td className="bf-cell-nowrap font-mono text-xs">{it.code}</td>
                    <td>{it.title}</td>
                    <td className="bf-cell-nowrap text-xs">{pretty(it.status)}</td>
                    <td className="bf-cell-nowrap text-xs text-muted-foreground">{it.assignee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
