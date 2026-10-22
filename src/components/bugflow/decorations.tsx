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

/* ───────── Halloween pieces ───────── */
function Pumpkin({ size, tilt = 0 }: { size: number; tilt?: number }) {
  return <svg className="bf-pumpkin" width={size} height={size * 0.82} viewBox="0 0 100 82" style={{ transform: `rotate(${tilt}deg)` }} aria-hidden="true">
    <path d="M50 10 c-1-6 2-9 6-9 l-1 10z" fill="oklch(.45 .08 130)" />
    <ellipse cx="50" cy="48" rx="46" ry="32" fill="oklch(.66 .19 50)" /><ellipse cx="50" cy="48" rx="30" ry="32" fill="oklch(.7 .19 50)" opacity=".55" /><ellipse cx="50" cy="48" rx="14" ry="32" fill="oklch(.74 .18 52)" opacity=".55" />
    <g className="bf-pumpkin-face" fill="oklch(.9 .17 85)"><path d="M26 36 l14 10 h-20z" /><path d="M74 36 l-14 10 h20z" /><path d="M50 44 l6 8 h-12z" /><path d="M22 56 q28 22 56 0 l-6 6 -6-4 -6 5 -6-5 -6 5 -6-5 -6 4 -6-4 -6 5z" /></g>
  </svg>;
}
/** A corner web whose threads draw themselves in when motion is lively (pathLength lets CSS animate the dash). */
function Web({ className, size = 150, flip = false }: { className: string; size?: number; flip?: boolean }) {
  return <svg className={`bf-web ${className}`} viewBox="0 0 120 120" width={size} height={size} style={flip ? { transform: 'scale(-1, -1)' } : undefined} aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1">
    {['M120 0 L0 0', 'M120 0 L0 120', 'M120 0 L60 120', 'M120 0 L0 60', 'M120 0 L30 120', 'M120 0 L0 30', 'M120 0 L90 120', 'M120 0 L0 90', 'M95 0 Q92 22 72 48 Q48 72 22 95 Q10 108 0 108', 'M70 0 Q68 18 52 36 Q36 52 18 68 Q8 80 0 82', 'M45 0 Q44 12 34 24 Q24 34 12 44 Q5 52 0 54', 'M22 0 Q20 8 14 14 Q8 20 0 26'].map((d, i) => <path key={i} d={d} pathLength={1} style={{ animationDelay: `${i * 0.9}s` }} />)}
  </g></svg>;
}
function Spider({ left, delay, duration }: { left: string; delay: string; duration: string }) {
  const timing = { animationDelay: delay, animationDuration: duration };
  return <span className="bf-spider" style={{ left }}><i className="bf-spider-line" style={timing} /><svg className="bf-spider-body" style={timing} viewBox="0 0 40 40" width="26" height="26" aria-hidden="true"><g className="bf-spider-legs" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"><path d="M14 18 L4 10 M14 22 L2 22 M14 26 L4 34 M15 29 L8 38" /><path d="M26 18 L36 10 M26 22 L38 22 M26 26 L36 34 M25 29 L32 38" /></g><circle cx="20" cy="15" r="5" fill="currentColor" /><ellipse cx="20" cy="26" rx="7" ry="9" fill="currentColor" /><circle cx="18" cy="14" r="1.2" fill="var(--card)" /><circle cx="22" cy="14" r="1.2" fill="var(--card)" /></svg></span>;
}
function Bat({ top, delay, duration, size = 44, rtl = false }: { top: string; delay: string; duration: string; size?: number; rtl?: boolean }) {
  return <svg className="bf-bat" data-rtl={rtl || undefined} style={{ top, animationDelay: delay, animationDuration: duration }} viewBox="0 0 64 32" width={size} height={size / 2} aria-hidden="true"><path fill="currentColor" d="M32 8c-3 6-9 9-14 7-3 4-9 5-14 2 2 5 7 8 13 7-1 3 1 6 4 8 3-3 8-4 11-2 3-2 8-1 11 2 3-2 5-5 4-8 6 1 11-2 13-7-5 3-11 2-14-2-5 2-11-1-14-7z" /></svg>;
}
function Ghost() {
  return <svg className="bf-ghost" viewBox="0 0 60 80" width="54" height="72" aria-hidden="true"><path d="M30 4 C14 4 8 18 8 34 V74 l7-6 7 6 8-6 8 6 7-6 7 6 V34 C52 18 46 4 30 4z" fill="#fff" /><circle cx="22" cy="30" r="4" fill="#222" /><circle cx="38" cy="30" r="4" fill="#222" /><ellipse cx="30" cy="44" rx="4" ry="6" fill="#222" /></svg>;
}

