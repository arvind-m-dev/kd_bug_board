import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { actionError } from "./action-feedback";
import { finishMediaUpload, prepareMediaUpload, saveVideoMarks } from "@/lib/bug-media.functions";
import { MEDIA_NAME_MAX, clock, formatBytes, type VideoMark } from "@/lib/bug-media";
import { prepareFile, uploadPut, type PreparedFile } from "@/lib/media-client";
import type { BugAccess } from "@/lib/bug-workflow";

export type UploadMeta = { name?: string; derivedFrom?: string | null; atSeconds?: number | null };
export type UploadState = {
  id: string;
  name: string;
  label: string;
  size: number;
  status: "preparing" | "queued" | "uploading" | "verifying" | "done" | "failed";
  progress: number;
  note?: string | undefined;
  error?: string | undefined;
  preview?: string | undefined;
  file?: PreparedFile | undefined;
  abort?: AbortController | undefined;
  derivedFrom: string | null;
  atSeconds: number | null;
  /** Timed marks the uploader drew on a local recording; saved right after it is attached. */
  marks?: VideoMark[] | undefined;
};
/** A queued file plus who added it and which bug it goes to (null while it waits in an unsent report form). */
export type QueuedUpload = UploadState & {
  owner: string;
  access: BugAccess;
  target: string | null;
  bugCode?: string | undefined;
};

export const uploadLabel = (u: UploadState) =>
  u.status === "preparing"
    ? (u.note ?? "Compressing…")
    : u.status === "queued"
      ? "Ready to upload"
      : u.status === "uploading"
        ? `Uploading ${Math.round(u.progress * 100)}%`
        : u.status === "verifying"
          ? "Verifying…"
          : u.status === "done"
            ? "Attached"
            : (u.error ?? "Failed");
const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || name;
const active = (u: UploadState) =>
  u.status === "preparing" || u.status === "uploading" || u.status === "verifying";

/**
 * Upload queue shared by the whole tab: compress in the browser → signed link → PUT straight to the bucket → server
 * verification. It lives outside React so closing a dialog never stops a compression or upload: once a report is
 * submitted its files carry on in the background and show in the upload tray until they are attached.
 */
let items: QueuedUpload[] = [];
const listeners = new Set<() => void>();
const mounted = new Set<string>();
let client: QueryClient | null = null;
function commit(next: QueuedUpload[]) {
  items = next;
  for (const l of listeners) l();
}
const find = (id: string) => items.find((u) => u.id === id);
const patch = (id: string, p: Partial<QueuedUpload>) =>
  commit(items.map((u) => (u.id === id ? { ...u, ...p } : u)));
