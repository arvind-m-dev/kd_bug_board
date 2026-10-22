import { useEffect, useState } from 'react';
import { Bug } from 'lucide-react';
import { useTheme } from './theme-toggle';
import { styleById } from '@/lib/appearance';

/** A bug with legs and feelers that move — the mascot comes alive in the Halloween style and when motion is lively. */
export function BugMascot({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <svg className={`bf-mascot ${className}`} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
    <g className="bf-mascot-legs bf-mascot-legs-l"><path d="M22 26 L9 18" /><path d="M20 34 L6 34" /><path d="M22 42 L9 52" /></g>
    <g className="bf-mascot-legs bf-mascot-legs-r"><path d="M42 26 L55 18" /><path d="M44 34 L58 34" /><path d="M42 42 L55 52" /></g>
    <g className="bf-mascot-feelers"><path d="M26 16 L20 6" /><path d="M38 16 L44 6" /></g>
    <ellipse cx="32" cy="37" rx="12" ry="16" fill="currentColor" stroke="none" />
    <circle cx="32" cy="18" r="7" fill="currentColor" stroke="none" />
    <path d="M32 24 V52" stroke="var(--card)" strokeWidth="2" />
    <circle cx="27" cy="33" r="1.8" fill="var(--card)" stroke="none" /><circle cx="37" cy="40" r="1.8" fill="var(--card)" stroke="none" /><circle cx="36" cy="30" r="1.4" fill="var(--card)" stroke="none" />
  </svg>;
}

/** The brand mark: the living bug in Halloween, the plain icon otherwise. */
export function BrandMark() {
  const { effective, ready } = useTheme();
  return ready && effective.style === 'halloween' ? <BugMascot size={26} /> : <Bug size={23} />;
}

const snow = Array.from({ length: 18 }, (_, i) => ({ left: `${(i * 37) % 100}%`, delay: `${(i * 1.7) % 9}s`, duration: `${9 + ((i * 2.3) % 7)}s`, size: 3 + (i % 3) * 1.5, drift: (i % 2 ? 1 : -1) * (10 + (i % 4) * 6) }));
const bats = [{ top: '8%', delay: '0s', duration: '26s' }, { top: '18%', delay: '7s', duration: '31s' }, { top: '30%', delay: '14s', duration: '22s' }, { top: '12%', delay: '20s', duration: '35s' }];

/**
 * Decorative layer for styles that have one. Fixed, pointer-events none, aria-hidden, transform/opacity only.
 * 'subtle' shows the still parts (cobweb, scanlines); 'lively' adds motion (bats, snow, the scurrying bug). 'off' renders nothing.
 */
export function Decorations() {
  const { effective, ready } = useTheme();
  const style = styleById(effective.style); const motion = effective.motion; const lively = motion === 'lively';
  const [walking, setWalking] = useState(false);
  // Every 40–90 s the bug scurries along the bottom of the sidebar for 7 s; only while the tab is visible and motion is lively.
  useEffect(() => {
    if (!ready || !lively || style.id !== 'halloween') return;
    let stop: number | undefined; let end: number | undefined;
    const schedule = () => { stop = window.setTimeout(() => { if (document.visibilityState === 'visible') { setWalking(true); end = window.setTimeout(() => { setWalking(false); schedule(); }, 7000); } else schedule(); }, 40000 + Math.random() * 50000); };
    schedule();
    return () => { window.clearTimeout(stop); window.clearTimeout(end); setWalking(false); };
  }, [ready, lively, style.id]);
  if (!ready || motion === 'off' || !style.decorated) return null;
  return <div className="bf-decor" data-style={style.id} aria-hidden="true">
    {style.id === 'halloween' && <>
      <svg className="bf-cobweb" viewBox="0 0 120 120" width="150" height="150"><g fill="none" stroke="currentColor" strokeWidth="1"><path d="M120 0 L0 0 M120 0 L0 120 M120 0 L60 120 M120 0 L0 60 M120 0 L30 120 M120 0 L0 30 M120 0 L90 120 M120 0 L0 90" /><path d="M95 0 Q92 22 72 48 Q48 72 22 95 Q 10 108 0 108" /><path d="M70 0 Q68 18 52 36 Q36 52 18 68 Q 8 80 0 82" /><path d="M45 0 Q44 12 34 24 Q24 34 12 44 Q 5 52 0 54" /><path d="M22 0 Q20 8 14 14 Q8 20 0 26" /></g></svg>
      {lively && bats.map((b, i) => <svg key={i} className="bf-bat" style={{ top: b.top, animationDelay: b.delay, animationDuration: b.duration }} viewBox="0 0 64 32" width="44" height="22"><path fill="currentColor" d="M32 8c-3 6-9 9-14 7-3 4-9 5-14 2 2 5 7 8 13 7-1 3 1 6 4 8 3-3 8-4 11-2 3-2 8-1 11 2 3-2 5-5 4-8 6 1 11-2 13-7-5 3-11 2-14-2-5 2-11-1-14-7z" /></svg>)}
      {walking && <BugMascot size={30} className="bf-scurry" />}
    </>}
    {style.id === 'winter' && lively && snow.map((s, i) => <i key={i} className="bf-snow" style={{ left: s.left, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.duration, ['--drift' as string]: `${s.drift}px` }} />)}
    {style.id === 'terminal' && <div className="bf-scanlines" />}
  </div>;
}
