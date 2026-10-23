import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

/**
 * Slim bar along the top of the window while pages or data load.
 * Waits 150 ms before showing (quick loads stay calm), creeps towards 90 %, then completes and fades.
 */
export function TopProgress() {
  // Only loads the user is waiting for (no data yet, or a new filter); background refreshes stay silent.
  const fetching = useIsFetching({ predicate: (q) => q.state.data === undefined }) > 0;
  const navigating = useRouterState({ select: (s) => s.status === "pending" });
  const busy = fetching || navigating;
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const clear = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    clear();
    if (busy) {
      timers.current.push(
        window.setTimeout(() => {
          setVisible(true);
          setWidth((w) => Math.max(w, 12));
        }, 150),
      );
      const creep = () => {
        setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w));
        timers.current.push(window.setTimeout(creep, 250));
      };
      timers.current.push(window.setTimeout(creep, 300));
    } else if (visible) {
      setWidth(100);
      timers.current.push(
        window.setTimeout(() => {
          setVisible(false);
          setWidth(0);
        }, 350),
      );
    }
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  return (
    <div
      className="bf-progress"
      data-visible={visible || undefined}
      role="progressbar"
      aria-label="Loading"
      aria-hidden={!visible}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <i style={{ width: `${width}%` }} />
    </div>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <span className={`bf-skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** Placeholder rows: avatar/icon, a line and a value — for lists and logs. */
export function SkeletonRows({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="bf-skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}>
          <Skeleton className="bf-skeleton-dot" />
          <Skeleton style={{ width: `${70 - (i % 3) * 14}%` }} />
          <Skeleton className="bf-skeleton-num" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder metric tiles. */
export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bf-kpi bf-kpi-static" aria-hidden="true">
          <Skeleton style={{ width: "45%", height: 12 }} />
          <Skeleton style={{ width: "35%", height: 30 }} />
          <Skeleton style={{ width: "70%", height: 11 }} />
        </div>
      ))}
    </>
  );
}
