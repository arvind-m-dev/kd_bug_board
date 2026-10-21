import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Check, ChevronDown, CircleCheck, CircleX, LoaderCircle, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { updateBug } from '@/lib/bug-workflow.functions';
import { NOTES_REQUIRED, allowedStatuses, mayVerify, statusPath, type BugAccess, type BugChange, type BugWorkspaceData, type LiveBug } from '@/lib/bug-workflow';
import { STATUSES, type Status } from '@/lib/bugflow';
import { actionError } from './action-feedback';

export const statusLabel = (v: string) => (v === 'RECHECK' ? 'Ready for QA retest' : v.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()));
export const statusTone = (s: string) => ['REOPENED'].includes(s) ? 'danger' : ['RESOLVED'].includes(s) ? 'success' : ['IN_PROGRESS', 'RECHECK', 'NEEDS_INFORMATION'].includes(s) ? 'warning' : ['NEW', 'VALIDATING'].includes(s) ? 'info' : 'neutral';
const STATUS_HELP: Record<string, string> = {
  NEW: 'Just reported — needs triage', VALIDATING: 'Being checked by QA', VALIDATED: 'Confirmed as a real bug', READY_FOR_ASSIGNMENT: 'Confirmed, waiting for a developer',
  ASSIGNED: 'A developer owns it', IN_PROGRESS: 'Being fixed', RECHECK: 'Fixed — waiting for QA to retest', RESOLVED: 'Fix verified by QA',
  NEEDS_INFORMATION: 'Waiting for more details from the reporter', REOPENED: 'Fix failed QA — back to the developer', DUPLICATE: 'Already reported elsewhere', NOT_A_BUG: 'Works as designed', WONT_FIX: 'Real, but not fixing now',
};
/** One-tap notes for statuses that need an explanation. */
const QUICK_NOTES: Record<string, string[]> = {
  RECHECK: ['Fix deployed to staging.', 'Fixed and covered by a test.'],
  REOPENED: ['Still reproducible.', 'Fix causes a regression.'],
  NEEDS_INFORMATION: ['Please add exact steps to reproduce.', 'Please attach a screen recording.', 'Which browser and device?'],
  NOT_A_BUG: ['Works as designed.', 'Expected behaviour per spec.'],
  DUPLICATE: ['Already tracked in another bug.'],
  WONT_FIX: ['Out of scope for this release.', 'Low impact; not worth the risk now.'],
  PASS: ['Verified on staging; works as expected.'],
  FAIL: ['Still reproducible on retest.', 'Partially fixed; edge case remains.'],
};
const REJECTIONS: Status[] = ['NOT_A_BUG', 'DUPLICATE', 'WONT_FIX'];

type NoteFor = { kind: 'status'; status: Status } | { kind: 'verify'; passed: boolean };

/** Hook that sends one change for a bug, refreshes lists and reports the result. */
function useBugChange(access: BugAccess, bug: LiveBug) {
  const update = useServerFn(updateBug); const client = useQueryClient(); const [busy, setBusy] = useState(false);
  async function send(change: Partial<BugChange>, done: string) {
    setBusy(true);
    try {
      await update({ data: { access, change: { requestId: crypto.randomUUID(), id: bug.id, version: bug.version, notes: '', ...change } as BugChange } });
      await Promise.all([client.invalidateQueries({ queryKey: ['bug-workspace'] }), client.invalidateQueries({ queryKey: ['bug-detail'] })]);
      toast.success(done); return true;
    } catch (e) { toast.error(actionError(e, 'This change could not be saved.')); return false; }
    finally { setBusy(false); }
  }
  return { send, busy };
}

