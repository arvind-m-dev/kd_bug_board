import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { actionError } from './action-feedback';

/**
 * "Moved to Trash" feedback: a toast with a small 3D bin (SVG with CSS perspective, no WebGL). A card carrying the item's
 * label lifts from where the item was and arcs into the bin; the lid snaps shut. Undo flies it back out.
 * Motion 'off' or reduced motion skips the flight and keeps the toast.
 */
export type BinSource = Element | DOMRect | null | undefined;
const rectOf = (s: BinSource) => (!s ? null : s instanceof DOMRect ? s : s.getBoundingClientRect());
const still = () => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-motion') === 'off';

type Options = { title: string; label: string; detail?: string | undefined; source?: BinSource; onUndo?: (() => Promise<unknown>) | undefined; trashLink?: boolean | undefined };
export function moveToTrashToast({ title, label, detail, source, onUndo, trashLink = true }: Options) {
  const from = rectOf(source);
  toast.custom(id => <BinToast id={id} title={title} label={label} detail={detail} from={still() ? null : from} onUndo={onUndo} trashLink={trashLink} />, { duration: onUndo ? 8000 : 5000 });
}

/** One flight of the label card between two rectangles, along an arc, with gravity on the way down. */
function fly(label: string, from: DOMRect, to: DOMRect, reverse: boolean) {
  const card = document.createElement('div'); card.className = 'bf-bin-ghost'; card.textContent = label; card.setAttribute('aria-hidden', 'true');
  const w = Math.min(Math.max(from.width, 140), 360), h = Math.min(Math.max(from.height, 36), 64);
  const x0 = from.left + from.width / 2 - w / 2, y0 = from.top + from.height / 2 - h / 2;
  Object.assign(card.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
  document.body.append(card);
  const dx = to.left + to.width / 2 - (x0 + w / 2), dy = to.top + to.height * .3 - (y0 + h / 2);
  const lift = -Math.min(150, Math.max(70, Math.abs(dy) * .3));
  const path: Keyframe[] = [
    { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(.2,.7,.4,1)' },
    { transform: `translate(${dx * .4}px, ${Math.min(0, dy) + lift}px) scale(.62) rotate(-9deg)`, opacity: 1, offset: .45, easing: 'cubic-bezier(.55,0,.85,.35)' },
    { transform: `translate(${dx}px, ${dy}px) scale(.1) rotate(16deg)`, opacity: .35 },
  ];
  const back: Keyframe[] = [
    { transform: `translate(${dx}px, ${dy}px) scale(.1) rotate(16deg)`, opacity: .35, easing: 'cubic-bezier(.2,.7,.4,1)' },
    { transform: `translate(${dx * .4}px, ${Math.min(0, dy) + lift}px) scale(.62) rotate(-9deg)`, opacity: 1, offset: .55, easing: 'cubic-bezier(.45,0,.55,1)' },
    { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 0 },
  ];
  const animation = card.animate(reverse ? back : path, { duration: reverse ? 700 : 760, fill: 'forwards' });
  return { animation, remove: () => card.remove() };
}

function BinToast({ id, title, label, detail, from, onUndo, trashLink }: { id: string | number; title: string; label: string; detail?: string | undefined; from: DOMRect | null; onUndo?: (() => Promise<unknown>) | undefined; trashLink: boolean }) {
  const bin = useRef<HTMLSpanElement>(null); const navigate = useNavigate();
  const [lid, setLid] = useState<'open' | 'shut'>(from ? 'open' : 'shut'); const [gulp, setGulp] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!from) return;
    let flight: ReturnType<typeof fly> | null = null;
    // Wait for the toast to finish sliding in, so the bin is where it will stay.
    const t = window.setTimeout(() => {
      const to = bin.current?.getBoundingClientRect(); if (!to) return;
      flight = fly(label, from, to, false);
      flight.animation.onfinish = () => { flight?.remove(); setLid('shut'); setGulp(true); };
    }, 380);
    return () => { window.clearTimeout(t); flight?.animation.cancel(); flight?.remove(); };
  }, [from, label]);
  async function undo() {
    if (!onUndo || busy) return; setBusy(true);
    try {
      await onUndo();
      const to = bin.current?.getBoundingClientRect();
      if (from && to && !still()) { setLid('open'); const back = fly(label, from, to, true); back.animation.onfinish = () => back.remove(); }
      window.setTimeout(() => toast.dismiss(id), from ? 420 : 0);
      toast.success('Restored', { description: label });
    } catch (e) { toast.error(actionError(e, 'It could not be restored.')); setBusy(false); }
  }
  return <div className="bf-bin-toast" role="status">
    <span ref={bin} className="bf-bin" data-lid={lid} data-gulp={gulp || undefined} onAnimationEnd={() => setGulp(false)} aria-hidden="true">
      <svg className="bf-bin-body" viewBox="0 0 48 52" width="44" height="48">
        <defs>
          <linearGradient id="bf-bin-metal" x1="0" x2="1"><stop offset="0" className="bf-bin-s1" /><stop offset=".35" className="bf-bin-s2" /><stop offset=".62" className="bf-bin-s3" /><stop offset="1" className="bf-bin-s4" /></linearGradient>
          <radialGradient id="bf-bin-mouth" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#0b0e16" /><stop offset="1" stopColor="#262c3a" /></radialGradient>
        </defs>
        <path d="M4 8 L44 8 L39.5 48 Q39 51 36 51 L12 51 Q9 51 8.5 48 Z" fill="url(#bf-bin-metal)" />
        <ellipse cx="24" cy="8" rx="20" ry="4.6" fill="url(#bf-bin-mouth)" />
        <ellipse cx="24" cy="8" rx="20" ry="4.6" fill="none" className="bf-bin-rim" strokeWidth="1.6" />
        <g className="bf-bin-ribs" strokeWidth="1.4" strokeLinecap="round"><path d="M15 15 L16.6 45" /><path d="M24 15.5 V45.5" /><path d="M33 15 L31.4 45" /></g>
        <path d="M8.6 44 Q24 47.5 39.4 44" fill="none" className="bf-bin-band" strokeWidth="2.4" />
      </svg>
      <svg className="bf-bin-lid" viewBox="0 0 48 14" width="44" height="13">
        <ellipse cx="24" cy="9" rx="22" ry="4.6" fill="url(#bf-bin-metal)" />
        <ellipse cx="24" cy="8" rx="22" ry="4.6" className="bf-bin-lidtop" />
        <path d="M18 6 Q18 1.5 24 1.5 Q30 1.5 30 6" fill="none" className="bf-bin-handle" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </span>
    <span className="min-w-0 flex-1">
      <strong className="block truncate text-sm">{title}</strong>
      <span className="block truncate text-xs text-muted-foreground" title={label}>{label}</span>
      {detail && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{detail}</span>}
      <span className="mt-2 flex flex-wrap gap-1.5">
        {onUndo && <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void undo()}>{busy ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}Undo</Button>}
        {trashLink && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { toast.dismiss(id); void navigate({ to: '/admin/trash' }); }}><Trash2 />Open Trash</Button>}
      </span>
    </span>
  </div>;
}
