import { useState } from 'react';
import { SkeletonRows } from './loading';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Link } from '@tanstack/react-router';
import { Bell, Link2, UsersRound, CircleAlert, ArrowUpRight, CheckCircle2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getMembers } from '@/lib/portal-access.functions';
import { getBugWorkspace } from '@/lib/bug-workflow.functions';
import { attentionBugs, DEFAULT_SEVERITIES, PRIORITIES, severityLevel, type BugAccess, type LiveBug } from '@/lib/bug-workflow';
import { PriorityBadge, SeverityBadge } from './bug-workspace';
import { MemberProfile } from './member-profile';

const admin: BugAccess = { kind: 'admin' };
const label = (v: string) => v.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
function useAdminData() {
  const members = useServerFn(getMembers); const bugs = useServerFn(getBugWorkspace);
  return {
    members: useQuery({ queryKey: ['members'], queryFn: () => members(), retry: false, staleTime: 10000, refetchInterval: 20000 }),
    bugs: useQuery({ queryKey: ['bug-workspace', admin, undefined], queryFn: () => bugs({ data: { access: admin } }), retry: false, staleTime: 10000, refetchInterval: 20000 }),
  };
}

const statusTone = (s: string) => s === 'NEW' || s === 'REOPENED' ? 'danger' : s === 'RESOLVED' || s === 'VERIFIED' ? 'success' : s === 'RECHECK' || s === 'NEEDS_INFORMATION' ? 'warning' : 'info';

