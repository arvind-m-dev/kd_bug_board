import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Lock,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateBug } from "@/lib/bug-workflow.functions";
import {
  NOTES_SUGGESTED,
  PRIORITIES,
  allowedStatuses,
  mayVerify,
  priorityNames,
  severityLevel,
  statusPath,
  ASSIGN_TASK_LABELS,
  assignmentMessage,
  defaultTask,
  roleName,
  roleTag,
  type AssignTask,
  type BugAccess,
  type BugChange,
  type BugWorkspaceData,
  type LiveBug,
} from "@/lib/bug-workflow";
import { STATUSES, type Status } from "@/lib/bugflow";
import { actionError } from "./action-feedback";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RoleTag } from "./role-tag";

import { statusLabel, statusTone } from "@/lib/format";
const STATUS_HELP: Record<string, string> = {
  NEW: "Just reported — needs triage",
  VALIDATING: "Being checked by QA",
  VALIDATED: "Confirmed as a real bug",
  READY_FOR_ASSIGNMENT: "Confirmed, waiting for a developer",
  ASSIGNED: "A developer owns it",
  IN_PROGRESS: "Being fixed",
  RECHECK: "Fixed — waiting for QA to retest",
  RESOLVED: "Fix verified by QA",
  NEEDS_INFORMATION: "Waiting for more details from the reporter",
  REOPENED: "Fix failed QA — back to the developer",
  DUPLICATE: "Already reported elsewhere",
  NOT_A_BUG: "Works as designed",
  WONT_FIX: "Real, but not fixing now",
};
/** One-tap notes for statuses that need an explanation. */
const QUICK_NOTES: Record<string, string[]> = {
  RECHECK: ["Fix deployed to staging.", "Fixed and covered by a test."],
  REOPENED: ["Still reproducible.", "Fix causes a regression."],
  NEEDS_INFORMATION: [
    "Please add exact steps to reproduce.",
    "Please attach a screen recording.",
    "Which browser and device?",
  ],
  NOT_A_BUG: ["Works as designed.", "Expected behaviour per spec."],
  DUPLICATE: ["Already tracked in another bug."],
  WONT_FIX: ["Out of scope for this release.", "Low impact; not worth the risk now."],
  PASS: ["Verified on staging; works as expected."],
  FAIL: ["Still reproducible on retest.", "Partially fixed; edge case remains."],
};
const REJECTIONS: Status[] = ["NOT_A_BUG", "DUPLICATE", "WONT_FIX"];

type NoteFor = { kind: "status"; status: Status } | { kind: "verify"; passed: boolean };

/** Hook that sends one change for a bug, refreshes lists and reports the result. */
function useBugChange(access: BugAccess, bug: LiveBug) {
  const update = useServerFn(updateBug);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function send(change: Partial<BugChange>, done: string) {
    setBusy(true);
    try {
      await update({
        data: {
          access,
          change: {
            requestId: crypto.randomUUID(),
            id: bug.id,
            version: bug.version,
            notes: "",
            ...change,
          } as BugChange,
        },
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["bug-workspace"] }),
        client.invalidateQueries({ queryKey: ["bug-detail"] }),
      ]);
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(actionError(e, "This change could not be saved."));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy };
}

