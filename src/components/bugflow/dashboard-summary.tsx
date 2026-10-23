import { useEffect, useMemo, useState } from "react";
import { SkeletonRows } from "./loading";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  Link2,
  UsersRound,
  CircleAlert,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getMembers } from "@/lib/portal-access.functions";
import { getBugWorkspace } from "@/lib/bug-workflow.functions";
import {
  DEFAULT_SEVERITIES,
  PRIORITIES,
  severityLevel,
  type BugAccess,
  type LiveBug,
} from "@/lib/bug-workflow";
import { PriorityBadge, SeverityBadge } from "./bug-workspace";
import { MemberProfile } from "./member-profile";
import { PeriodPicker } from "./period-picker";
import { Presence } from "./presence";
import { getOverviewStats } from "@/lib/overview.functions";
import { periodLabel as describePeriod, viewerTimeZone, type Period } from "@/lib/period";

const admin: BugAccess = { kind: "admin" };
import { statusLabel as label, statusTone, initials, roleText } from "@/lib/format";
function useAdminData() {
  const members = useServerFn(getMembers);
  const bugs = useServerFn(getBugWorkspace);
  return {
    members: useQuery({
      queryKey: ["members"],
      queryFn: () => members(),
      retry: false,
      staleTime: 5000,
      refetchInterval: 10000,
    }),
    bugs: useQuery({
      queryKey: ["bug-workspace", admin, undefined],
      queryFn: () => bugs({ data: { access: admin } }),
      retry: false,
      staleTime: 10000,
      refetchInterval: 20000,
    }),
  };
}

