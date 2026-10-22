import { useEffect, useState } from 'react';
import { Bug } from 'lucide-react';
import { useTheme } from './theme-toggle';
import { styleById } from '@/lib/appearance';

/** A bug with legs and feelers that move — the mascot comes alive in the Halloween style and when motion is lively. */
export function BugMascot({ size = 24, className = '', style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return <svg className={`bf-mascot ${className}`} style={style} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
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

/** A carved pumpkin: ribbed body, stem, and a face that glows from inside. */
function Pumpkin({ size, tilt = 0 }: { size: number; tilt?: number }) {
  return <svg className="bf-pumpkin" width={size} height={size * 0.82} viewBox="0 0 100 82" style={{ transform: `rotate(${tilt}deg)` }} aria-hidden="true">
    <path d="M50 10 c-1-6 2-9 6-9 l-1 10z" fill="oklch(.45 .08 130)" />
    <ellipse cx="50" cy="48" rx="46" ry="32" fill="var(--bf-pumpkin, oklch(.66 .19 50))" />
    <ellipse cx="50" cy="48" rx="30" ry="32" fill="oklch(.7 .19 50)" opacity=".55" />
    <ellipse cx="50" cy="48" rx="14" ry="32" fill="oklch(.74 .18 52)" opacity=".55" />
    <g className="bf-pumpkin-face" fill="oklch(.9 .17 85)">
      <path d="M26 36 l14 10 h-20z" /><path d="M74 36 l-14 10 h20z" /><path d="M50 44 l6 8 h-12z" />
      <path d="M22 56 q28 22 56 0 l-6 6 -6-4 -6 5 -6-5 -6 5 -6-5 -6 4 -6-4 -6 5z" />
    </g>
  </svg>;
}
/** A fir tree with a star and a few baubles. */
function Tree({ size }: { size: number }) {
  return <svg className="bf-tree" width={size * 0.7} height={size} viewBox="0 0 70 100" aria-hidden="true">
    <rect x="31" y="84" width="8" height="14" fill="oklch(.4 .07 60)" />
    <path d="M35 16 L58 50 H12z" fill="oklch(.42 .1 150)" /><path d="M35 34 L64 70 H6z" fill="oklch(.38 .1 150)" /><path d="M35 52 L70 88 H0z" fill="oklch(.34 .1 150)" />
    <path className="bf-star" d="M35 2 l3 7 7 .6 -5.4 4.6 1.7 7 -6.3-3.9 -6.3 3.9 1.7-7 -5.4-4.6 7-.6z" fill="oklch(.9 .17 90)" />
    <g className="bf-baubles"><circle cx="28" cy="44" r="3" fill="oklch(.6 .22 25)" /><circle cx="44" cy="60" r="3" fill="oklch(.8 .15 90)" /><circle cx="22" cy="74" r="3" fill="oklch(.65 .15 250)" /><circle cx="50" cy="80" r="3" fill="oklch(.6 .22 25)" /></g>
  </svg>;
}
/** A string of fairy lights across the top; each bulb twinkles on its own beat when motion is lively. */
function Lights() {
  const bulbs = Array.from({ length: 24 }, (_, i) => ({ x: 4 + i * 4.1, y: 6 + Math.sin(i * 0.9) * 2.5, hue: [25, 90, 150, 250, 330][i % 5]! }));
  return <svg className="bf-lights" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
    <path d={`M0 4 ${bulbs.map(b => `L${b.x} ${b.y - 3}`).join(' ')} L100 4`} fill="none" stroke="oklch(.35 .03 150)" strokeWidth=".35" vectorEffect="non-scaling-stroke" />
    {bulbs.map((b, i) => <circle key={i} className="bf-bulb" cx={b.x} cy={b.y} r="1.2" fill={`oklch(.78 .18 ${b.hue})`} style={{ animationDelay: `${(i * 0.37) % 2.2}s` }} />)}
  </svg>;
}
function Leaf({ hue }: { hue: number }) {
  return <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M3 20 C3 8 11 3 21 3 C21 13 15 21 3 20z M3 20 L16 8" fill={`oklch(.62 .16 ${hue})`} stroke={`oklch(.45 .12 ${hue})`} strokeWidth="1" /></svg>;
}

const snow = Array.from({ length: 18 }, (_, i) => ({ left: `${(i * 37) % 100}%`, delay: `${(i * 1.7) % 9}s`, duration: `${9 + ((i * 2.3) % 7)}s`, size: 3 + (i % 3) * 1.5, drift: (i % 2 ? 1 : -1) * (10 + (i % 4) * 6) }));
const leaves = Array.from({ length: 14 }, (_, i) => ({ left: `${(i * 41) % 100}%`, delay: `${(i * 2.3) % 11}s`, duration: `${11 + ((i * 3.1) % 8)}s`, size: 14 + (i % 3) * 4, drift: (i % 2 ? 1 : -1) * (30 + (i % 4) * 14), hue: [45, 60, 30, 80][i % 4]! }));
const bats = [{ top: '8%', delay: '0s', duration: '26s' }, { top: '18%', delay: '7s', duration: '31s' }, { top: '30%', delay: '14s', duration: '22s' }, { top: '12%', delay: '20s', duration: '35s' }];
/** Bugs that crawl along the bottom edge (both ways) and one that climbs the right-hand edge. */
const crawlers = [
  { y: 6, size: 22, duration: '38s', delay: '0s', dir: 1 }, { y: 30, size: 16, duration: '55s', delay: '12s', dir: -1 }, { y: 14, size: 18, duration: '47s', delay: '25s', dir: 1 },
  { y: 48, size: 14, duration: '70s', delay: '5s', dir: -1 }, { y: 2, size: 26, duration: '33s', delay: '40s', dir: 1 },
];

/**
 * Decorative layer for styles that have one. Fixed, pointer-events none, aria-hidden, transform/opacity only.
 * 'subtle' shows the still parts (cobweb, pumpkins, trees, scanlines); 'lively' adds motion (bats, crawling bugs, snow, leaves, twinkling lights). 'off' renders nothing.
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
  return <div className="bf-decor" data-style={style.id} data-lively={lively || undefined} aria-hidden="true">
    {style.id === 'halloween' && <>
      <svg className="bf-cobweb" viewBox="0 0 120 120" width="150" height="150"><g fill="none" stroke="currentColor" strokeWidth="1"><path d="M120 0 L0 0 M120 0 L0 120 M120 0 L60 120 M120 0 L0 60 M120 0 L30 120 M120 0 L0 30 M120 0 L90 120 M120 0 L0 90" /><path d="M95 0 Q92 22 72 48 Q48 72 22 95 Q 10 108 0 108" /><path d="M70 0 Q68 18 52 36 Q36 52 18 68 Q 8 80 0 82" /><path d="M45 0 Q44 12 34 24 Q24 34 12 44 Q 5 52 0 54" /><path d="M22 0 Q20 8 14 14 Q8 20 0 26" /></g></svg>
      <svg className="bf-moon" viewBox="0 0 64 64" width="72" height="72"><path d="M40 4 a28 28 0 1 0 20 46 a22 22 0 1 1 -20-46z" fill="currentColor" /></svg>
      <div className="bf-scene bf-pumpkins"><Pumpkin size={54} tilt={-6} /><Pumpkin size={84} /><Pumpkin size={44} tilt={8} /></div>
      {lively && bats.map((b, i) => <svg key={i} className="bf-bat" style={{ top: b.top, animationDelay: b.delay, animationDuration: b.duration }} viewBox="0 0 64 32" width="44" height="22"><path fill="currentColor" d="M32 8c-3 6-9 9-14 7-3 4-9 5-14 2 2 5 7 8 13 7-1 3 1 6 4 8 3-3 8-4 11-2 3-2 8-1 11 2 3-2 5-5 4-8 6 1 11-2 13-7-5 3-11 2-14-2-5 2-11-1-14-7z" /></svg>)}
      {lively && crawlers.map((c, i) => <BugMascot key={i} size={c.size} className="bf-crawl" style={{ bottom: c.y, animationDuration: c.duration, animationDelay: c.delay, ['--rot' as string]: `${90 * c.dir}deg`, animationDirection: c.dir < 0 ? 'reverse' : 'normal' }} />)}
      {lively && <BugMascot size={18} className="bf-climb" />}
      {!lively && <><BugMascot size={18} className="bf-still" style={{ left: '38%', bottom: 4, transform: 'rotate(90deg)' }} /><BugMascot size={14} className="bf-still" style={{ right: '28%', bottom: 10, transform: 'rotate(-80deg)' }} /></>}
      {walking && <BugMascot size={30} className="bf-scurry" />}
    </>}
    {style.id === 'winter' && lively && snow.map((s, i) => <i key={i} className="bf-snow" style={{ left: s.left, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.duration, ['--drift' as string]: `${s.drift}px` }} />)}
    {style.id === 'christmas' && <>
      <Lights />
      <div className="bf-scene bf-trees"><Tree size={70} /><Tree size={120} /><Tree size={90} /><Tree size={56} /></div>
      <div className="bf-drift" />
      {lively && snow.map((s, i) => <i key={i} className="bf-snow" style={{ left: s.left, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.duration, ['--drift' as string]: `${s.drift}px` }} />)}
    </>}
    {style.id === 'autumn' && lively && leaves.map((l, i) => <i key={i} className="bf-leaf" style={{ left: l.left, width: l.size, height: l.size, animationDelay: l.delay, animationDuration: l.duration, ['--drift' as string]: `${l.drift}px` }}><Leaf hue={l.hue} /></i>)}
    {style.id === 'terminal' && <div className="bf-scanlines" />}
  </div>;
}
