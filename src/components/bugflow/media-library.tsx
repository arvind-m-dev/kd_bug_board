import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CheckSquare,
  FileText,
  Film,
  Image as ImageIcon,
  Images,
  Link2,
  LoaderCircle,
  PenLine,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction, ErrorNotice, actionError } from "./action-feedback";
import { moveToTrashToast } from "./trash-bin";
import { SavedMediaMarkup } from "./upload-markup";
import { MediaLightbox, MediaThumb, Lineage, copyMediaLink } from "./bug-media";
import {
  deleteMedia,
  deleteMediaForever,
  getMediaLibrary,
  getMediaTrash,
  restoreMedia,
} from "@/lib/bug-media.functions";
import { formatBytes, mediaLinkPath, type LibraryItem, type TrashedMedia } from "@/lib/bug-media";
import { daysLeft, daysLeftLabel } from "@/lib/trash";
import type { BugAccess } from "@/lib/bug-workflow";
import { statusLabel, statusTone, timeAgo } from "@/lib/format";

/**
 * "My media": every file this person attached, grouped by bug, with a link per file and per bug.
 * Admin sees everyone's files. Links open the bug for whoever has access to it; nothing here is public.
 * Files can be moved to the Trash here; removed files stay restorable for 30 days in "Removed files" below.
 */
