import { useEffect, useState } from "react";

/**
 * The item just opened from a notification or link: stays highlighted while open and a few seconds after, and is
 * scrolled into view once its row is on screen (`[data-highlight="<id>"]`). `ready` re-runs the scroll when the list loads.
 */
export function useHighlight(id: string | null, ready: unknown) {
  const [recent, setRecent] = useState<string | null>(null);
  useEffect(() => {
    if (id) {
      setRecent(id);
      return;
    }
    const t = window.setTimeout(() => setRecent(null), 4000);
    return () => window.clearTimeout(t);
  }, [id]);
  useEffect(() => {
    if (!recent) return;
    const raf = requestAnimationFrame(() =>
      document
        .querySelector(
          `[data-highlight="${CSS.escape(recent)}"], [data-highlight-alt="${CSS.escape(recent)}"]`,
        )
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(raf);
  }, [recent, ready]);
  return recent;
}
