import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipProps } from 'recharts';
import { Activity, ArrowDown, ArrowRightLeft, ArrowUp, Bug, Check, ClipboardCheck, Flag, MessageSquare, Pencil, Search, Trash2, Trophy, UserPlus, UsersRound, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getActivity, getActivityInsights, getActivityPeople, getTeamPerformance } from '@/lib/activity.functions';
import { ACTIVITY_CATEGORIES, ACTIVITY_PERIODS, ACTIVITY_SERIES, ACTIVITY_SOURCES, changeText, durationText, formatWhen, viaLabel, type PersonPerformance, type ActivityFilters, type ActivityInsights, type ActivityRow } from '@/lib/activity';
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
      <section className="bf-panel" aria-labelledby="activity-share">
        <div className="bf-panel-heading"><div><h2 id="activity-share">Activity mix</h2><p className="bf-panel-sub">Share of changes · {periodLabel}</p></div></div>
        {ins ? <MixDonut series={ins.series} /> : <div className="bf-donut-skeleton" />}
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

    <TeamPerformanceSection days={days} periodLabel={periodLabel} onPerson={id => set(setActor)(id)} />

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

/** Part-to-whole donut of the four activity kinds, total in the centre, legend with counts and shares. */
function MixDonut({ series }: { series: ActivityInsights['series'] }) {
  const data = ACTIVITY_SERIES.map((s, i) => ({ key: s.key, name: s.label, value: series[s.key] ?? 0, color: `var(--viz-${i + 1})` }));
  const total = data.reduce((n, d) => n + d.value, 0);
  const pct = (v: number) => (total ? `${Math.round((v / total) * 100)}%` : '0%');
  if (!total) return <p className="px-5 py-10 text-center text-sm text-muted-foreground">No changes in this period</p>;
  return <div className="bf-mix">
    <div className="bf-mix-chart">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data.filter(d => d.value > 0)} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270} paddingAngle={data.filter(d => d.value > 0).length > 1 ? 2 : 0} cornerRadius={4} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
            {data.filter(d => d.value > 0).map(d => <Cell key={d.key} fill={d.color} />)}
          </Pie>
          <Tooltip content={<MixTooltip total={total} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="bf-mix-center" aria-hidden="true"><strong>{total}</strong><span>changes</span></div>
    </div>
    <ul className="bf-mix-legend">{data.map(d => <li key={d.key}><span className="bf-swatch" style={{ background: d.color }} /><span className="truncate">{d.name}</span><b>{d.value}</b><small>{pct(d.value)}</small></li>)}</ul>
  </div>;
}