function drop(id: string) {
  const u = find(id);
  u?.abort?.abort();
  if (u?.preview) URL.revokeObjectURL(u.preview);
  commit(items.filter((x) => x.id !== id));
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => items;
/** Background items: files headed to a bug whose form or panel is no longer on screen. */
export const isBackground = (u: QueuedUpload) => u.target !== null && !mounted.has(u.owner);

if (typeof window !== "undefined")
  window.addEventListener("beforeunload", (e) => {
    if (items.some(active)) e.preventDefault();
  });

async function send(id: string) {
  const u = find(id);
  if (!u?.file || !u.target) return false;
  const abort = new AbortController();
  patch(id, { status: "uploading", progress: 0, error: undefined, abort });
  const background = () => isBackground(find(id) ?? u);
  try {
    const thumb = u.file.thumb;
    const { uploadUrl, headers, thumbUrl } = await prepareMediaUpload({
      data: {
        access: u.access,
        upload: {
          bugId: u.target,
          id,
          name: u.label.trim() || u.file.name,
          contentType: u.file.contentType,
          size: u.file.size,
          derivedFrom: u.derivedFrom,
          atSeconds: u.atSeconds,
          thumbSize: thumb?.size ?? null,
        },
      },
    });
    await uploadPut(
      uploadUrl,
      headers,
      u.file.blob,
      (f) => patch(id, { progress: f }),
      abort.signal,
    );
    // The preview is small and optional: if it fails the file is still attached, just without a poster.
    const thumbSent =
      !!thumb &&
      !!thumbUrl &&
      (await uploadPut(
        thumbUrl,
        { "Content-Type": "image/jpeg", "If-None-Match": "*" },
        thumb,
        () => {},
      ).then(
        () => true,
        () => false,
      ));
    patch(id, { status: "verifying", progress: 1 });
    await finishMediaUpload({
      data: {
        access: u.access,
        upload: { id, width: u.file.width, height: u.file.height, thumb: thumbSent },
      },
    });
    // Timed marks drawn on the local recording before upload are saved with it.
    const marks = find(id)?.marks ?? [];
    if (marks.length)
      await saveVideoMarks({ data: { access: u.access, media: { id, version: 0, marks } } }).catch(
        (e: unknown) =>
          toast.error(`The marks on ${u.label} could not be saved`, {
            description: actionError(e, "The recording was attached without them."),
          }),
      );
    patch(id, { status: "done" });
    if (background())
      toast.success(`Attached to ${u.bugCode ?? "the bug"}`, { description: u.label });
    await Promise.all([
      client?.invalidateQueries({ queryKey: ["bug-detail"] }),
      client?.invalidateQueries({ queryKey: ["bug-workspace"] }),
      client?.invalidateQueries({ queryKey: ["media-library"] }),
    ]);
    window.setTimeout(() => drop(id), 1500);
    return true;
  } catch (e) {
    if (!find(id)) return false; // cancelled and removed
    const error = actionError(e, "The upload failed.");
    patch(id, { status: "failed", error });
    if (background())
      toast.error(`${u.label} was not attached to ${u.bugCode ?? "the bug"}`, {
        description: `${error} Retry it from the uploads tray.`,
      });
    return false;
  }
}

async function add(
  owner: string,
  access: BugAccess,
  target: string | null,
  files: File[],
  meta: UploadMeta = {},
) {
  for (const f of files) {
    const id = crypto.randomUUID();
    const abort = new AbortController();
    commit([
      ...items,
      {
        id,
        owner,
        access,
        target,
        name: f.name,
        label: meta.name ?? baseName(f.name),
        size: f.size,
        status: "preparing",
        progress: 0,
        preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
        derivedFrom: meta.derivedFrom ?? null,
        atSeconds: meta.atSeconds ?? null,
        abort,
      },
    ]);
    const r = await prepareFile(f, {
      onProgress: (fraction, done, total) =>
        patch(id, {
          progress: fraction,
          note: `Compressing ${clock(done)} of ${clock(total)} · keep this tab open`,
        }),
      signal: abort.signal,
    });
    if (!find(id)) continue; // removed while compressing
    if (!r.ok) {
      patch(id, { status: "failed", error: r.error });
      continue;
    }
    patch(id, {
      name: r.file.name,
      size: r.file.size,
      status: "queued",
      file: r.file,
      note: f.size > r.file.size * 1.5 ? `Compressed from ${formatBytes(f.size)}` : undefined,
      progress: 0,
    });
    // The bug may have been submitted while this file was compressing: it goes up as soon as it is ready.
    if (find(id)?.target) void send(id);
  }
}

/**
 * Hands a submitted report's files to the background: ready ones upload one after another, files still
 * compressing follow as soon as they finish. Returns how many files were handed over.
 */
function handoff(owner: string, target: string, bugCode: string) {
  const mine = items.filter((u) => u.owner === owner && u.target === null && u.status !== "done");
  commit(items.map((u) => (mine.includes(u) ? { ...u, target, bugCode } : u)));
  void (async () => {
    for (const u of mine)
      if (find(u.id)?.status === "queued" || find(u.id)?.status === "failed") await send(u.id);
  })();
  return mine.length;
}

/** Swaps a queued file for its marked-up version (drawn on the local image before upload). */
export async function replaceUploadFile(id: string, file: File) {
  const u = find(id);
  if (!u || u.status !== "queued") return;
  patch(id, { status: "preparing", progress: 0, note: "Preparing the marked-up image…" });
  const r = await prepareFile(file);
  if (!find(id)) return;
  if (!r.ok) {
    patch(id, { status: "queued", note: undefined });
    toast.error(r.error);
    return;
  }
  if (u.preview) URL.revokeObjectURL(u.preview);
  patch(id, {
    status: "queued",
    file: r.file,
    name: r.file.name,
    size: r.file.size,
    note: "Marked up",
    preview: URL.createObjectURL(r.file.blob),
  });
  if (find(id)?.target) void send(id);
}
/** Stores timed marks drawn on a queued recording. */
export function setUploadMarks(id: string, marks: VideoMark[]) {
  if (find(id))
    patch(id, {
      marks,
      note: marks.length
        ? `${marks.length} timed ${marks.length === 1 ? "mark" : "marks"}`
        : undefined,
    });
}
/** Uploads files straight to a bug in the background (e.g. a marked-up copy saved from My media). */
export function uploadToBug(
  access: BugAccess,
  bugId: string,
  bugCode: string,
  files: File[],
  meta?: UploadMeta,
) {
  const owner = `library:${crypto.randomUUID()}`;
  const before = new Set(items.map((u) => u.id));
  const work = add(owner, access, bugId, files, meta);
  commit(items.map((u) => (!before.has(u.id) && u.owner === owner ? { ...u, bugCode } : u)));
  return work;
}
export function retryUpload(id: string) {
  const u = find(id);
  if (u?.target) void send(id);
  else if (u) patch(id, { status: "queued", error: undefined });
}
export const removeUpload = drop;

/** One form or attachments panel's view of the queue. Unsent files are discarded when it closes; sent ones carry on. */
export function useMediaUpload(access: BugAccess, bugId: string | null) {
  const queryClient = useQueryClient();
  client = queryClient;
  const [owner] = useState(() => crypto.randomUUID());
  useEffect(() => {
    mounted.add(owner);
    commit([...items]);
    return () => {
      mounted.delete(owner);
      for (const u of items) if (u.owner === owner && u.target === null) drop(u.id);
      commit([...items]);
    };
  }, [owner]);
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const uploads = all.filter((u) => u.owner === owner);
  return {
    uploads,
    add: (files: File[], meta?: UploadMeta) => add(owner, access, bugId, files, meta),
    handoff: (target: string, code: string) => handoff(owner, target, code),
    retry: retryUpload,
    remove: removeUpload,
    setLabel: (id: string, value: string) => patch(id, { label: value.slice(0, MEDIA_NAME_MAX) }),
    busy: uploads.some(active),
    compressing: uploads.filter((u) => u.status === "preparing").length,
    staged: uploads.filter((u) => u.status !== "done").length,
  };
}

/** Everything uploading in the background, for the tray. */
export function useBackgroundUploads() {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return all.filter(isBackground);
}