/** Status cell: current status, one-click next steps, a "Move to" menu, and an inline note box when a note is required. */
export function RowStatus({ bug, access, workspace }: { bug: LiveBug; access: BugAccess; workspace: BugWorkspaceData }) {
  const actor = workspace.actor; const { send, busy } = useBugChange(access, bug);
  const [note, setNote] = useState<NoteFor | null>(null); const [text, setText] = useState('');
  const direct = allowedStatuses(actor, bug);
  const canValidate = ['NEW', 'VALIDATING', 'NEEDS_INFORMATION'].includes(bug.status) && !!statusPath(actor, bug, 'READY_FOR_ASSIGNMENT');
  // Rejecting is a triage call: offer the shortcut only before development starts (the status menu still has it later).
  const triage = ['NEW', 'VALIDATING', 'NEEDS_INFORMATION', 'VALIDATED', 'READY_FOR_ASSIGNMENT'].includes(bug.status);
  const rejectTo = triage ? REJECTIONS.filter(s => statusPath(actor, bug, s)) : [];
  const verify = mayVerify(actor, bug);
  // Everything reachable from here (direct moves plus triage shortcuts), in workflow order.
  const reachable = STATUSES.filter(s => s !== bug.status && (direct.includes(s) || statusPath(actor, bug, s)));

  const move = (to: Status) => {
    // Open the note box after the menu has finished closing, so its focus handling can't dismiss it.
    if (NOTES_REQUIRED.includes(to)) { setText(''); setNote({ kind: 'status', status: to }); return; }
    void send({ action: 'status', status: to }, `${bug.code} → ${statusLabel(to)}`);
  };
  const submitNote = async () => {
    if (!note || !text.trim()) return;
    const ok = note.kind === 'verify'
      ? await send({ action: 'verify', passed: note.passed, notes: text.trim() }, `${bug.code} ${note.passed ? 'passed QA — resolved' : 'failed QA — reopened'}`)
      : await send({ action: 'status', status: note.status, notes: text.trim() }, `${bug.code} → ${statusLabel(note.status)}`);
    if (ok) setNote(null);
  };
  const noteKey = note ? (note.kind === 'verify' ? (note.passed ? 'PASS' : 'FAIL') : note.status) : '';
  const noteTitle = note ? (note.kind === 'verify' ? (note.passed ? 'Pass QA retest' : 'Fail QA retest') : statusLabel(note.status)) : '';

  return <div className="bf-rowstatus">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!reachable.length || busy}>
          <button type="button" className="bf-status-pill bf-status-trigger" data-tone={statusTone(bug.status)} title={STATUS_HELP[bug.status]} aria-label={`Status of ${bug.code}: ${statusLabel(bug.status)}${reachable.length ? '. Change status' : ''}`}>
            {busy ? <LoaderCircle size={11} className="animate-spin" /> : <span className="bf-dot" />}{statusLabel(bug.status)}{reachable.length > 0 && <ChevronDown size={12} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64" onCloseAutoFocus={e => e.preventDefault()}>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{STATUS_HELP[bug.status]}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {reachable.map(s => <DropdownMenuItem key={s} onSelect={() => move(s)} className="flex-col items-start gap-0">
            <span className="flex items-center gap-2"><span className="bf-dot" data-tone={statusTone(s)} />{statusLabel(s)}{NOTES_REQUIRED.includes(s) && <span className="text-[11px] text-muted-foreground">· note</span>}</span>
            <span className="pl-4 text-[11.5px] text-muted-foreground">{STATUS_HELP[s]}</span>
          </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      {(canValidate || rejectTo.length > 0 || verify) && <span className="bf-quick">
        {canValidate && <button type="button" className="bf-quick-btn" data-tone="success" disabled={busy} onClick={() => void send({ action: 'status', status: 'READY_FOR_ASSIGNMENT' }, `${bug.code} validated — ready to assign`)} title="Confirm this is a real bug (moves it to Ready to assign)"><Check size={13} />Validate</button>}
        {rejectTo.length > 0 && <DropdownMenu><DropdownMenuTrigger asChild disabled={busy}><button type="button" className="bf-quick-btn" data-tone="danger" title="Close without fixing"><X size={13} />Reject<ChevronDown size={11} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={e => e.preventDefault()}>{rejectTo.map(s => <DropdownMenuItem key={s} onSelect={() => move(s)}>{statusLabel(s)}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
        {verify && <>
          <button type="button" className="bf-quick-btn" data-tone="success" disabled={busy} onClick={() => void send({ action: 'verify', passed: true, notes: QUICK_NOTES['PASS']![0]! }, `${bug.code} passed QA — resolved`)} title="Retest passed — resolve the bug"><CircleCheck size={13} />Pass</button>
          <button type="button" className="bf-quick-btn" data-tone="danger" disabled={busy} onClick={() => { setNote({ kind: 'verify', passed: false }); setText(''); }} title="Retest failed — send back to the developer"><CircleX size={13} />Fail</button>
        </>}
      </span>}
      {note && <form className="bf-inline-note" onSubmit={e => { e.preventDefault(); void submitNote(); }} onKeyDown={e => { if (e.key === 'Escape') setNote(null); }}>
        <strong>{noteTitle}<span> · note required</span></strong>
        {(QUICK_NOTES[noteKey] ?? []).length > 0 && <div className="flex flex-wrap gap-1.5">{(QUICK_NOTES[noteKey] ?? []).map(n => <button key={n} type="button" className="bf-note-chip" data-active={text === n || undefined} onClick={() => setText(n)}>{n}</button>)}</div>}
        <textarea autoFocus className="bf-note-input" rows={2} maxLength={4000} aria-label={`Note for ${noteTitle}`} placeholder="Short note…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitNote(); } }} />
        <div className="flex justify-end gap-1"><button type="button" className="bf-quick-btn" onClick={() => setNote(null)}>Cancel</button><button type="submit" className="bf-quick-btn" data-tone="primary" disabled={!text.trim() || busy}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}Save</button></div>
      </form>}
    </div>;
}

/** Assignee cell: pick a person and it's assigned immediately (validating first when needed and allowed). */
export function RowAssign({ bug, access, workspace }: { bug: LiveBug; access: BugAccess; workspace: BugWorkspaceData }) {
  const { send, busy } = useBugChange(access, bug);
  const owners = bug.assignees?.length ? bug.assignees : bug.assigneeId ? [{ id: bug.assigneeId, name: bug.assignee }] : [];
  const assignable = ['VALIDATED', 'READY_FOR_ASSIGNMENT', 'ASSIGNED', 'REOPENED', 'IN_PROGRESS'].includes(bug.status);
  const viaValidation = !assignable && !!statusPath(workspace.actor, bug, 'READY_FOR_ASSIGNMENT');
  const people = workspace.developers.filter(m => m.projectIds.includes(bug.projectId));
  const closed = ['RESOLVED', 'NOT_A_BUG', 'DUPLICATE', 'WONT_FIX', 'RECHECK'].includes(bug.status);
  if (closed || (!assignable && !viaValidation)) return owners.length ? <span className="bf-owner">{owners.map(o => o.name).join(', ')}</span> : <span className="text-muted-foreground">Unassigned</span>;
  const assign = (id: string, name: string) => void send({ action: 'assign', assigneeIds: [id] }, viaValidation ? `${bug.code} validated and assigned to ${name}` : `${bug.code} assigned to ${name}`);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild disabled={busy}>
      <button type="button" className="bf-assign-trigger" data-empty={!owners.length || undefined} aria-label={`Assign ${bug.code}`}>
        {busy ? <LoaderCircle size={13} className="animate-spin" /> : owners.length ? <span className="bf-avatar !size-5 !text-[9.5px]">{owners[0]!.name.slice(0, 2).toUpperCase()}</span> : <UserPlus size={13} />}
        <span className="truncate">{owners.length ? owners[0]!.name + (owners.length > 1 ? ` +${owners.length - 1}` : '') : 'Assign'}</span><ChevronDown size={12} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
      {viaValidation && <><DropdownMenuLabel className="text-[11.5px] font-normal text-muted-foreground">Picking someone also validates this bug.</DropdownMenuLabel><DropdownMenuSeparator /></>}
      {people.length ? people.map(m => <DropdownMenuItem key={m.id} onSelect={() => assign(m.id, m.name)} className="justify-between">
        <span className="flex items-center gap-2"><span className="bf-avatar !size-5 !text-[9.5px]">{m.name.slice(0, 2).toUpperCase()}</span>{m.name}</span>
        <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground">{m.role === 'qa' ? 'QA' : m.role}{owners.some(o => o.id === m.id) && <Check size={13} className="text-primary" />}</span>
      </DropdownMenuItem>) : <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No members have access to this project.</DropdownMenuLabel>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
