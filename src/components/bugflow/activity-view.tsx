import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { Activity, ArrowRightLeft, Bug, ClipboardCheck, Flag, MessageSquare, Pencil, Search, Trash2, UserPlus, UsersRound, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getActivity, getActivityInsights, getActivityPeople } from '@/lib/activity.functions';
import { ACTIVITY_CATEGORIES, ACTIVITY_PERIODS, ACTIVITY_SERIES, ACTIVITY_SOURCES, changeText, formatWhen, viaLabel, type ActivityFilters, type ActivityInsights, type ActivityRow } from '@/lib/activity';
import { notificationLabel } from '@/lib/notifications';
import { ThemedSelect } from './themed-select';
import { ErrorNotice, actionError } from './action-feedback';

/** Icon + tone per activity kind, shared by the timeline and the category breakdown. */
const KIND: Record<string, { icon: LucideIcon; tone: string }> = {
  created: { icon: Bug, tone: 'info' }, status: { icon: ArrowRightLeft, tone: 'teal' }, verify: { icon: ClipboardCheck, tone: 'success' },
  priority: { icon: Flag, tone: 'warning' }, assign: { icon: UserPlus, tone: 'violet' }, comment: { icon: MessageSquare, tone: 'neutral' },
  edited: { icon: Pencil, tone: 'neutral' }, deleted: { icon: Trash2, tone: 'danger' }, team: { icon: UsersRound, tone: 'neutral' },
};
function kindOf(action: string) {
  if (action === 'bug.created' || action === 'bug.sample_created') return 'created';
  if (action === 'bug.severity') return 'priority';
  const k = action.replace(/^bug\./, '');
  return KIND[k] ? k : 'team';
}
const categoryLabel = (key: string) => ACTIVITY_CATEGORIES.find(c => c.key === key)?.label ?? key;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
const dayKey = (at: string) => new Date(at).toDateString();
function dayHeading(at: string) {
  const d = new Date(at); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const time = (at: string) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function ActivityView() {
  const fetchRows = useServerFn(getActivity); const fetchInsights = useServerFn(getActivityInsights); const fetchPeople = useServerFn(getActivityPeople);
  const [type, setType] = useState('all'); const [days, setDays] = useState<ActivityFilters['days']>(30);
  const [actor, setActor] = useState(''); const [via, setVia] = useState('all');
  const [searchText, setSearchText] = useState(''); const [query, setQuery] = useState('');
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]); const [page, setPage] = useState(0);
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }, []);
  // Search applies after a short pause so typing doesn't fire a request per key.
  useEffect(() => { const t = setTimeout(() => { setQuery(searchText.trim()); setPages([undefined]); setPage(0); }, 350); return () => clearTimeout(t); }, [searchText]);
  const filters: ActivityFilters = { type, days, query, tz, ...(actor ? { actor } : {}), ...(via !== 'all' ? { via: via as NonNullable<ActivityFilters['via']> } : {}) };
  const cursor = pages[page];
  const rows = useQuery({ queryKey: ['activity', filters, cursor ?? ''], queryFn: () => fetchRows({ data: { ...filters, ...(cursor ? { cursor } : {}) } }), retry: 1, staleTime: 15000, refetchInterval: 30000 });
  const insights = useQuery({ queryKey: ['activity-insights', filters], queryFn: () => fetchInsights({ data: filters }), retry: 1, staleTime: 15000, refetchInterval: 60000 });
  const people = useQuery({ queryKey: ['activity-people'], queryFn: () => fetchPeople(), staleTime: 60000 });
  const reset = () => { setPages([undefined]); setPage(0); };
  const set = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); reset(); };
  const list = rows.data?.rows ?? []; const nextCursor = rows.data?.nextCursor ?? '';
  const personName = people.data?.find(p => p.id === actor)?.name ?? 'Selected person';
  const chips = [
    type !== 'all' && { label: categoryLabel(type), clear: () => set(setType)('all') },
    actor && { label: personName, clear: () => set(setActor)('') },
    via !== 'all' && { label: ACTIVITY_SOURCES.find(s => s.value === via)?.label ?? via, clear: () => set(setVia)('all') },
    query && { label: `“${query}”`, clear: () => setSearchText('') },
  ].filter(Boolean) as { label: string; clear: () => void }[];
  const ins = insights.data; const periodLabel = days ? `last ${days} days` : 'all time';

  return <>
    <div className="bf-toolbar">
      <div className="bf-search"><Search /><Input aria-label="Search activity" placeholder="Search by bug ID, title or person…" value={searchText} onChange={e => setSearchText(e.target.value)} /></div>
      <ThemedSelect label="Activity type" value={type} onChange={set(setType)} options={ACTIVITY_CATEGORIES.map(c => ({ value: c.key, label: c.label }))} />
      <ThemedSelect label="Person" value={actor || 'all'} onChange={v => set(setActor)(v === 'all' ? '' : v)} options={[{ value: 'all', label: 'Everyone' }, ...(people.data ?? []).map(p => ({ value: p.id, label: p.name }))]} />
      <ThemedSelect label="Source" value={via} onChange={set(setVia)} options={ACTIVITY_SOURCES} />
      <ThemedSelect label="Period" value={String(days)} onChange={v => set(setDays)(Number(v) as ActivityFilters['days'])} options={ACTIVITY_PERIODS} />
    </div>
    {chips.length > 0 && <div className="bf-chips"><span>Filtered by</span>{chips.map(c => <button key={c.label} type="button" className="bf-chip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>{c.label}<X size={12} /></button>)}<Button size="sm" variant="ghost" onClick={() => { setType('all'); setActor(''); setVia('all'); setSearchText(''); reset(); }}>Clear all</Button></div>}

    {insights.isError && <ErrorNotice message={actionError(insights.error, 'Activity insights could not load.')} onRetry={() => insights.refetch()} retrying={insights.isFetching} />}
    <div className="bf-kpi-grid">
      <Tile label="Changes" value={ins?.totals.events} foot={`Recorded in the ${periodLabel}`} />
      <Tile label="Bugs touched" value={ins?.totals.bugs} foot="Distinct bugs with any change" />
      <Tile label="People active" value={ins?.totals.people} foot="Made at least one change" />
      <Tile label="Resolved · reopened" value={ins ? `${ins.totals.resolved} · ${ins.totals.reopened}` : undefined} foot="Fixes passed vs sent back" />
    </div>

    <div className="bf-activity-grid">
      <section className="bf-panel bf-chart-panel" aria-labelledby="activity-trend">
        <div className="bf-panel-heading"><div><h2 id="activity-trend">Activity over time</h2><p className="bf-panel-sub">Changes per day · {ins ? `last ${ins.windowDays} days` : '…'}</p></div>
          <ul className="bf-legend-row" aria-label="Legend">{ACTIVITY_SERIES.map((s, i) => <li key={s.key}><span className="bf-swatch" style={{ background: `var(--viz-${i + 1})` }} />{s.label}</li>)}</ul></div>
        <div className="bf-chart-body">{ins ? <TrendChart data={ins.daily} /> : <div className="bf-chart-skeleton" />}</div>
      </section>
      <section className="bf-panel" aria-labelledby="activity-mix">
        <div className="bf-panel-heading"><div><h2 id="activity-mix">What changed</h2><p className="bf-panel-sub">Click a row to filter</p></div></div>
        <BarList empty="No changes yet" items={(ins?.categories ?? []).map(c => ({ id: c.key, label: categoryLabel(c.key), count: c.count, icon: KIND[c.key]?.icon, tone: KIND[c.key]?.tone, active: type === c.key }))} onPick={id => set(setType)(type === id ? 'all' : id)} />
      </section>
      <section className="bf-panel" aria-labelledby="activity-people">
        <div className="bf-panel-heading"><div><h2 id="activity-people">Most active</h2><p className="bf-panel-sub">Click a person to filter</p></div></div>
        <BarList empty="No one yet" items={(ins?.people ?? []).map(p => ({ id: p.id, label: p.name, count: p.count, avatar: initials(p.name), active: actor === p.id }))} onPick={id => set(setActor)(actor === id ? '' : id)} />
      </section>
    </div>

    {rows.isError && <ErrorNotice message={actionError(rows.error, 'Activity could not load. Try again.')} onRetry={() => rows.refetch()} retrying={rows.isFetching} />}
    <section className="bf-panel" aria-labelledby="activity-log">
      <div className="bf-panel-heading"><div><h2 id="activity-log">Activity log</h2><p className="bf-panel-sub">Every change, newest first</p></div>{rows.isFetching && <span className="bf-tag">Updating…</span>}</div>
      {rows.isLoading ? <p className="p-5 text-sm text-muted-foreground">Loading activity…</p> : list.length === 0 && !rows.isError
        ? <div className="bf-empty"><span className="bf-empty-icon"><Activity size={22} /></span><h3>No activity matches these filters</h3><p>Try a longer period or remove a filter.</p></div>
        : <Timeline rows={list.slice(0, 50)} />}
      {list.length > 0 && <div className="bf-table-footer"><span>Page {page + 1} · {Math.min(list.length, 50)} changes</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page === 0 || rows.isFetching} onClick={() => setPage(p => p - 1)}>Newer</Button><Button variant="outline" size="sm" disabled={!nextCursor || rows.isFetching} onClick={() => { const next = [...pages]; next[page + 1] = nextCursor; setPages(next); setPage(page + 1); }}>Older</Button></div></div>}
    </section>
  </>;
}

function Tile({ label, value, foot }: { label: string; value: number | string | undefined; foot: string }) {
  return <div className="bf-kpi bf-kpi-static"><span className="bf-kpi-label">{label}</span><span className="bf-kpi-value">{value ?? '…'}</span><span className="bf-kpi-foot">{foot}</span></div>;
}

function TrendChart({ data }: { data: ActivityInsights['daily'] }) {
  const every = data.length > 45 ? 14 : data.length > 14 ? 7 : 1;
  return <ResponsiveContainer width="100%" height="100%" minHeight={260}>
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap={data.length > 45 ? 1 : '22%'}>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
      <XAxis dataKey="day" tickFormatter={shortDay} interval={every - 1} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} axisLine={false} tickLine={false} />
      <YAxis allowDecimals={false} tickCount={5} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
      <Tooltip cursor={{ fill: 'color-mix(in oklab, var(--foreground) 6%, transparent)' }} content={<TrendTooltip />} />
      {ACTIVITY_SERIES.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={`var(--viz-${i + 1})`} stroke="var(--card)" strokeWidth={1} radius={i === ACTIVITY_SERIES.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />)}
    </BarChart>
  </ResponsiveContainer>;
}

function TrendTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((n, p) => n + Number(p.value ?? 0), 0);
  return <div className="bf-tooltip"><strong>{new Date(`${label}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
    <ul>{[...payload].reverse().map(p => <li key={String(p.dataKey)}><span className="bf-swatch" style={{ background: String(p.color) }} />{p.name}<b>{p.value}</b></li>)}</ul>
    <div className="bf-tooltip-total">Total<b>{total}</b></div></div>;
}

function BarList({ items, onPick, empty }: { items: { id: string; label: string; count: number; icon?: LucideIcon | undefined; tone?: string | undefined; avatar?: string; active: boolean }[]; onPick: (id: string) => void; empty: string }) {
  if (!items.length) return <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map(i => i.count));
  return <ul className="bf-barlist">{items.map(i => <li key={i.id}><button type="button" data-active={i.active || undefined} onClick={() => onPick(i.id)}>
    <span className="bf-barlist-label">{i.icon ? <span className="bf-kind" data-tone={i.tone}><i.icon size={13} /></span> : <span className="bf-avatar !size-6 !text-[10.5px]">{i.avatar}</span>}<span className="truncate">{i.label}</span></span>
    <span className="bf-barlist-track"><i style={{ width: `${Math.max(3, (i.count / max) * 100)}%` }} /></span>
    <b>{i.count}</b></button></li>)}</ul>;
}

function Timeline({ rows }: { rows: ActivityRow[] }) {
  const groups: { key: string; heading: string; rows: ActivityRow[] }[] = [];
  for (const r of rows) { const k = dayKey(r.at); const g = groups[groups.length - 1]; if (g && g.key === k) g.rows.push(r); else groups.push({ key: k, heading: dayHeading(r.at), rows: [r] }); }
  return <div className="bf-timeline">{groups.map(g => <div key={g.key} className="bf-timeline-day">
    <h3>{g.heading}<span>{g.rows.length} change{g.rows.length === 1 ? '' : 's'}</span></h3>
    <ol>{g.rows.map(r => { const k = KIND[kindOf(r.action)]!; const Icon = k.icon; const change = changeText(r); return <li key={r.id}>
      <span className="bf-kind" data-tone={k.tone}><Icon size={14} /></span>
      <div className="bf-timeline-main">
        <p className="bf-timeline-title"><strong>{notificationLabel(r.action)}</strong>{r.bugId && <span className="bf-timeline-bug"><code>{r.bugCode}</code>{r.bugTitle && <span className="truncate">{r.bugTitle}</span>}</span>}</p>
        {change && <p className="bf-timeline-change">{change}</p>}
      </div>
      <div className="bf-timeline-meta"><span className="bf-timeline-actor"><span className="bf-avatar !size-6 !text-[10.5px]">{initials(r.actor)}</span>{r.actor || '—'}</span><span className="bf-tag">{viaLabel(r.via)}</span><time dateTime={r.at} title={formatWhen(r.at)}>{time(r.at)}</time></div>
    </li>; })}</ol>
  </div>)}</div>;
}
