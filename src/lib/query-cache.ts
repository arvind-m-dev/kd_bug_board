import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * Keeps this tab's last loaded lists in sessionStorage so a refresh shows them at once instead of a blank page,
 * while fresh data loads in the background. Per tab only (sessionStorage), short-lived, and limited to read views;
 * the server still checks every request, and signed media links in the copy are newer than their 10-minute expiry.
 */
const KEY = "bugflow-query-cache";
const MAX_AGE = 8 * 60_000;
const MAX_BYTES = 3_000_000;
const KEEP = new Set([
  "bug-workspace",
  "bug-detail",
  "personal-portal",
  "media-library",
  "media-trash",
  "notifications",
  "members",
  "projects",
  "project-summary",
  "overview-stats",
  "trash",
  "activity",
  "activity-insights",
  "activity-people",
  "team-performance",
  "admin-access",
]);
type Saved = { at: number; entries: { key: unknown[]; data: unknown; at: number }[] };

function read(): Saved | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved && Date.now() - saved.at < MAX_AGE ? saved : null;
  } catch {
    return null;
  }
}

/** Puts the saved lists back (marked as already old, so every one refetches straight away). */
export function restoreQueries(client: QueryClient) {
  const saved = read();
  if (!saved) return;
  for (const e of saved.entries)
    if (client.getQueryData(e.key) === undefined)
      client.setQueryData(e.key, e.data, { updatedAt: Math.min(e.at, Date.now() - 60 * 60_000) });
}

/** Saves the kept lists whenever they change (debounced) and right before the page unloads. */
export function persistQueries(client: QueryClient) {
  let timer = 0;
  const save = () => {
    window.clearTimeout(timer);
    try {
      const entries = client
        .getQueryCache()
        .getAll()
        .filter((q) => q.state.status === "success" && KEEP.has(String(q.queryKey[0])))
        .map((q) => ({
          key: q.queryKey as unknown[],
          data: q.state.data,
          at: q.state.dataUpdatedAt,
        }));
      const text = JSON.stringify({ at: Date.now(), entries } satisfies Saved);
      if (text.length <= MAX_BYTES) sessionStorage.setItem(KEY, text);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage full or blocked: the page simply loads normally next time */
    }
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success") {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 400);
    }
  });
  window.addEventListener("pagehide", save);
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", save);
    window.clearTimeout(timer);
  };
}

/** Forget the copy (sign-out, revoked access). */
export function clearQueryCache() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Call at the top of a page that shows saved lists. Runs after that page has hydrated (pages hydrate in their own
 * Suspense boundary, after the root), so the server HTML always matches the first client render; once per load.
 */
let restored = false;
export function useRestoredQueries() {
  const client = useQueryClient();
  useEffect(() => {
    if (restored) return;
    restored = true;
    restoreQueries(client);
  }, [client]);
}