/** Five delivery stages, each a group of workflow statuses (closed-without-fix is shown separately). */
const STAGES = [
  { key: 'triage', label: 'Triage', hint: 'New, validating or waiting for info', statuses: ['NEW', 'VALIDATING', 'NEEDS_INFORMATION'], tone: 'info', filter: 'NEW' },
  { key: 'ready', label: 'Ready to assign', hint: 'Validated, waiting for an owner', statuses: ['VALIDATED', 'READY_FOR_ASSIGNMENT'], tone: 'violet', filter: 'READY_FOR_ASSIGNMENT' },
  { key: 'dev', label: 'In development', hint: 'Assigned, in progress or reopened', statuses: ['ASSIGNED', 'IN_PROGRESS', 'REOPENED'], tone: 'teal', filter: 'IN_PROGRESS' },
  { key: 'qa', label: 'QA retest', hint: 'Fix waiting for verification', statuses: ['RECHECK'], tone: 'warning', filter: 'RECHECK' },
  { key: 'done', label: 'Resolved', hint: 'Fix verified by QA', statuses: ['RESOLVED'], tone: 'success', filter: 'RESOLVED' },
] as const;
const CLOSED = ['NOT_A_BUG', 'DUPLICATE', 'WONT_FIX'];
const OPEN = (s: string) => !['RESOLVED', ...CLOSED].includes(s);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
const roleText = (r: string) => (r === 'qa' ? 'QA' : r === 'other' ? 'Member' : r ? r[0]!.toUpperCase() + r.slice(1) : 'Member');
function ago(at: string) {
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m`; const h = Math.round(m / 60); if (h < 24) return `${h}h`; return `${Math.round(h / 24)}d`;
}
const VERBS: Record<string, string> = { 'bug.created': 'reported a bug', 'bug.sample_created': 'added a sample bug', 'bug.status': 'changed the status', 'bug.priority': 'changed the priority', 'bug.severity': 'changed the severity', 'bug.assign': 'assigned the bug', 'bug.verify': 'verified a fix', 'bug.comment': 'commented', 'bug.edited': 'edited the details' };
const changeVerb = (action: string) => VERBS[action] ?? label(action.replace(/^bug\./, ''));
const PRIORITY_RANK = (p: string) => { const i = PRIORITIES.indexOf(p as never); return i < 0 ? 9 : i; };

export function DashboardSummary() {
  const { members, bugs } = useAdminData(); const [profile, setProfile] = useState<string | null>(null);
  const list = members.data ?? []; const active = list.filter(m => m.active).length; const online = list.filter(m => m.online).length;
  const d = bugs.data; const bugList = d?.bugs ?? []; const severities = d?.options.severities ?? DEFAULT_SEVERITIES;
  const attention = attentionBugs(bugList);
  const roles = ['tester', 'developer', 'qa', 'other'].map(r => ({ r, n: list.filter(m => m.role === r).length }));
  const n = (v: number, loading: boolean) => (loading ? '…' : v);
  // Full status totals (not limited to the latest page of bugs).
  const byStatus = new Map<string, number>(); for (const c of d?.statusCounts ?? []) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + c.count);
  const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
  const stages = STAGES.map(st => ({ ...st, count: st.statuses.reduce((a, s) => a + (byStatus.get(s) ?? 0), 0) }));
  const closed = CLOSED.reduce((a, s) => a + (byStatus.get(s) ?? 0), 0);
  // Most urgent first: priority, then oldest.
  const urgent = [...attention].sort((a, b) => PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority) || +new Date(a.createdAt) - +new Date(b.createdAt)).slice(0, 6);
  const count = (key: 'priority' | 'severity') => bugList.reduce<Record<string, number>>((acc, b) => { acc[b[key]] = (acc[b[key]] ?? 0) + 1; return acc; }, {});
  const pri = count('priority'); const sev = count('severity');
  const sevKeys = [...severities, ...Object.keys(sev).filter(s => !severities.includes(s))];
  // Open bugs per owner.
  const load = new Map<string, { name: string; n: number }>(); let unowned = 0;
  for (const b of bugList.filter(b => OPEN(b.status))) {
    const owners = b.assignees?.length ? b.assignees : b.assigneeId ? [{ id: b.assigneeId, name: b.assignee }] : [];
    if (!owners.length) unowned++;
    for (const o of owners) load.set(o.id, { name: o.name, n: (load.get(o.id)?.n ?? 0) + 1 });
  }
  const workload = [...load.entries()].sort((a, b) => b[1].n - a[1].n);
  const openByUser = new Map(workload.map(([id, v]) => [id, v.n]));
  const recent = bugList.filter(b => b.lastChange).sort((a: LiveBug, b: LiveBug) => +new Date(b.lastChange!.at) - +new Date(a.lastChange!.at)).slice(0, 7);
  const sample = d?.nextCursor ? `Latest ${bugList.length} bugs` : `${bugList.length} bugs`;
  const team = [...list].sort((a, b) => Number(b.online) - Number(a.online) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const loading = bugs.isPending; const failed = bugs.isError;

  return <>
    {/* 1 · Headline numbers */}
    <div className="bf-kpi-grid">
      <Kpi to="/portals" tone="teal" icon={Link2} label="Online now" value={n(online, members.isPending)} of={active} share={active ? online / active : 0} foot="Active in the last 2 minutes" />
      <Kpi to="/admin/users" tone="info" icon={UsersRound} label="Team members" value={n(list.length, members.isPending)} share={list.length ? active / list.length : 0} foot={`${active} active · ${roles.filter(x => x.n > 0).map(x => `${x.n} ${x.r === 'qa' ? 'QA' : x.r === 'other' ? 'other' : x.r + (x.n === 1 ? '' : 's')}`).join(' · ') || 'No roles assigned yet'}`} />
      <Kpi to="/admin/bugs" search={{ filter: 'unassigned' }} tone="warning" icon={CircleAlert} label="Unassigned bugs" value={n(d?.unassigned ?? 0, loading)} of={total} share={total ? (d?.unassigned ?? 0) / total : 0} foot="Waiting for an owner" />
      <Kpi to="/admin/bugs" search={{ filter: 'open' }} tone="danger" icon={Bell} label="Needs attention" value={n(attention.length, loading)} of={total} share={total ? attention.length / total : 0} foot="New, reopened, retest or info" />
    </div>
    {failed && <p className="mb-4 text-sm text-destructive">Bugs could not be loaded.</p>}

    {/* 2 · What to act on, and where work sits */}
    <div className="bf-ov-row bf-ov-row-main">
      <section className="bf-panel bf-ov-panel" aria-labelledby="ov-attention">
        <div className="bf-panel-heading"><div><h2 id="ov-attention">Needs your attention</h2><p className="bf-panel-sub">Most urgent first · priority, then oldest</p></div><Link to="/admin/bugs" search={{ filter: 'open' }}>All {attention.length}<ArrowUpRight size={12} /></Link></div>
        {loading ? <SkeletonRows rows={6} label="Loading bugs" /> : urgent.length === 0 ? <div className="bf-ov-empty"><CheckCircle2 size={22} />You’re all caught up</div> :
          <ul className="bf-urgent">{urgent.map(b => <li key={b.id}><Link to="/admin/bugs" search={{ filter: b.status }}>
            <PriorityBadge value={b.priority} />
            <span className="bf-urgent-main"><span className="bf-urgent-title"><code>{b.code}</code><span className="truncate">{b.title}</span></span>
              <span className="bf-urgent-meta"><span className="bf-status-pill" data-tone={statusTone(b.status)}><span className="bf-dot" />{label(b.status)}</span><span>{b.assignees?.length ? b.assignees.map(a => a.name).join(', ') : b.assigneeId ? b.assignee : 'Unassigned'}</span></span></span>
            <span className="bf-urgent-age" title={new Date(b.createdAt).toLocaleString('en-GB')}>{ago(b.createdAt)}</span>
          </Link></li>)}</ul>}
      </section>
      <section className="bf-panel bf-ov-panel" aria-labelledby="ov-pipeline">
        <div className="bf-panel-heading"><div><h2 id="ov-pipeline">Bug pipeline</h2><p className="bf-panel-sub">{total} bugs by stage</p></div><Link to="/admin/bugs">View all<ArrowUpRight size={12} /></Link></div>
        {loading ? <SkeletonRows rows={5} label="Loading pipeline" /> : <div className="bf-pipeline">
          <div className="bf-pipeline-bar" role="img" aria-label={stages.map(s => `${s.label}: ${s.count}`).join(', ')}>{stages.filter(s => s.count).map(s => <i key={s.key} data-tone={s.tone} style={{ flexGrow: s.count }} title={`${s.label}: ${s.count}`} />)}{closed > 0 && <i data-tone="neutral" style={{ flexGrow: closed }} title={`Closed without fix: ${closed}`} />}</div>
          <ol>{stages.map(s => <li key={s.key}><Link to="/admin/bugs" search={{ filter: s.filter }} title={s.hint}><span className="bf-stage-dot" data-tone={s.tone} /><span className="bf-stage-label">{s.label}<small>{s.hint}</small></span><b>{s.count}</b><small className="bf-stage-pct">{total ? Math.round((s.count / total) * 100) : 0}%</small></Link></li>)}</ol>
          <p className="bf-pipeline-foot"><span className="bf-stage-dot" data-tone="neutral" />Closed without fix (not a bug, duplicate, won’t fix)<b>{closed}</b></p>
        </div>}
      </section>
    </div>

    {/* 3 · Shape of the work */}
    <div className="bf-ov-row bf-ov-row-three">
      <section className="bf-panel bf-ov-panel" aria-labelledby="ov-priority">
        <div className="bf-panel-heading"><div><h2 id="ov-priority">Priority mix</h2><p className="bf-panel-sub">{sample}</p></div></div>
        {loading ? <SkeletonRows rows={6} /> : <ul className="bf-rbars bf-ov-bars">{PRIORITIES.map(p => <li key={p} data-pri={p}><Link to="/admin/bugs" search={{ filter: p }} className="contents"><span className="bf-rbars-label"><PriorityBadge value={p} /></span><span className="bf-rbars-track"><i style={{ width: `${((pri[p] ?? 0) / Math.max(1, ...Object.values(pri))) * 100}%` }} /></span><b>{pri[p] ?? 0}</b></Link></li>)}</ul>}
      </section>
      <section className="bf-panel bf-ov-panel" aria-labelledby="ov-severity">
        <div className="bf-panel-heading"><div><h2 id="ov-severity">Severity</h2><p className="bf-panel-sub">{sample}</p></div></div>
        {loading ? <SkeletonRows rows={4} /> : <ul className="bf-rbars bf-ov-bars">{sevKeys.map(s => <li key={s} data-sev={severityLevel(s, severities)}><span className="bf-rbars-label"><SeverityBadge value={s} list={severities} /></span><span className="bf-rbars-track"><i style={{ width: `${((sev[s] ?? 0) / Math.max(1, ...Object.values(sev))) * 100}%` }} /></span><b>{sev[s] ?? 0}</b></li>)}</ul>}
      </section>
      <section className="bf-panel bf-ov-panel" aria-labelledby="ov-workload">
        <div className="bf-panel-heading"><div><h2 id="ov-workload">Workload</h2><p className="bf-panel-sub">Open bugs per owner</p></div><Link to="/admin/reports">Reports<ArrowUpRight size={12} /></Link></div>
        {loading ? <SkeletonRows rows={5} /> : <ul className="bf-rbars bf-ov-bars bf-ov-scroll">{workload.map(([id, v]) => <li key={id}><span className="bf-rbars-label bf-ov-person"><span className="bf-avatar !size-6 !text-[10.5px]">{initials(v.name)}</span><span className="truncate">{v.name}</span></span><span className="bf-rbars-track"><i style={{ width: `${(v.n / Math.max(1, workload[0]?.[1].n ?? 1)) * 100}%` }} /></span><b>{v.n}</b></li>)}
          {unowned > 0 && <li className="bf-ov-unowned"><span className="bf-rbars-label">Unassigned</span><span className="bf-rbars-track"><i style={{ width: `${(unowned / Math.max(1, workload[0]?.[1].n ?? 1, unowned)) * 100}%` }} /></span><b>{unowned}</b></li>}</ul>}
      </section>
    </div>

    {/* 4 · What happened, and who is around */}
    <div className="bf-ov-row bf-ov-row-main">
      <section className="bf-panel bf-ov-panel" aria-labelledby="ov-recent">
        <div className="bf-panel-heading"><div><h2 id="ov-recent">Recent activity</h2><p className="bf-panel-sub">Latest change on each bug</p></div><Link to="/admin/activity">Activity & reports<ArrowUpRight size={12} /></Link></div>
        {loading ? <SkeletonRows rows={6} /> : <ol className="bf-ov-recent">{recent.map(b => <li key={b.id}>
          <span className="bf-avatar !size-8 !text-[11px]">{initials(b.lastChange!.by)}</span>
          <span className="min-w-0 flex-1"><span className="block truncate"><strong>{b.lastChange!.by}</strong> <span className="text-muted-foreground">{changeVerb(b.lastChange!.action)}</span></span>
            <span className="block truncate text-muted-foreground"><code>{b.code}</code> {b.title}</span></span>
          <span className="bf-status-pill" data-tone={statusTone(b.status)}><span className="bf-dot" />{label(b.status)}</span>
          <time className="bf-ov-time" title={new Date(b.lastChange!.at).toLocaleString('en-GB')}>{ago(b.lastChange!.at)}</time>
        </li>)}</ol>}
      </section>
      <section className="bf-panel bf-ov-panel" aria-labelledby="ov-team">
        <div className="bf-panel-heading"><div><h2 id="ov-team">Team</h2><p className="bf-panel-sub">{online} online · {active} active</p></div><Link to="/admin/users">Manage<ArrowUpRight size={12} /></Link></div>
        {members.isError ? <p className="p-5 text-xs text-muted-foreground">Members could not be loaded.</p> : members.isPending ? <SkeletonRows rows={6} /> :
          <ul className="bf-ov-team bf-ov-scroll">{team.map(m => <li key={m.id}><button type="button" onClick={() => setProfile(m.id)}>
            <span className="bf-ov-avatar"><span className="bf-avatar !size-8 !text-[11px]">{initials(m.name)}</span>{m.online && <i title="Online" />}</span>
            <span className="min-w-0 flex-1"><strong className="block truncate">{m.name}</strong><small>{roleText(m.role)}{!m.active && ' · inactive'}</small></span>
            <span className="bf-ov-open" title="Open bugs assigned">{openByUser.get(m.userId) ?? 0}</span>
          </button></li>)}</ul>}
      </section>
    </div>
    <Dialog open={profile !== null} onOpenChange={o => { if (!o) setProfile(null); }}><DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>Member profile</DialogTitle><DialogDescription>Details, permissions and portal controls</DialogDescription></DialogHeader>{profile && <MemberProfile id={profile} onDeleted={() => setProfile(null)} />}</DialogContent></Dialog>
  </>;
}

export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const { bugs } = useAdminData(); const count = attentionBugs(bugs.data?.bugs ?? []).length;
  return <Button size="icon" variant="ghost" className="relative" aria-label={`Notifications${count ? `: ${count}` : ''}`} title="Notifications" onClick={onOpen}><Bell size={17} />{count > 0 && <span className="bf-badge">{count > 99 ? '99+' : count}</span>}</Button>;
}

export function NotificationList({ close }: { close: () => void }) {
  const { bugs } = useAdminData(); const items = attentionBugs(bugs.data?.bugs ?? []);
  if (bugs.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!items.length) return <p className="text-sm text-muted-foreground">You’re all caught up — nothing needs your attention.</p>;
  return <ul className="grid gap-2">{items.slice(0, 20).map(b => <li key={b.id}><Link to="/admin/bugs" search={{ filter: b.status }} onClick={close} className="flex items-start gap-3 rounded-md border p-3 text-xs hover:bg-muted"><span className="font-mono text-[11.5px] text-muted-foreground">{b.code}</span><span className="flex-1"><strong className="block">{b.title}</strong><span className="text-muted-foreground">{label(b.status)}{b.lastChange ? ` · ${b.lastChange.by} · ${new Date(b.lastChange.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</span></span></Link></li>)}</ul>;
}

/** Overview metric card: label + icon, headline number with context, share meter and a one-line footnote. */
function Kpi({ to, search, tone, icon: Icon, label, value, of, share, foot }: { to: '/portals' | '/admin/users' | '/admin/bugs'; search?: { filter: string }; tone: 'teal' | 'info' | 'warning' | 'danger'; icon: LucideIcon; label: string; value: number | string; of?: number; share: number; foot: string }) {
  return <Link to={to} search={search as never} className="bf-kpi" data-tone={tone}>
    <span className="bf-kpi-head"><span className="bf-kpi-label">{label}</span><span className="bf-kpi-icon"><Icon size={16} /></span></span>
    <span className="bf-kpi-value">{value}{of !== undefined && <span className="bf-kpi-of">of {of}</span>}</span>
    <span className="bf-kpi-meter" role="presentation"><i style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} /></span>
    <span className="bf-kpi-foot"><span className="truncate">{foot}</span><ArrowUpRight size={14} className="bf-kpi-go" /></span>
  </Link>;
}
