import { useCallback, useEffect, useState } from "react";

/** The router writes search values as JSON (a numeric string becomes "\"123\""): read either form back as plain text. */
export function readParam(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))
    try {
      const v: unknown = JSON.parse(raw);
      return typeof v === "string" ? v : raw;
    } catch {
      return raw;
    }
  return raw;
}

/**
 * One piece of view state kept in the address bar (?key=value), so a refresh, "Try again" or a shared link
 * reopens the same tab or bug. Read after mount (the server render has no URL state), written with replaceState so
 * it never adds history entries.
 */
export function useUrlParam(key: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    setValue(readParam(new URL(window.location.href).searchParams.get(key)));
  }, [key]);
  const set = useCallback(
    (next: string | null) => {
      setValue(next);
      const url = new URL(window.location.href);
      if (next === null || next === "") url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      if (url.href !== window.location.href)
        window.history.replaceState(window.history.state, "", url);
    },
    [key],
  );
  return [value, set];
}

/**
 * A page index (or any non-negative integer) kept in the address bar, so a refresh reopens the same page of a table
 * instead of jumping back to the first. The fallback value writes nothing, keeping clean URLs for the default.
 */
export function useUrlNumber(key: string, fallback = 0): [number, (n: number) => void] {
  const [raw, setRaw] = useUrlParam(key);
  const parsed = raw === null ? fallback : Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  const set = useCallback(
    (n: number) => setRaw(n === fallback ? null : String(n)),
    [setRaw, fallback],
  );
  return [value, set];
}
