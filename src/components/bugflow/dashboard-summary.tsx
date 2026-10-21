import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Link } from '@tanstack/react-router';
import { Bell, Link2, UsersRound, CircleAlert, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getMembers } from '@/lib/portal-access.functions';
import { getBugWorkspace } from '@/lib/bug-workflow.functions';
import { attentionBugs, type BugAccess, type LiveBug } from '@/lib/bug-workflow';
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

export function DashboardSummary() {
  const { members, bugs } = useAdminData(); const [profile, setProfile] = useState<string | null>(null);
  const list = members.data ?? []; const active = list.filter(m => m.active).length; const online = list.filter(m => m.online).length;
  const bugList = bugs.data?.bugs ?? [];
  const alerts = attentionBugs(bugList).length;
  const roles = ['tester', 'developer', 'qa', 'other'].map(r => ({ r, n: list.filter(m => m.role === r).length }));
  const countBy = (key: 'status' | 'priority') => Object.entries(bugList.reduce<Record<string, number>>((acc, b) => { acc[b[key]] = (acc[b[key]] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const statusCounts = countBy('status'); const priorityCounts = countBy('priority');
  const recent = bugList.filter(b => b.lastChange).sort((a: LiveBug, b: LiveBug) => +new Date(b.lastChange!.at) - +new Date(a.lastChange!.at)).slice(0, 5);
  const n = (v: number, loading: boolean) => (loading ? '…' : v);
  return <>
    <div className="bf-summary-grid">
      <Link to="/portals" className="bf-summary-card"><span><Link2 size={16} className="text-primary" />Online now</span><strong>{n(online, members.isPending)}<small> / {n(active, members.isPending)} active links</small></strong></Link>
      <Link to="/admin/users" className="bf-summary-card"><span><UsersRound size={16} className="text-info" />Team members</span><strong>{n(list.length, members.isPending)}</strong><small>{roles.map(x => `${x.n} ${x.r === 'qa' ? 'QA' : x.r}`).join(' · ')}</small></Link>
      <Link to="/admin/bugs" search={{ filter: 'unassigned' }} className="bf-summary-card"><span><CircleAlert size={16} className="text-warning" />Unassigned bugs</span><strong>{n(bugs.data?.unassigned ?? 0, bugs.isPending)}</strong></Link>
      <Link to="/admin/bugs" search={{ filter: 'open' }} className="bf-summary-card"><span><Bell size={16} className="text-destructive" />Needs attention</span><strong>{n(alerts, bugs.isPending)}</strong><small>New, reopened, retest or info needed</small></Link>
    </div>
    <div className="bf-panel mb-6"><div className="bf-panel-heading"><h2>Bugs at a glance</h2><Link to="/admin/bugs">View all bugs<ArrowUpRight size={12} /></Link></div>
      {bugs.isError ? <p className="p-5 text-xs text-muted-foreground">Bugs could not be loaded.</p> : bugs.isPending ? <p className="p-5 text-xs text-muted-foreground">Loading bugs…</p> : <>
        <div className="bf-glance-row"><strong>Total {bugList.length}</strong><span className="text-muted-foreground">{bugs.data?.open ?? 0} open · {bugs.data?.recheck ?? 0} in retest · {bugs.data?.unassigned ?? 0} unassigned · {bugs.data?.resolved ?? 0} resolved</span></div>
        <div className="bf-glance-grid">
          <div><h3>By status</h3><ul>{statusCounts.map(([s, c]) => <li key={s}><Link to="/admin/bugs" search={{ filter: s }}><span className="bf-status-pill" data-tone={statusTone(s)}><span className="bf-dot" />{label(s)}</span><strong>{c}</strong></Link></li>)}</ul></div>
          <div><h3>By priority</h3><ul>{priorityCounts.map(([p, c]) => <li key={p}><Link to="/admin/bugs" search={{ filter: p }}><span className="font-mono text-[11.5px]">{p}</span><strong>{c}</strong></Link></li>)}</ul></div>
        </div>
        {recent.length > 0 && <div className="bf-glance-recent"><h3>Latest changes</h3><ul>{recent.map(b => <li key={b.id}><Link to="/admin/bugs" search={{ filter: b.status }}><span className="font-mono text-[11.5px] text-muted-foreground">{b.code}</span><span className="flex-1 truncate">{b.title}</span><small className="text-muted-foreground">{b.lastChange!.by} · {new Date(b.lastChange!.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</small></Link></li>)}</ul></div>}
      </>}
    </div>
    <div className="bf-panel mb-6"><div className="bf-panel-heading"><h2>Team</h2><Link to="/admin/users">Manage team<ArrowUpRight size={12} /></Link></div>
      {members.isError ? <p className="p-5 text-xs text-muted-foreground">Members could not be loaded.</p> : list.length === 0 ? <p className="p-5 text-xs text-muted-foreground">{members.isPending ? 'Loading members…' : 'No members yet.'}</p> :
        <ul className="bf-team-list">{list.slice(0, 8).map(m => <li key={m.id}><button type="button" onClick={() => setProfile(m.id)}><span className="bf-avatar">{m.name.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><strong className="bf-person-link block truncate">{m.name}</strong><small className="text-muted-foreground">{m.role === 'qa' ? 'QA' : m.role} · ID {m.id.slice(0, 8)}</small></span><span className="bf-status-pill ml-auto" data-tone={m.active ? 'success' : 'neutral'}><span className="bf-dot" />{m.active ? 'Active' : 'Inactive'}</span></button></li>)}</ul>}
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
