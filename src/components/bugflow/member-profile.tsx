import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, Ban, Trash2, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getMemberProfile,
  saveMemberProfile,
  changeMember,
} from "@/lib/member-management.functions";
import { restoreFromTrash } from "@/lib/trash.functions";
import { moveToTrashToast } from "./trash-bin";
import { getProjects, manageMemberPortal } from "@/lib/portal-access.functions";
import {
  rolePermissions,
  permissionLabels,
  type Permission,
  type Collaborator,
} from "@/lib/onboarding";
import { editMemberSchema } from "@/lib/member-management";
import { ConfirmAction, ErrorNotice, actionError } from "./action-feedback";
import { toast } from "sonner";
import { refreshPeople } from "@/lib/refresh-people";
export function MemberProfile({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const fetch = useServerFn(getMemberProfile);
  const query = useQuery({
    queryKey: ["member-profile", id],
    queryFn: () => fetch({ data: { id } }),
    retry: false,
  });
  if (query.isPending) return <p role="status">Loading profile…</p>;
  if (query.isError)
    return (
      <ErrorNotice
        message={actionError(query.error, "Profile could not be loaded.")}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  return <ProfileEditor key={query.data.id} profile={query.data} onDeleted={onDeleted} />;
}
type Profile = Awaited<ReturnType<typeof getMemberProfile>>;
function ProfileEditor({ profile: p, onDeleted }: { profile: Profile; onDeleted: () => void }) {
  const client = useQueryClient();
  const restoreMember = useServerFn(restoreFromTrash);
  const update = useServerFn(saveMemberProfile);
  const change = useServerFn(changeMember);
  const replace = useServerFn(manageMemberPortal);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(), retry: false });
  const [welcome, setWelcome] = useState(p.welcome);
  const [name, setName] = useState(p.name);
  const [email, setEmail] = useState(p.email);
  const [role, setRole] = useState<Collaborator["role"]>(p.role);
  const [permissions, setPermissions] = useState<Permission[]>(p.permissions as Permission[]);
  const [ids, setIds] = useState(p.projectIds);
  const [pending, setPending] = useState<
    "save" | "deactivate" | "activate" | "delete" | "replace" | null
  >(null);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const mutation = useMutation({
    mutationFn: update,
    onSuccess: async () => {
      await refresh();
      toast.success("Profile and permissions saved");
    },
  });
  async function refresh() {
    await refreshPeople(client);
  }
  async function copy() {
    setError("");
    try {
      const r = await change({ data: { id: p.id, action: "copy" } });
      const value = window.location.origin + r.path;
      setLink(value);
      await navigator.clipboard.writeText(value);
      toast.success("Private portal link copied");
    } catch (e) {
      setError(actionError(e, "The portal link could not be copied."));
    }
  }
  async function confirm() {
    if (pending === "save") {
      const scope = (projects.data ?? [])
        .filter((v) => ids.includes(v.id))
        .map((v) => v.name)
        .join(", ");
      const data = editMemberSchema.parse({
        id: p.id,
        collaborator: { name, email, role, permissions, scope, context: p.context },
        projectIds: ids,
        welcome,
      });
      await mutation.mutateAsync({ data });
    } else if (pending === "replace") {
      const r = await replace({ data: { id: p.id, regenerate: true } });
      setLink(window.location.origin + r.path);
      await refresh();
      toast.success("Portal link replaced");
    } else if (pending === "delete") {
      const source = document.querySelector("[role=dialog]")?.getBoundingClientRect() ?? null;
      await change({ data: { id: p.id, action: "delete" } });
      await refresh();
      onDeleted();
      moveToTrashToast({
        title: "Moved to Trash",
        label: p.name,
        detail: "Undo brings them back deactivated; activate them and replace their link.",
        source,
        onUndo: async () => {
          await restoreMember({ data: { kind: "member", id: p.userId } });
          await refresh();
        },
      });
    } else if (pending) {
      await change({ data: { id: p.id, action: pending } });
      await refresh();
      toast.success(pending === "activate" ? "Member activated" : "Member deactivated");
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <span className="bf-avatar">
            <UserRound />
          </span>
          <div>
            <strong>{p.name}</strong>
            <p className="text-xs text-muted-foreground">
              Joined {new Date(p.createdAt).toLocaleDateString()} ·{" "}
              {p.active ? "Active" : "Deactivated"}
            </p>
          </div>
        </div>
        <div className="flex gap-5 text-xs">
          <span>
            <strong className="block text-xl">{p.reported}</strong>Reported
          </span>
          <span>
            <strong className="block text-xl">{p.assigned}</strong>Open assignments
          </span>
        </div>
      </div>
      <form
        className="bf-form"
        onSubmit={(e) => {
          e.preventDefault();
          setPending("save");
        }}
      >
        <div className="bf-form-grid">
          <label className="bf-field">
            Full name
            <Input
              required
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="bf-field">
            Email
            <Input
              required
              type="email"
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        <label className="bf-field">
          Role
          <select
            aria-label="Role"
            className="bf-select"
            value={role}
            onChange={(e) => {
              const r = e.target.value as Collaborator["role"];
              setRole(r);
              setPermissions((old) => old.filter((v) => (rolePermissions[r] ?? []).includes(v)));
            }}
          >
            <option value="tester">Tester</option>
            <option value="developer">Developer</option>
            <option value="qa">QA</option>
            <option value="other">Other collaborator</option>
          </select>
        </label>
        <details hidden={projects.data?.length === 1}>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Advanced access scope
          </summary>
          <fieldset className="mt-3">
            <legend className="mb-3 text-sm font-semibold">Projects</legend>
            {projects.isError ? (
              <ErrorNotice
                message="Projects could not be loaded."
                onRetry={() => {
                  void projects.refetch();
                }}
              />
            ) : projects.isPending ? (
              <p>Loading projects…</p>
            ) : (
              <div className="grid max-h-40 gap-3 overflow-y-auto">
                {projects.data.map((v) => (
                  <label className="bf-permission" key={v.id}>
                    <Checkbox
                      checked={ids.includes(v.id)}
                      onCheckedChange={(checked) =>
                        setIds((old) =>
                          checked ? [...old, v.id] : old.filter((id) => id !== v.id),
                        )
                      }
                    />
                    {v.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </details>
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Permissions</legend>
          <div className="bf-form-grid">
            {(rolePermissions[role] ?? []).map((v) => (
              <label className="bf-permission" key={v}>
                <Checkbox
                  checked={permissions.includes(v)}
                  onCheckedChange={(checked) =>
                    setPermissions((old) => (checked ? [...old, v] : old.filter((a) => a !== v)))
                  }
                />
                {permissionLabels[v]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="bf-field">
          First-visit welcome
          <textarea
            aria-label="First-visit welcome"
            value={welcome}
            maxLength={12000}
            onChange={(e) => setWelcome(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={mutation.isPending}>
          <Save />
          Save profile
        </Button>
      </form>
      <section className="grid gap-3 border-t pt-4">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="text-sm font-semibold">Portal access</h3>
          <span className="text-xs text-muted-foreground">
            {p.expiresAt ? `Expires ${new Date(p.expiresAt).toLocaleDateString()}` : "No expiry"} ·{" "}
            {p.welcomed ? "Welcome viewed" : "First visit pending"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void copy();
            }}
            disabled={!p.active}
          >
            <Copy />
            Copy portal
          </Button>
          <Button variant="outline" onClick={() => setPending("replace")}>
            <KeyRound />
            Replace link
          </Button>
          <Button
            variant="outline"
            onClick={() => setPending(p.active ? "deactivate" : "activate")}
          >
            <Ban />
            {p.active ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="destructive" onClick={() => setPending("delete")}>
            <Trash2 />
            Delete member
          </Button>
        </div>
        {!p.copyable && (
          <p className="text-xs text-muted-foreground">
            Older links require one replacement before they can be copied again.
          </p>
        )}
        {link && (
          <label className="bf-field">
            Private portal link
            <Input aria-label="Private portal link" type="password" readOnly value={link} />
          </label>
        )}
        {error && <ErrorNotice message={error} />}
      </section>
      <ConfirmAction
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending === "save"
            ? "Save profile changes?"
            : pending === "delete"
              ? "Move this member to the Trash?"
              : pending === "replace"
                ? "Replace private portal link?"
                : pending === "activate"
                  ? "Activate this member?"
                  : "Deactivate this member?"
        }
        description={
          pending === "delete"
            ? "This member disappears from the team and all their portals stop working. Their bugs and activity history are retained. You can restore them from Trash for 30 days."
            : pending === "replace"
              ? "The old link stops working immediately. Share the new link securely."
              : pending === "save"
                ? "Updated details, role, project scope and permissions take effect immediately."
                : "Access changes apply to every portal belonging to this member."
        }
        confirmLabel="Confirm changes"
        destructive={pending === "delete" || pending === "deactivate" || pending === "replace"}
        onConfirm={confirm}
      />
    </>
  );
}
