import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bug,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction, ErrorNotice, actionError } from "./action-feedback";
import { deleteForever, emptyTrash, getTrash, restoreFromTrash } from "@/lib/trash.functions";
import { daysLeft, daysLeftLabel, type TrashItemRef } from "@/lib/trash";
import { formatBytes } from "@/lib/bug-media";
import { statusLabel, timeAgo, roleText } from "@/lib/format";
import { SkeletonRows } from "./loading";

type Tab = "bugs" | "members" | "files";
type Pending = { kind: "forever"; item: TrashItemRef; label: string } | { kind: "empty" } | null;
const REFRESH = ["trash", "bug-workspace", "bug-detail", "members", "media-library", "activity"];

/** Settings-free Trash: restore bugs (with their attachments) and members, delete them forever, or empty it. Files removed earlier are listed for the record. */
export function TrashView() {
  const client = useQueryClient();
  const read = useServerFn(getTrash);
  const restore = useServerFn(restoreFromTrash);
  const purge = useServerFn(deleteForever);
  const empty = useServerFn(emptyTrash);
  const q = useQuery({
    queryKey: ["trash"],
    queryFn: () => read(),
    retry: false,
    staleTime: 5000,
    refetchInterval: 30000,
  });
  const [tab, setTab] = useState<Tab>("bugs");
  const [pending, setPending] = useState<Pending>(null);
  const refresh = () =>
    Promise.all(REFRESH.map((k) => client.invalidateQueries({ queryKey: [k] })));
  const back = useMutation({
    mutationFn: (item: TrashItemRef) => restore({ data: item }),
    onSuccess: async (r) => {
      await refresh();
      toast.success(r.kind === "bug" ? `${r.label} restored` : `${r.label} restored`, {
        description:
          r.kind === "bug"
            ? "Back in every list, with its attachments."
            : r.kind === "file"
              ? "Back on its bug, with its name and marks."
              : "Back in Team & access, deactivated. Activate them and replace their link to give access again.",
      });
    },
    onError: (e) => toast.error(actionError(e, "It could not be restored.")),
  });
  const d = q.data;
  const counts = {
    bugs: d?.bugs.length ?? 0,
    members: d?.members.length ?? 0,
    files: d?.files.length ?? 0,
  };
  const restorableFiles = d?.files.filter((f) => f.restorable).length ?? 0;
  const total = counts.bugs + counts.members + restorableFiles;
  const left = (iso: string) => {
    const n = daysLeft(iso);
    return (
      <span
        className="bf-tag bf-trash-left"
        data-soon={n <= 3 || undefined}
        title={`Moved to the Trash ${new Date(iso).toLocaleString()}`}
      >
        {daysLeftLabel(n)}
      </span>
    );
  };
  const restoreButton = (item: TrashItemRef) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={back.isPending}
      onClick={() => back.mutate(item)}
    >
      {back.isPending && back.variables?.id === item.id ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <RotateCcw />
      )}
      Restore
    </Button>
  );
  const foreverButton = (item: TrashItemRef, label: string) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive"
      onClick={() => setPending({ kind: "forever", item, label })}
    >
      <Trash2 />
      Delete forever
    </Button>
  );
  return (
    <section className="bf-panel">
      <div className="bf-panel-heading">
        <div>
          <h2>
            <Trash2 size={17} />
            Trash
          </h2>
          <p className="bf-panel-sub">
            {d
              ? `Deleted bugs and members stay here for ${d.days} days, then they are deleted forever. A restored bug comes back with its attachments.`
              : "Deleted bugs and members, restorable for a while."}
          </p>
        </div>
        {total > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => setPending({ kind: "empty" })}
          >
            <Trash2 />
            Empty Trash
          </Button>
        )}
      </div>
      <div className="px-5 pt-4">
        <div className="bf-mode" role="tablist" aria-label="Trash sections">
          {(["bugs", "members", "files"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-checked={tab === t}
              onClick={() => setTab(t)}
            >
              {t === "bugs" ? "Bugs" : t === "members" ? "Members" : "Removed files"}{" "}
              <span className="bf-nav-count">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>
      {q.isPending && (
        <div className="p-5">
          <SkeletonRows rows={4} label="Opening the Trash" />
        </div>
      )}
      {q.isError && (
        <div className="p-5">
          <ErrorNotice
            message={actionError(q.error, "The Trash could not be loaded.")}
            onRetry={() => {
              void q.refetch();
            }}
          />
        </div>
      )}
      {d && (
        <div className="mt-3 border-t">
          {tab === "bugs" &&
            (d.bugs.length ? (
              d.bugs.map((b) => (
                <div key={b.id} className="bf-trash-row">
                  <span className="bf-stat-icon bf-tone-danger">
                    <Bug size={17} />
                  </span>
                  <span className="min-w-0">
                    <strong title={b.title}>
                      <span className="font-mono text-xs text-muted-foreground">{b.code}</span> ·{" "}
                      {b.title}
                    </strong>
                    <small>
                      {b.project} · was {statusLabel(b.status)}
                      {b.files
                        ? ` · ${b.files} ${b.files === 1 ? "attachment" : "attachments"}`
                        : ""}{" "}
                      · deleted by {b.deletedBy} {timeAgo(b.deletedAt)}
                    </small>
                  </span>
                  {left(b.deletedAt)}
                  <span className="flex flex-wrap gap-1">
                    {restoreButton({ kind: "bug", id: b.id })}
                    {foreverButton({ kind: "bug", id: b.id }, `${b.code} · ${b.title}`)}
                  </span>
                </div>
              ))
            ) : (
              <Empty icon={<Bug size={22} />} text="No deleted bugs." />
            ))}
          {tab === "members" &&
            (d.members.length ? (
              d.members.map((m) => (
                <div key={m.id} className="bf-trash-row">
                  <span className="bf-stat-icon bf-tone-info">
                    <UserRound size={17} />
                  </span>
                  <span className="min-w-0">
                    <strong>{m.name}</strong>
                    <small>
                      {m.email}
                      {m.roles.length ? ` · ${m.roles.map(roleText).join(", ")}` : ""} · deleted by{" "}
                      {m.deletedBy} {timeAgo(m.deletedAt)}
                    </small>
                  </span>
                  {left(m.deletedAt)}
                  <span className="flex flex-wrap gap-1">
                    {restoreButton({ kind: "member", id: m.id })}
                    {foreverButton({ kind: "member", id: m.id }, m.name)}
                  </span>
                </div>
              ))
            ) : (
              <Empty icon={<UserRound size={22} />} text="No deleted members." />
            ))}
          {tab === "files" &&
            (d.files.length ? (
              <>
                <p className="px-5 py-3 text-xs text-muted-foreground">
                  Files removed one by one stay in storage for {d.days} days and can be restored to
                  their bug. Files cleared by the clean-up or “Remove all files” left storage at
                  once and are listed for the record.
                </p>
                {d.files.map((f) => (
                  <div key={f.id} className="bf-trash-row">
                    <span className="bf-stat-icon bf-tone-neutral">
                      {f.kind === "image" ? (
                        <ImageIcon size={17} />
                      ) : f.kind === "video" ? (
                        <Film size={17} />
                      ) : (
                        <FileText size={17} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <strong title={f.name}>{f.name}</strong>
                      <small>
                        {formatBytes(f.size)} · from {f.bugCode} {f.bugTitle} · removed by{" "}
                        {f.deletedBy} {timeAgo(f.deletedAt)}
                      </small>
                    </span>
                    {f.restorable ? (
                      <>
                        {left(f.deletedAt)}
                        {restoreButton({ kind: "file", id: f.id })}
                        {foreverButton({ kind: "file", id: f.id }, f.name)}
                      </>
                    ) : (
                      <span className="bf-tag">Deleted from storage</span>
                    )}
                    {/* The Admin bug list, with the bug opened and highlighted (a removed file is not shown on it). */}
                    <Button asChild size="sm" variant="ghost">
                      <a href={`/admin/bugs?bug=${f.bugId}`}>Open bug</a>
                    </Button>
                  </div>
                ))}
              </>
            ) : (
              <Empty icon={<FileText size={22} />} text="No files removed in the last 30 days." />
            ))}
        </div>
      )}
      <ConfirmAction
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
        destructive
        title={
          pending?.kind === "empty"
            ? `Empty the Trash (${total} ${total === 1 ? "item" : "items"})?`
            : `Delete ${pending?.kind === "forever" ? pending.label : ""} forever?`
        }
        description={
          pending?.kind === "empty"
            ? "Every bug, member and removed file in the Trash is deleted forever, and those files are deleted from storage. History and comments stay in the audit log. This cannot be undone."
            : pending?.kind === "forever" && pending.item.kind === "file"
              ? "The file is deleted from storage now and cannot be restored. The removal stays in the bug’s history."
              : "It cannot be restored afterwards. A bug’s attachments are deleted from storage; its history and comments stay in the audit log."
        }
        confirmLabel={pending?.kind === "empty" ? "Empty Trash" : "Delete forever"}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === "empty") {
            const r = await empty();
            await refresh();
            toast.success("Trash emptied", {
              description: `${r.bugs} bugs and ${r.members} members deleted forever${r.files ? `, ${r.files} files removed from storage` : ""}.`,
            });
          } else {
            const r = await purge({ data: pending.item });
            await refresh();
            toast.success("Deleted forever", {
              description: r.files
                ? `${r.files} ${r.files === 1 ? "file" : "files"} removed from storage.`
                : pending.label,
            });
          }
          setPending(null);
        }}
      />
    </section>
  );
}
function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="bf-empty">
      <span className="bf-empty-icon">{icon}</span>
      <strong>{text}</strong>
      <p>Deleted items appear here and can be restored for 30 days.</p>
    </div>
  );
}