/** Status cell: current status, one-click next steps, a "Move to" menu, and an inline note box when a note is required. */
export function RowStatus({
  bug,
  access,
  workspace,
}: {
  bug: LiveBug;
  access: BugAccess;
  workspace: BugWorkspaceData;
}) {
  const actor = workspace.actor;
  const { send, busy } = useBugChange(access, bug);
  const [note, setNote] = useState<NoteFor | null>(null);
  const [text, setText] = useState("");
  const direct = allowedStatuses(actor, bug);
  const canValidate =
    ["NEW", "VALIDATING", "NEEDS_INFORMATION"].includes(bug.status) &&
    !!statusPath(actor, bug, "READY_FOR_ASSIGNMENT");
  // Rejecting is a triage call: offer the shortcut only before development starts (the status menu still has it later).
  const triage = [
    "NEW",
    "VALIDATING",
    "NEEDS_INFORMATION",
    "VALIDATED",
    "READY_FOR_ASSIGNMENT",
  ].includes(bug.status);
  const rejectTo = triage ? REJECTIONS.filter((s) => statusPath(actor, bug, s)) : [];
  const verify = mayVerify(actor, bug);
  // Everything reachable from here (direct moves plus triage shortcuts), in workflow order.
  const reachable = STATUSES.filter(
    (s) => s !== bug.status && (direct.includes(s) || statusPath(actor, bug, s)),
  );

  const move = (to: Status) => {
    // Open the note box after the menu has finished closing, so its focus handling can't dismiss it.
    if (NOTES_SUGGESTED.includes(to)) {
      setText("");
      setNote({ kind: "status", status: to });
      return;
    }
    void send({ action: "status", status: to }, `${bug.code} → ${statusLabel(to)}`);
  };
  // Notes are optional: an empty note saves the change without one.
  const submitNote = async () => {
    if (!note) return;
    const ok =
      note.kind === "verify"
        ? await send(
            { action: "verify", passed: note.passed, notes: text.trim() },
            `${bug.code} ${note.passed ? "passed QA — resolved" : "failed QA — reopened"}`,
          )
        : await send(
            { action: "status", status: note.status, notes: text.trim() },
            `${bug.code} → ${statusLabel(note.status)}`,
          );
    if (ok) setNote(null);
  };
  const noteKey = note
    ? note.kind === "verify"
      ? note.passed
        ? "PASS"
        : "FAIL"
      : note.status
    : "";
  const noteTitle = note
    ? note.kind === "verify"
      ? note.passed
        ? "Pass QA retest"
        : "Fail QA retest"
      : statusLabel(note.status)
    : "";

  const quick = canValidate || rejectTo.length > 0 || verify;
  const locked = !reachable.length && !quick;
  const lockReason =
    bug.status === "RECHECK"
      ? "Waiting for QA — only QA or Admin can pass or fail this retest."
      : ["RESOLVED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"].includes(bug.status)
        ? "Closed — only Admin or QA can reopen it."
        : "You can’t change this status.";

  return (
    <div className="bf-rowstatus">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={busy}>
          <button
            type="button"
            className="bf-status-pill bf-status-trigger"
            data-tone={statusTone(bug.status)}
            data-locked={locked || undefined}
            title={STATUS_HELP[bug.status]}
            aria-label={`Status of ${bug.code}: ${statusLabel(bug.status)}`}
          >
            {busy ? (
              <LoaderCircle size={11} className="animate-spin" />
            ) : (
              <span className="bf-dot" />
            )}
            {statusLabel(bug.status)}
            <ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {STATUS_HELP[bug.status]}
          </DropdownMenuLabel>
          {quick && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="bf-menu-heading">Quick actions</DropdownMenuLabel>
              {canValidate && (
                <DropdownMenuItem
                  onSelect={() =>
                    void send(
                      { action: "status", status: "READY_FOR_ASSIGNMENT" },
                      `${bug.code} validated — ready to assign`,
                    )
                  }
                >
                  <Check size={14} className="text-success" />
                  Validate
                  <span className="ml-auto text-[11.5px] text-muted-foreground">
                    → Ready to assign
                  </span>
                </DropdownMenuItem>
              )}
              {rejectTo.map((st) => (
                <DropdownMenuItem key={st} onSelect={() => move(st)}>
                  <X size={14} className="text-destructive" />
                  Reject · {statusLabel(st)}
                  <span className="ml-auto text-[11px] text-muted-foreground">reason</span>
                </DropdownMenuItem>
              ))}
              {verify && (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      void send(
                        { action: "verify", passed: true, notes: QUICK_NOTES["PASS"]![0]! },
                        `${bug.code} passed QA — resolved`,
                      )
                    }
                  >
                    <CircleCheck size={14} className="text-success" />
                    Pass retest
                    <span className="ml-auto text-[11.5px] text-muted-foreground">→ Resolved</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setText("");
                      setNote({ kind: "verify", passed: false });
                    }}
                  >
                    <CircleX size={14} className="text-destructive" />
                    Fail retest
                    <span className="ml-auto text-[11px] text-muted-foreground">reason</span>
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
          {reachable.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="bf-menu-heading">Move to</DropdownMenuLabel>
              {reachable.map((st) => (
                <DropdownMenuItem
                  key={st}
                  onSelect={() => move(st)}
                  className="flex-col items-start gap-0"
                >
                  <span className="flex items-center gap-2">
                    <span className="bf-dot" data-tone={statusTone(st)} />
                    {statusLabel(st)}
                    {NOTES_SUGGESTED.includes(st) && (
                      <span className="text-[11px] text-muted-foreground">· reason</span>
                    )}
                  </span>
                  <span className="pl-4 text-[11.5px] text-muted-foreground">
                    {STATUS_HELP[st]}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          {locked && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                <Lock size={13} />
                {lockReason}
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {note && (
        <form
          className="bf-inline-note"
          onSubmit={(e) => {
            e.preventDefault();
            void submitNote();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setNote(null);
          }}
        >
          <strong>
            {noteTitle}
            <span> · add a reason (optional)</span>
          </strong>
          {(QUICK_NOTES[noteKey] ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(QUICK_NOTES[noteKey] ?? []).map((n) => (
                <button
                  key={n}
                  type="button"
                  className="bf-note-chip"
                  data-active={text === n || undefined}
                  onClick={() => setText(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          <textarea
            autoFocus
            className="bf-note-input"
            rows={2}
            maxLength={4000}
            aria-label={`Note for ${noteTitle}`}
            placeholder="Why? (optional — helps the next person)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitNote();
              }
            }}
          />
          <div className="flex justify-end gap-1">
            <button type="button" className="bf-quick-btn" onClick={() => setNote(null)}>
              Cancel
            </button>
            <button type="submit" className="bf-quick-btn" data-tone="primary" disabled={busy}>
              {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
              {text.trim() ? "Save" : "Save without note"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Assignee cell: who is on the bug, and a panel to assign one person or several at once. Each person gets a task
 * (fix, re-validate, retest, add media or info) defaulted from their role, and the assignment message ("Assigned to
 * Krishna (Developer) to fix it…") is saved on the bug. A bug that is not validated yet says so and is validated first.
 * Admin can also pick members outside the bug's project; assigning gives them access to it in the same save.
 */
export function RowAssign({
  bug,
  access,
  workspace,
}: {
  bug: LiveBug;
  access: BugAccess;
  workspace: BugWorkspaceData;
}) {
  const { send, busy } = useBugChange(access, bug);
  const [open, setOpen] = useState(false);
  const roleOf = (id: string) => workspace.developers.find((m) => m.id === id)?.role ?? "";
  const owners: { id: string; name: string; role: string }[] = bug.assignees?.length
    ? bug.assignees.map((a) => ({ ...a, role: a.role || roleOf(a.id) }))
    : bug.assigneeId
      ? [{ id: bug.assigneeId, name: bug.assignee, role: roleOf(bug.assigneeId) }]
      : [];
  const ownerText = owners
    .map((o) => (roleTag(o.role) ? `${o.name} · ${roleTag(o.role)}` : o.name))
    .join(", ");
  const assignable = [
    "VALIDATED",
    "READY_FOR_ASSIGNMENT",
    "ASSIGNED",
    "REOPENED",
    "IN_PROGRESS",
  ].includes(bug.status);
  const viaValidation = !assignable && !!statusPath(workspace.actor, bug, "READY_FOR_ASSIGNMENT");
  const closed = ["RESOLVED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"].includes(bug.status);
  const lockReason = closed
    ? "This bug is closed — assignment is locked."
    : bug.status === "RECHECK"
      ? "Waiting for QA retest — reassign after QA decides."
      : !assignable && !viaValidation
        ? "Validate this bug first, then assign it. Ask QA or Admin to validate it."
        : "";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={busy}>
        <button
          type="button"
          className="bf-assign-trigger"
          data-empty={!owners.length || undefined}
          data-locked={!!lockReason || undefined}
          title={ownerText || undefined}
          aria-label={`Assignee of ${bug.code}: ${ownerText || "unassigned"}`}
        >
          {busy ? (
            <LoaderCircle size={13} className="animate-spin" />
          ) : owners.length ? (
            <span className="bf-avatar !size-5 !text-[9.5px]">
              {owners[0]!.name.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <UserPlus size={13} />
          )}
          <span className="truncate">
            {owners.length ? owners[0]!.name : lockReason ? "Unassigned" : "Assign"}
          </span>
          {owners[0] && <RoleTag role={owners[0].role} />}
          {owners.length > 1 && <span className="bf-role-more">+{owners.length - 1}</span>}
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="bf-assign-panel w-[340px] p-0">
        {open && (
          <AssignPanel
            bug={bug}
            workspace={workspace}
            owners={owners}
            lockReason={lockReason}
            viaValidation={viaValidation}
            busy={busy}
            onAssign={async (people, note, grant) => {
              const message = assignmentMessage(people);
              const ok = await send(
                {
                  action: "assign",
                  assigneeIds: people.map((p) => p.id),
                  notes: [message, note.trim()].filter(Boolean).join("\n\n"),
                  ...(grant ? { grantAccess: true } : {}),
                },
                `${bug.code}${viaValidation ? " validated and" : ""} ${message.replace(/^Assigned/, "assigned").replace(/\.$/, "")}`,
              );
              if (ok) setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

type Pick = { id: string; name: string; role: string; task: AssignTask };
function AssignPanel({
  bug,
  workspace,
  owners,
  lockReason,
  viaValidation,
  busy,
  onAssign,
}: {
  bug: LiveBug;
  workspace: BugWorkspaceData;
  owners: { id: string; name: string; role: string }[];
  lockReason: string;
  viaValidation: boolean;
  busy: boolean;
  onAssign: (people: Pick[], note: string, grant: boolean) => Promise<void>;
}) {
  const isAdmin = workspace.actor.role === "admin";
  const everyone = workspace.developers;
  const onProject = everyone.filter((m) => m.projectIds.includes(bug.projectId));
  const others = isAdmin ? everyone.filter((m) => !m.projectIds.includes(bug.projectId)) : [];
  const [multiple, setMultiple] = useState(owners.length > 1);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Pick[]>(() =>
    owners.flatMap((o) => {
      const m = everyone.find((x) => x.id === o.id);
      const role = m?.role ?? o.role;
      return [{ id: o.id, name: o.name, role, task: defaultTask(role) }];
    }),
  );
  if (lockReason)
    return (
      <div className="grid gap-2 p-3">
        {owners.length > 0 && (
          <div className="grid gap-1">
            <span className="bf-menu-heading">Assigned to</span>
            {owners.map((o) => (
              <span key={o.id} className="flex items-center gap-2 text-sm">
                <span className="bf-avatar !size-5 !text-[9.5px]">
                  {o.name.slice(0, 2).toUpperCase()}
                </span>
                {o.name}
                <RoleTag role={o.role} />
              </span>
            ))}
          </div>
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock size={13} className="mt-0.5 shrink-0" />
          {lockReason}
        </p>
      </div>
    );
  const match = (m: { name: string; role?: string }) =>
    `${m.name} ${roleName(m.role ?? "")}`.toLowerCase().includes(query.trim().toLowerCase());
  const toggle = (m: { id: string; name: string; role?: string }) => {
    const role = m.role ?? "";
    setPicked((list) =>
      list.some((p) => p.id === m.id)
        ? list.filter((p) => p.id !== m.id)
        : multiple
          ? [...list, { id: m.id, name: m.name, role, task: defaultTask(role) }]
          : [{ id: m.id, name: m.name, role, task: defaultTask(role) }],
    );
  };
  const grant = picked.some((p) => others.some((o) => o.id === p.id));
  const unchanged =
    picked.length === owners.length &&
    picked.every((p) => owners.some((o) => o.id === p.id)) &&
    !note.trim();
  const row = (m: (typeof everyone)[number], outside: boolean) => {
    const on = picked.some((p) => p.id === m.id);
    return (
      <li key={m.id}>
        <label className="bf-assign-person" data-on={on || undefined}>
          <input
            type={multiple ? "checkbox" : "radio"}
            name={`assign-${bug.id}`}
            checked={on}
            onChange={() => toggle(m)}
          />
          <span className="bf-avatar !size-6 !text-[10px]">{m.name.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1 truncate">{m.name}</span>
          <RoleTag role={m.role} />
          {outside && (
            <span className="bf-assign-role" title="Not on this project yet">
              + access
            </span>
          )}
        </label>
      </li>
    );
  };
  return (
    <div className="grid gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">Assign {bug.code}</strong>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(e) => {
              setMultiple(e.target.checked);
              if (!e.target.checked) setPicked((l) => l.slice(0, 1));
            }}
          />
          Multiple people
        </label>
      </div>
      {viaValidation && (
        <p className="bf-assign-warn">
          {bug.code} is not validated yet. It will be validated first (to Ready for assignment),
          then assigned.
        </p>
      )}
      {everyone.length > 6 && (
        <input
          className="bf-input h-8"
          placeholder="Search people or roles"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search people"
        />
      )}
      <div className="bf-assign-list">
        <span className="bf-menu-heading">On {bug.project}</span>
        <ul>{onProject.filter(match).map((m) => row(m, false))}</ul>
        {!onProject.length && (
          <p className="px-1 text-xs text-muted-foreground">
            Nobody has access to this project yet.
          </p>
        )}
        {others.length > 0 && (
          <>
            <span className="bf-menu-heading">
              Other members · assigning gives them access to {bug.project}
            </span>
            <ul>{others.filter(match).map((m) => row(m, true))}</ul>
          </>
        )}
      </div>
      {picked.length > 0 && (
        <div className="bf-assign-tasks">
          {picked.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {p.name} <span className="text-muted-foreground">({roleName(p.role)})</span> to
              </span>
              <select
                className="bf-input h-7 w-auto py-0 text-xs"
                value={p.task}
                onChange={(e) =>
                  setPicked((l) =>
                    l.map((x) =>
                      x.id === p.id ? { ...x, task: e.target.value as AssignTask } : x,
                    ),
                  )
                }
                aria-label={`Task for ${p.name}`}
              >
                {(Object.keys(ASSIGN_TASK_LABELS) as AssignTask[]).map((t) => (
                  <option key={t} value={t}>
                    {ASSIGN_TASK_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="bf-assign-message">{assignmentMessage(picked)}</p>
          <textarea
            className="bf-input min-h-[52px] text-xs"
            placeholder="Add a note for them (optional)"
            maxLength={1500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
      <Button
        type="button"
        size="sm"
        disabled={busy || !picked.length || unchanged}
        onClick={() => void onAssign(picked, note, grant)}
      >
        {busy ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
        {viaValidation ? "Validate & assign" : grant ? "Give access & assign" : "Assign"}
      </Button>
    </div>
  );
}

/** Priority and severity in one chip and one menu: P0–P5 on top, severities (Settings order) below. Admin edits; others see read-only. */
export function RowRating({
  bug,
  access,
  workspace,
  editable,
}: {
  bug: LiveBug;
  access: BugAccess;
  workspace: BugWorkspaceData;
  editable: boolean;
}) {
  const { send, busy } = useBugChange(access, bug);
  const severities = [...new Set([...workspace.options.severities, bug.severity])];
  const level = severityLevel(bug.severity, workspace.options.severities);
  const chip = (
    <span className="bf-rating-inner">
      <span className="bf-pri" data-pri={bug.priority}>
        {bug.priority}
      </span>
      <span className="bf-rating-sev" data-sev={level}>
        <span className="bf-sev-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {bug.severity}
      </span>
    </span>
  );
  const label = `${bug.code}: priority ${bug.priority} (${priorityNames[bug.priority] ?? ""}), severity ${bug.severity}`;
  if (!editable)
    return (
      <span className="bf-rating" title={label}>
        {chip}
      </span>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy}>
        <button
          type="button"
          className="bf-rating bf-rating-trigger"
          aria-label={`${label}. Change`}
          title={label}
        >
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : chip}
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel className="bf-menu-heading">
          Priority · how soon to fix
        </DropdownMenuLabel>
        {PRIORITIES.map((p) => (
          <DropdownMenuItem
            key={p}
            onSelect={() => {
              if (p !== bug.priority)
                void send({ action: "priority", priority: p }, `${bug.code} priority → ${p}`);
            }}
          >
            <span className="bf-pri" data-pri={p}>
              {p}
            </span>
            {priorityNames[p]}
            {p === bug.priority && <Check size={14} className="ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="bf-menu-heading">
          Severity · how bad the impact is
        </DropdownMenuLabel>
        {severities.map((sv) => (
          <DropdownMenuItem
            key={sv}
            onSelect={() => {
              if (sv !== bug.severity)
                void send({ action: "severity", severity: sv }, `${bug.code} severity → ${sv}`);
            }}
          >
            <span className="bf-sev" data-sev={severityLevel(sv, workspace.options.severities)}>
              <span className="bf-sev-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {sv}
            </span>
            {sv === bug.severity && <Check size={14} className="ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
