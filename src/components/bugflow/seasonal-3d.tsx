import { useEffect, useRef, useState } from "react";
import { SeasonalGifts } from "./seasonal-gifts";
import type { Scene } from "@/lib/appearance";

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
}: {
  season: string;
  lively: boolean;
  scene: Scene;
}) {
  const host = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    import("./seasonal-scene")
      .then(({ createSeasonalScene }) => {
        if (cancelled) return;
        try {
          dispose = createSeasonalScene(target, season, lively, JSON.parse(settled) as Scene);
          setAvailable(true);
        } catch {
          // Leave decorations empty on devices without WebGL; never flash legacy artwork.
          target.replaceChildren();
          setAvailable(false);
        }
      })
      .catch(() => {
        /* Leave the workspace undecorated when loading fails. */
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [season, lively, settled, version]);
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
