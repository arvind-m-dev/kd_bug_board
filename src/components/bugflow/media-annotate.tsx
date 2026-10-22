import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, PenLine, Save, Square, Type, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MEDIA_NAME_MAX } from '@/lib/bug-media';

/**
 * Draw on a screenshot or a captured video frame: pencil, boxes, arrows and text.
 * Nothing is changed in place — Save produces a new PNG that the caller attaches as its own file, linked to the original.
 */
type Tool = 'pen' | 'rect' | 'arrow' | 'text';
type Shape =
  | { type: 'pen'; points: number[]; color: string; width: number }
  | { type: 'rect' | 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number };
const COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#111111'];
const TOOLS: { id: Tool; label: string; icon: typeof PenLine }[] = [{ id: 'pen', label: 'Pencil', icon: PenLine }, { id: 'rect', label: 'Box', icon: Square }, { id: 'arrow', label: 'Arrow', icon: ArrowUpRight }, { id: 'text', label: 'Text', icon: Type }];

export type AnnotationSource = { image: CanvasImageSource; width: number; height: number };

/** Loads a signed image URL so the canvas stays exportable (needs GET in the bucket's CORS rule). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('The image could not be loaded for drawing. Check that the bucket CORS rule allows GET from this site.')); img.src = url; });
}
/** Copies the current frame of a playing/paused video; fails when the bucket CORS rule does not allow GET. */
export function captureFrame(video: HTMLVideoElement): AnnotationSource {
  const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d'); if (!ctx || !c.width) throw new Error('The video has not loaded yet. Play it, pause on the moment you want and try again.');
  ctx.drawImage(video, 0, 0);
  try { ctx.getImageData(0, 0, 1, 1); } catch { throw new Error('This frame cannot be captured. Check that the bucket CORS rule allows GET from this site.'); }
  return { image: c, width: c.width, height: c.height };
}

function paint(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.type === 'text') { ctx.font = `700 ${s.size}px system-ui, sans-serif`; ctx.lineWidth = Math.max(2, s.size / 8); ctx.strokeStyle = s.color === '#ffffff' ? '#111111' : '#ffffff'; ctx.strokeText(s.text, s.x, s.y); ctx.fillStyle = s.color; ctx.fillText(s.text, s.x, s.y); ctx.restore(); return; }
  ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
  if (s.type === 'pen') { ctx.beginPath(); for (let i = 0; i < s.points.length; i += 2) { if (i === 0) ctx.moveTo(s.points[0]!, s.points[1]!); else ctx.lineTo(s.points[i]!, s.points[i + 1]!); } if (s.points.length === 2) ctx.lineTo(s.points[0]! + 0.1, s.points[1]!); ctx.stroke(); }
  else if (s.type === 'rect') { ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)); }
  else { const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1); const head = s.width * 4; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(s.x2, s.y2); ctx.lineTo(s.x2 - head * Math.cos(a - Math.PI / 6), s.y2 - head * Math.sin(a - Math.PI / 6)); ctx.lineTo(s.x2 - head * Math.cos(a + Math.PI / 6), s.y2 - head * Math.sin(a + Math.PI / 6)); ctx.closePath(); ctx.fillStyle = s.color; ctx.fill(); }
  ctx.restore();
}

