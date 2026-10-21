import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SkeletonRows } from './loading';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { Search, UsersRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getPersonDetail, getPersonOverview, getTeamDetail } from '@/lib/person-reports.functions';
import { getBugWorkspace } from '@/lib/bug-workflow.functions';
import { OUTCOMES, acceptanceRate, outcomeCounts, passRate, reportFocus, teamMetrics, type Counts, type PersonMetrics, type PersonRecentBug } from '@/lib/person-reports';
import { durationText, roleName, statusText } from '@/lib/activity';
import { periodLabel as describePeriod, viewerTimeZone, type Period } from '@/lib/period';
import { PeriodPicker } from './period-picker';
import { DEFAULT_SEVERITIES, PRIORITIES, severityLevel, type BugAccess } from '@/lib/bug-workflow';
import { PriorityBadge, SeverityBadge } from './bug-workspace';
import { ThemedSelect } from './themed-select';
import { ErrorNotice, actionError } from './action-feedback';

const admin: BugAccess = { kind: 'admin' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
const FOCUS_LABEL = { tester: 'Tester', developer: 'Developer', qa: 'QA', admin: 'Admin' } as const;
const ROLE_FILTERS = [{ value: 'all', label: 'All roles' }, { value: 'tester', label: 'Testers' }, { value: 'developer', label: 'Developers' }, { value: 'qa', label: 'QA' }, { value: 'admin', label: 'Admin' }];
const OUTCOME_COLORS: Record<string, string> = { fixed: 'var(--success)', open: 'var(--info)', notabug: 'var(--sev-5)', duplicate: 'var(--violet)', wontfix: 'var(--warning)' };
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The four numbers that matter most for this person's role. */
function headline(m: PersonMetrics, o: ReturnType<typeof outcomeCounts>): [string, ReactNode][] {
  if (m.role === 'team') return [['Bugs raised', m.raised], ['Fixed & verified', o.fixed], ['Reopened', m.ownedReopened], ['Avg. fix time', durationText(m.avgFixDays)]];
  switch (reportFocus(m)) {
    case 'developer': return [['Assigned', m.owned], ['Sent to QA', m.sentToQa], ['Fixed', m.fixed], ['Reopened', m.ownedReopened]];
    case 'qa': return [['Validated', m.validated], ['Rejected', m.rejected], ['Retests', m.qaPassed + m.qaFailed], ['Pass rate', pct(passRate(m))]];
    case 'admin': return [['Raised', m.raised], ['Validated', m.validated], ['Revalidated', m.revalidated], ['Total changes', m.changes]];
    default: return [['Raised', m.raised], ['Fixed', o.fixed], ['Not a bug', o.notabug], ['Accepted', pct(acceptanceRate(m))]];
  }
}

/** Severity order from Settings, so badges and bars use the same colours as the bug table. */
function useSeverities() {
  const fetch = useServerFn(getBugWorkspace);
  const q = useQuery({ queryKey: ['bug-workspace', admin, undefined], queryFn: () => fetch({ data: { access: admin } }), staleTime: 30000 });
  return q.data?.options.severities ?? DEFAULT_SEVERITIES;
}

export function TeamReports() {
  const search = useSearch({ from: '/admin_/reports' }); const navigate = useNavigate();
  const fetch = useServerFn(getPersonOverview); const fetchDetail = useServerFn(getPersonDetail); const client = useQueryClient();
  const prefetch = (person: string) => void client.prefetchQuery({ queryKey: ['person-detail', person, period], queryFn: () => fetchDetail({ data: { person, ...period, tz } }), staleTime: 30000 });
  const [period, setPeriod] = useState<Period>({ days: 0 }); const tz = useMemo(viewerTimeZone, []); const [role, setRole] = useState('all'); const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['person-overview', period], queryFn: () => fetch({ data: { ...period, tz } }), placeholderData: keepPreviousData, retry: 1, staleTime: 30000, refetchInterval: 60000 });
  const people = useMemo(() => (q.data ?? []).filter(m => (role === 'all' || reportFocus(m) === role) && m.name.toLowerCase().includes(text.trim().toLowerCase())), [q.data, role, text]);
  // Selected person from the URL; none selected shows the whole team. Clicking the selected person again deselects.
  const selected = people.find(m => m.id === search.person) ?? null;
  const select = (id: string | null) => void navigate({ to: '/admin/reports', search: id ? { person: id } : {}, replace: true });
  const toggle = (id: string) => select(selected?.id === id ? null : id);
  // Keep the highlighted name visible (the list scrolls sideways on phones).
  useEffect(() => { document.getElementById(selected ? `person-${selected.id}` : 'person-team')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected?.id]);
  function onKey(e: KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    // -1 = Whole team, then each person.
    const i = selected ? people.findIndex(m => m.id === selected.id) : -1; const j = Math.min(people.length - 1, Math.max(-1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    const next = j < 0 ? null : people[j]!; select(next?.id ?? null);
    requestAnimationFrame(() => document.getElementById(next ? `person-${next.id}` : 'person-team')?.focus());
  }
  return <>
    <div className="bf-toolbar">
      <div className="bf-search"><Search /><Input aria-label="Search people" placeholder="Search people…" value={text} onChange={e => setText(e.target.value)} /></div>
      <ThemedSelect label="Role" value={role} onChange={setRole} options={ROLE_FILTERS} />
      <PeriodPicker value={period} onChange={setPeriod} />
    </div>
    {q.isError && <ErrorNotice message={actionError(q.error, 'Team reports could not load.')} onRetry={() => q.refetch()} retrying={q.isFetching} />}
    {q.isPending ? <div className="bf-reports"><div className="bf-people"><SkeletonRows rows={6} label="Loading people" /></div><div className="bf-report-loading" role="status"><span /><span /><span /></div></div>
      : people.length === 0 ? <div className="bf-panel bf-empty"><span className="bf-empty-icon"><UsersRound size={22} /></span><h3>No one matches</h3><p>Try another role or clear the search.</p></div>
      : <div className="bf-reports">
        <aside className="bf-people" aria-label="Team members">
          <p className="bf-people-count">{plural(people.length, 'person').replace('persons', 'people')}</p>
          <ul role="listbox" aria-label="Choose a person" aria-activedescendant={selected ? `person-${selected.id}` : 'person-team'} onKeyDown={onKey}>
            <li><button type="button" id="person-team" role="option" aria-selected={!selected} tabIndex={selected ? -1 : 0} className="bf-person-item bf-person-team" onClick={() => select(null)}>
              <span className="bf-avatar !size-9"><UsersRound size={16} /></span>
              <span className="min-w-0 flex-1"><strong className="block truncate">Whole team</strong><small className="block truncate">Totals across {plural((q.data ?? []).length, 'person').replace('persons', 'people')}</small></span>
            </button></li>
            {people.map(m => { const on = m.id === selected?.id; const focus = reportFocus(m); return <li key={m.id}>
              <button type="button" id={`person-${m.id}`} role="option" aria-selected={on} tabIndex={on ? 0 : -1} className="bf-person-item" onClick={() => toggle(m.id)} title={on ? 'Click again to show the whole team' : undefined} onMouseEnter={() => prefetch(m.id)} onFocus={() => prefetch(m.id)}>
                <span className="bf-avatar !size-9 !text-[12px]">{initials(m.name)}</span>
                <span className="min-w-0 flex-1"><strong className="block truncate">{m.name}</strong><small className="block truncate">{roleName(m.role) || FOCUS_LABEL[focus]}{!m.current && ' · former'} · {keyMetric(m)}</small>
                  <MiniStrip counts={focus === 'developer' ? m.ownedByPriority : m.raisedByPriority} /></span>
              </button></li>; })}
          </ul>
        </aside>
        <div className="bf-reports-detail" aria-live="polite">{selected ? <PersonDetailView person={selected.id} period={period} tz={tz} /> : <TeamDetailView people={q.data ?? []} period={period} updating={q.isPlaceholderData} />}</div>
      </div>}
  </>;
}

/** Short summary for the people list. */
function keyMetric(m: PersonMetrics) {
  switch (reportFocus(m)) {
    case 'developer': return `${m.fixed} fixed · ${m.owned} assigned`;
    case 'qa': return `${m.validated} validated · ${m.qaPassed + m.qaFailed} retests`;
    case 'admin': return `${m.raised} raised · ${m.validated} validated`;
    default: return `${m.raised} raised · ${outcomeCounts(m.raisedByStatus).fixed} fixed`;
  }
}

/** Thin P0–P5 bar under each name in the list. */
function MiniStrip({ counts }: { counts: Counts }) {
  const shown = PRIORITIES.filter(p => counts[p]);
  if (!shown.length) return null;
  return <span className="bf-ministrip" aria-hidden="true">{shown.map(p => <i key={p} data-pri={p} style={{ flexGrow: counts[p] }} />)}</span>;
}

/* ───────────── Detail: everything about one person ───────────── */

function PersonDetailView({ person, period, tz }: { person: string; period: Period; tz: string }) {
  const fetch = useServerFn(getPersonDetail); const severities = useSeverities();
  const q = useQuery({ queryKey: ['person-detail', person, period], queryFn: () => fetch({ data: { person, ...period, tz } }), placeholderData: keepPreviousData, retry: 1, staleTime: 30000 });
  const d = q.data; const m = d?.metrics;
  if (q.isError) return <ErrorNotice message={actionError(q.error, 'This report could not load.')} onRetry={() => q.refetch()} retrying={q.isFetching} />;
  if (!m) return <div className="bf-report-loading" role="status"><span /><span /><span /></div>;
  return <div data-updating={q.isPlaceholderData || undefined}><PersonReport m={m} trend={d.trend} recent={d.recent} severities={severities} periodLabel={describePeriod(period)} /></div>;
}

function TeamDetailView({ people, period, updating }: { people: PersonMetrics[]; period: Period; updating: boolean }) {
  const fetch = useServerFn(getTeamDetail); const severities = useSeverities();
  const q = useQuery({ queryKey: ['team-detail'], queryFn: () => fetch(), retry: 1, staleTime: 30000, refetchInterval: 60000 });
  const m = useMemo(() => teamMetrics(people), [people]);
  return <div data-updating={updating || undefined}><PersonReport m={m} trend={q.data?.trend ?? []} recent={q.data?.recent ?? []} severities={severities} periodLabel={`${plural(people.length, 'person').replace('persons', 'people')} · ${describePeriod(period)}`} /></div>;
}

function PersonReport({ m, trend, recent, severities, periodLabel }: { m: PersonMetrics; trend: { week: string; raised: number; fixed: number }[]; recent: PersonRecentBug[]; severities: readonly string[]; periodLabel: string }) {
  const focus = reportFocus(m); const o = outcomeCounts(m.raisedByStatus); const team = m.role === 'team';
  const showDev = m.owned + m.sentToQa + m.fixed > 0 || focus === 'developer';
  const showTriage = m.validated + m.rejected + m.revalidated + m.needsInfo > 0 || focus === 'qa';
  const showRetests = m.qaPassed + m.qaFailed > 0 || focus === 'qa';
  const showRaised = m.raised > 0 || focus === 'tester';
  const sevKeys = [...severities, ...Object.keys(m.raisedBySeverity).filter(s => !severities.includes(s))];
  return <>
    <section className="bf-person-hero">
      <span className="bf-avatar !size-14 !text-lg">{team ? <UsersRound size={24} /> : initials(m.name)}</span>
      <div className="min-w-0"><h2>{m.name}</h2><p>{team ? periodLabel : <>{roleName(m.role) || FOCUS_LABEL[focus]}{!m.current && ' · former member'} · {periodLabel}</>}</p></div>
      <div className="bf-person-hero-stats">{headline(m, o).map(([k, v]) => <span key={k}><b>{v}</b><small>{k}</small></span>)}</div>
    </section>

    {showRaised && <>
      <h3 className="bf-report-heading">Bugs raised</h3>
      <div className="bf-report-grid bf-report-grid-raised">
        <Panel title="Priority & severity" sub={`${plural(m.raised, 'bug')} raised${team ? ' by the team' : ''}`}>
          <div className="bf-ps">
            <div><h4>Priority · how soon</h4><Bars rows={PRIORITIES.map(p => ({ key: p, label: <PriorityBadge value={p} />, value: m.raisedByPriority[p] ?? 0, attr: { 'data-pri': p } }))} /></div>
            <div><h4>Severity · how bad</h4><Bars rows={sevKeys.map(sv => ({ key: sv, label: <SeverityBadge value={sv} list={severities} />, value: m.raisedBySeverity[sv] ?? 0, attr: { 'data-sev': String(severityLevel(sv, severities)) } }))} /></div>
          </div>
        </Panel>
        <Panel title="What happened to them" sub="Current outcome of each raised bug">
          <OutcomeDonut counts={o} />
          <div className="bf-report-facts"><Fact label="Accepted as real bugs" value={pct(acceptanceRate(m))} /><Fact label="Reopened after a fix" value={m.raisedReopened} /><Fact label="Revalidated after rejection" value={m.raisedRevalidated} /></div>
        </Panel>
      </div>
    </>}

    {showDev && <>
      <h3 className="bf-report-heading">Fixing bugs</h3>
      <div className="bf-report-grid">
        <Panel title="Fix work" sub={team ? 'All assigned work' : 'Bugs assigned to them'}>
          <div className="bf-report-tiles"><Tile label="Assigned" value={m.owned} /><Tile label="Open now" value={m.ownedOpen} /><Tile label="Sent to QA" value={m.sentToQa} /><Tile label="Fixed & verified" value={m.fixed} tone="success" /><Tile label="Reopened" value={m.ownedReopened} tone={m.ownedReopened ? 'danger' : undefined} /><Tile label="Avg. fix time" value={durationText(m.avgFixDays)} /></div>
          <Meter label="First-time fix rate" value={m.fixed + m.ownedReopened ? Math.round((m.fixed / (m.fixed + m.ownedReopened)) * 100) : null} hint="Fixed ÷ (fixed + reopened)" />
        </Panel>
        <Panel title="Assigned by priority" sub={plural(m.owned, 'bug')}><Bars rows={PRIORITIES.map(p => ({ key: p, label: <PriorityBadge value={p} />, value: m.ownedByPriority[p] ?? 0, attr: { 'data-pri': p } }))} /></Panel>
      </div>
    </>}

    {(showTriage || showRetests) && <>
      <h3 className="bf-report-heading">Reviews & QA decisions</h3>
      <div className="bf-report-grid">
        {showTriage && <Panel title="Triage decisions" sub={team ? 'Status changes by the team' : 'Status changes they made'}>
          <Bars rows={[{ key: 'v', label: 'Validated', value: m.validated }, { key: 'r', label: <span title="Not a bug, duplicate or won’t fix">Rejected</span>, value: m.rejected }, { key: 'rv', label: 'Revalidated', value: m.revalidated }, { key: 'ni', label: 'Asked for more info', value: m.needsInfo }]} />
        </Panel>}
        {showRetests && <Panel title="Fix retests" sub="QA verifications">
          <div className="bf-report-tiles"><Tile label="Passed" value={m.qaPassed} tone="success" /><Tile label="Failed" value={m.qaFailed} tone={m.qaFailed ? 'danger' : undefined} /></div>
          <Meter label="Pass rate" value={passRate(m)} hint="Passed ÷ all retests" />
        </Panel>}
      </div>
    </>}

    <div className="bf-report-grid bf-report-grid-wide">
      <Panel title="Weekly trend" sub="Raised vs fixed · last 12 weeks" legend={[['Raised', 'var(--viz-1)'], ['Fixed', 'var(--viz-3)']]}><TrendBars data={trend} /></Panel>
      <Panel title="Recent bugs" sub={team ? 'Latest changes across the team' : 'Raised by or assigned to them'}>
        {recent.length ? <ul className="bf-recent bf-recent-scroll">{recent.map(b => <li key={b.id}>
          <code>{b.code}</code><span className="truncate" title={b.title}>{b.title}</span>
          <span className="bf-recent-meta"><PriorityBadge value={b.priority} />{b.relation !== 'team' && <span className="bf-tag">{b.relation === 'both' ? 'Raised & fixing' : b.relation === 'raised' ? 'Raised by them' : 'Assigned to them'}</span>}<span className="bf-recent-status">{statusText(b.status)}</span></span>
        </li>)}</ul> : <p className="px-5 py-6 text-sm text-muted-foreground">No bugs yet</p>}
      </Panel>
    </div>
  </>;
}

/* ───────────── Building blocks ───────────── */

function Panel({ title, sub, legend, children }: { title: string; sub?: string; legend?: [string, string][]; children: ReactNode }) {
  return <section className="bf-panel bf-report-panel"><div className="bf-panel-heading"><div><h2>{title}</h2>{sub && <p className="bf-panel-sub">{sub}</p>}</div>
    {legend && <ul className="bf-legend-row">{legend.map(([l, c]) => <li key={l}><span className="bf-swatch" style={{ background: c }} />{l}</li>)}</ul>}</div>
    <div className="bf-report-body">{children}</div></section>;
}

function Bars({ rows }: { rows: { key: string; label: ReactNode; value: number; attr?: Record<string, string> }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return <ul className="bf-rbars">{rows.map(r => <li key={r.key} {...r.attr}><span className="bf-rbars-label">{r.label}</span><span className="bf-rbars-track"><i style={{ width: r.value ? `${Math.max(3, (r.value / max) * 100)}%` : 0 }} /></span><b>{r.value}</b></li>)}</ul>;
}

function Tile({ label, value, tone }: { label: string; value: ReactNode; tone?: 'success' | 'danger' | undefined }) {
  return <span className="bf-rtile" data-tone={tone}><b>{value}</b><small>{label}</small></span>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <span className="bf-fact"><small>{label}</small><b>{value}</b></span>;
}

function Meter({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return <div className="bf-rmeter" title={hint}><span><small>{label}</small><b>{pct(value)}</b></span><span className="bf-rmeter-track"><i style={{ width: `${value ?? 0}%` }} /></span></div>;
}

function OutcomeDonut({ counts }: { counts: Record<string, number> }) {
  const data = OUTCOMES.map(o => ({ key: o.key, name: o.label, value: counts[o.key] ?? 0, color: OUTCOME_COLORS[o.key]! }));
  const total = data.reduce((n, d) => n + d.value, 0); const shown = data.filter(d => d.value > 0);
  if (!total) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing raised in this period</p>;
  return <div className="bf-outcome">
    <div className="bf-mix-chart bf-outcome-chart">
      <ResponsiveContainer width="100%" height="100%"><PieChart>
        <Pie data={shown} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" startAngle={90} endAngle={-270} paddingAngle={shown.length > 1 ? 2 : 0} cornerRadius={4} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>{shown.map(d => <Cell key={d.key} fill={d.color} />)}</Pie>
        <Tooltip content={<ShareTip total={total} />} />
      </PieChart></ResponsiveContainer>
      <div className="bf-mix-center" aria-hidden="true"><strong>{total}</strong><span>raised</span></div>
    </div>
    <ul className="bf-mix-legend">{data.map(d => <li key={d.key}><span className="bf-swatch" style={{ background: d.color }} /><span className="truncate">{d.name}</span><b>{d.value}</b><small>{Math.round((d.value / total) * 100)}%</small></li>)}</ul>
  </div>;
}

function ShareTip({ active, payload, total }: TooltipProps<number, string> & { total: number }) {
  const p = payload?.[0]; if (!active || !p) return null; const v = Number(p.value ?? 0);
  return <div className="bf-tooltip"><ul><li><span className="bf-swatch" style={{ background: String(p.payload?.color) }} />{p.name}<b>{v}</b></li></ul><div className="bf-tooltip-total">Share<b>{Math.round((v / total) * 100)}%</b></div></div>;
}

function TrendBars({ data }: { data: { week: string; raised: number; fixed: number }[] }) {
  const label = (w: string) => new Date(`${w}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return <div className="bf-trend"><ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -22 }} barGap={2} barCategoryGap="28%">
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis dataKey="week" tickFormatter={label} interval={1} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} axisLine={false} tickLine={false} />
      <YAxis allowDecimals={false} tickCount={4} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
      <Tooltip cursor={{ fill: 'color-mix(in oklab, var(--foreground) 6%, transparent)' }} content={<WeekTip />} />
      <Bar dataKey="raised" name="Raised" fill="var(--viz-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      <Bar dataKey="fixed" name="Fixed" fill="var(--viz-3)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer></div>;
}

function WeekTip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return <div className="bf-tooltip"><strong>Week of {new Date(`${label}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</strong><ul>{payload.map(p => <li key={String(p.dataKey)}><span className="bf-swatch" style={{ background: String(p.color) }} />{p.name}<b>{p.value}</b></li>)}</ul></div>;
}
