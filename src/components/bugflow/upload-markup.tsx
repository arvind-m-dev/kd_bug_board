import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { actionError } from "./action-feedback";
import { saveVideoMarks } from "@/lib/bug-media.functions";
import type { LibraryItem } from "@/lib/bug-media";
import type { BugAccess } from "@/lib/bug-workflow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AnnotationEditor, loadImage, type AnnotationSource } from "./media-annotate";
import { VideoPlayer } from "./video-marks";
import { replaceUploadFile, setUploadMarks, uploadToBug, type UploadState } from "./media-queue";

/**
 * Mark-up happens only here: on the uploader's own local file, while it waits in the upload queue. Images are drawn
 * on and replaced by the marked-up version; recordings get timed marks that are saved with them once attached.
 * After upload every file is view-only for everyone.
 */
export function UploadMarkup({ upload, onClose }: { upload: UploadState; onClose: () => void }) {
  const file = upload.file;
  const [url] = useState(() => (file ? URL.createObjectURL(file.blob) : ""));
  const [source, setSource] = useState<AnnotationSource | null>(null);
  const isImage = !!file?.contentType.startsWith("image/");
  const dirty = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    if (!isImage || !url) return;
    loadImage(url).then(
      (img) => setSource({ image: img, width: img.naturalWidth, height: img.naturalHeight }),
      () => {
        toast.error("This image could not be opened for drawing.");
        close.current();
      },
    );
  }, [isImage, url]);
  if (!file) return null;
  const label = upload.label.trim() || upload.name;
  if (isImage)
    return source ? (
      <AnnotationEditor
        source={source}
        defaultName={label}
        caption={label}
        description="Draw boxes, arrows, lines and text on your screenshot before it is uploaded. The marked-up image is what gets attached."
        saveLabel="Use marked-up image"
        showName={false}
        onSave={async (f) => {
          await replaceUploadFile(upload.id, f);
          onClose();
        }}
        onClose={onClose}
      />
    ) : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && (!dirty.current || window.confirm("Discard the marks you have not saved?")))
          onClose();
      }}
    >
      <DialogContent className="bf-lightbox bf-markup-dialog max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate">Mark up {label}</DialogTitle>
          <DialogDescription>
            Pause where you want to point something out and draw. Play on, pause again and hide
            marks from there. The marks are saved with the recording when it is uploaded.
          </DialogDescription>
        </DialogHeader>
        <VideoPlayer
          onState={(st) => {
            dirty.current = st.dirty;
          }}
          src={url}
          initialMarks={upload.marks ?? []}
          edit={{
            onDone: (marks) => {
              setUploadMarks(upload.id, marks);
              toast.success(
                marks.length
                  ? `${marks.length} timed ${marks.length === 1 ? "mark" : "marks"} added`
                  : "No marks on this recording",
              );
              onClose();
            },
            onCancel: onClose,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The uploader marks up one of their own files from My media. A recording's timed marks are saved onto it (the server
 * accepts only the uploader, with a version check); an image gets a marked-up copy next to it, the original unchanged.
 */
export function SavedMediaMarkup({
  item,
  access,
  onClose,
}: {
  item: LibraryItem;
  access: BugAccess;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const save = useServerFn(saveVideoMarks);
  const [source, setSource] = useState<AnnotationSource | null>(null);
  const [local, setLocal] = useState("");
  const dirty = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  // Keyed on the file, not the list row: the list refreshes in the background while the editor is open.
  const kind = item.kind,
    src = item.url;
  useEffect(() => {
    if (kind !== "image" || !src) return;
    let url = "";
    // Read the picture as a local copy so the canvas can export it.
    // no-store: the list may have cached this same link without CORS headers, which would block the read.
    fetch(src, { cache: "no-store", mode: "cors" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setLocal(url);
        return loadImage(url);
      })
      .then((img) => setSource({ image: img, width: img.naturalWidth, height: img.naturalHeight }))
      .catch(() => {
        toast.error("This image could not be opened for drawing.", {
          description: "Check that the bucket's CORS rule allows GET from this address.",
        });
        close.current();
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [kind, src]);
  const refresh = () =>
    Promise.all(
      ["media-library", "bug-detail", "bug-workspace"].map((k) =>
        client.invalidateQueries({ queryKey: [k] }),
      ),
    );
  if (item.kind === "image")
    return source && local ? (
      <AnnotationEditor
        source={source}
        defaultName={`${item.name} (marked up)`}
        caption={item.name}
        description="Draw boxes, arrows, lines and text. Saving attaches a marked-up copy next to the original on the same bug; the original is never changed."
        saveLabel="Save marked-up copy"
        onSave={async (file, name) => {
          void uploadToBug(access, item.bugId, item.bugCode, [file], {
            name,
            derivedFrom: item.id,
          }).then(refresh);
          toast.success("Marked-up copy is uploading", {
            description: `It appears next to ${item.name} on ${item.bugCode} in a moment.`,
          });
          onClose();
        }}
        onClose={onClose}
      />
    ) : null;
  if (item.kind !== "video" || !item.url) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && (!dirty.current || window.confirm("Discard the marks you have not saved?")))
          onClose();
      }}
    >
      <DialogContent className="bf-lightbox bf-markup-dialog max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate">Mark up {item.name}</DialogTitle>
          <DialogDescription>
            Pause where you want to point something out and draw. Play on, pause again and hide
            marks from there. Everyone who opens the recording sees the marks while it plays.
          </DialogDescription>
        </DialogHeader>
        <VideoPlayer
          onState={(st) => {
            dirty.current = st.dirty;
          }}
          src={item.url}
          poster={item.thumbUrl}
          initialMarks={item.marks}
          edit={{
            onDone: (marks) => {
              void save({
                data: { access, media: { id: item.id, version: item.marksVersion, marks } },
              })
                .then(async () => {
                  await refresh();
                  toast.success("Marks saved", {
                    description: `${marks.length} timed ${marks.length === 1 ? "mark" : "marks"} on ${item.name}.`,
                  });
                  onClose();
                })
                .catch((e: unknown) =>
                  toast.error(actionError(e, "The marks could not be saved.")),
                );
            },
            onCancel: onClose,
            doneLabel: "Save marks",
            note: "everyone who opens the recording sees them",
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
