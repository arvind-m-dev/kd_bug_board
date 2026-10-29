import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X, LoaderCircle, Layers, GripVertical, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getBacklog, createWorkItemFn, updateWorkItemFn } from "@/lib/backlog.functions";
import { addToSprintFn } from "@/lib/sprints.functions";
import type { BacklogData, BacklogItem } from "@/lib/backlog.server";
import {
  rankBetween,
  epicProgress,
  KIND_LABEL,
  type WorkKind,
  type CreateWorkItem,
  type UpdateWorkItem,
} from "@/lib/backlog";
import { statusLabel } from "@/lib/format";
import { ThemedSelect } from "./themed-select";
import { ErrorNotice, actionError } from "./action-feedback";
import { SkeletonRows } from "./loading";
import { useUrlParam } from "@/hooks/use-url-param";
import { toast } from "sonner";

/**
 * One prioritized backlog per project: epics, stories, tasks and bugs, ranked by drag (each reorder writes a single
 * rank string). Epics carry a progress bar over their children and are never sprint items.
 */
export function BacklogView() {
  const client = useQueryClient();
  const fetch = useServerFn(getBacklog);
  const update = useServerFn(updateWorkItemFn);
  const toSprint = useServerFn(addToSprintFn);
  const q = useQuery({
    queryKey: ["backlog"],
    queryFn: () => fetch(),
    retry: false,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const [projectParam, setProjectParam] = useUrlParam("project");
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["backlog"] });

  if (q.isLoading) return <SkeletonRows />;
  if (q.isError || !q.data)
    return (
      <ErrorNotice
        message="The backlog could not be loaded."
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  const d = q.data;
  const projectId =
    projectParam && d.projects.some((p) => p.id === projectParam)
      ? projectParam
      : (d.projects[0]?.id ?? "");
  const items = d.items
    .filter((i) => i.projectId === projectId)
    .sort((a, b) => (a.rank ?? "~").localeCompare(b.rank ?? "~") || Number(a.id) - Number(b.id));
  const epics = items.filter((i) => i.kind === "epic");
  const sprints = d.openSprints.filter((s) => s.projectId === projectId);

  async function save(item: BacklogItem, patch: Omit<UpdateWorkItem, "id">, done?: string) {
    setBusy(true);
    try {
      await update({ data: { id: item.id, ...patch } });
      await refresh();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(actionError(e, "The change could not be saved."));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Drop `draggedId` so it lands just above `target` (or at the end when target is null). */
  async function reorder(draggedId: string, target: BacklogItem | null) {
    const list = items.filter((i) => i.id !== draggedId);
    const item = items.find((i) => i.id === draggedId);
    if (!item) return;
    const at = target ? list.findIndex((i) => i.id === target.id) : list.length;
    if (at < 0) return;
    const prev = at > 0 ? list[at - 1]!.rank : null;
    const next = at < list.length ? list[at]!.rank : null;
    // Unranked neighbours (legacy bugs) sort last; ranking against them uses open bounds instead.
    await save(item, { rank: rankBetween(prev ?? null, next ?? null) });
  }

  return (
    <section className="grid gap-4">
      <div className="bf-section-heading">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-primary" />
          <h2>Backlog</h2>
          <span className="text-xs text-muted-foreground">
            Drag to rank. Epics group work; stories and tasks plan it; bugs fix it.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemedSelect
            label="Project"
            value={projectId}
            onChange={(v) => setProjectParam(v === d.projects[0]?.id ? null : v)}
            options={d.projects.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Button size="sm" disabled={!projectId} onClick={() => setCreating(true)}>
            <Plus />
            New item
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="bf-panel p-5 text-sm text-muted-foreground">
          Nothing open in this project’s backlog.
        </p>
      ) : (
        <div className="bf-backlog" data-busy={busy || undefined}>
          {items.map((it) => {
            const children = it.kind === "epic" ? d.items.filter((c) => c.parentId === it.id) : [];
            const progress = it.kind === "epic" ? epicProgress(children) : null;
            const parent = it.parentId ? d.items.find((p) => p.id === it.parentId) : undefined;
            return (
              <article
                key={it.id}
                className="bf-backlog-row"
                draggable={!busy}
                data-dragging={dragging === it.id || undefined}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", it.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(it.id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  if (dragging && dragging !== it.id) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  setDragging(null);
                  if (id && id !== it.id) void reorder(id, it);
                }}
              >
                <GripVertical size={14} className="bf-backlog-grip" aria-hidden="true" />
                <span className="bf-backlog-kind" data-kind={it.kind}>
                  {KIND_LABEL[it.kind]}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{it.code}</span>
                <span className="bf-backlog-title">
                  {it.title}
                  {parent && <span className="bf-backlog-parent">in {parent.title}</span>}
                  {progress && (
                    <span
                      className="bf-backlog-progress"
                      title={`${progress.done} of ${progress.total} done`}
                    >
                      <span
                        style={{
                          width: progress.total
                            ? `${(100 * progress.done) / progress.total}%`
                            : "0%",
                        }}
                      />
                    </span>
                  )}
                </span>
                <span className="bf-board-chip">{statusLabel(it.status)}</span>
                {it.kind !== "epic" && (
                  <>
                    <Input
                      className="bf-backlog-estimate"
                      aria-label={`Estimate for ${it.code}`}
                      type="number"
                      min={0}
                      max={1000}
                      placeholder="pts"
                      defaultValue={it.estimate ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        if (v !== it.estimate) void save(it, { estimate: v });
                      }}
                    />
                    <label className="bf-backlog-ready" title="Groomed and ready for a sprint">
                      <input
                        type="checkbox"
                        checked={it.ready}
                        onChange={(e) => void save(it, { ready: e.target.checked })}
                      />
                      Ready
                    </label>
                    {it.kind !== "bug" && (
                      <select
                        className="bf-board-move"
                        aria-label={`Epic for ${it.code}`}
                        value={it.parentId ?? ""}
                        onChange={(e) =>
                          void save(it, { parentId: e.target.value === "" ? null : e.target.value })
                        }
                      >
                        <option value="">No epic</option>
                        {epics
                          .filter((epic) => epic.id !== it.id)
                          .map((epic) => (
                            <option key={epic.id} value={epic.id}>
                              {epic.title}
                            </option>
                          ))}
                      </select>
                    )}
                    {sprints.length > 0 &&
                      (it.sprintId ? (
                        <span className="bf-backlog-insprint" title="Already in an open sprint">
                          <CalendarRange size={12} />
                          {sprints.find((s) => s.id === it.sprintId)?.name ?? "In sprint"}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          title={`Add to ${sprints[0]!.name}`}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await toSprint({ data: { sprintId: sprints[0]!.id, bugId: it.id } });
                              await refresh();
                              toast.success(`${it.code} → ${sprints[0]!.name}`);
                            } catch (e) {
                              toast.error(actionError(e, "Could not add to the sprint."));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          <CalendarRange />
                          Sprint
                        </Button>
                      ))}
                  </>
                )}
              </article>
            );
          })}
          <div
            className="bf-backlog-tail"
            onDragOver={(e) => {
              if (dragging) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              setDragging(null);
              if (id) void reorder(id, null);
            }}
          >
            Drop here to send to the end.
          </div>
        </div>
      )}
      {creating && (
        <CreateItemDialog
          projectId={projectId}
          epics={epics}
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

function CreateItemDialog({
  projectId,
  epics,
  onClose,
  onCreated,
}: {
  projectId: string;
  epics: BacklogItem[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = useServerFn(createWorkItemFn);
  const [requestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<Exclude<WorkKind, "bug">>("story");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: (data: CreateWorkItem) => create({ data }),
    onSuccess: onCreated,
    onError: (e) => setError(actionError(e, "The item could not be created.")),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New backlog item</DialogTitle>
          <DialogDescription>
            A story, task or epic. Bugs are raised from All bugs or a portal, as always.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            const f = new FormData(e.currentTarget);
            const est = String(f.get("estimate") ?? "");
            m.mutate({
              requestId,
              projectId,
              kind,
              title: String(f.get("title") ?? ""),
              description: String(f.get("description") ?? ""),
              ...(parentId ? { parentId } : {}),
              estimate: est === "" ? null : Number(est),
            });
          }}
        >
          <label className="bf-field">
            Kind
            <ThemedSelect
              label="Kind"
              value={kind}
              onChange={(v) => setKind(v as Exclude<WorkKind, "bug">)}
              options={[
                { value: "story", label: "Story" },
                { value: "task", label: "Task" },
                { value: "epic", label: "Epic" },
              ]}
            />
          </label>
          <label className="bf-field">
            Title
            <Input name="title" maxLength={180} required placeholder="e.g. Faster checkout" />
          </label>
          <label className="bf-field">
            Details<span className="bf-opt">Optional</span>
            <textarea name="description" maxLength={8000} placeholder="What and why" />
          </label>
          {kind !== "epic" && (
            <div className="bf-form-grid">
              <label className="bf-field">
                Epic<span className="bf-opt">Optional</span>
                <select
                  className="bf-board-move"
                  aria-label="Epic"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">No epic</option>
                  {epics.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bf-field">
                Estimate<span className="bf-opt">Optional</span>
                <Input name="estimate" type="number" min={0} max={1000} placeholder="points" />
              </label>
            </div>
          )}
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
