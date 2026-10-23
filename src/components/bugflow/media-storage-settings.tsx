import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BookOpen,
  BrushCleaning,
  ChevronDown,
  Cloud,
  HardDrive,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Save,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getMediaStatus, saveMediaCleanup, saveMediaStorage } from "@/lib/bug-media.functions";
import {
  CLEANUP_CHOICES,
  STORAGE_PROVIDERS,
  formatBytes,
  mediaStorageSchema,
  type CleanupDays,
  type MediaSource,
  type MediaStatus,
} from "@/lib/bug-media";
import { ConfirmAction, ErrorNotice, actionError } from "./action-feedback";
import { StorageUsage } from "./storage-usage";

const VARS = [
  "MEDIA_S3_ENDPOINT",
  "MEDIA_S3_BUCKET",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
];
const FREE_TIER = 10 * 1024 * 1024 * 1024;
type Form = {
  provider: string;
  endpoint: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};
const fromStatus = (s: MediaStatus | undefined): Form => {
  const c = s?.custom;
  const p = c
    ? STORAGE_PROVIDERS.find((x) =>
        c.endpoint.includes("r2.cloudflarestorage")
          ? x.id === "r2"
          : c.endpoint.includes("backblazeb2")
            ? x.id === "b2"
            : c.endpoint.includes("amazonaws")
              ? x.id === "s3"
              : x.id === "other",
      )!
    : STORAGE_PROVIDERS[0];
  return {
    provider: p.id,
    endpoint: c?.endpoint ?? "",
    bucket: c?.bucket ?? "",
    region: c?.region ?? p.region,
    forcePathStyle: c?.forcePathStyle ?? p.forcePathStyle,
    accessKeyId: "",
    secretAccessKey: "",
  };
};

/**
 * Settings → Connected services → Media storage. Three honest states (not connected, configured but untested, connected/unreachable),
 * a choice between the default bucket from the environment and Admin's own bucket entered here, a real round trip on request, and the setup guide.
 */
