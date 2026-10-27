import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Bot,
  Database,
  HardDrive,
  KeyRound,
  Link2,
  RefreshCw,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { getStorageAlarms, getSystemHealth } from "@/lib/system-health.functions";
import {
  ALARM_AT,
  HEALTH_LABEL,
  usageLevel,
  type HealthState,
  type UsageMeter,
} from "@/lib/system-health";
import { formatBytes } from "@/lib/bug-media";
import { timeAgo } from "@/lib/format";
import { actionError, ErrorNotice } from "./action-feedback";

const ICONS: Record<string, typeof Database> = {
  database: Database,
  storage: HardDrive,
  encryption: KeyRound,
  "sign-in": ShieldCheck,
  site: Link2,
  ai: Bot,
  deployment: Rocket,
};
const TEXT: Record<HealthState, string> = {
  ok: "text-success",
  warn: "text-warning",
  fail: "text-destructive",
  off: "",
};
const ICON_TONE: Record<HealthState, string> = {
  ok: "bf-tone-success",
  warn: "bf-tone-warning",
  fail: "bf-tone-warning",
  off: "bf-tone-info",
};

/**
 * Settings → System health: live checks of the database, media bucket (including the browser upload rule), encryption
 * key, sign-in, site address, AI services and deployment. Runs when opened and on "Check again"; nothing is assumed.
 */
export function SystemHealth() {
  const read = useServerFn(getSystemHealth);
  const q = useQuery({
    queryKey: ["system-health"],
    queryFn: () => read(),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const h = q.data;
  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <Activity size={18} />
          System health
          {h && (
            <span className={`bf-tag ${TEXT[h.overall]}`} role="status">
              {HEALTH_LABEL[h.overall]}
            </span>
          )}
        </h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {h && !q.isFetching && <>Checked {timeAgo(h.checkedAt)}</>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            <RefreshCw className={q.isFetching ? "animate-spin" : undefined} />
            {q.isFetching ? "Checking…" : "Check again"}
          </Button>
        </span>
      </div>
      {q.isError && (
        <ErrorNotice
          message={actionError(q.error, "The health checks could not run.")}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      )}
      {!h && q.isPending && (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          Running checks…
        </p>
      )}
      {h?.checks.map((c) => {
        const Icon = ICONS[c.key] ?? Activity;
        return (
          <div key={c.key} className="bf-setting-row">
            <span className={`bf-stat-icon ${ICON_TONE[c.state]}`}>
              <Icon size={19} />
            </span>
            <div className="min-w-0">
              <h3>{c.label}</h3>
              <p>{c.summary}</p>
              {c.meter && <Meter meter={c.meter} />}
              {c.facts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {c.facts.map((f, i) => (
                    <span key={f.label}>
                      {i > 0 && " · "}
                      {f.label}: <strong className="font-medium">{f.value}</strong>
                    </span>
                  ))}
                </p>
              )}
              {c.action && c.state !== "ok" && (
                <p className="text-xs">
                  <strong>Fix:</strong> {c.action}
                </p>
              )}
            </div>
            <span className={`bf-tag ${TEXT[c.state]}`}>
              {HEALTH_LABEL[c.state]}
              {c.ms !== undefined && c.state !== "off" ? ` · ${c.ms} ms` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const FILL: Record<HealthState, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  fail: "bg-destructive",
  off: "bg-muted-foreground",
};
/** Used vs limit, with a red line where the alarm starts (90%). */
export function Meter({ meter }: { meter: UsageMeter }) {
  const { usedBytes, limitBytes, limitLabel } = meter;
  const level = usageLevel(meter);
  const share = limitBytes ? Math.min(1, usedBytes / limitBytes) : 0;
  const pct = limitBytes ? Math.round((usedBytes / limitBytes) * 100) : null;
  return (
    <div className="my-2 max-w-xl">
      {limitBytes ? (
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={limitBytes}
          aria-valuenow={usedBytes}
          aria-label={`${formatBytes(usedBytes)} of ${formatBytes(limitBytes)} used`}
        >
          <div
            className={`h-full rounded-full ${FILL[level]}`}
            style={{ width: `${Math.max(share * 100, usedBytes > 0 ? 1 : 0)}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-destructive"
            style={{ left: `${ALARM_AT * 100}%` }}
            title={`Alarm at ${ALARM_AT * 100}%`}
          />
        </div>
      ) : null}
      <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          <strong className={`font-semibold ${TEXT[level]}`}>{formatBytes(usedBytes)}</strong> used
          {limitBytes ? (
            <>
              {" "}
              of {formatBytes(limitBytes)} ({pct}%) ·{" "}
              <strong className="font-medium">
                {formatBytes(Math.max(0, limitBytes - usedBytes))}
              </strong>{" "}
              left
            </>
          ) : null}
        </span>
        <span>
          {limitLabel}
          {limitBytes && level === "ok" ? " · within the limit" : ""}
        </span>
      </p>
    </div>
  );
}

/**
 * Admin panel alarm: shown on every Admin page while the database or the media bucket is at 75%+ (amber) or 90%+
 * (red) of its limit. Checked every 10 minutes; costs one database query and no bucket requests.
 */
export function StorageAlarmBanner() {
  const read = useServerFn(getStorageAlarms);
  const q = useQuery({
    queryKey: ["storage-alarms"],
    queryFn: () => read(),
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: false,
  });
  const alarms = q.data ?? [];
  if (!alarms.length) return null;
  const red = alarms.some((a) => a.level === "fail");
  return (
    <div
      role="alert"
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
        red
          ? "border-destructive bg-destructive/10 text-destructive"
          : "border-warning bg-warning/10 text-warning"
      }`}
    >
      <AlertTriangle size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>{red ? "Storage almost full" : "Storage filling up"}:</strong>{" "}
        {alarms
          .map(
            (a) =>
              `${a.label} ${Math.round((a.usedBytes / a.limitBytes) * 100)}% (${formatBytes(a.usedBytes)} of ${formatBytes(a.limitBytes)})`,
          )
          .join(" · ")}
        {red ? ". Uploads or saves will fail at the limit." : "."}
      </span>
      <Button asChild size="sm" variant="outline">
        <Link to="/admin/settings/health">Review storage</Link>
      </Button>
    </div>
  );
}
