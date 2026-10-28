import { useEffect, useRef, useState } from "react";
import { SeasonalGifts } from "./seasonal-gifts";
import type { Scene } from "@/lib/appearance";
import type { SceneQuality } from "./scene-quality";

/**
 * Lazy WebGL scene: no server renderer, hit targets, focusable nodes, or workspace mutations.
 * Scene knobs from the Theme Studio rebuild the diorama, debounced so a slider drag does not rebuild on every tick.
 */
// Dev only: when the scene module is edited, mounted dioramas rebuild instead of waiting for a full reload.
const reloaders = new Set<() => void>();
if (import.meta.hot)
  import.meta.hot.accept("./seasonal-scene", () => {
    for (const r of reloaders) r();
  });

export function Seasonal3D({
  season,
  lively,
  scene,
  quality,
}: {
  season: string;
  lively: boolean;
  scene: Scene;
  quality: SceneQuality;
}) {
  const host = useRef<HTMLDivElement>(null);
  const activeDispose = useRef<(() => void) | null>(null);
  const [available, setAvailable] = useState(false);
  const key = JSON.stringify(scene);
  const [settled, setSettled] = useState(key);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    reloaders.add(bump);
    return () => {
      reloaders.delete(bump);
    };
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(key), 350);
    return () => window.clearTimeout(t);
  }, [key]);
  useEffect(
    () => () => {
      activeDispose.current?.();
      activeDispose.current = null;
    },
    [],
  );
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    // The scene is hidden on phones and tablets and pointless with reduced motion: skip WebGL (and three.js)
    // there entirely. Elsewhere it loads once the browser is idle, after the page has painted.
    if (
      window.matchMedia("(max-width: 768px)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      const loader =
        season === "geometry" ? import("./minimal-geometry-scene") : import("./seasonal-scene");
      loader
        .then((module) => {
          if (cancelled) return;
          try {
            const nextDispose =
              season === "geometry"
                ? (module as typeof import("./minimal-geometry-scene")).createMinimalGeometryScene(
                    target,
                    lively,
                    JSON.parse(settled) as Scene,
                    quality,
                  )
                : (module as typeof import("./seasonal-scene")).createSeasonalScene(
                    target,
                    season,
                    lively,
                    JSON.parse(settled) as Scene,
                    quality,
                  );
            // Build first, then remove the previous renderer. The background never has a blank frame.
            const previousDispose = activeDispose.current;
            activeDispose.current = nextDispose;
            setAvailable(true);
            previousDispose?.();
          } catch {
            // Keep the last working scene if a replacement cannot be created.
            if (!activeDispose.current) setAvailable(false);
          }
        })
        .catch(() => {
          /* Leave the workspace undecorated when loading fails. */
        });
    };
    const hasIdle = typeof window.requestIdleCallback === "function";
    const idle = hasIdle
      ? window.requestIdleCallback(start, { timeout: 3000 })
      : window.setTimeout(start, 1500);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [season, lively, settled, quality, version]);
  return (
    <>
      <div
        ref={host}
        className="bf-seasonal-3d"
        data-ready={available || undefined}
        aria-hidden="true"
        inert
      />
      {season === "christmas" && lively && available && (
        <SeasonalGifts key={`${season}:${settled}:${version}`} host={host} />
      )}
    </>
  );
}
