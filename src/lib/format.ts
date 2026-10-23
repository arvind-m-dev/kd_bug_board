/** Display helpers shared by every panel, so a status, a date or a person reads the same everywhere. */

/** Human status: RECHECK → "Ready for QA retest", NEEDS_INFORMATION → "Needs information". */
export const statusLabel = (v: string) =>
  v === "RECHECK"
    ? "Ready for QA retest"
    : v
        .toLowerCase()
        .replaceAll("_", " ")
        .replace(/^./, (c) => c.toUpperCase());

/** Colour tone for a status pill; the same mapping is used in tables, cards, history and notifications. */
export const statusTone = (s: string) =>
  s === "REOPENED"
    ? "danger"
    : s === "RESOLVED"
      ? "success"
      : ["IN_PROGRESS", "RECHECK", "NEEDS_INFORMATION"].includes(s)
        ? "warning"
        : ["NEW", "VALIDATING"].includes(s)
          ? "info"
          : "neutral";

/** "21 Oct 2026, 16:57" */
export const dateLabel = (v: string) =>
  new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
/** "21 Oct, 16:57" */
export const shortDate = (v: string) =>
  new Date(v).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
/** "just now", "5m ago", "3h ago", "12d ago", then a short date. */
export function timeAgo(v: string) {
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : shortDate(v);
}
/** "Today", "Yesterday", then "Monday, 13 October" (with the year when it differs). */
export function dayHeading(at: string) {
  const d = new Date(at);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** Up to two initials for an avatar: "Lakshmi Venkat" → "LV". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

/** Member role for display: qa → "QA", other → "Member", tester → "Tester". */
export const roleText = (r: string) =>
  r === "qa" ? "QA" : r === "other" || !r ? "Member" : r[0]!.toUpperCase() + r.slice(1);

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;
