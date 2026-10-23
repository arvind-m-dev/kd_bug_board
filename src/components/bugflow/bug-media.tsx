import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Paperclip,
  Pencil,
  PenLine,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ConfirmAction, actionError } from "./action-feedback";
import { moveToTrashToast } from "./trash-bin";
import { clearBugMedia, deleteMedia, renameMedia, restoreMedia } from "@/lib/bug-media.functions";
import {
  MEDIA_NAME_MAX,
  clock,
  formatBytes,
  isClosedForMedia,
  mayDeleteMedia,
  mayUploadMedia,
  mediaLinkPath,
  type MediaConfig,
  type MediaItem,
} from "@/lib/bug-media";
import { uploadLabel, useMediaUpload, type UploadState } from "./media-queue";
import { VideoPlayer } from "./video-marks";
import { UploadMarkup } from "./upload-markup";
import type { BugAccess, BugActor, LiveBug } from "@/lib/bug-workflow";
import { timeAgo } from "@/lib/format";

export { useMediaUpload, type UploadMeta, type UploadState } from "./media-queue";

/** Copies an in-app link to a bug's files (or one file). It opens for whoever is signed in or has their portal open. */
export async function copyMediaLink(bugId: string, mediaId?: string) {
  const url = `${window.location.origin}${mediaLinkPath(bugId, mediaId)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied", {
      description: mediaId
        ? "Opens this file on the bug for anyone with access to it."
        : "Opens the bug with all its files for anyone with access to it.",
    });
  } catch {
    toast.error("The link could not be copied.", { description: url });
  }
}

/** Drop zone + picker + the queue of files in flight, each with an editable name. Purely presentational; the hook above does the work. */
export function MediaDropZone({
  accept,
  remaining,
  disabledReason,
  onFiles,
  uploads,
  onRetry,
  onRemove,
  onLabel,
  hint,
  markup = false,
}: {
  /** Offer "Mark up" on queued images and recordings (the uploader's local files, before they go up). */
  markup?: boolean | undefined;
  accept: string[];
  remaining: number;
  disabledReason?: string | undefined;
  onFiles: (files: File[]) => void;
  uploads: UploadState[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onLabel?: ((id: string, value: string) => void) | undefined;
  hint?: string | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [marking, setMarking] = useState<UploadState | null>(null);
  const disabled = !!disabledReason || remaining <= 0;
  const take = (list: FileList | null) => {
    if (!list) return;
    const files = [...list];
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    if (files.length > remaining)
      toast.error(
        `Only ${remaining} more ${remaining === 1 ? "file" : "files"} can be attached to this bug.`,
      );
    onFiles(files.slice(0, Math.max(0, remaining)));
  };
  // Paste a screenshot or file from the clipboard anywhere on the page; text pastes are left alone.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      take(dt.files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [disabled, take]);
  const editable = (u: UploadState) =>
    !!onLabel && (u.status === "preparing" || u.status === "queued" || u.status === "failed");
  return (
    <div className="grid gap-3">
      <div
        className="bf-upload"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        data-active={active}
        onClick={() => !disabled && input.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setActive(true);
        }}
        onDragLeave={() => setActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setActive(false);
          take(e.dataTransfer.files);
        }}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept={accept.join(",")}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
        <Upload size={24} />
        <strong className="text-xs">
          {disabledReason
            ? "Media uploads unavailable"
            : remaining <= 0
              ? "This bug has all 10 files"
              : "Drop or paste screenshots, recordings or PDFs here — several at once is fine"}
        </strong>
        <span className="text-xs text-muted-foreground">
          {disabledReason ??
            (remaining <= 0
              ? "Remove one to add another"
              : (hint ??
                `PNG, JPEG, WebP, GIF, MP4, MOV, WebM or PDF · images are shrunk and recordings over 100 MB are compressed in your browser · ${remaining} more`))}
        </span>
        {!disabledReason && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              input.current?.click();
            }}
          >
            <Paperclip />
            Choose files
          </Button>
        )}
      </div>
      {uploads.length > 0 && (
        <ul className="bf-upload-queue" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.id} className="bf-upload-row" data-status={u.status}>
              {u.preview ? (
                <img src={u.preview} alt="" />
              ) : (
                <span className="bf-upload-ph">
                  {u.name.toLowerCase().endsWith(".pdf") ? (
                    <FileText size={18} />
                  ) : (
                    <Film size={18} />
                  )}
                </span>
              )}
              <span className="min-w-0">
                {editable(u) ? (
                  <input
                    className="bf-upload-name"
                    value={u.label}
                    maxLength={MEDIA_NAME_MAX}
                    placeholder="Name this file"
                    aria-label={`Name for ${u.name}`}
                    onChange={(e) => onLabel!(u.id, e.target.value)}
                  />
                ) : (
                  <strong title={u.name}>{u.label.trim() || u.name}</strong>
                )}
                <small>
                  {formatBytes(u.size)} · {u.status === "queued" && u.note ? `${u.note} · ` : ""}
                  {uploadLabel(u)}
                </small>
                {(u.status === "uploading" ||
                  u.status === "verifying" ||
                  (u.status === "preparing" && u.progress > 0)) && (
                  <Progress value={u.progress * 100} className="mt-1 h-1.5" />
                )}
              </span>
              <span className="flex items-center gap-1">
                {markup &&
                  u.status === "queued" &&
                  u.file &&
                  (u.file.contentType.startsWith("image/") ||
                    u.file.contentType.startsWith("video/")) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setMarking(u)}
                      title={
                        u.marks?.length
                          ? "Change or preview the timed marks before uploading"
                          : "Mark up this file before it is uploaded"
                      }
                    >
                      <PenLine />
                      {u.marks?.length ? "Edit / preview marks" : "Mark up"}
                    </Button>
                  )}
                {u.status === "failed" && u.file && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onRetry(u.id)}
                  >
                    <RefreshCw />
                    Retry
                  </Button>
                )}
                {u.status === "preparing" && u.progress > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onRemove(u.id)}
                  >
                    <X />
                    Cancel
                  </Button>
                ) : u.status === "preparing" ||
                  u.status === "uploading" ||
                  u.status === "verifying" ? (
                  <LoaderCircle className="animate-spin text-muted-foreground" size={16} />
                ) : u.status === "done" ? (
                  <Check className="text-success" size={16} />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Remove ${u.name} from the queue`}
                    onClick={() => onRemove(u.id)}
                  >
                    <X size={14} />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {marking && <UploadMarkup upload={marking} onClose={() => setMarking(null)} />}
    </div>
  );
}

