import { useEffect, useId, useRef, useState } from 'react';


export function BrandLogo3D({ motion, colorKey }: { motion: string; colorKey: string }) {
  const shellId = useId();
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
  return <span className="bf-brand-sculpture" data-ready={ready || undefined} aria-hidden="true"><svg className="bf-brand-fallback" width="32" height="32" viewBox="-29 -29 58 58">
    <defs><radialGradient id={shellId} cx="30%" cy="20%" r="85%"><stop stopColor="#e4fff6"/><stop offset=".28" stopColor="var(--primary, #33c4a2)"/><stop offset="1" stopColor="#102d30"/></radialGradient></defs>
    <ellipse cy="6" rx="13" ry="18" fill="#07181c" opacity=".25"/>
    <g fill="none" stroke="#142629" strokeWidth="2" strokeLinecap="round"><path d="M-7-6-17-10-21-6M7-6 17-10 21-6M-7 1-17 1-21 5M7 1 17 1 21 5M-7 8-17 12-21 16M7 8 17 12 21 16M-3-16-8-23M3-16 8-23"/></g>
    <ellipse cy="3" rx="10" ry="14" fill="#142629"/>
    <ellipse cx="-4.5" cy="3" rx="5.3" ry="13" fill={`url(#${shellId})`}/><ellipse cx="4.5" cy="3" rx="5.3" ry="13" fill={`url(#${shellId})`}/>
    <ellipse cy="-12" rx="6.5" ry="6" fill="#142629"/><g fill="#ffecc0"><circle cx="-2.8" cy="-14" r="1"/><circle cx="2.8" cy="-14" r="1"/></g>
  </svg><span ref={target} className="bf-brand-canvas" /></span>;
}
