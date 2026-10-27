import { useState, useEffect } from "react";
import { shareOrigin, warnIfLocalLink } from "@/lib/share-origin";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Copy, Link2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  collaboratorSchema,
  permissionLabels,
  rolePermissions,
  type Permission,
  type Collaborator,
} from "@/lib/onboarding";
import { generateCollaboratorOnboarding } from "@/lib/onboarding.functions";
import { getProjects, addProject, createMemberPortal } from "@/lib/portal-access.functions";
import { toast } from "sonner";
import { ErrorNotice, actionError } from "./action-feedback";

export function CollaboratorOnboarding() {
  const client = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(), retry: false });
  const createProject = useServerFn(addProject);
  const save = useServerFn(createMemberPortal);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projectName, setProjectName] = useState("");
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Collaborator["role"]>("tester");
  const scope = (projects.data ?? [])
    .filter((p) => projectIds.includes(p.id))
    .map((p) => p.name)
    .join(", ");
  const [context, setContext] = useState("");
  useEffect(() => {
    const only = projects.data?.[0];
    if (projects.data?.length === 1 && only) setProjectIds([only.id]);
  }, [projects.data]);
  const [permissions, setPermissions] = useState<Permission[]>(rolePermissions["tester"] ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generate = useServerFn(generateCollaboratorOnboarding);
  function invalidate() {
    setText("");
    setError("");
    setLink("");
  }
  async function savePortal() {
    setBusy(true);
    setError("");
    try {
      const result = await save({
        data: {
          collaborator: { name, email, role, scope, context, permissions },
          projectIds,
          welcome: text,
        },
      });
      setLink(shareOrigin() + result.path);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["members"] }),
        client.invalidateQueries({ queryKey: ["bug-workspace"] }),
        client.invalidateQueries({ queryKey: ["bug-detail"] }),
      ]);
      toast.success(`${name} added to the team`);
    } catch (cause) {
      setError(
        actionError(cause, "Member could not be saved. Please check the details and try again."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = collaboratorSchema.safeParse({ name, email, role, scope, context, permissions });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the collaborator details.");
      return;
    }
    setBusy(true);
    setError("");
    setText("");
    try {
      const result = await generate({ data: parsed.data });
      setText(result.text);
    } catch (cause) {
      setError(actionError(cause, "Onboarding could not be generated. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="bf-form" onSubmit={submit}>
      <fieldset disabled={busy} className="bf-onboarding-fields">
        <div className="bf-form-grid">
          <label className="bf-field">
            Full name
            <Input
              value={name}
              maxLength={100}
              required
              onChange={(event) => {
                setName(event.target.value);
                invalidate();
              }}
              placeholder="Person’s name"
            />
          </label>
          <label className="bf-field">
            Email
            <Input
              type="email"
              value={email}
              maxLength={254}
              required
              onChange={(event) => {
                setEmail(event.target.value);
                invalidate();
              }}
              placeholder="name@company.com"
            />
          </label>
        </div>
        <label className="bf-field">
          Collaborator role
          <select
            className="bf-select"
            value={role}
            onChange={(event) => {
              const next = event.target.value as Collaborator["role"];
              setRole(next);
              setPermissions(rolePermissions[next] ?? []);
              invalidate();
            }}
          >
            <option value="tester">Tester / reporter</option>
            <option value="developer">Developer</option>
            <option value="qa">QA member</option>
            <option value="other">Other collaborator</option>
          </select>
        </label>
        <details hidden={projects.data?.length === 1}>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Advanced access scope
          </summary>
          <fieldset className="bf-onboarding-permissions mt-3">
            <legend>Project access</legend>
            {projects.isPending ? (
              <p className="text-xs">Loading projects…</p>
            ) : projects.error ? (
              <ErrorNotice
                message="Projects couldn’t be loaded. Please try again."
                onRetry={() => {
                  void projects.refetch();
                }}
                retrying={projects.isFetching}
              />
            ) : (
              (projects.data ?? []).map((p) => (
                <label className="bf-permission" key={p.id}>
                  <Checkbox
                    checked={projectIds.includes(p.id)}
                    onCheckedChange={(checked) => {
                      setProjectIds((current) =>
                        checked === true ? [...current, p.id] : current.filter((id) => id !== p.id),
                      );
                      invalidate();
                    }}
                  />
                  {p.name}
                </label>
              ))
            )}
            <div className="flex gap-2 mt-3">
              <Input
                aria-label="New project name"
                value={projectName}
                maxLength={100}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="New project name"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!projectName.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const p = await createProject({ data: { name: projectName } });
                    setProjectIds((current) => [...current, p.id]);
                    setProjectName("");
                    await client.invalidateQueries({ queryKey: ["projects"] });
                    invalidate();
                  } catch (e) {
                    setError(actionError(e, "Project could not be saved. Please try again."));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Add project
              </Button>
            </div>
          </fieldset>
        </details>
        <fieldset className="bf-onboarding-permissions">
          <legend>Permissions</legend>
          <div className="bf-form-grid">
            {(rolePermissions[role] ?? []).map((permission) => (
              <label className="bf-permission" key={permission}>
                <Checkbox
                  checked={permissions.includes(permission)}
                  onCheckedChange={(checked) => {
                    setPermissions((current) =>
                      checked === true
                        ? [...current, permission]
                        : current.filter((item) => item !== permission),
                    );
                    invalidate();
                  }}
                />
                {permissionLabels[permission]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="bf-field">
          Onboarding context
          <textarea
            value={context}
            maxLength={1000}
            onChange={(event) => {
              setContext(event.target.value);
              invalidate();
            }}
            placeholder="Experience, focus areas, and handoff notes"
          />
        </label>
      </fieldset>
      <div className="bf-note">
        {link
          ? "Member saved · Private link expires in 90 days."
          : "Unsaved member · Review permissions and onboarding before saving."}
      </div>
      {error && <ErrorNotice message={error} />}
      <Button type="submit" disabled={busy || projectIds.length === 0 || !!link}>
        {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
        {busy ? "Please wait…" : text ? "Regenerate onboarding" : "Generate AI welcome"}
      </Button>
      {text && (
        <section className="bf-onboarding-result" aria-label="AI onboarding draft">
          <div className="bf-section-heading">
            <h2>Welcome & onboarding</h2>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="Copy onboarding"
              title="Copy onboarding"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  toast.success("Onboarding copied");
                } catch {
                  toast.error("Clipboard unavailable");
                }
              }}
            >
              <Copy />
            </Button>
          </div>
          <label className="bf-field">
            Review draft
            <textarea value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <span className="text-xs text-muted-foreground">
            AI-written · Unsaved · Review before sharing
          </span>
        </section>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={busy || projectIds.length === 0 || !name.trim() || !email.trim() || !!link}
        onClick={savePortal}
      >
        <Link2 />
        Save member & generate portal link
      </Button>
      {link && (
        <div className="bf-form">
          <label className="bf-field">
            Private portal link
            <Input readOnly value={link} />
          </label>
          <Button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                toast.success("Portal link copied");
                warnIfLocalLink(link);
              } catch {
                toast.error("Clipboard unavailable");
              }
            }}
          >
            <Copy />
            Copy portal link
          </Button>
        </div>
      )}
    </form>
  );
}