function MixTooltip({ active, payload, total }: TooltipProps<number, string> & { total: number }) {
  const p = payload?.[0]; if (!active || !p) return null;
  const v = Number(p.value ?? 0);
  return <div className="bf-tooltip"><ul><li><span className="bf-swatch" style={{ background: String(p.payload?.color) }} />{p.name}<b>{v}</b></li></ul><div className="bf-tooltip-total">Share<b>{total ? Math.round((v / total) * 100) : 0}%</b></div></div>;
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

type SortKey = 'name' | 'raised' | 'openNow' | 'submitted' | 'fixed' | 'avgFixDays' | 'reopened' | 'qa';
const PERF_COLUMNS: { key: SortKey; label: string; hint: string }[] = [
  { key: 'raised', label: 'Raised', hint: 'Bugs reported in the period' },
  { key: 'openNow', label: 'Open now', hint: 'Open bugs currently assigned to them' },
  { key: 'submitted', label: 'Sent to QA', hint: 'Fixes moved to “Ready for QA retest”' },
  { key: 'fixed', label: 'Fixed', hint: 'Their bugs verified and resolved in the period' },
  { key: 'avgFixDays', label: 'Avg. fix time', hint: 'First assignment → resolved' },
  { key: 'reopened', label: 'Reopened', hint: 'Their bugs sent back after a failed check' },
  { key: 'qa', label: 'QA checks', hint: 'Verifications passed / failed' },
];
const roleLabel = (r: string) => (r === 'qa' ? 'QA' : r ? r[0]!.toUpperCase() + r.slice(1) : 'Member');

/** Who raised, who fixed, and how fast — per person and overall. */
function TeamPerformanceSection({ days, periodLabel, onPerson }: { days: ActivityFilters['days']; periodLabel: string; onPerson: (id: string) => void }) {
  const fetchPerf = useServerFn(getTeamPerformance);
  const q = useQuery({ queryKey: ['team-performance', days], queryFn: () => fetchPerf({ data: { days } }), retry: 1, staleTime: 30000, refetchInterval: 60000 });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fixed', dir: -1 });
  const t = q.data?.totals; const list = q.data?.people ?? [];
  const value = (p: PersonPerformance, k: SortKey) => k === 'name' ? p.name : k === 'qa' ? p.qaPassed + p.qaFailed : k === 'avgFixDays' ? (p.avgFixDays ?? Number.POSITIVE_INFINITY) : p[k];
  const sorted = [...list].sort((a, b) => { const x = value(a, sort.key), y = value(b, sort.key); return (typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number)) * sort.dir || a.name.localeCompare(b.name); });
  const fastest = list.filter(p => p.avgFixDays != null).sort((a, b) => a.avgFixDays! - b.avgFixDays!)[0];
  const maxBar = Math.max(1, ...list.map(p => Math.max(p.raised, p.fixed)));
  const head = (key: SortKey, label: string, hint?: string) => <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" title={hint} onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'avgFixDays' ? 1 : -1 }))}>{label}{sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th>;

  return <section className="bf-panel mb-6" aria-labelledby="team-perf">
    <div className="bf-panel-heading"><div><h2 id="team-perf">Team performance</h2><p className="bf-panel-sub">Who raised bugs, who fixed them, and how fast · {periodLabel}</p></div>{fastest && <span className="bf-perf-badge"><Trophy size={13} />Fastest fixer · {fastest.name} · {durationText(fastest.avgFixDays)}</span>}</div>
    {q.isError ? <div className="p-4"><ErrorNotice message={actionError(q.error, 'Team performance could not load.')} onRetry={() => q.refetch()} retrying={q.isFetching} /></div> : <>
      <div className="bf-perf-stats">
        <PerfStat label="Bugs raised" value={t ? String(t.raised) : '…'} sub={t ? `${t.openNow} still open` : ''} />
        <PerfStat label="Fixed & verified" value={t ? String(t.fixed) : '…'} sub="Resolved after QA retest" />
        <PerfStat label="Avg. time to fix" value={t ? durationText(t.avgFixDays) : '…'} sub="Assigned → resolved" />
        <PerfStat label="Avg. time to resolve" value={t ? durationText(t.avgResolveDays) : '…'} sub="Reported → resolved" />
        <PerfStat label="Avg. time to assign" value={t ? durationText(t.avgAssignDays) : '…'} sub="Reported → first owner" />
      </div>
      {q.isPending ? <p className="px-5 pb-5 text-sm text-muted-foreground">Loading team performance…</p> : list.length === 0 ? <div className="bf-empty"><span className="bf-empty-icon"><UsersRound size={22} /></span><h3>No bug work in this period</h3><p>Try a longer period. Numbers appear once bugs are raised, assigned and fixed.</p></div> : <div className="bf-perf-body">
        <div className="bf-perf-compare" aria-label="Raised vs fixed by person">
          <div className="bf-perf-compare-head"><h3>Raised vs fixed</h3><ul className="bf-legend-row"><li><span className="bf-swatch" style={{ background: 'var(--viz-1)' }} />Raised</li><li><span className="bf-swatch" style={{ background: 'var(--viz-3)' }} />Fixed</li></ul></div>
          <ul>{list.filter(p => p.raised + p.fixed > 0).sort((a, b) => b.raised + b.fixed - (a.raised + a.fixed)).slice(0, 8).map(p => <li key={p.id} title={`${p.name}: ${p.raised} raised · ${p.fixed} fixed`}>
            <span className="bf-perf-name"><span className="bf-avatar !size-6 !text-[10.5px]">{initials(p.name)}</span><span className="truncate">{p.name}</span></span>
            <span className="bf-perf-bars"><span><i style={{ width: `${(p.raised / maxBar) * 100}%`, background: 'var(--viz-1)' }} /><b>{p.raised}</b></span><span><i style={{ width: `${(p.fixed / maxBar) * 100}%`, background: 'var(--viz-3)' }} /><b>{p.fixed}</b></span></span>
          </li>)}</ul>
        </div>
        <div className="bf-table-wrap"><table className="bf-table bf-perf-table"><thead><tr>{head('name', 'Person')}{PERF_COLUMNS.map(c => <Fragment key={c.key}>{head(c.key, c.label, c.hint)}</Fragment>)}</tr></thead>
          <tbody>{sorted.map(p => <tr key={p.id}>
            <td><button type="button" className="bf-perf-person" onClick={() => onPerson(p.id)} title="Show this person’s activity"><span className="bf-avatar !size-7 !text-[11px]">{initials(p.name)}</span><span className="min-w-0"><strong className="block truncate">{p.name}</strong><small>{roleLabel(p.role)}{!p.current && ' · former'}</small></span></button></td>
            <td>{p.raised || <Dim />}</td><td>{p.openNow || <Dim />}</td><td>{p.submitted || <Dim />}</td>
            <td>{p.fixed ? <span className="bf-perf-fixed"><Check size={13} />{p.fixed}</span> : <Dim />}</td>
            <td>{p.avgFixDays == null ? <Dim /> : <span className="bf-perf-speed" data-speed={p.avgFixDays <= 2 ? 'fast' : p.avgFixDays <= 7 ? 'ok' : 'slow'}>{durationText(p.avgFixDays)}</span>}</td>
            <td>{p.reopened ? <span className="text-destructive">{p.reopened}</span> : <Dim />}</td>
            <td>{p.qaPassed + p.qaFailed ? <span className="bf-perf-qa"><span className="text-success">{p.qaPassed} ✓</span><span className="text-destructive">{p.qaFailed} ✗</span></span> : <Dim />}</td>
          </tr>)}</tbody></table></div>
      </div>}
    </>}
  </section>;
}
const Dim = () => <span className="text-muted-foreground">—</span>;
function PerfStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="bf-perf-stat"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}
