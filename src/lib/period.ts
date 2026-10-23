import { z } from "zod";

/** Reporting period shared by Activity, Team performance and Team reports. */

export type Period = { days: number; from?: string | undefined; to?: string | undefined };
export const ALL_TIME: Period = { days: 0 };

export const PERIOD_PRESETS: { value: string; label: string }[] = [
  { value: "0", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "custom", label: "Custom range…" },
];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), "Invalid date");

/** Period fields for a request schema: preset days, or a from/to range (inclusive) in the viewer's time zone. */
export const periodFields = {
  days: z.number().int().min(0).max(3650).default(0),
  from: isoDate.optional(),
  to: isoDate.optional(),
  tz: z
    .string()
    .regex(/^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/)
    .max(60)
    .default("UTC"),
};
export const validRange = (p: { from?: string | undefined; to?: string | undefined }) =>
  !p.from || !p.to || p.from <= p.to;

export function periodLabel(p: Period) {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (p.from && p.to) return p.from === p.to ? fmt(p.from) : `${fmt(p.from)} – ${fmt(p.to)}`;
  if (p.from) return `since ${fmt(p.from)}`;
  if (p.to) return `until ${fmt(p.to)}`;
  if (p.days === 365) return "last 12 months";
  return p.days ? `last ${p.days} days` : "all time";
}

/**
 * SQL condition builder for a timestamp column. Pushes its parameters once and returns a function
 * that renders the condition for any column, so one period can filter several tables in a query.
 */
export function periodWindow(
  p: Period & { tz?: string },
  params: unknown[],
): (col: string) => string {
  const parts: ((col: string) => string)[] = [];
  if (p.from || p.to) {
    params.push(p.tz ?? "UTC");
    const tz = `$${params.length}`;
    if (p.from) {
      params.push(p.from);
      const a = `$${params.length}`;
      parts.push((c) => `${c}>=(${a}::date)::timestamp at time zone ${tz}`);
    }
    if (p.to) {
      params.push(p.to);
      const b = `$${params.length}`;
      parts.push((c) => `${c}<((${b}::date)+1)::timestamp at time zone ${tz}`);
    }
  } else if (p.days > 0) {
    params.push(p.days);
    const d = `$${params.length}`;
    parts.push((c) => `${c}>=now()-(${d}::int||' days')::interval`);
  }
  return (col) => (parts.length ? parts.map((f) => f(col)).join(" and ") : "true");
}

/** The viewer's time zone, for date ranges. */
export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