/* ───────── Winter & Christmas pieces ───────── */
function Snow({ count, front = false, seed = 0 }: { count: number; front?: boolean; seed?: number }) {
  return <>{Array.from({ length: count }, (_, j) => { const i = j + seed; return <i key={j} className="bf-snow" data-front={front || undefined} style={{ left: `${(i * 37) % 100}%`, width: 2 + (i % 4) * 1.5, height: 2 + (i % 4) * 1.5, animationDelay: `${(i * 1.7) % 11}s`, animationDuration: `${(front ? 7 : 10) + ((i * 2.3) % 8)}s`, ['--drift' as string]: `${(i % 2 ? 1 : -1) * (14 + (i % 5) * 8)}px`, ['--blur' as string]: front ? '1.5px' : i % 3 === 0 ? '1px' : '0px' }} />; })}</>;
}
function Tree({ size }: { size: number }) {
  return <svg className="bf-tree" width={size * 0.7} height={size} viewBox="0 0 70 100" aria-hidden="true">
    <rect x="31" y="84" width="8" height="14" fill="oklch(.4 .07 60)" />
    <path d="M35 16 L58 50 H12z" fill="oklch(.42 .1 150)" /><path d="M35 34 L64 70 H6z" fill="oklch(.38 .1 150)" /><path d="M35 52 L70 88 H0z" fill="oklch(.34 .1 150)" />
    <path d="M12 50 L35 16 L58 50 Q46 46 35 50 Q24 46 12 50z" fill="#fff" opacity=".55" /><path d="M6 70 L35 34 L64 70 Q50 64 35 70 Q20 64 6 70z" fill="#fff" opacity=".4" />
    <path className="bf-star" d="M35 2 l3 7 7 .6 -5.4 4.6 1.7 7 -6.3-3.9 -6.3 3.9 1.7-7 -5.4-4.6 7-.6z" fill="oklch(.9 .17 90)" />
    <g className="bf-baubles"><circle cx="28" cy="44" r="3" fill="oklch(.6 .22 25)" /><circle cx="44" cy="60" r="3" fill="oklch(.8 .15 90)" /><circle cx="22" cy="74" r="3" fill="oklch(.65 .15 250)" /><circle cx="50" cy="80" r="3" fill="oklch(.6 .22 25)" /></g>
  </svg>;
}
function Gifts() {
  return <svg className="bf-gifts" viewBox="0 0 80 40" width="80" height="40" aria-hidden="true"><rect x="2" y="14" width="30" height="24" rx="2" fill="oklch(.55 .2 25)" /><rect x="15" y="14" width="4" height="24" fill="oklch(.9 .15 90)" /><rect x="2" y="22" width="30" height="4" fill="oklch(.9 .15 90)" /><rect x="40" y="20" width="24" height="18" rx="2" fill="oklch(.5 .14 250)" /><rect x="50" y="20" width="4" height="18" fill="#fff" /><rect x="40" y="27" width="24" height="3" fill="#fff" /><rect x="58" y="8" width="18" height="30" rx="2" fill="oklch(.5 .12 150)" /><rect x="65" y="8" width="4" height="30" fill="oklch(.9 .15 90)" /></svg>;
}
function Snowman() {
  return <svg className="bf-snowman" viewBox="0 0 80 110" width="72" height="99" aria-hidden="true"><circle cx="40" cy="80" r="28" fill="#fff" /><circle cx="40" cy="42" r="20" fill="#fff" /><circle cx="40" cy="14" r="12" fill="#fff" /><circle cx="36" cy="11" r="1.6" fill="#222" /><circle cx="44" cy="11" r="1.6" fill="#222" /><path d="M40 14 l9 2 -9 2z" fill="oklch(.68 .19 45)" /><circle cx="40" cy="36" r="1.8" fill="#222" /><circle cx="40" cy="44" r="1.8" fill="#222" /><circle cx="40" cy="52" r="1.8" fill="#222" /><path d="M22 40 L6 30 M58 40 L74 30" stroke="oklch(.4 .07 60)" strokeWidth="2.5" strokeLinecap="round" /><path d="M28 6 h24 v-4 h-24z M31 2 h18 v-8 h-18z" fill="#222" /><path d="M26 22 q14 6 28 0 l2 6 q-16 6 -32 0z" fill="oklch(.55 .2 25)" /></svg>;
}
function Lights() {
  const bulbs = Array.from({ length: 28 }, (_, i) => ({ x: 2 + i * 3.55, y: 7 + Math.sin(i * 0.9) * 2.5, hue: [25, 90, 150, 250, 330][i % 5]! }));
  return <svg className="bf-lights" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
    <path d={`M0 3 ${bulbs.map(b => `L${b.x} ${b.y - 3}`).join(' ')} L100 3`} fill="none" stroke="oklch(.35 .03 150)" strokeWidth=".35" vectorEffect="non-scaling-stroke" />
    {bulbs.map((b, i) => <circle key={i} className="bf-bulb" cx={b.x} cy={b.y} r="1.3" fill={`oklch(.78 .18 ${b.hue})`} style={{ animationDelay: `${(i * 0.37) % 2.2}s` }} />)}
  </svg>;
}
function Sleigh() {
  return <svg className="bf-sleigh" viewBox="0 0 260 60" width="260" height="60" aria-hidden="true"><g fill="currentColor">
    {[0, 44, 88].map(x => <path key={x} d={`M${x + 6} 40 l4-14 6-4 2-8 4 2 -2 6 8 2 4 6 10 2 2 8 -4 2 -2-6 -6 0 -2 6 -4 0 2-6 -8-2 -2 8 -4 0 1-8 -6 0 -2 8z`} />)}
    <path d="M136 36 h40 l6-14 h12 v14 h8 l-4 8 h-66 q-10 0 -12-8z" /><circle cx="186" cy="20" r="6" /><path d="M180 26 h14 l2 10 h-18z" /><path d="M126 38 h6 M126 38 q-4 0 -4 4 h-6" stroke="currentColor" strokeWidth="2" fill="none" />
    <path d="M0 42 q30-6 60-2 t60-2 t46-2" stroke="currentColor" strokeWidth="1.5" fill="none" opacity=".7" />
  </g></svg>;
}
function Leaf({ hue }: { hue: number }) {
  return <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M3 20 C3 8 11 3 21 3 C21 13 15 21 3 20z M3 20 L16 8" fill={`oklch(.62 .16 ${hue})`} stroke={`oklch(.45 .12 ${hue})`} strokeWidth="1" /></svg>;
}
function Leaves({ count, front = false, seed = 0 }: { count: number; front?: boolean; seed?: number }) {
  return <>{Array.from({ length: count }, (_, j) => { const i = j + seed; return <i key={j} className="bf-leaf" data-front={front || undefined} style={{ left: `${(i * 41) % 100}%`, width: 14 + (i % 3) * 4, height: 14 + (i % 3) * 4, animationDelay: `${(i * 2.3) % 13}s`, animationDuration: `${11 + ((i * 3.1) % 9)}s`, ['--drift' as string]: `${(i % 2 ? 1 : -1) * (30 + (i % 4) * 14)}px` }}><Leaf hue={[45, 60, 30, 80][i % 4]!} /></i>; })}</>;
}

