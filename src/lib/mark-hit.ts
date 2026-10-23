/**
 * Eraser hit-testing for drawings (pencil strokes, boxes, arrows, text). Works in screen/canvas pixels: callers map
 * their own coordinates (fractions of a video frame, or image pixels) through X/Y, and give the text size in pixels.
 */
type Pt = { x: number; y: number };
export type HitShape =
  | { type: "pen"; points: number[] }
  | { type: "rect" | "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { type: "text"; x: number; y: number; text: string };

function toSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function hitShape(
  s: HitShape,
  p: Pt,
  X: (v: number) => number,
  Y: (v: number) => number,
  textPx: number,
  tolerance: number,
) {
  if (s.type === "text") {
    const left = X(s.x),
      base = Y(s.y);
    const width = s.text.length * textPx * 0.62;
    return (
      p.x >= left - tolerance &&
      p.x <= left + width + tolerance &&
      p.y >= base - textPx - tolerance &&
      p.y <= base + textPx * 0.3 + tolerance
    );
  }
  if (s.type === "pen") {
    const pts: Pt[] = [];
    for (let i = 0; i < s.points.length; i += 2)
      pts.push({ x: X(s.points[i]!), y: Y(s.points[i + 1]!) });
    if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) <= tolerance;
    for (let i = 1; i < pts.length; i++)
      if (toSegment(p, pts[i - 1]!, pts[i]!) <= tolerance) return true;
    return false;
  }
  const a = { x: X(s.x1), y: Y(s.y1) },
    b = { x: X(s.x2), y: Y(s.y2) };
  if (s.type === "arrow") return toSegment(p, a, b) <= tolerance;
  // A box is erased by touching its outline (its inside stays usable for drawing over).
  const c = { x: a.x, y: b.y },
    d = { x: b.x, y: a.y };
  return [
    [a, d],
    [d, b],
    [b, c],
    [c, a],
  ].some(([u, v]) => toSegment(p, u!, v!) <= tolerance);
}
