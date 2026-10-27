import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Link2, X, LoaderCircle, ListChecks, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBug, editBug } from "@/lib/bug-workflow.functions";
import {
  PRIORITIES,
  priorityNames,
  reportSchema,
  editSchema,
  type BugAccess,
  type LiveBug,
  type DropdownOptions,
  DEFAULT_OPTIONS,
} from "@/lib/bug-workflow";
import { ErrorNotice, actionError } from "./action-feedback";
import { toast } from "sonner";
import { ThemedSelect } from "./themed-select";
import { MediaDropZone, useMediaUpload } from "./bug-media";
import { MEDIA_OFF, type MediaConfig } from "@/lib/bug-media";
export function BugReportForm({
  access,
  projects,
  onSaved,
  initial,
  options = DEFAULT_OPTIONS,
  media = MEDIA_OFF,
}: {
  options?: DropdownOptions;
  access: BugAccess;
  projects: { id: string; name: string }[];
  onSaved: (id: string) => void;
  initial?: LiveBug;
  media?: MediaConfig;
}) {
  const client = useQueryClient();
  const save = useServerFn(createBug);
  const saveEdit = useServerFn(editBug);
  const [requestId] = useState(() => crypto.randomUUID());
  // After reporting, priority and severity are Admin decisions; the server refuses other changes.
  const adminOnly = !!initial && access.kind !== "admin";
  const [error, setError] = useState("");
  const [links, setLinks] = useState<string[]>(
    initial?.evidenceUrls.length ? initial.evidenceUrls : [""],
  );
  // Files are compressed while the report is written. On submit they move to the tab's background queue, so the
  // report saves at once and the dialog closes while compression and upload carry on (see the uploads tray).
  const uploads = useMediaUpload(access, null);
  const edit = useMutation({
    mutationFn: saveEdit,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["bug-workspace"] }),
        client.invalidateQueries({ queryKey: ["bug-detail"] }),
      ]);
      toast.success(`Bug updated · ${initial?.code}`, {
        description: `${initial?.title} · ${initial?.priority} · ${initial?.severity}`,
      });
      onSaved(initial?.id ?? "");
    },
    onError: (e) => setError(actionError(e, "Your changes could not be saved. Please try again.")),
  });
  const mutation = useMutation({
    mutationFn: save,
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ["bug-workspace"] });
      const files = uploads.staged ? uploads.handoff(r.id, r.code) : 0;
      toast.success(`Bug reported · ${r.code}`, {
        description: files
          ? `${files} ${files === 1 ? "file is" : "files are"} uploading in the background (tray at the bottom left). You can raise the next bug now; keep this tab open.`
          : "Saved with the title, priority and details you entered. The bug summary is open now.",
      });
      onSaved(r.id);
    },
    onError: (e) => setError(actionError(e, "The report could not be saved. Please try again.")),
  });
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const read = (key: string) => String(f.get(key) ?? "");
    const parsed = reportSchema.safeParse({
      requestId,
      projectId: initial ? initial.projectId : read("projectId"),
      title: read("title"),
      module: read("module"),
      priority: read("priority"),
      severity: read("severity"),
      description: read("description"),
      steps: read("steps")
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
      expected: read("expected"),
      actual: read("actual"),
      browserDevice: read("browserDevice"),
      environment: read("environment"),
      evidenceUrls: links.map((v) => v.trim()).filter(Boolean),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the report details.");
      return;
    }
    if (initial) {
      const { requestId: _r, projectId: _p, ...rest } = parsed.data;
      const ok = editSchema.safeParse({ ...rest, id: initial.id, version: initial.version });
      if (!ok.success) {
        setError(ok.error.issues[0]?.message ?? "Check the details.");
        return;
      }
      edit.mutate({ data: { access, edit: ok.data } });
      return;
    }
    mutation.mutate({ data: { access, report: parsed.data } });
  }
  const busy = mutation.isPending || edit.isPending;
  return (
    <form className="bf-form" onSubmit={submit}>
      <fieldset disabled={busy} className="grid gap-4">
        <section className="bf-form-step" data-tone="teal">
          <h3 className="bf-form-step-title">
            <span className="bf-step-num">1</span>The bug report
            <span className="bf-step-hint">What went wrong and how to see it</span>
          </h3>
          <label className="bf-field">
            Bug description <span className="bf-req">Required</span>
            <textarea
              name="description"
              defaultValue={initial?.description}
              required
              maxLength={8000}
              placeholder="What happened? Include the error or unexpected behaviour."
            />
          </label>
          <label className="bf-field">
            <span className="flex items-center gap-2">
              <ListChecks size={15} />
              Steps to replicate <span className="bf-req">Required</span>
            </span>
            <textarea
              name="steps"
              defaultValue={initial?.steps.join("\n")}
              required
              maxLength={12000}
              placeholder={"Open the page\nPerform the action\nObserve the issue"}
            />
          </label>
          <label className="bf-field">
            Bug title <span className="bf-opt">Optional</span>
            <Input
              name="title"
              defaultValue={initial?.title}
              maxLength={180}
              placeholder="Use description as title if left blank"
            />
          </label>
        </section>
        <section className="bf-form-step" data-tone="violet">
          <h3 className="bf-form-step-title">
            <span className="bf-step-num">2</span>Details<span className="bf-opt">Optional</span>
            <span className="bf-step-hint">Where, how urgent and how bad</span>
          </h3>
          <div className="bf-form-grid">
            {initial ? null : projects.length === 1 ? (
              <input type="hidden" name="projectId" value={projects[0]?.id ?? ""} />
            ) : (
              <label className="bf-field">
                Project
                <select name="projectId" aria-label="Project" className="bf-select" required>
                  <option value="">Choose project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="bf-field">
              Module or page
              <OptionField
                name="module"
                list={options.modules}
                value={initial?.module}
                placeholder="e.g. Sign in"
              />
            </label>
          </div>
          <div className="bf-form-grid">
            <label className="bf-field">
              Priority
              <FormSelect
                name="priority"
                label="Priority"
                initial={initial?.priority ?? "P3"}
                disabled={adminOnly}
                options={PRIORITIES.map((p) => ({ value: p, label: `${p} · ${priorityNames[p]}` }))}
              />
            </label>
            <label className="bf-field">
              Severity
              <FormSelect
                name="severity"
                label="Severity"
                initial={initial?.severity ?? "Medium"}
                disabled={adminOnly}
                options={[
                  ...new Set([...(initial ? [initial.severity] : []), ...options.severities]),
                ].map((s) => ({ value: s, label: s }))}
              />
            </label>
          </div>
          <div className="bf-form-grid">
            <label className="bf-field">
              Expected result
              <textarea
                name="expected"
                defaultValue={initial?.expected}
                maxLength={4000}
                placeholder="What should have happened?"
              />
            </label>
            <label className="bf-field">
              Actual result
              <textarea
                name="actual"
                defaultValue={initial?.actual}
                maxLength={4000}
                placeholder="Uses the description if left blank"
              />
            </label>
          </div>
          <div className="bf-form-grid">
            <label className="bf-field">
              Browser / device
              <OptionField
                name="browserDevice"
                list={options.devices}
                value={initial?.browserDevice}
                placeholder="e.g. Chrome · Desktop"
              />
            </label>
            <label className="bf-field">
              Environment
              <OptionField
                name="environment"
                list={options.environments}
                value={initial?.environment}
                placeholder="e.g. Staging"
              />
            </label>
          </div>
        </section>
        <section className="bf-form-step" data-tone="info">
          <h3 className="bf-form-step-title">
            <span className="bf-step-num">3</span>Evidence<span className="bf-opt">Optional</span>
            <span className="bf-step-hint">
              {media.enabled
                ? "Attach files directly, or share Google Drive links"
                : "Screenshots or recordings on Google Drive"}
            </span>
          </h3>
          <fieldset className="grid gap-2">
            {links.map((link, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  type="url"
                  aria-label={`Drive evidence URL ${i + 1}`}
                  placeholder="https://drive.google.com/…"
                  value={link}
                  maxLength={2000}
                  onChange={(e) =>
                    setLinks((old) => old.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={`Remove evidence link ${i + 1}`}
                  onClick={() => setLinks((old) => old.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              type="button"
              className="justify-self-start"
              disabled={links.length >= 10}
              onClick={() => setLinks((old) => [...old, ""])}
            >
              <Link2 />
              Add Drive link
            </Button>
          </fieldset>
          {initial ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Paperclip size={14} />
              Attached files are managed from the bug's details, under Attachments.
            </p>
          ) : (
            <MediaDropZone
              accept={media.accept}
              remaining={media.maxFiles - uploads.uploads.length}
              disabledReason={
                media.enabled
                  ? undefined
                  : "Media uploads are off until your Admin connects storage in Settings → Media storage. Add a Drive link instead."
              }
              hint={
                uploads.compressing
                  ? "You can submit now: compression and upload carry on in the background"
                  : `Up to ${media.maxFiles} files · uploaded to the bug as soon as it is submitted`
              }
              onFiles={(f) => void uploads.add(f)}
              uploads={uploads.uploads}
              onRetry={uploads.retry}
              onRemove={uploads.remove}
              onLabel={uploads.setLabel}
              markup
            />
          )}
        </section>
      </fieldset>
      {error && <ErrorNotice message={error} />}
      <Button type="submit" disabled={busy || (!initial && projects.length === 0)}>
        {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
        {initial
          ? edit.isPending
            ? "Saving changes…"
            : "Save changes"
          : mutation.isPending
            ? "Saving report…"
            : uploads.staged
              ? `Submit bug with ${uploads.staged} ${uploads.staged === 1 ? "file" : "files"}`
              : "Submit bug"}
      </Button>
    </form>
  );
}

function OptionField({
  name,
  list,
  value,
  placeholder,
}: {
  name: string;
  list: string[];
  value?: string | undefined;
  placeholder: string;
}) {
  if (!list.length)
    return <Input name={name} defaultValue={value} maxLength={100} placeholder={placeholder} />;
  const all = value && !list.includes(value) ? [value, ...list] : list;
  return (
    <FormSelect
      name={name}
      label={name}
      initial={value ?? ""}
      options={[{ value: "", label: "Not specified" }, ...all.map((o) => ({ value: o, label: o }))]}
    />
  );
}
function FormSelect({
  name,
  label,
  initial,
  options,
  disabled = false,
}: {
  name: string;
  label: string;
  initial: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <ThemedSelect
        value={value}
        onChange={setValue}
        label={label}
        options={options}
        disabled={disabled}
        className="w-full min-w-0"
      />
    </>
  );
}
