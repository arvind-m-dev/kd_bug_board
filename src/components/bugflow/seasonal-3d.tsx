import { useEffect, useRef, useState } from 'react';
import type { Scene } from '@/lib/appearance';

/**
 * Lazy WebGL scene: no server renderer, hit targets, focusable nodes, or workspace mutations.
 * Scene knobs from the Theme Studio rebuild the diorama, debounced so a slider drag does not rebuild on every tick.
 */
export function Seasonal3D({ season, lively, scene }: { season: string; lively: boolean; scene: Scene }) {
  const host = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(false);
  const key = JSON.stringify(scene);
  const [settled, setSettled] = useState(key);
  useEffect(() => { const t = window.setTimeout(() => setSettled(key), 350); return () => window.clearTimeout(t); }, [key]);
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setAvailable(false);
    import('./seasonal-scene').then(({ createSeasonalScene }) => {
      if (cancelled) return;
      try {
        dispose = createSeasonalScene(target, season, lively, JSON.parse(settled) as Scene);
        setAvailable(true);
      } catch {
        // Existing CSS scenery remains available on devices without WebGL.
        target.replaceChildren();
      }
    }).catch(() => { /* keep the CSS fallback */ });
    return () => { cancelled = true; dispose?.(); };
  }, [season, lively, settled]);
  return <div ref={host} className="bf-seasonal-3d" data-ready={available || undefined} aria-hidden="true" inert />;
}