export function AnnotationEditor({ source, defaultName, caption, onSave, onClose }: { source: AnnotationSource; defaultName: string; caption: string; onSave: (file: File, name: string) => Promise<void>; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null); const wrap = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('pen'); const [color, setColor] = useState(COLORS[0]!); const [thick, setThick] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]); const [draft, setDraft] = useState<Shape | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null); const [text, setText] = useState('');
  const [name, setName] = useState(defaultName); const [saving, setSaving] = useState(false);
  const base = Math.max(3, Math.round(source.width / 320)); const width = thick ? base * 2.2 : base; const fontSize = Math.max(18, Math.round(source.width / 36));

  const redraw = useCallback(() => {
    const c = canvas.current; const ctx = c?.getContext('2d'); if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(source.image, 0, 0, c.width, c.height);
    for (const s of shapes) paint(ctx, s); if (draft) paint(ctx, draft);
  }, [source, shapes, draft]);
  useEffect(() => { redraw(); }, [redraw]);

  const at = (e: React.PointerEvent) => { const c = canvas.current!; const r = c.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * (c.width / r.width)), y: Math.round((e.clientY - r.top) * (c.height / r.height)) }; };
  const down = (e: React.PointerEvent) => {
    if (saving) return; const p = at(e);
    if (tool === 'text') { setTextAt(p); setText(''); return; }
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraft(tool === 'pen' ? { type: 'pen', points: [p.x, p.y], color, width } : { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width });
  };
  const move = (e: React.PointerEvent) => { if (!draft || draft.type === 'text') return; const p = at(e); setDraft(draft.type === 'pen' ? { ...draft, points: [...draft.points, p.x, p.y] } : { ...draft, x2: p.x, y2: p.y }); };
  const up = () => { if (!draft) return; setShapes(list => [...list, draft]); setDraft(null); };
  const commitText = () => { if (textAt && text.trim()) setShapes(list => [...list, { type: 'text', x: textAt.x, y: textAt.y, text: text.trim(), color, size: fontSize }]); setTextAt(null); setText(''); };

  async function save() {
    const c = canvas.current; if (!c) return; setSaving(true);
    try {
      const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The drawing could not be exported.');
      const clean = name.trim().slice(0, MEDIA_NAME_MAX) || defaultName;
      await onSave(new File([blob], `${clean}.png`, { type: 'image/png' }), clean);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The drawing could not be saved.'); setSaving(false); }
  }
  const textStyle = (() => { const c = canvas.current; if (!textAt || !c) return {}; const r = c.getBoundingClientRect(); const w = wrap.current?.getBoundingClientRect(); return { left: (r.left - (w?.left ?? 0)) + textAt.x * (r.width / c.width), top: (r.top - (w?.top ?? 0)) + textAt.y * (r.height / c.height) - 28 }; })();

  return <Dialog open onOpenChange={o => { if (!o && !saving) onClose(); }}><DialogContent className="bf-annotate max-w-6xl">
    <DialogHeader><DialogTitle>Mark up {caption}</DialogTitle><DialogDescription>Draw boxes, arrows, lines and text. Saving attaches a new file next to the original; the original is never changed.</DialogDescription></DialogHeader>
    <div className="bf-annotate-tools" role="toolbar" aria-label="Drawing tools">
      <div className="bf-mode" role="radiogroup" aria-label="Tool">{TOOLS.map(t => <button key={t.id} type="button" role="radio" aria-checked={tool === t.id} onClick={() => setTool(t.id)}><t.icon size={14} />{t.label}</button>)}</div>
      <div className="bf-annotate-colors" role="radiogroup" aria-label="Colour">{COLORS.map(c => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
      <label className="bf-switch-row text-xs"><input type="checkbox" checked={thick} onChange={e => setThick(e.target.checked)} /> Thick lines</label>
      <span className="ml-auto flex gap-1"><Button type="button" variant="outline" size="sm" disabled={!shapes.length || saving} onClick={() => setShapes(l => l.slice(0, -1))}><Undo2 />Undo</Button><Button type="button" variant="ghost" size="sm" disabled={!shapes.length || saving} onClick={() => setShapes([])}><X />Clear</Button></span>
    </div>
    <div ref={wrap} className="bf-annotate-stage" data-tool={tool}>
      <canvas ref={canvas} width={source.width} height={source.height} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Drawing canvas" />
      {textAt && <input className="bf-annotate-text" style={textStyle} autoFocus value={text} maxLength={120} placeholder="Type, then Enter" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } if (e.key === 'Escape') { setTextAt(null); setText(''); } }} onBlur={commitText} />}
    </div>
    <div className="bf-annotate-save">
      <label className="grid min-w-0 flex-1 gap-1 text-xs"><span className="text-muted-foreground">Name for the marked-up copy</span><input className="bf-input" value={name} maxLength={MEDIA_NAME_MAX} onChange={e => setName(e.target.value)} /></label>
      <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
      <Button type="button" size="sm" disabled={saving || !shapes.length} onClick={() => void save()}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}Save as new file</Button>
    </div>
  </DialogContent></Dialog>;
}