export function MediaLibrary({
  access,
  title = "My media",
}: {
  access: BugAccess;
  title?: string;
}) {
  const fetch = useServerFn(getMediaLibrary);
  const library = useQuery({
    queryKey: ["media-library", access],
    queryFn: () => fetch({ data: { access } }),
    retry: false,
    staleTime: 10000,
    refetchInterval: 30000,
  });
  const client = useQueryClient();
  const remove = useServerFn(deleteMedia);
  const restore = useServerFn(restoreMedia);
  const forever = useServerFn(deleteMediaForever);
  const fetchTrash = useServerFn(getMediaTrash);
  const removed = useQuery({
    queryKey: ["media-trash", access],
    queryFn: () => fetchTrash({ data: { access } }),
    retry: false,
    staleTime: 10000,
  });
  const [removing, setRemoving] = useState<LibraryItem | null>(null);
  const [marking, setMarking] = useState<LibraryItem | null>(null);
  const [purging, setPurging] = useState<TrashedMedia | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Select mode: tick several files, then move them to the Trash together (or restore / delete removed ones).
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedRemoved, setPickedRemoved] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"trash" | "forever" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
    setPickedRemoved(new Set());
  };
  /** Runs one action per file, three at a time; returns the ids that worked and how many failed. */
  async function each(ids: string[], work: (id: string) => Promise<unknown>) {
    const ok: string[] = [];
    let failed = 0;
    const queue = [...ids];
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        for (let id = queue.shift(); id; id = queue.shift())
          await work(id).then(
            () => ok.push(id!),
            () => failed++,
          );
      }),
    );
    return { ok, failed };
  }
  async function restoreSelected() {
    setBulkBusy(true);
    const r = await each([...pickedRemoved], (id) => restore({ data: { access, media: { id } } }));
    await refresh();
    setBulkBusy(false);
    setPickedRemoved(new Set());
    if (r.ok.length)
      toast.success(`${r.ok.length} ${r.ok.length === 1 ? "file" : "files"} restored`, {
        description: r.failed
          ? `${r.failed} could not be restored (their bug may be full or in the Trash).`
          : undefined,
      });
    else if (r.failed) toast.error("The selected files could not be restored.");
  }
  const tileRect = useRef<DOMRect | null>(null);
  const refresh = () =>
    Promise.all(
      ["media-library", "media-trash", "bug-detail", "bug-workspace", "trash"].map((k) =>
        client.invalidateQueries({ queryKey: [k] }),
      ),
    );
  async function bringBack(id: string, name: string) {
    setBusy(id);
    try {
      await restore({ data: { access, media: { id } } });
      await refresh();
      toast.success(`${name} restored`, {
        description: "Back on its bug, with its name and marks.",
      });
    } catch (e) {
      toast.error(actionError(e, "The file could not be restored."));
    } finally {
      setBusy(null);
    }
  }
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const items = useMemo(() => {
    const all = library.data ?? [];
    const needle = q.trim().toLowerCase();
    return needle
      ? all.filter((m) => `${m.name} ${m.bugCode} ${m.bugTitle}`.toLowerCase().includes(needle))
      : all;
  }, [library.data, q]);
  const groups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    for (const m of items) map.set(m.bugId, [...(map.get(m.bugId) ?? []), m]);
    return [...map.values()];
  }, [items]);
  const total = (library.data ?? []).reduce((n, m) => n + m.size, 0);
  return (
    <section className="bf-panel p-5">
      <div className="bf-panel-heading">
        <div>
          <h2>
            <Images size={18} />
            {title}
          </h2>
          <p>
            {library.data
              ? `${library.data.length} ${library.data.length === 1 ? "file" : "files"} · ${formatBytes(total)} · each file has its own link, and each bug a link to all of its files.`
              : "Screenshots, recordings and PDFs you attached, by bug."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={selecting ? "secondary" : "outline"}
          aria-pressed={selecting}
          onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          disabled={!library.data?.length && !removed.data?.length}
        >
          <CheckSquare />
          {selecting ? "Done selecting" : "Select"}
        </Button>
        <label className="bf-search">
          <Search size={15} />
          <input
            value={q}
            placeholder="Search by name or bug"
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search files"
          />
        </label>
      </div>
      {library.isPending && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Loading your files…
        </p>
      )}
      {library.isError && (
        <ErrorNotice
          message="Your files could not be loaded."
          onRetry={() => {
            void library.refetch();
          }}
        />
      )}
      {library.data && groups.length === 0 && (
        <div className="bf-empty">
          <span className="bf-empty-icon">
            <Images size={22} />
          </span>
          <strong>{q ? "Nothing matches that search." : "No files yet."}</strong>
          <p>
            {q
              ? "Try another name or bug code."
              : "Files you attach to a bug, and marked-up copies you save, appear here with the names you gave them."}
          </p>
        </div>
      )}
      <div className="bf-library">
        {groups.map((g) => {
          const first = g[0]!;
          return (
            <article key={first.bugId} className="bf-library-group">
              <header>
                <span className="bf-tag">{first.bugCode}</span>
                <strong className="truncate">{first.bugTitle}</strong>
                <span className="bf-status-pill" data-tone={statusTone(first.bugStatus)}>
                  <i className="bf-dot" />
                  {statusLabel(first.bugStatus)}
                </span>
                <span className="ml-auto flex gap-1">
                  {selecting && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        const all = g.every((m) => picked.has(m.id));
                        const next = new Set(picked);
                        for (const m of g) {
                          if (all) next.delete(m.id);
                          else next.add(m.id);
                        }
                        setPicked(next);
                      }}
                    >
                      <CheckSquare />
                      {g.every((m) => picked.has(m.id)) ? "Clear" : "Select all"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void copyMediaLink(first.bugId)}
                  >
                    <Link2 />
                    Copy link to all {g.length === 1 ? "" : g.length} files
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                    <Link to={mediaLinkPath(first.bugId)}>
                      <ArrowUpRight />
                      Open bug
                    </Link>
                  </Button>
                </span>
              </header>
              <div className="bf-media-grid">
                {g.map((m) => (
                  <figure
                    key={m.id}
                    className="bf-media-tile"
                    data-derived={m.derivedFrom ? "" : undefined}
                    data-picked={(selecting && picked.has(m.id)) || undefined}
                  >
                    {selecting && (
                      <label className="bf-media-pick" title={`Select ${m.name}`}>
                        <input
                          type="checkbox"
                          checked={picked.has(m.id)}
                          onChange={() => setPicked((p) => toggle(p, m.id))}
                          aria-label={`Select ${m.name}`}
                        />
                      </label>
                    )}
                    <MediaThumb
                      item={m}
                      onOpen={() =>
                        selecting ? setPicked((p) => toggle(p, m.id)) : setOpen(items.indexOf(m))
                      }
                    />
                    <figcaption className="bf-media-cap">
                      <strong title={m.name}>{m.name}</strong>
                      <small>
                        {formatBytes(m.size)} · {timeAgo(m.createdAt)}
                        {access.kind === "admin" ? ` · ${m.uploadedBy}` : ""}
                      </small>
                      <Lineage item={m} items={g} />
                    </figcaption>
                    <span className="bf-media-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => void copyMediaLink(m.bugId, m.id)}
                      >
                        <Link2 />
                        Copy link
                      </Button>
                      {/* Members mark up their own files here (My media only lists what they attached). */}
                      {access.kind !== "admin" &&
                        m.url &&
                        (m.kind === "image" || m.kind === "video") && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Mark up ${m.name}`}
                            title={
                              m.kind === "video"
                                ? "Add timed marks to this recording"
                                : "Draw on this image (saves a marked-up copy)"
                            }
                            onClick={() => setMarking(m)}
                          >
                            <PenLine size={14} />
                          </Button>
                        )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive"
                        aria-label={`Move ${m.name} to Trash`}
                        onClick={(e) => {
                          tileRect.current =
                            e.currentTarget.closest("figure")?.getBoundingClientRect() ?? null;
                          setRemoving(m);
                        }}
                      >
                        <Trash2 />
                        Delete
                      </Button>
                    </span>
                  </figure>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {(removed.data?.length ?? 0) > 0 && (
        <div className="bf-library-trash">
          <h3 className="bf-section-title">
            <Trash2 size={15} />
            Removed files
            <span className="bf-tag ml-1">{removed.data!.length}</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Restorable for 30 days, then deleted from storage for good.
          </p>
          {removed.data!.map((f) => (
            <div
              key={f.id}
              className="bf-trash-row"
              data-picked={(selecting && pickedRemoved.has(f.id)) || undefined}
            >
              {selecting && (
                <input
                  type="checkbox"
                  className="bf-trash-pick"
                  checked={pickedRemoved.has(f.id)}
                  onChange={() => setPickedRemoved((p) => toggle(p, f.id))}
                  aria-label={`Select removed file ${f.name}`}
                />
              )}
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
                  {formatBytes(f.size)} · from {f.bugCode} {f.bugTitle} · removed{" "}
                  {timeAgo(f.deletedAt)}
                  {access.kind === "admin" ? ` · attached by ${f.uploadedBy}` : ""}
                </small>
              </span>
              <span
                className="bf-tag bf-trash-left"
                data-soon={daysLeft(f.deletedAt) <= 3 || undefined}
              >
                {daysLeftLabel(daysLeft(f.deletedAt))}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null || f.bugInTrash}
                title={f.bugInTrash ? "Its bug is in the Trash: restore the bug first." : undefined}
                onClick={() => void bringBack(f.id, f.name)}
              >
                {busy === f.id ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
                Restore
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy !== null}
                onClick={() => setPurging(f)}
              >
                <Trash2 />
                Delete forever
              </Button>
            </div>
          ))}
        </div>
      )}
      {selecting && (picked.size > 0 || pickedRemoved.size > 0) && (
        <div className="bf-bulk-bar" role="toolbar" aria-label="Selected files">
          {picked.size > 0 && (
            <>
              <strong>
                {picked.size} {picked.size === 1 ? "file" : "files"} selected
              </strong>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={bulkBusy}
                onClick={() => setBulk("trash")}
              >
                <Trash2 />
                Move to Trash
              </Button>
            </>
          )}
          {pickedRemoved.size > 0 && (
            <>
              <strong>{pickedRemoved.size} removed selected</strong>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => void restoreSelected()}
              >
                {bulkBusy ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
                Restore
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={bulkBusy}
                onClick={() => setBulk("forever")}
              >
                <Trash2 />
                Delete forever
              </Button>
            </>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={stopSelecting}>
            Cancel
          </Button>
        </div>
      )}
      <ConfirmAction
        open={bulk !== null}
        onOpenChange={(o) => {
          if (!o) setBulk(null);
        }}
        destructive
        title={
          bulk === "trash"
            ? `Move ${picked.size} ${picked.size === 1 ? "file" : "files"} to Trash?`
            : `Delete ${pickedRemoved.size} ${pickedRemoved.size === 1 ? "file" : "files"} forever?`
        }
        description={
          bulk === "trash"
            ? "They are removed from their bugs for everyone and stay restorable for 30 days under Removed files. Each removal is recorded with your name, date and time."
            : "They are deleted from storage now and cannot be restored. The removals stay in each bug’s history."
        }
        confirmLabel={bulk === "trash" ? "Move to Trash" : "Delete forever"}
        onConfirm={async () => {
          setBulkBusy(true);
          try {
            if (bulk === "trash") {
              const r = await each([...picked], (id) =>
                remove({ data: { access, media: { id } } }),
              );
              await refresh();
              setPicked(new Set());
              if (r.ok.length)
                moveToTrashToast({
                  title: "Files moved to Trash",
                  label: `${r.ok.length} ${r.ok.length === 1 ? "file" : "files"}`,
                  detail: r.failed
                    ? `${r.failed} could not be removed. The rest are restorable for 30 days.`
                    : "Restorable for 30 days under Removed files.",
                  source: null,
                  trashLink: access.kind === "admin",
                  onUndo: async () => {
                    await each(r.ok, (id) => restore({ data: { access, media: { id } } }));
                    await refresh();
                  },
                });
              else toast.error("The selected files could not be removed.");
            } else {
              const r = await each([...pickedRemoved], (id) =>
                forever({ data: { access, media: { id } } }),
              );
              await refresh();
              setPickedRemoved(new Set());
              toast.success(
                `${r.ok.length} ${r.ok.length === 1 ? "file" : "files"} deleted forever`,
                {
                  description: r.failed ? `${r.failed} could not be deleted.` : undefined,
                },
              );
            }
          } finally {
            setBulkBusy(false);
            setBulk(null);
          }
        }}
      />
      <MediaLightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      {marking && (
        <SavedMediaMarkup item={marking} access={access} onClose={() => setMarking(null)} />
      )}
      <ConfirmAction
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        destructive
        title={`Move ${removing?.name ?? "this file"} to Trash?`}
        description="It is removed from its bug for everyone and stays restorable for 30 days under Removed files. The removal is recorded with your name, date and time."
        confirmLabel="Move to Trash"
        onConfirm={async () => {
          if (!removing) return;
          const gone = removing;
          await remove({ data: { access, media: { id: gone.id } } });
          await refresh();
          moveToTrashToast({
            title: "File moved to Trash",
            label: gone.name,
            detail: "Restorable for 30 days under Removed files.",
            source: tileRect.current,
            trashLink: access.kind === "admin",
            onUndo: async () => {
              await restore({ data: { access, media: { id: gone.id } } });
              await refresh();
            },
          });
          setRemoving(null);
        }}
      />
      <ConfirmAction
        open={purging !== null}
        onOpenChange={(o) => {
          if (!o) setPurging(null);
        }}
        destructive
        title={`Delete ${purging?.name ?? "this file"} forever?`}
        description="The file is deleted from storage now and cannot be restored. The removal stays in the bug’s history."
        confirmLabel="Delete forever"
        onConfirm={async () => {
          if (!purging) return;
          await forever({ data: { access, media: { id: purging.id } } });
          await refresh();
          toast.success("Deleted forever", { description: purging.name });
          setPurging(null);
        }}
      />
    </section>
  );
}
