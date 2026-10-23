import { BrandLogo3D } from './brand-logo-3d';
import { useTheme } from './theme-toggle';
import { styleById } from '@/lib/appearance';
import { Seasonal3D } from './seasonal-3d';

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

/** One lit brand sculpture shared by workspace and member portals. */
export function BrandMark() {
  const { effective, dark } = useTheme();
  return <BrandLogo3D motion={effective.motion} colorKey={`${effective.palette}:${effective.accent}:${effective.style}:${dark}`} />;
}

/** Seasonal themes use one renderer, including while it loads or WebGL is unavailable. */
export function Decorations() {
  const { effective, ready } = useTheme();
  const style = styleById(effective.style);
  if (!ready || effective.motion === 'off' || !style.decorated) return null;
  if (['halloween', 'winter', 'christmas', 'autumn'].includes(style.id)) {
    return <Seasonal3D season={style.id} lively={effective.motion === 'lively'} scene={effective.scene} />;
  }
  if (style.id === 'terminal') {
    return <div className="bf-decor bf-decor-front" data-style="terminal" aria-hidden="true"><div className="bf-scanlines" /></div>;
  }
  return null;
}