export function MediaStorageCard() {
  const client = useQueryClient();
  const read = useServerFn(getMediaStatus);
  const save = useServerFn(saveMediaStorage);
  const saveCleanup = useServerFn(saveMediaCleanup);
  const [confirmNow, setConfirmNow] = useState(false);
  const cleanup = useMutation({
    mutationFn: (data: { cleanupDays: CleanupDays } | { now: true }) => saveCleanup({ data }),
    onSuccess: (r, v) => {
      client.setQueryData(["media-status"], r);
      void client.invalidateQueries({ queryKey: ["bug-detail"] });
      toast.success(
        "now" in v
          ? "Files on closed bugs removed"
          : r.cleanupDays
            ? `Files are removed ${r.cleanupDays} days after a bug closes`
            : "Automatic clean-up is off",
      );
    },
    onError: (e) => toast.error(actionError(e, "The clean-up setting could not be saved.")),
  });
  const q = useQuery({
    queryKey: ["media-status"],
    queryFn: () => read({ data: { test: false } }),
    staleTime: 60000,
    retry: false,
  });
  const test = useMutation({
    mutationFn: () => read({ data: { test: true } }),
    onSuccess: (r) => client.setQueryData(["media-status"], r),
  });
  const s = test.data ?? q.data;
  const [guide, setGuide] = useState(false);
  const [choice, setChoice] = useState<MediaSource>("default");
  const [form, setForm] = useState<Form>(fromStatus(undefined));
  const [touched, setTouched] = useState(false);
  // Nothing set up anywhere → open on the own-bucket form, so the input boxes are the first thing Admin sees.
  useEffect(() => {
    if (q.data && !touched) {
      setChoice(q.data.source === "default" && q.data.defaultAvailable ? "default" : "custom");
      setForm(fromStatus(q.data));
    }
  }, [q.data, touched]);
  const storage = useMutation({
    mutationFn: (data: z.infer<typeof mediaStorageSchema>) => save({ data }),
    onSuccess: (r) => {
      client.setQueryData(["media-status"], r);
      void client.invalidateQueries({ queryKey: ["bug-workspace"] });
      setTouched(false);
      setForm((f) => ({ ...f, secretAccessKey: "" }));
      toast[r.test?.ok ? "success" : "warning"](
        r.test?.ok ? "Storage saved and connected" : "Storage saved, but the test failed",
        { description: r.test?.message },
      );
    },
    onError: (e) => toast.error(actionError(e, "The storage settings could not be saved.")),
  });
  const origin =
    typeof window === "undefined" ? "https://your-app.vercel.app" : window.location.origin;
  const state = !s
    ? "loading"
    : !s.configured
      ? "off"
      : s.test?.ok
        ? "ok"
        : s.test
          ? "bad"
          : "untested";
  const tag =
    state === "loading"
      ? "…"
      : state === "off"
        ? "Not connected"
        : state === "ok"
          ? "Connected"
          : state === "bad"
            ? "Not reachable"
            : "Configured · not tested";
  const tone =
    state === "ok"
      ? "text-success"
      : state === "bad"
        ? "text-destructive"
        : state === "untested"
          ? "text-warning"
          : "";
  const showGuide = guide || state === "off";
  const set = (patch: Partial<Form>) => {
    setTouched(true);
    setForm((f) => ({ ...f, ...patch }));
  };
  const pickProvider = (id: string) => {
    const p = STORAGE_PROVIDERS.find((x) => x.id === id)!;
    set({
      provider: id,
      region: p.region,
      forcePathStyle: p.forcePathStyle,
      endpoint: form.endpoint && form.provider === id ? form.endpoint : "",
    });
  };
  const provider = STORAGE_PROVIDERS.find((x) => x.id === form.provider) ?? STORAGE_PROVIDERS[0];
  const customDirty = choice === "custom" && (touched || s?.source !== "custom");
  const parsed =
    choice === "custom"
      ? mediaStorageSchema.safeParse({
          source: "custom",
          endpoint: form.endpoint,
          bucket: form.bucket,
          region: form.region,
          forcePathStyle: form.forcePathStyle,
          accessKeyId: form.accessKeyId,
          secretAccessKey: form.secretAccessKey,
        })
      : null;
  const needsSecret =
    choice === "custom" && !form.secretAccessKey && (!s?.custom || !!form.accessKeyId);
  const sourceLabel =
    s?.source === "custom"
      ? `the workspace bucket (${s.custom?.bucket ?? ""})`
      : s?.source === "default"
        ? "the hosting bucket"
        : "";
  return (
    <>
      <div className="bf-setting-row">
        <span className="bf-stat-icon bf-tone-info">
          <Upload size={19} />
        </span>
        <div>
          <h3>Media storage</h3>
          <p>
            Private screenshots, recordings and PDFs on a bug, in an S3-compatible bucket. The
            bucket you enter here is the workspace default: every portal uploads to it. Cloudflare
            R2 free tier recommended (10 GB, no egress fees).
            <br />
            {state === "off" &&
              "Uploads are hidden until a bucket is connected. Drive links keep working."}
            {state === "untested" &&
              `Using ${sourceLabel}: ${s!.provider} at ${s!.endpointHost}. Uploads are on — run Test connection to confirm the bucket answers.`}
            {state === "ok" && `Using ${sourceLabel}: ${s!.provider} · ${s!.test!.message}`}
            {state === "bad" &&
              `Using ${sourceLabel}: ${s!.provider} · ${s!.test!.message} Uploads will fail until this is fixed.`}
            {s && s.configured && (
              <>
                {" "}
                {s.files} {s.files === 1 ? "file" : "files"} · {formatBytes(s.bytes)}
                {s.provider === "Cloudflare R2" && ` of the ${formatBytes(FREE_TIER)} R2 free tier`}
                {s.pending > 0 && ` · ${s.pending} uploading`}
                {s.awaitingPurge > 0 && ` · ${s.awaitingPurge} awaiting purge`}
              </>
            )}
          </p>
        </div>
        <span className={`bf-tag ${tone}`}>{tag}</span>
      </div>
      {q.isError && (
        <ErrorNotice
          message={actionError(q.error, "Media storage status could not be read.")}
          onRetry={() => {
            void q.refetch();
          }}
          retrying={q.isFetching}
        />
      )}
      {s && (
        <div className="bf-media-guide">
          <div className="bf-storage-choice" role="radiogroup" aria-label="Where files are stored">
            <button
              type="button"
              role="radio"
              aria-checked={choice === "custom"}
              onClick={() => {
                setTouched(true);
                setChoice("custom");
              }}
            >
              <HardDrive size={18} />
              <span>
                <strong>Workspace bucket</strong>
                <small>
                  {s.custom
                    ? `Saved: ${s.custom.bucket} (key ${s.custom.accessKeyIdHint}). The default for every portal.`
                    : "The Admin panel’s bucket: create one, paste the endpoint and an API key here, and every portal uses it. Secrets are stored encrypted."}
                </small>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={choice === "default"}
              disabled={!s.defaultAvailable}
              onClick={() => {
                setTouched(true);
                setChoice("default");
              }}
            >
              <Cloud size={18} />
              <span>
                <strong>Hosting bucket</strong>
                <small>
                  {s.defaultAvailable
                    ? "Set by whoever hosts this app through environment variables. A fallback when no workspace bucket is saved."
                    : "Not provided by the host (would need the four MEDIA_S3_* variables). Use the workspace bucket."}
                </small>
              </span>
            </button>
            <div className="bf-storage-soon" aria-disabled="true">
              <KeyRound size={18} />
              <span>
                <strong>Google Drive</strong>
                <small>
                  Coming later: connect a Drive folder in two steps. Drive links on a bug already
                  work today.
                </small>
              </span>
            </div>
          </div>
          {choice === "custom" && (
            <form
              className="bf-storage-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (parsed?.success) storage.mutate(parsed.data);
                else toast.error(parsed?.error.issues[0]?.message ?? "Check the bucket details.");
              }}
            >
              {!s.canStoreSecrets && (
                <ErrorNotice message="Set BUGFLOW_PORTAL_ENCRYPTION_KEY in the environment first; the secret key is stored encrypted with it." />
              )}
              <label>
                <span>Provider</span>
                <div className="bf-mode" role="radiogroup" aria-label="Provider">
                  {STORAGE_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={form.provider === p.id}
                      onClick={() => pickProvider(p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <small>{provider.note}</small>
              </label>
              <label>
                <span>S3 endpoint</span>
                <input
                  className="bf-input"
                  value={form.endpoint}
                  placeholder={provider.endpoint}
                  spellCheck={false}
                  onChange={(e) => set({ endpoint: e.target.value })}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span>Bucket name</span>
                  <input
                    className="bf-input"
                    value={form.bucket}
                    placeholder="bugboard-media"
                    spellCheck={false}
                    onChange={(e) => set({ bucket: e.target.value.toLowerCase() })}
                  />
                </label>
                <label>
                  <span>Region</span>
                  <input
                    className="bf-input"
                    value={form.region}
                    placeholder={provider.region || "auto"}
                    spellCheck={false}
                    onChange={(e) => set({ region: e.target.value })}
                  />
                </label>
                <label>
                  <span>Access key ID</span>
                  <input
                    className="bf-input"
                    value={form.accessKeyId}
                    placeholder={
                      s.custom
                        ? `Saved · ${s.custom.accessKeyIdHint} (leave blank to keep)`
                        : "From the API token"
                    }
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => set({ accessKeyId: e.target.value })}
                  />
                </label>
                <label>
                  <span>Secret access key</span>
                  <input
                    className="bf-input"
                    type="password"
                    value={form.secretAccessKey}
                    placeholder={
                      s.custom && !form.accessKeyId
                        ? "Saved · leave blank to keep"
                        : "Shown once when the token is created"
                    }
                    autoComplete="new-password"
                    onChange={(e) => set({ secretAccessKey: e.target.value })}
                  />
                </label>
              </div>
              <label className="bf-switch-row">
                <span className="text-sm">
                  Path-style addressing{" "}
                  <small className="block text-xs text-muted-foreground">
                    On for R2, B2 and most others; off for Amazon S3.
                  </small>
                </span>
                <Switch
                  checked={form.forcePathStyle}
                  onCheckedChange={(v) => set({ forcePathStyle: v })}
                  aria-label="Path-style addressing"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={storage.isPending || !s.canStoreSecrets || !customDirty || needsSecret}
                >
                  {storage.isPending ? <LoaderCircle className="animate-spin" /> : <Save />}Save
                  &amp; test workspace bucket
                </Button>
                <span className="text-xs text-muted-foreground">
                  Saving runs the connection test straight away and switches every portal to this
                  bucket. The secret never leaves the server.
                </span>
              </div>
            </form>
          )}
          {choice === "default" && touched && s.source !== "default" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={storage.isPending}
                onClick={() => storage.mutate({ source: "default" })}
              >
                {storage.isPending ? <LoaderCircle className="animate-spin" /> : <Save />}Use the
                hosting bucket
              </Button>
              <span className="text-xs text-muted-foreground">
                The workspace bucket details stay saved in case you switch back.
              </span>
            </div>
          )}
          {!s.configured &&
            s.source !== "custom" &&
            !s.defaultAvailable &&
            choice === "default" && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  The hosting bucket needs these environment variables from the host:
                </p>
                <div className="bf-media-missing">
                  {s.missing.map((v) => (
                    <code key={v}>{v}</code>
                  ))}
                </div>
              </div>
            )}
          {s.configured && <StorageUsage />}
          {s.configured && (
            <div className="bf-storage-form" aria-label="Clean-up">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 text-sm font-semibold">
                  <BrushCleaning size={15} />
                  Clean-up
                </span>
                <span className="text-xs text-muted-foreground">
                  Remove every file from a bug once it has been resolved, a duplicate, not a bug or
                  won't-fix for
                </span>
                <div className="bf-mode" role="radiogroup" aria-label="Days after closing">
                  {CLEANUP_CHOICES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={s.cleanupDays === d}
                      disabled={cleanup.isPending}
                      onClick={() => cleanup.mutate({ cleanupDays: d })}
                    >
                      {d === 0 ? "Never" : `${d} days`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {s.closedFiles > 0 ? (
                  <>
                    {s.closedFiles} {s.closedFiles === 1 ? "file" : "files"} ·{" "}
                    {formatBytes(s.closedBytes)} sit on closed bugs right now.
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={cleanup.isPending}
                      onClick={() => setConfirmNow(true)}
                    >
                      {cleanup.isPending ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <BrushCleaning />
                      )}
                      Remove them now
                    </Button>
                  </>
                ) : (
                  "No files on closed bugs right now."
                )}{" "}
                Each removal is audited on the bug; reopening a bug does not bring files back.
              </div>
            </div>
          )}
          <ConfirmAction
            open={confirmNow}
            onOpenChange={setConfirmNow}
            destructive
            title={`Remove ${s.closedFiles} ${s.closedFiles === 1 ? "file" : "files"} from closed bugs?`}
            description={`${formatBytes(s.closedBytes)} is freed. The files are deleted from storage for everyone; each bug gets an audit entry with your name, date and time.`}
            confirmLabel="Remove files"
            onConfirm={async () => {
              await cleanup.mutateAsync({ now: true });
              setConfirmNow(false);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {s.configured && (
              <Button
                size="sm"
                variant="outline"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? <LoaderCircle className="animate-spin" /> : <PlugZap />}
                {s.awaitingPurge > 0 ? "Test connection & purge" : "Test connection"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setGuide((g) => !g)}>
              <BookOpen />
              Setup guide
              <ChevronDown className={showGuide ? "rotate-180" : ""} />
            </Button>
            {test.isError && (
              <span className="text-xs text-destructive">
                {actionError(test.error, "The test could not run.")}
              </span>
            )}
          </div>
          {showGuide && (
            <ol>
              <li>
                <strong>Create a private bucket</strong> in Cloudflare → R2 Object Storage → Create
                bucket (for example <code>bugboard-media</code>). Leave public access off; never use
                an r2.dev domain.
              </li>
              <li>
                <strong>Create an API token</strong> under R2 → Manage R2 API Tokens: permission{" "}
                <em>Object Read &amp; Write</em>, scoped to that bucket. Copy the Access Key ID, the
                Secret Access Key and the S3 endpoint{" "}
                <code>https://&lt;ACCOUNT_ID&gt;.r2.cloudflarestorage.com</code>.
              </li>
              <li>
                <strong>Connect it</strong>: under <em>Workspace bucket</em> above, paste the three
                values and press <em>Save &amp; test</em>. It becomes the default for every portal.
                Hosts can instead set{" "}
                {VARS.map((v, i) => (
                  <span key={v}>
                    {i > 0 && ", "}
                    <code>{v}</code>
                  </span>
                ))}{" "}
                in the environment as a hosting fallback. Backblaze B2 or AWS S3 work the same way
                (set the region).
              </li>
              <li>
                <strong>Allow the browser to upload and read</strong>: bucket → Settings → CORS
                policy, add this rule (uploads go straight from the browser to the bucket; GET lets
                screenshots and recordings be marked up):
                <pre>
                  {JSON.stringify(
                    [
                      {
                        AllowedOrigins: [origin],
                        AllowedMethods: ["PUT", "GET"],
                        AllowedHeaders: ["content-type", "if-none-match"],
                        ExposeHeaders: ["ETag"],
                        MaxAgeSeconds: 3600,
                      },
                    ],
                    null,
                    2,
                  )}
                </pre>
              </li>
              <li>
                <strong>Try it</strong>: attach a screenshot to any bug. Files stay private: every
                view uses a 10-minute signed link minted after the usual bug permission check. What
                members see, with a picture, is under Help &amp; support (sidebar) → Attachments
                &amp; media.
              </li>
            </ol>
          )}
        </div>
      )}
    </>
  );
}
