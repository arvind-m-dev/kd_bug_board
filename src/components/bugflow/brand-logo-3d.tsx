import { useEffect, useRef, useState } from 'react';
import { Bug } from 'lucide-react';

export function BrandLogo3D({ motion, colorKey }: { motion: string; colorKey: string }) {
  const target = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false, dispose: (() => void) | undefined;
    setReady(false);
    import('./brand-scene').then(({ createBrandScene }) => {
      if (cancelled || !target.current) return;
      try { dispose = createBrandScene(target.current, motion); setReady(true); } catch { /* retain the accessible page's vector mark */ }
    }).catch(() => {});
    return () => { cancelled = true; dispose?.(); };
  }, [motion, colorKey]);
  return <span className="bf-brand-sculpture" data-ready={ready || undefined} aria-hidden="true"><Bug className="bf-brand-fallback" size={24} /><span ref={target} className="bf-brand-canvas" /></span>;
}