/** Bugs wander along the bottom in both directions with pauses and wobbles; one climbs the right edge. */
const crawlers = [
  { y: 6, size: 22, duration: '46s', delay: '0s', dir: 1 }, { y: 30, size: 16, duration: '64s', delay: '12s', dir: -1 }, { y: 14, size: 18, duration: '52s', delay: '27s', dir: 1 },
  { y: 48, size: 14, duration: '80s', delay: '5s', dir: -1 }, { y: 2, size: 26, duration: '38s', delay: '41s', dir: 1 },
];
const bats = [{ top: '8%', delay: '0s', duration: '26s', size: 44 }, { top: '18%', delay: '7s', duration: '31s', size: 36 }, { top: '30%', delay: '14s', duration: '22s', size: 50 }, { top: '12%', delay: '20s', duration: '35s', size: 30 },
  { top: '22%', delay: '9s', duration: '28s', size: 40, rtl: true }, { top: '10%', delay: '9.6s', duration: '28s', size: 28, rtl: true }, { top: '16%', delay: '10.4s', duration: '28s', size: 34, rtl: true }];

/**
 * Two decorative layers for styles that have one, both fixed, pointer-events none and aria-hidden.
 * The back layer sits behind every card and panel, so still scenery (moon, webs, pumpkins, trees, snowman, drifts) only shows in the gaps and never over text.
 * The front layer carries the moving parts (bats, bugs, spider, sleigh, near snow) that cross content briefly and keep going.
 * 'subtle' shows still parts; 'lively' adds motion; 'off' renders nothing.
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
  const id = style.id; const live = lively || undefined;
  return <>
    <div className="bf-decor bf-decor-back" data-style={id} data-lively={live} aria-hidden="true">
      {id === 'halloween' && <>
        <svg className="bf-moon" viewBox="0 0 64 64" width="84" height="84"><path d="M40 4 a28 28 0 1 0 20 46 a22 22 0 1 1 -20-46z" fill="currentColor" /></svg>
        <Web className="bf-web-tr" /><Web className="bf-web-bl" size={110} flip />
        <div className="bf-scene bf-pumpkins"><Pumpkin size={54} tilt={-6} /><Pumpkin size={84} /><Pumpkin size={44} tilt={8} /></div>
        {lively && <Ghost />}
        {!lively && <><BugMascot size={18} className="bf-still" style={{ left: '38%', bottom: 4, transform: 'rotate(90deg)' }} /><BugMascot size={14} className="bf-still" style={{ right: '28%', bottom: 10, transform: 'rotate(-80deg)' }} /></>}
      </>}
      {id === 'winter' && <>
        <div className="bf-frost" /><div className="bf-aurora" />
        <div className="bf-drift bf-drift-far" /><div className="bf-drift" /><Snowman />
        {lively && <Snow count={26} />}
      </>}
      {id === 'christmas' && <>
        <div className="bf-drift bf-drift-far" /><div className="bf-drift" />
        <div className="bf-scene bf-trees"><Tree size={70} /><Tree size={120} /><Tree size={90} /><Tree size={56} /><Gifts /></div>
        {lively && <Snow count={22} />}
      </>}
      {id === 'autumn' && lively && <Leaves count={12} />}
    </div>
    <div className="bf-decor bf-decor-front" data-style={id} data-lively={live} aria-hidden="true">
      {id === 'halloween' && lively && <>
        {bats.map((b, i) => <Bat key={i} {...b} />)}
        {crawlers.map((c, i) => <BugMascot key={i} size={c.size} className="bf-crawl" style={{ bottom: c.y, animationDuration: c.duration, animationDelay: c.delay, ['--rot' as string]: `${90 * c.dir}deg`, animationDirection: c.dir < 0 ? 'reverse' : 'normal' }} />)}
        <BugMascot size={18} className="bf-climb" />
        <Spider left="31%" delay="6s" duration="96s" /><Spider left="72%" delay="51s" duration="118s" />
        {walking && <BugMascot size={30} className="bf-scurry" />}
      </>}
      {id === 'winter' && lively && <Snow count={7} front seed={100} />}
      {id === 'christmas' && <><Lights />{lively && <><Snow count={6} front seed={200} /><Sleigh /></>}</>}
      {id === 'autumn' && lively && <Leaves count={4} front seed={50} />}
      {id === 'terminal' && <div className="bf-scanlines" />}
    </div>
  </>;
}