/** Five delivery stages, each a group of workflow statuses (closed-without-fix is shown separately). */
const STAGES = [
  {
    key: "triage",
    label: "Triage",
    hint: "New, validating or waiting for info",
    statuses: ["NEW", "VALIDATING", "NEEDS_INFORMATION"],
    tone: "info",
    filter: "NEW",
  },
  {
    key: "ready",
    label: "Ready to assign",
    hint: "Validated, waiting for an owner",
    statuses: ["VALIDATED", "READY_FOR_ASSIGNMENT"],
    tone: "violet",
    filter: "READY_FOR_ASSIGNMENT",
  },
  {
    key: "dev",
    label: "In development",
    hint: "Assigned, in progress or reopened",
    statuses: ["ASSIGNED", "IN_PROGRESS", "REOPENED"],
    tone: "teal",
    filter: "IN_PROGRESS",
  },
  {
    key: "qa",
    label: "QA retest",
    hint: "Fix waiting for verification",
    statuses: ["RECHECK"],
    tone: "warning",
    filter: "RECHECK",
  },
  {
    key: "done",
    label: "Resolved",
    hint: "Fix verified by QA",
    statuses: ["RESOLVED"],
    tone: "success",
    filter: "RESOLVED",
  },
] as const;
const CLOSED = ["NOT_A_BUG", "DUPLICATE", "WONT_FIX"];
const OPEN = (s: string) => !["RESOLVED", ...CLOSED].includes(s);
function ago(at: string) {
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
const VERBS: Record<string, string> = {
  "bug.created": "reported a bug",
  "bug.sample_created": "added a sample bug",
  "bug.status": "changed the status",
  "bug.priority": "changed the priority",
  "bug.severity": "changed the severity",
  "bug.assign": "assigned the bug",
  "bug.verify": "verified a fix",
  "bug.comment": "commented",
  "bug.edited": "edited the details",
};
const changeVerb = (action: string) => VERBS[action] ?? label(action.replace(/^bug\./, ""));
const PRIORITY_RANK = (p: string) => {
  const i = PRIORITIES.indexOf(p as never);
  return i < 0 ? 9 : i;
};

export function DashboardSummary() {
  const { members, bugs } = useAdminData();
  const [profile, setProfile] = useState<string | null>(null);
  const [perPage, setPerPageState] = useState(10);
  useEffect(() => {
    try {
      const n = Number(localStorage.getItem("bugflow-attention-per-page"));
      if ([5, 10, 20, 50].includes(n)) setPerPageState(n);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [pageRaw, setPage] = useState(0);
  const setPerPage = (n: number) => {
    setPerPageState(n);
    setPage(0);
    try {
      localStorage.setItem("bugflow-attention-per-page", String(n));
    } catch {
      /* storage unavailable */
    }
  };
  const list = members.data ?? [];
  const active = list.filter((m) => m.active).length;
  const online = list.filter((m) => m.online).length;
  const d = bugs.data;
  const bugList = d?.bugs ?? [];
  const severities = d?.options.severities ?? DEFAULT_SEVERITIES;
  // Bug numbers for the chosen period, counted over all bugs on the server.
  const [period, setPeriod] = useState<Period>({ days: 0 });
  const tz = useMemo(viewerTimeZone, []);
  const fetchStats = useServerFn(getOverviewStats);
  const stats = useQuery({
    queryKey: ["overview-stats", period, tz],
    queryFn: () => fetchStats({ data: { ...period, tz } }),
    placeholderData: keepPreviousData,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const st = stats.data;
  const periodText = describePeriod(period);
  const attention = st?.attention ?? [];
  const roles = ["tester", "developer", "qa", "other"].map((r) => ({
    r,
    n: list.filter((m) => m.role === r).length,
  }));
  const n = (v: number, loading: boolean) => (loading ? "…" : v);
  // Full status totals (not limited to the latest page of bugs).
  const byStatus = new Map<string, number>(Object.entries(st?.byStatus ?? {}));
  const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
  const stages = STAGES.map((st) => ({
    ...st,
    count: st.statuses.reduce((a, s) => a + (byStatus.get(s) ?? 0), 0),
  }));
  const closed = CLOSED.reduce((a, s) => a + (byStatus.get(s) ?? 0), 0);
  // Most urgent first: priority, then oldest.
  const urgentAll = [...attention].sort(
    (a, b) =>
      PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority) ||
      +new Date(a.createdAt) - +new Date(b.createdAt),
  );
  const pages = Math.max(1, Math.ceil(urgentAll.length / perPage));
  const page = Math.min(pageRaw, pages - 1);
  const urgent = urgentAll.slice(page * perPage, page * perPage + perPage);
  const pri = st?.byPriority ?? {};
  const sev = st?.bySeverity ?? {};
  const sevKeys = [...severities, ...Object.keys(sev).filter((s) => !severities.includes(s))];
  // Open bugs per owner (bugs reported in the period).
  const workload = (st?.workload ?? []).map((w) => [w.id, { name: w.name, n: w.n }] as const);
  const unowned = st?.unowned ?? 0;
  const openByUser = new Map(workload.map(([id, v]) => [id, v.n]));
  const recent = bugList
    .filter((b) => b.lastChange)
    .sort((a: LiveBug, b: LiveBug) => +new Date(b.lastChange!.at) - +new Date(a.lastChange!.at))
    .slice(0, 7);
  const team = [...list].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name),
  );
  const loading = stats.isPending;
  const failed = stats.isError;
  const updating = stats.isPlaceholderData;

  return (
    <>
      <div className="bf-ov-toolbar">
        <div>
          <strong>Bugs reported</strong>
          <span>
            {periodText}
            {updating && <span className="bf-updating ml-3">Updating…</span>}
          </span>
        </div>
        <PeriodPicker
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setPage(0);
          }}
        />
      </div>
      {/* 1 · Headline numbers */}
      <div className="bf-kpi-grid">
        <Kpi
          to="/admin/users"
          tone="teal"
          icon={Link2}
          label="Online now"
          value={n(online, members.isPending)}
          of={active}
          share={active ? online / active : 0}
          foot="Active in the last 2 minutes"
        />
        <Kpi
          to="/admin/users"
          tone="info"
          icon={UsersRound}
          label="Team members"
          value={n(list.length, members.isPending)}
          share={list.length ? active / list.length : 0}
          foot={`${active} active · ${
            roles
              .filter((x) => x.n > 0)
              .map(
                (x) =>
                  `${x.n} ${x.r === "qa" ? "QA" : x.r === "other" ? "other" : x.r + (x.n === 1 ? "" : "s")}`,
              )
              .join(" · ") || "No roles assigned yet"
          }`}
        />
        <Kpi
          to="/admin/bugs"
          search={{ filter: "unassigned" }}
          tone="warning"
          icon={CircleAlert}
          label="Unassigned bugs"
          value={n(unowned, loading)}
          of={total}
          share={total ? unowned / total : 0}
          foot={`Open, no owner · ${periodText}`}
        />
        <Kpi
          to="/admin/bugs"
          search={{ filter: "open" }}
          tone="danger"
          icon={Bell}
          label="Needs attention"
          value={n(attention.length, loading)}
          of={total}
          share={total ? attention.length / total : 0}
          foot={`New, reopened, retest or info · ${periodText}`}
        />
      </div>
      {failed && <p className="mb-4 text-sm text-destructive">Bugs could not be loaded.</p>}

      {/* 2 · What to act on, and where work sits */}
      <div className="bf-ov-row bf-ov-row-main">
        <section
          className="bf-panel bf-ov-panel"
          aria-labelledby="ov-attention"
          data-ui="attention"
        >
          <div className="bf-panel-heading">
            <div>
              <h2 id="ov-attention">Needs your attention</h2>
              <p className="bf-panel-sub">Most urgent first · priority, then oldest</p>
            </div>
            <Link to="/admin/bugs" search={{ filter: "open" }}>
              All {attention.length}
              <ArrowUpRight size={12} />
            </Link>
          </div>
          {loading ? (
            <SkeletonRows rows={6} label="Loading bugs" />
          ) : urgent.length === 0 ? (
            <div className="bf-ov-empty">
              <CheckCircle2 size={22} />
              You’re all caught up
            </div>
          ) : (
            <>
              <ul className="bf-urgent bf-urgent-scroll" key={`${page}-${perPage}`}>
                {urgent.map((b) => (
                  <li key={b.id}>
                    <Link to="/admin/bugs" search={{ filter: b.status }}>
                      <PriorityBadge value={b.priority} />
                      <span className="bf-urgent-main">
                        <span className="bf-urgent-title">
                          <code>{b.code}</code>
                          <span className="truncate">{b.title}</span>
                        </span>
                        <span className="bf-urgent-meta">
                          <span className="bf-status-pill" data-tone={statusTone(b.status)}>
                            <span className="bf-dot" />
                            {label(b.status)}
                          </span>
                          <span>{b.owners || "Unassigned"}</span>
                        </span>
                      </span>
                      <span
                        className="bf-urgent-age"
                        title={new Date(b.createdAt).toLocaleString("en-GB")}
                      >
                        {ago(b.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="bf-pager">
                <span>
                  Showing {page * perPage + 1}–{Math.min(urgentAll.length, (page + 1) * perPage)} of{" "}
                  {urgentAll.length}
                </span>
                <label className="bf-pager-size">
                  Per page
                  <select
                    value={perPage}
                    onChange={(e) => setPerPage(Number(e.target.value))}
                    aria-label="Bugs per page"
                  >
                    {[5, 10, 20, 50].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="bf-pager-nav">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                  </Button>
                  <span>
                    {page + 1} / {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pages - 1}
                    onClick={() => setPage(page + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} />
                  </Button>
                </span>
              </div>
            </>
          )}
        </section>
        <section className="bf-panel bf-ov-panel" aria-labelledby="ov-pipeline" data-ui="pipeline">
          <div className="bf-panel-heading">
            <div>
              <h2 id="ov-pipeline">Bug pipeline</h2>
              <p className="bf-panel-sub">
                {total} bugs by stage · {periodText}
              </p>
            </div>
            <Link to="/admin/bugs">
              View all
              <ArrowUpRight size={12} />
            </Link>
          </div>
          {loading ? (
            <SkeletonRows rows={5} label="Loading pipeline" />
          ) : (
            <div className="bf-pipeline">
              <div
                className="bf-pipeline-bar"
                role="img"
                aria-label={stages.map((s) => `${s.label}: ${s.count}`).join(", ")}
              >
                {stages
                  .filter((s) => s.count)
                  .map((s) => (
                    <i
                      key={s.key}
                      data-tone={s.tone}
                      style={{ flexGrow: s.count }}
                      title={`${s.label}: ${s.count}`}
                    />
                  ))}
                {closed > 0 && (
                  <i
                    data-tone="neutral"
                    style={{ flexGrow: closed }}
                    title={`Closed without fix: ${closed}`}
                  />
                )}
              </div>
              <ol>
                {stages.map((s) => (
                  <li key={s.key}>
                    <Link to="/admin/bugs" search={{ filter: s.filter }} title={s.hint}>
                      <span className="bf-stage-dot" data-tone={s.tone} />
                      <span className="bf-stage-label">
                        {s.label}
                        <small>{s.hint}</small>
                      </span>
                      <b>{s.count}</b>
                      <small className="bf-stage-pct">
                        {total ? Math.round((s.count / total) * 100) : 0}%
                      </small>
                    </Link>
                  </li>
                ))}
              </ol>
              <p className="bf-pipeline-foot">
                <span className="bf-stage-dot" data-tone="neutral" />
                Closed without fix (not a bug, duplicate, won’t fix)<b>{closed}</b>
              </p>
            </div>
          )}
        </section>
      </div>

      {/* 3 · Shape of the work */}
      <div className="bf-ov-row bf-ov-row-ps">
        <section className="bf-panel bf-ov-panel" aria-labelledby="ov-ps">
          <div className="bf-panel-heading">
            <div>
              <h2 id="ov-ps">Priority & severity</h2>
              <p className="bf-panel-sub">
                {total} bugs · {periodText}
              </p>
            </div>
          </div>
          {loading ? (
            <SkeletonRows rows={6} />
          ) : (
            <div className="bf-ps bf-ov-ps">
              <div>
                <h4>Priority · how soon</h4>
                <ul className="bf-rbars">
                  {PRIORITIES.map((p) => (
                    <li key={p} data-pri={p}>
                      <Link to="/admin/bugs" search={{ filter: p }} className="contents">
                        <span className="bf-rbars-label">
                          <PriorityBadge value={p} />
                        </span>
                        <span className="bf-rbars-track">
                          <i
                            style={{
                              width: `${((pri[p] ?? 0) / Math.max(1, ...Object.values(pri))) * 100}%`,
                            }}
                          />
                        </span>
                        <b>{pri[p] ?? 0}</b>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Severity · how bad</h4>
                <ul className="bf-rbars">
                  {sevKeys.map((sv) => (
                    <li key={sv} data-sev={severityLevel(sv, severities)}>
                      <span className="bf-rbars-label">
                        <SeverityBadge value={sv} list={severities} />
                      </span>
                      <span className="bf-rbars-track">
                        <i
                          style={{
                            width: `${((sev[sv] ?? 0) / Math.max(1, ...Object.values(sev))) * 100}%`,
                          }}
                        />
                      </span>
                      <b>{sev[sv] ?? 0}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
        <section className="bf-panel bf-ov-panel" aria-labelledby="ov-workload">
          <div className="bf-panel-heading">
            <div>
              <h2 id="ov-workload">Workload</h2>
              <p className="bf-panel-sub">Open bugs per owner · {periodText}</p>
            </div>
            <Link to="/admin/reports">
              Reports
              <ArrowUpRight size={12} />
            </Link>
          </div>
          {loading ? (
            <SkeletonRows rows={5} />
          ) : (
            <ul className="bf-rbars bf-ov-bars bf-ov-scroll">
              {workload.map(([id, v]) => (
                <li key={id}>
                  <span className="bf-rbars-label bf-ov-person">
                    <span className="bf-avatar !size-6 !text-[10.5px]">{initials(v.name)}</span>
                    <span className="truncate">{v.name}</span>
                  </span>
                  <span className="bf-rbars-track">
                    <i
                      style={{ width: `${(v.n / Math.max(1, workload[0]?.[1].n ?? 1)) * 100}%` }}
                    />
                  </span>
                  <b>{v.n}</b>
                </li>
              ))}
              {unowned > 0 && (
                <li className="bf-ov-unowned">
                  <span className="bf-rbars-label">Unassigned</span>
                  <span className="bf-rbars-track">
                    <i
                      style={{
                        width: `${(unowned / Math.max(1, workload[0]?.[1].n ?? 1, unowned)) * 100}%`,
                      }}
                    />
                  </span>
                  <b>{unowned}</b>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      {/* 4 · What happened, and who is around */}
      <div className="bf-ov-row bf-ov-row-main">
        <section className="bf-panel bf-ov-panel" aria-labelledby="ov-recent">
          <div className="bf-panel-heading">
            <div>
              <h2 id="ov-recent">Recent activity</h2>
              <p className="bf-panel-sub">Latest change on each bug</p>
            </div>
            <Link to="/admin/activity">
              Activity & reports
              <ArrowUpRight size={12} />
            </Link>
          </div>
          {loading ? (
            <SkeletonRows rows={6} />
          ) : (
            <ol className="bf-ov-recent">
              {recent.map((b) => (
                <li key={b.id}>
                  <span className="bf-avatar !size-8 !text-[11px]">
                    {initials(b.lastChange!.by)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <strong>{b.lastChange!.by}</strong>{" "}
                      <span className="text-muted-foreground">
                        {changeVerb(b.lastChange!.action)}
                      </span>
                    </span>
                    <span className="block truncate text-muted-foreground">
                      <code>{b.code}</code> {b.title}
                    </span>
                  </span>
                  <span className="bf-status-pill" data-tone={statusTone(b.status)}>
                    <span className="bf-dot" />
                    {label(b.status)}
                  </span>
                  <time
                    className="bf-ov-time"
                    title={new Date(b.lastChange!.at).toLocaleString("en-GB")}
                  >
                    {ago(b.lastChange!.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="bf-panel bf-ov-panel" aria-labelledby="ov-team">
          <div className="bf-panel-heading">
            <div>
              <h2 id="ov-team">Team</h2>
              <p className="bf-panel-sub">
                {online} online · {active} active
              </p>
            </div>
            <Link to="/admin/users">
              Manage
              <ArrowUpRight size={12} />
            </Link>
          </div>
          {members.isError ? (
            <p className="p-5 text-xs text-muted-foreground">Members could not be loaded.</p>
          ) : members.isPending ? (
            <SkeletonRows rows={6} />
          ) : (
            <ul className="bf-ov-team bf-ov-scroll">
              {team.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => setProfile(m.id)}>
                    <span className="bf-ov-avatar">
                      <span className="bf-avatar !size-8 !text-[11px]">{initials(m.name)}</span>
                      {m.online && <i title="Online" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate">{m.name}</strong>
                      <small>
                        {roleText(m.role)}
                        {!m.active && " · inactive"} ·{" "}
                        <Presence online={m.online} lastSeen={m.lastSeen} />
                      </small>
                    </span>
                    <span className="bf-ov-open" title="Open bugs assigned">
                      {openByUser.get(m.userId) ?? 0}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <Dialog
        open={profile !== null}
        onOpenChange={(o) => {
          if (!o) setProfile(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Member profile</DialogTitle>
            <DialogDescription>Details, permissions and portal controls</DialogDescription>
          </DialogHeader>
          {profile && <MemberProfile id={profile} onDeleted={() => setProfile(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Overview metric card: label + icon, headline number with context, share meter and a one-line footnote. */
function Kpi({
  to,
  search,
  tone,
  icon: Icon,
  label,
  value,
  of,
  share,
  foot,
}: {
  to: "/portals" | "/admin/users" | "/admin/bugs";
  search?: { filter: string };
  tone: "teal" | "info" | "warning" | "danger";
  icon: LucideIcon;
  label: string;
  value: number | string;
  of?: number;
  share: number;
  foot: string;
}) {
  return (
    <Link to={to} search={search as never} className="bf-kpi" data-tone={tone}>
      <span className="bf-kpi-head">
        <span className="bf-kpi-label">{label}</span>
        <span className="bf-kpi-icon">
          <Icon size={16} />
        </span>
      </span>
      <span className="bf-kpi-value">
        {value}
        {of !== undefined && <span className="bf-kpi-of">of {of}</span>}
      </span>
      <span className="bf-kpi-meter" role="presentation">
        <i style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} />
      </span>
      <span className="bf-kpi-foot">
        <span className="truncate">{foot}</span>
        <ArrowUpRight size={14} className="bf-kpi-go" />
      </span>
    </Link>
  );
}
