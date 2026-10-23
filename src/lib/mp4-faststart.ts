/**
 * "Faststart" for MP4 and QuickTime files: moves the index box (moov) in front of the media data (mdat).
 * Recorders often write the index last, so a browser must fetch the end of the file before it can play anything;
 * with the index first, playback starts after the first small range request. Chunk offsets (stco/co64) inside
 * the index are shifted by the index size. Returns null when nothing needs doing or the file is not a plain MP4
 * (already faststart, fragmented, compressed index, or malformed), in which case the original is used unchanged.
 */
type Box = { type: string; start: number; size: number; header: number };
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta"]);

function boxes(view: DataView, start: number, end: number): Box[] | null {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(
      view.getUint8(p + 4),
      view.getUint8(p + 5),
      view.getUint8(p + 6),
      view.getUint8(p + 7),
    );
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) return null;
      size = view.getUint32(p + 8) * 2 ** 32 + view.getUint32(p + 12);
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || p + size > end) return null;
    out.push({ type, start: p, size, header });
    p += size;
  }
  return out;
}

/** Shifts chunk offsets that point into [from, to) by `by`, in place. False if an offset would overflow. */
function patch(
  view: DataView,
  start: number,
  end: number,
  from: number,
  to: number,
  by: number,
): boolean {
  const list = boxes(view, start, end);
  if (!list) return false;
  for (const b of list) {
    const body = b.start + b.header;
    if (b.type === "cmov") return false;
    if (CONTAINERS.has(b.type)) {
      if (!patch(view, body, b.start + b.size, from, to, by)) return false;
    } else if (b.type === "stco") {
      const count = view.getUint32(body + 4);
      if (body + 8 + count * 4 > b.start + b.size) return false;
      for (let i = 0; i < count; i++) {
        const at = body + 8 + i * 4;
        const v = view.getUint32(at);
        if (v >= from && v < to) {
          if (v + by > 0xffffffff) return false;
          view.setUint32(at, v + by);
        }
      }
    } else if (b.type === "co64") {
      const count = view.getUint32(body + 4);
      if (body + 8 + count * 8 > b.start + b.size) return false;
      for (let i = 0; i < count; i++) {
        const at = body + 8 + i * 8;
        const v = view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);
        if (v >= from && v < to) {
          const n = v + by;
          view.setUint32(at, Math.floor(n / 2 ** 32));
          view.setUint32(at + 4, n >>> 0);
        }
      }
    }
  }
  return true;
}

export function faststart(buffer: ArrayBuffer): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(buffer);
  const top = boxes(view, 0, buffer.byteLength);
  if (!top) return null;
  const moov = top.findIndex((b) => b.type === "moov");
  const mdat = top.findIndex((b) => b.type === "mdat");
  if (moov < 0 || mdat < 0 || moov < mdat || top.some((b) => b.type === "moof")) return null;
  const m = top[moov]!,
    d = top[mdat]!;
  const index = new Uint8Array(buffer.slice(m.start, m.start + m.size));
  const ok = patch(new DataView(index.buffer), m.header, m.size, d.start, m.start, m.size);
  if (!ok) return null;
  const bytes = new Uint8Array(buffer);
  const out = new Uint8Array(buffer.byteLength);
  out.set(bytes.subarray(0, d.start), 0);
  out.set(index, d.start);
  out.set(bytes.subarray(d.start, m.start), d.start + m.size);
  out.set(bytes.subarray(m.start + m.size), m.start + m.size);
  return out;
}
