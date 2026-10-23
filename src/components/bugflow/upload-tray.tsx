import { useState } from "react";
import { ChevronDown, ChevronUp, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { removeUpload, retryUpload, uploadLabel, useBackgroundUploads } from "./media-queue";

/**
 * Floating tray for files still compressing or uploading after their report was submitted or their panel closed.
 * People keep working while it runs; it collapses to one line and disappears once everything is attached.
 */
export function UploadTray() {
  const items = useBackgroundUploads();
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const working = items.filter((u) => u.status !== "done" && u.status !== "failed").length;
  const failed = items.filter((u) => u.status === "failed").length;
  const overall =
    items.reduce((sum, u) => sum + (u.status === "done" ? 1 : u.progress), 0) / items.length;
  const title = working
    ? `Uploading ${working} ${working === 1 ? "file" : "files"}`
    : failed
      ? `${failed} ${failed === 1 ? "upload" : "uploads"} failed`
      : "All files attached";
  return (
    <section
      className="bf-upload-tray"
      aria-label="Background uploads"
      data-open={open || undefined}
    >
      <button
        type="button"
        className="bf-upload-tray-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {working ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />}
        <strong>{title}</strong>
        <span className="bf-upload-tray-pct">{working ? `${Math.round(overall * 100)}%` : ""}</span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {!open && working > 0 && <Progress value={overall * 100} className="h-1" />}
      {open && (
        <ul>
          {items.map((u) => (
            <li key={u.id} data-status={u.status}>
              <div className="bf-upload-tray-row">
                <span className="bf-upload-tray-name" title={u.label}>
                  {u.label}
                </span>
                {u.bugCode && <code>{u.bugCode}</code>}
                {u.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => retryUpload(u.id)}
                    aria-label={`Retry ${u.label}`}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                {u.status !== "done" && (
                  <button
                    type="button"
                    onClick={() => removeUpload(u.id)}
                    aria-label={u.status === "failed" ? `Dismiss ${u.label}` : `Cancel ${u.label}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <small>{uploadLabel(u)}</small>
              {u.status !== "failed" && u.status !== "done" && (
                <Progress value={u.progress * 100} className="h-1" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
