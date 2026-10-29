import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Kanban } from "lucide-react";
import { getBugWorkspace, updateBug } from "@/lib/bug-workflow.functions";
import type { BugAccess, BugChange, LiveBug } from "@/lib/bug-workflow";
import {
  BOARD_COLUMNS,
  boardColumn,
  dropAction,
  mayDragCard,
  type BoardColumnKey,
} from "@/lib/board";
import { dueBadge } from "@/lib/bugflow";
import { statusLabel, statusTone } from "@/lib/format";
import { ThemedSelect } from "./themed-select";
import { ErrorNotice, actionError } from "./action-feedback";
import { SkeletonRows } from "./loading";
import { toast } from "sonner";

const access: BugAccess = { kind: "admin" };

/**
 * The scrum board: one column per workflow stage. A drop either performs the one allowed status change directly, or
 * opens the bug (assigning and retest verdicts need their own dialogs) — it can never bypass the workflow rules.
 */
export function BoardView() {
  const client = useQueryClient();
  const fetch = useServerFn(getBugWorkspace);
  const update = useServerFn(updateBug);
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["bug-workspace", access, undefined],
    queryFn: () => fetch({ data: { access } }),
    retry: false,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const [project, setProject] = useState("all");
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <SkeletonRows />;
  if (q.isError || !q.data)
    return (
      <ErrorNotice
        message="The board could not be loaded."
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    );
  const d = q.data;
  const bugs = d.bugs.filter((b) => project === "all" || b.projectId === project);
  const draggingBug = dragging ? bugs.find((b) => b.id === dragging) : undefined;
  const openBug = (b: LiveBug) =>
    void navigate({ to: "/admin/bugs", search: { bug: Number(b.id) } });

  async function moveTo(b: LiveBug, column: BoardColumnKey) {
    const action = dropAction(d.actor, b, column);
    if (!action) return;
    if (action.kind === "open") {
      toast.info(action.reason);
      openBug(b);
      return;
    }
    setBusy(true);
    try {
      await update({
        data: {
          access,
          change: {
            requestId: crypto.randomUUID(),
            id: b.id,
            version: b.version,
            notes: "",
            action: "status",
            status: action.status,
          } as BugChange,
        },
      });
      await client.invalidateQueries({ queryKey: ["bug-workspace"] });
      toast.success(`${b.code} → ${statusLabel(action.status)}`);
    } catch (e) {
      // A version conflict refetches, so the card simply stays where the latest data says it is.
      toast.error(actionError(e, "This move could not be saved."));
      await client.invalidateQueries({ queryKey: ["bug-workspace"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4">
      <div className="bf-section-heading">
        <div className="flex items-center gap-2">
          <Kanban size={18} className="text-primary" />
          <h2>Board</h2>
          <span className="text-xs text-muted-foreground">
            Drag a card, or use its Move menu. Assigning and retest verdicts open the bug.
          </span>
        </div>
        <ThemedSelect
          label="Project"
          value={project}
          onChange={setProject}
          options={[
            { value: "all", label: "All projects" },
            ...d.projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>
      <div className="bf-board" data-busy={busy || undefined}>
        {BOARD_COLUMNS.map((col) => {
          const cards = bugs.filter((b) => boardColumn(b.status) === col.key);
          const dim = draggingBug ? dropAction(d.actor, draggingBug, col.key) === null : false;
          return (
            <div
              key={col.key}
              className="bf-board-col"
              data-dim={dim || undefined}
              onDragOver={(e) => {
                if (draggingBug && dropAction(d.actor, draggingBug, col.key)) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const b = bugs.find((x) => x.id === e.dataTransfer.getData("text/plain"));
                setDragging(null);
                if (b) void moveTo(b, col.key);
              }}
            >
              <header className="bf-board-col-head">
                <span>{col.label}</span>
                <span className="bf-board-count">{cards.length}</span>
              </header>
              <div className="bf-board-cards">
                {cards.map((b) => {
                  const draggable = !busy && mayDragCard(d.actor, b);
                  const targets = BOARD_COLUMNS.filter(
                    (c) => dropAction(d.actor, b, c.key) !== null,
                  );
                  const badge = dueBadge(b.status, b.dueOn, d.today);
                  return (
                    <article
                      key={b.id}
                      className="bf-board-card"
                      draggable={draggable}
                      data-dragging={dragging === b.id || undefined}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", b.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(b.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <button type="button" className="bf-board-title" onClick={() => openBug(b)}>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {b.code}
                        </span>
                        {b.title}
                      </button>
                      <div className="bf-board-meta">
                        <span className="bf-board-chip" data-tone={statusTone(b.status)}>
                          {statusLabel(b.status)}
                        </span>
                        <span className="bf-board-chip">{b.priority}</span>
                        {badge && (
                          <span className="bf-board-chip" data-tone={badge.tone}>
                            {badge.text}
                          </span>
                        )}
                        <span className="truncate text-[11px] text-muted-foreground">
                          {b.assignee}
                        </span>
                      </div>
                      {targets.length > 0 && (
                        <select
                          className="bf-board-move"
                          aria-label={`Move ${b.code}`}
                          value=""
                          disabled={busy}
                          onChange={(e) => {
                            const to = e.target.value as BoardColumnKey;
                            e.target.value = "";
                            if (to) void moveTo(b, to);
                          }}
                        >
                          <option value="">Move to…</option>
                          {targets.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </article>
                  );
                })}
                {cards.length === 0 && <p className="bf-board-empty">Nothing here.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
