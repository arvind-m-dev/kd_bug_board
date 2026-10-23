import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorNotice, actionError } from "./action-feedback";
import { getMediaUsage, saveMediaQuota } from "@/lib/bug-media.functions";
import { formatBytes, type MediaUsage } from "@/lib/bug-media";
import { timeAgo } from "@/lib/format";

const SEGMENTS: {
  key: keyof Pick<MediaUsage, "images" | "videos" | "pdfs" | "previews" | "trash">;
  label: string;
  color: string;
}[] = [
  { key: "videos", label: "Recordings", color: "var(--chart-1, #6366f1)" },
  { key: "images", label: "Screenshots", color: "var(--chart-2, #22c55e)" },
  { key: "pdfs", label: "PDFs", color: "var(--chart-3, #f59e0b)" },
  { key: "previews", label: "Previews", color: "var(--chart-4, #06b6d4)" },
  { key: "trash", label: "In Trash", color: "var(--chart-5, #ef4444)" },
];

/**
 * Settings → Media storage → Usage: how much the bucket holds, how much is left under the limit, and what takes the
 * space. Used space is measured from the bucket itself; the limit is the R2 free plan's 10 GB unless Admin sets one.
 */
export function StorageUsage() {
  const client = useQueryClient();
  const read = useServerFn(getMediaUsage);
  const save = useServerFn(saveMediaQuota);
  const q = useQuery({
    queryKey: ["media-usage"],
    queryFn: () => read({ data: { refresh: false } }),
    staleTime: 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => read({ data: { refresh: true } }),
    onSuccess: (u) => client.setQueryData(["media-usage"], u),
    onError: (e) => toast.error(actionError(e, "Usage could not be measured.")),
  });
  const [editing, setEditing] = useState(false);
  const [gb, setGb] = useState("");
  const quota = useMutation({
    mutationFn: (value: number | null) => save({ data: { gb: value } }),
    onSuccess: (u) => {
      client.setQueryData(["media-usage"], u);
      setEditing(false);
      toast.success("Storage limit saved", {
        description: u.quotaBytes
          ? `Usage is measured against ${formatBytes(u.quotaBytes)}.`
          : "No limit set.",
      });
    },
    onError: (e) => toast.error(actionError(e, "The limit could not be saved.")),
  });
  const u = q.data;
  if (q.isError)
    return (
      <ErrorNotice
        message={actionError(q.error, "Usage could not be loaded.")}
        onRetry={() => void q.refetch()}
      />
    );
  if (!u)
    return (
      <div className="bf-storage-form" aria-busy="true">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" size={15} /> Measuring storage…
        </span>
      </div>
    );
  if (!u.configured) return null;
  const pct = u.quotaBytes ? Math.min(100, (u.usedBytes / u.quotaBytes) * 100) : null;
  const tone = pct === null ? "info" : pct >= 95 ? "danger" : pct >= 80 ? "warning" : "success";
  const scale = Math.max(u.quotaBytes ?? 0, u.usedBytes, 1);
  const parts = [
    ...SEGMENTS.map((s) => ({ ...s, bytes: u[s.key].bytes, files: u[s.key].files })),
    {
      key: "other",
      label: "Other objects",
      color: "var(--muted-foreground)",
      bytes: u.otherBytes,
      files: 0,
    },
  ].filter((p) => p.bytes > 0);
  return (
    <section className="bf-storage-form bf-usage" aria-label="Storage usage" data-tone={tone}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1 text-sm font-semibold">
          <Gauge size={15} />
          Storage usage
        </span>
        <span className="text-xs text-muted-foreground">
          {u.provider} · {u.bucket}
          {u.objects !== null && ` · ${u.objects.toLocaleString()} objects`} · measured{" "}
          {timeAgo(u.measuredAt)}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-xs"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Measure again
        </Button>
      </div>
      <div className="bf-usage-figures">
        <div>
          <strong>{formatBytes(u.usedBytes)}</strong>
          <small>used</small>
        </div>
        {u.remainingBytes !== null && (
          <div>
            <strong>{formatBytes(u.remainingBytes)}</strong>
            <small>remaining</small>
          </div>
        )}
        <div>
          <strong>{u.quotaBytes ? formatBytes(u.quotaBytes) : "No limit"}</strong>
          <small>
            {u.quotaIsDefault ? "R2 free plan" : "limit"}
            {pct !== null && ` · ${pct < 1 && pct > 0 ? "<1" : Math.round(pct)}% used`}
          </small>
        </div>
      </div>
      <div
        className="bf-usage-bar"
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={u.quotaBytes ?? u.usedBytes}
        aria-valuenow={u.usedBytes}
        aria-valuetext={`${formatBytes(u.usedBytes)} used${u.quotaBytes ? ` of ${formatBytes(u.quotaBytes)}` : ""}`}
      >
        {parts.map((p) => (
          <span
            key={p.key}
            style={{ width: `${Math.max(0.6, (p.bytes / scale) * 100)}%`, background: p.color }}
            title={`${p.label}: ${formatBytes(p.bytes)}`}
          />
        ))}
      </div>
      <ul className="bf-usage-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            {p.label}
            <span>
              {formatBytes(p.bytes)}
              {p.files ? ` · ${p.files.toLocaleString()} ${p.files === 1 ? "file" : "files"}` : ""}
            </span>
          </li>
        ))}
        {parts.length === 0 && <li className="text-muted-foreground">The bucket is empty.</li>}
      </ul>
      {pct !== null && pct >= 80 && (
        <p
          className="text-xs"
          style={{ color: pct >= 95 ? "var(--destructive)" : "var(--warning)" }}
        >
          {pct >= 95 ? "Storage is almost full." : "Storage is filling up."} Empty the Trash, turn
          on Clean-up below, or raise the limit if your plan allows.
        </p>
      )}
      {!u.measured && (
        <p className="text-xs text-muted-foreground">
          The bucket could not be listed{u.scanError ? ` (${u.scanError})` : ""}, so this counts
          only BugFlow's own files.
        </p>
      )}
      {u.truncated && (
        <p className="text-xs text-muted-foreground">
          Over 100,000 objects: the total is a lower bound.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(gb);
              if (!Number.isFinite(n) || n < 0.1) {
                toast.error("Enter the limit in GB, for example 10.");
                return;
              }
              quota.mutate(n);
            }}
          >
            <label className="inline-flex items-center gap-2">
              Limit
              <input
                className="bf-input h-8 w-24"
                inputMode="decimal"
                autoFocus
                value={gb}
                placeholder="10"
                aria-label="Storage limit in GB"
                onChange={(e) => setGb(e.target.value)}
              />
              GB
            </label>
            <Button type="submit" size="sm" disabled={quota.isPending}>
              {quota.isPending ? <LoaderCircle className="animate-spin" /> : <Save />}
              Save limit
            </Button>
            {!u.quotaIsDefault && u.quotaBytes !== null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={quota.isPending}
                onClick={() => quota.mutate(null)}
              >
                Use default
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <span>
              Providers do not report remaining space through the S3 API, so “remaining” is measured
              against this limit. Set it to your plan's storage.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                setGb(u.quotaBytes ? String(+(u.quotaBytes / 1024 ** 3).toFixed(2)) : "");
                setEditing(true);
              }}
            >
              Change limit
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