/** Where a file came from: a marked-up copy of another, or a frame taken from a recording. */
export function Lineage({ item, items }: { item: MediaItem; items: MediaItem[] }) {
  if (!item.derivedFrom) return null;
  const from = items.find((m) => m.id === item.derivedFrom);
  return (
    <small className="bf-media-lineage">
      {item.atSeconds != null ? `Frame at ${clock(item.atSeconds)}` : "Marked up"}
      {from ? ` · from ${from.name}` : ""}
    </small>
  );
}

/** A thumbnail for one file. */
export function MediaThumb({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="bf-media-thumb"
      data-kind={item.kind}
      onClick={onOpen}
      aria-label={`Open ${item.name}`}
      disabled={!item.url}
    >
      {item.kind === "image" && item.url ? (
        <img
          src={item.thumbUrl ?? item.url}
          alt={item.name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : item.kind === "video" && item.url ? (
        // Lists never download the recording itself: a poster when there is one, otherwise an icon.
        <>
          {item.thumbUrl ? (
            <img
              src={item.thumbUrl}
              alt={item.name}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Film size={30} />
          )}
          <span className="bf-media-play">
            <Play size={18} />
          </span>
        </>
      ) : item.kind === "pdf" ? (
        <FileText size={30} />
      ) : item.kind === "video" ? (
        <Film size={30} />
      ) : (
        <ImageIcon size={30} />
      )}
      <span className="bf-media-kind">{item.kind}</span>
    </button>
  );
}

/**
 * Full-size viewer with previous/next (buttons and arrow keys), inline PDF, copy link, and whatever extra actions the caller adds.
 * View only: recordings play with the uploader's timed marks; nothing is marked up here.
 */
export function MediaLightbox({
  items,
  index,
  onIndex,
  onClose,
  actions,
  videoRef,
}: {
  items: MediaItem[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  actions?: ((m: MediaItem) => ReactNode) | undefined;
  videoRef?: React.RefObject<HTMLVideoElement | null> | undefined;
}) {
  const m = index === null ? null : (items[index] ?? null);
  const videoState = useRef({ editing: false, dirty: false });
  const onVideoState = useCallback((s: { editing: boolean; dirty: boolean }) => {
    videoState.current = s;
  }, []);
  // Unsaved timed marks are never dropped silently by closing or switching files.
  const leave = () =>
    !videoState.current.dirty || window.confirm("Discard the timed marks you have not saved?");
  const go = (d: number) => {
    if (index === null || items.length < 2 || !leave()) return;
    videoState.current = { editing: false, dirty: false };
    onIndex((index + d + items.length) % items.length);
  };
  return (
    <Dialog
      open={m !== null}
      onOpenChange={(o) => {
        if (!o && leave()) {
          videoState.current = { editing: false, dirty: false };
          onClose();
        }
      }}
    >
      <DialogContent
        className="bf-lightbox max-w-5xl"
        onKeyDown={(e) => {
          if (videoState.current.editing) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="truncate">{m?.name}</DialogTitle>
          <DialogDescription>
            {m
              ? `${formatBytes(m.size)} · attached by ${m.uploadedBy} · ${timeAgo(m.createdAt)}${items.length > 1 ? ` · ${(index ?? 0) + 1} of ${items.length}` : ""}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {m && (
          <div className="bf-lightbox-stage">
            {m.kind === "image" && m.url && (
              <img src={m.url} alt={m.name} referrerPolicy="no-referrer" />
            )}
            {m.kind === "video" && m.url && (
              <VideoPlayer
                key={m.id}
                src={m.url}
                poster={m.thumbUrl}
                initialMarks={m.marks}
                videoRef={videoRef}
                onState={onVideoState}
              />
            )}
            {m.kind === "pdf" && m.url && <iframe key={m.id} src={m.url} title={m.name} />}
            {!m.url && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                This file cannot be shown because media storage is not connected right now.
              </p>
            )}
            {items.length > 1 && (
              <>
                <button
                  type="button"
                  className="bf-lightbox-nav"
                  data-dir="prev"
                  aria-label="Previous file"
                  onClick={() => go(-1)}
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  className="bf-lightbox-nav"
                  data-dir="next"
                  aria-label="Next file"
                  onClick={() => go(1)}
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
        )}
        {m && (
          <div className="bf-lightbox-bar">
            {m.url && (
              <Button asChild variant="outline" size="sm">
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  <ExternalLink />
                  Open in a new tab
                </a>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyMediaLink(m.bugId, m.id)}
            >
              <Link2 />
              Copy link
            </Button>
            {actions?.(m)}
            <Lineage item={m} items={items} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The "Attachments" card on a bug: gallery with lightbox, rename, mark-up, Open and Remove, plus the drop zone for people who may attach files. */
export function BugMedia({
  access,
  bug,
  actor,
  items,
  config,
  readOnly = false,
  openMediaId,
}: {
  access: BugAccess;
  bug: LiveBug;
  actor: BugActor;
  items: MediaItem[];
  config: MediaConfig;
  readOnly?: boolean;
  openMediaId?: string | undefined;
}) {
  const client = useQueryClient();
  const remove = useServerFn(deleteMedia);
  const restoreFile = useServerFn(restoreMedia);
  const rename = useServerFn(renameMedia);
  const clearAll = useServerFn(clearBugMedia);
  const [open, setOpen] = useState<number | null>(null);
  const [removing, setRemoving] = useState<MediaItem | null>(null);
  const [clearing, setClearing] = useState(false);
  const removingRect = useRef<DOMRect | null>(null);
  const section = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  // Files wait in the queue until "Upload" so the uploader can mark them up first; then they go up in the background.
  const uploader = useMediaUpload(access, null);
  // A link to one file opens it as soon as it is in the list (once).
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!openMediaId || opened.current === openMediaId) return;
    const i = items.findIndex((m) => m.id === openMediaId);
    if (i >= 0) {
      opened.current = openMediaId;
      setOpen(i);
    }
  }, [openMediaId, items]);
  const canSee = actor.permissions.includes("evidence");
  const canUpload = !readOnly && mayUploadMedia(actor, bug);
  if (!canSee && !canUpload) return null;
  if (readOnly && items.length === 0) return null;
  const disabledReason = !config.enabled
    ? "Media uploads are off until your Admin connects storage in Settings → Media storage. Add a Drive link instead."
    : undefined;
  if (!canUpload && items.length === 0) return null;
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["bug-detail"] }),
      client.invalidateQueries({ queryKey: ["bug-workspace"] }),
      client.invalidateQueries({ queryKey: ["media-library"] }),
    ]);
  async function saveName() {
    if (!editing) return;
    const value = editing.value.trim();
    const current = items.find((m) => m.id === editing.id);
    if (!value || !current || value === current.name) {
      setEditing(null);
      return;
    }
    setSavingName(true);
    try {
      await rename({ data: { access, media: { id: editing.id, name: value } } });
      await refresh();
      setEditing(null);
      toast.success("File renamed");
    } catch (e) {
      toast.error(actionError(e, "The file could not be renamed."));
    } finally {
      setSavingName(false);
    }
  }
  const waiting = uploader.uploads.filter((u) => u.target === null && u.status !== "done").length;
  const remaining =
    config.maxFiles - items.length - uploader.uploads.filter((u) => u.status !== "failed").length;
  return (
    <section ref={section} className="bf-rc-card" data-tone="info">
      <h3 className="bf-section-title">
        <span className="bf-rc-icon">
          <Paperclip size={15} />
        </span>
        Attachments
        {items.length > 0 && (
          <span className="bf-tag ml-1">
            {items.length} of {config.maxFiles}
          </span>
        )}
        {items.length > 0 && (
          <span className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void copyMediaLink(bug.id)}
            >
              <Link2 />
              Copy link to all files
            </Button>
            {!readOnly && actor.role === "admin" && isClosedForMedia(bug.status) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive"
                onClick={() => setClearing(true)}
              >
                <Trash2 />
                Remove all {items.length} files
              </Button>
            )}
          </span>
        )}
      </h3>
      {!readOnly && actor.role === "admin" && isClosedForMedia(bug.status) && items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          This bug is closed. Its files take {formatBytes(items.reduce((n, m) => n + m.size, 0))} of
          storage; remove them here, or set a clean-up schedule in Settings → Media storage.
        </p>
      )}
      {items.length > 0 && (
        <div className="bf-media-grid">
          {items.map((m, i) => (
            <figure
              key={m.id}
              className="bf-media-tile"
              data-derived={m.derivedFrom ? "" : undefined}
            >
              <MediaThumb item={m} onOpen={() => setOpen(i)} />
              <figcaption className="bf-media-cap">
                {editing?.id === m.id ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveName();
                    }}
                  >
                    <input
                      className="bf-upload-name"
                      autoFocus
                      value={editing.value}
                      maxLength={MEDIA_NAME_MAX}
                      aria-label="New name"
                      onChange={(e) => setEditing({ id: m.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={savingName}
                      aria-label="Save name"
                    >
                      {savingName ? (
                        <LoaderCircle className="animate-spin" size={13} />
                      ) : (
                        <Check size={13} />
                      )}
                    </Button>
                  </form>
                ) : (
                  <strong title={m.name}>{m.name}</strong>
                )}
                <small>
                  {formatBytes(m.size)} · {m.uploadedBy} · {timeAgo(m.createdAt)}
                </small>
                <Lineage item={m} items={items} />
              </figcaption>
              <span className="bf-media-actions">
                {!readOnly && mayDeleteMedia(actor, m) && editing?.id !== m.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEditing({ id: m.id, value: m.name })}
                  >
                    <Pencil />
                    Rename
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  aria-label={`Copy link to ${m.name}`}
                  onClick={() => void copyMediaLink(bug.id, m.id)}
                >
                  <Link2 />
                  Link
                </Button>
                {mayDeleteMedia(actor, m) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs text-destructive"
                    onClick={(e) => {
                      removingRect.current =
                        (
                          e.currentTarget.closest("figure") as HTMLElement | null
                        )?.getBoundingClientRect() ?? null;
                      setRemoving(m);
                    }}
                  >
                    <Trash2 />
                    Remove
                  </Button>
                )}
              </span>
            </figure>
          ))}
        </div>
      )}
      {canUpload && (
        <MediaDropZone
          accept={config.accept}
          remaining={remaining}
          disabledReason={disabledReason}
          onFiles={(f) => void uploader.add(f)}
          uploads={uploader.uploads}
          onRetry={uploader.retry}
          onRemove={uploader.remove}
          onLabel={uploader.setLabel}
          markup
          hint="Files wait here so you can name and mark them up, then press Upload"
        />
      )}
      {canUpload && waiting > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            Mark up screenshots and recordings now if you want: after upload they are view-only.
          </span>
          <Button type="button" size="sm" onClick={() => uploader.handoff(bug.id, bug.code)}>
            <Upload />
            Upload {waiting} {waiting === 1 ? "file" : "files"}
          </Button>
        </div>
      )}
      {items.some((m) => !m.url) && (
        <p className="text-xs text-muted-foreground">
          Some files cannot be shown because media storage is not connected right now.
        </p>
      )}
      <MediaLightbox
        items={items}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
        videoRef={video}
      />

      <ConfirmAction
        open={clearing}
        onOpenChange={setClearing}
        destructive
        title={`Remove all ${items.length} files from ${bug.code}?`}
        description="Every screenshot, recording and PDF on this bug is removed for everyone and deleted from storage. One audit entry records it with your name, date and time."
        confirmLabel="Remove all files"
        onConfirm={async () => {
          const source = section.current?.getBoundingClientRect() ?? null;
          const n = items.length;
          await clearAll({ data: { access, media: { bugId: bug.id } } });
          await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["trash"] })]);
          moveToTrashToast({
            title: "Files removed",
            label: `${n} ${n === 1 ? "file" : "files"} from ${bug.code}`,
            detail: "Deleted from storage; listed in Trash for the record.",
            source,
            trashLink: access.kind === "admin",
          });
          setClearing(false);
        }}
      />
      <ConfirmAction
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        destructive
        title={`Remove ${removing?.name ?? "this file"}?`}
        description="The file is removed from this bug for everyone and moved to the Trash, where it can be restored for 30 days. The removal is recorded with your name, date and time."
        confirmLabel="Move to Trash"
        onConfirm={async () => {
          if (!removing) return;
          const source = removingRect.current;
          await remove({ data: { access, media: { id: removing.id } } });
          await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["trash"] })]);
          const gone = removing;
          moveToTrashToast({
            title: "File moved to Trash",
            label: gone.name,
            detail: "Restorable for 30 days from My media or the Trash.",
            source,
            trashLink: access.kind === "admin",
            onUndo: async () => {
              await restoreFile({ data: { access, media: { id: gone.id } } });
              await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["trash"] })]);
            },
          });
          setRemoving(null);
        }}
      />
    </section>
  );
}
