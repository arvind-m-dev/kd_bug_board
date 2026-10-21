import { useState } from 'react';
import { SkeletonRows } from './loading';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Link } from '@tanstack/react-router';
import { Bell, Bug, ArrowRight, MessageSquare, UserCheck, ClipboardCheck, Flag, Trash2, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getNotifications, updateNotifications } from '@/lib/notifications.functions';
import { NOTIFICATION_DAYS, notificationLabel, notificationTone, type NotificationItem } from '@/lib/notifications';
import { ConfirmAction, ErrorNotice, actionError } from './action-feedback';

const when = (at: string) => {
  const d = new Date(at); const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now'; if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} h ago`;
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};
const iconFor = (a: string) => a.startsWith('member.') || a.startsWith('portal.') ? UserCheck : a.includes('comment') ? MessageSquare : a.includes('assign') ? UserCheck : a.includes('verify') ? ClipboardCheck : a.includes('priority') ? Flag : Bug;
const status = (s: string) => s ? s.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : '';

function useNotifications(limit: number) {
  const fn = useServerFn(getNotifications);
  return useQuery({ queryKey: ['notifications', limit], queryFn: () => fn({ data: { limit } }), retry: false, staleTime: 30000, refetchInterval: 60000 });
}
function useMark() {
  const fn = useServerFn(updateNotifications); const qc = useQueryClient();
  return useMutation({ mutationFn: (kind: 'read' | 'clear') => fn({ data: { kind } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
}

function Item({ n, onClick }: { n: NotificationItem; onClick?: () => void }) {
  const Icon = iconFor(n.action);
  return <Link to={n.action.startsWith("bug.") ? "/admin/bugs" : "/admin/users"} onClick={onClick} className={`bf-notice ${n.unread ? 'bf-notice-unread' : ''}`}>
    <span className="bf-notice-icon"><Icon size={17} /></span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2"><strong className="text-sm">{notificationLabel(n.action)}</strong>{n.unread && <span className="bf-notice-dot" data-tone={notificationTone(n.action, n.status)} aria-label="Unread" />}{n.status && <span className="bf-notice-tag ml-auto">{status(n.status)}</span>}</span>
      <span className="block truncate text-xs text-muted-foreground">{n.title || (n.action.startsWith('bug.') ? 'Bug update' : 'Team & access')} · by {n.actor}</span>
      <span className="block text-xs text-muted-foreground">{when(n.at)}</span>
    </span>
  </Link>;
}

export function NotificationMenu() {
  const [open, setOpen] = useState(false); const q = useNotifications(5); const mark = useMark();
  const unread = q.data?.unread ?? 0;
  return <Popover open={open} onOpenChange={o => { setOpen(o); if (!o && unread) mark.mutate('read'); }}>
    <PopoverTrigger asChild><Button size="icon" variant="ghost" className="relative" aria-label={`Notifications${unread ? `: ${unread} unread` : ''}`}><Bell size={17} />{unread > 0 && <span className="bf-badge">{unread > 99 ? '99+' : unread}</span>}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[380px] p-0">
      <div className="flex items-center justify-between border-b px-4 py-3"><strong className="text-sm">Notifications</strong>{unread > 0 && <span className="bf-unread-pill">{unread} unread</span>}</div>
      <div className="grid max-h-[360px] gap-2 overflow-y-auto p-3">
        {q.isPending ? <p className="text-xs text-muted-foreground">Loading…</p>
          : q.isError ? <ErrorNotice message={actionError(q.error, 'Notifications could not be loaded.')} onRetry={() => q.refetch()} />
          : !q.data.items.length ? <p className="py-6 text-center text-xs text-muted-foreground">You’re all caught up.</p>
          : q.data.items.map(n => <Item key={n.id} n={n} onClick={() => setOpen(false)} />)}
      </div>
      <div className="border-t p-3"><Button asChild variant="secondary" className="w-full"><Link to="/admin/notifications" onClick={() => setOpen(false)}>View all notifications<ArrowRight /></Link></Button></div>
    </PopoverContent>
  </Popover>;
}

export function NotificationsPage() {
  const q = useNotifications(200); const mark = useMark();
  const [tab, setTab] = useState<'all' | 'unread'>('all'); const [confirm, setConfirm] = useState(false);
  if (q.isPending) return <SkeletonRows rows={5} label="Loading notifications" />;
  if (q.isError) return <ErrorNotice message={actionError(q.error, 'Notifications could not be loaded.')} onRetry={() => q.refetch()} />;
  const items = tab === 'unread' ? q.data.items.filter(n => n.unread) : q.data.items;
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={tab === 'all' ? 'default' : 'outline'} onClick={() => setTab('all')}>All ({q.data.total})</Button>
      <Button size="sm" variant={tab === 'unread' ? 'default' : 'outline'} onClick={() => setTab('unread')}>Unread ({q.data.unread})</Button>
      <span className="text-xs text-muted-foreground">Showing the last {NOTIFICATION_DAYS} days</span>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" disabled={!q.data.unread || mark.isPending} onClick={() => mark.mutate('read')}><CheckCheck />Mark all read</Button>
        <Button size="sm" variant="outline" disabled={!q.data.total} onClick={() => setConfirm(true)}><Trash2 />Clear all</Button>
        <ConfirmAction open={confirm} onOpenChange={setConfirm} destructive title="Clear notifications?" description={`This clears all notifications from the last ${NOTIFICATION_DAYS} days. Bug history is kept.`} confirmLabel="Clear all" onConfirm={async () => { await mark.mutateAsync('clear'); }} />
      </div>
    </div>
    {items.length ? <div className="grid gap-2">{items.map(n => <Item key={n.id} n={n} />)}</div>
      : <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">No notifications in the last {NOTIFICATION_DAYS} days.</p>}
  </div>;
}
