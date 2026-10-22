/** Screen coordinates: y grows downward. Edges are measured from the visible UI. */
export type LandingEdge = { left: number; right: number; top: number };
export type SnowBody = { x: number; y: number; vx: number; vy: number; radius: number; bounces: number; ignoreUntil: number };

export function stepSnow(body: SnowBody, dt: number, time: number, edges: LandingEdge[], wind: number) {
  const before = body.y;
  body.vx += (wind - body.vx) * Math.min(1, dt * .7);
  body.vy = Math.min(95, body.vy + 45 * dt);
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  if (body.vy <= 0 || time < body.ignoreUntil) return false;
  const edge = edges.filter(e => body.x >= e.left && body.x <= e.right && before + body.radius <= e.top && body.y + body.radius >= e.top).sort((a, b) => a.top - b.top)[0];
  if (!edge) return false;
  body.y = edge.top - body.radius;
  body.vy = -Math.max(13, body.vy * .48);
  body.vx += wind < 0 ? -22 : 22;
  body.bounces += 1;
  // After a second soft bounce it tumbles past this ledge and can meet a lower one.
  body.ignoreUntil = time + (body.bounces % 2 === 0 ? 1.1 : .12);
  return true;
}

export function perimeterPoint(rect: { left: number; top: number; width: number; height: number }, distance: number) {
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  let d = ((distance % (2 * (w + h))) + 2 * (w + h)) % (2 * (w + h));
  if (d < w) return { x: rect.left + d, y: rect.top, angle: -Math.PI / 2 };
  d -= w;
  if (d < h) return { x: rect.left + w, y: rect.top + d, angle: -Math.PI };
  d -= h;
  if (d < w) return { x: rect.left + w - d, y: rect.top + h, angle: -Math.PI * 1.5 };
  return { x: rect.left, y: rect.top + h - (d - w), angle: -Math.PI * 2 };
}
