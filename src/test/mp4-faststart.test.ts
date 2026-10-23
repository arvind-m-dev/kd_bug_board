import { describe, expect, it } from "vitest";
import { faststart } from "@/lib/mp4-faststart";

const box = (type: string, ...parts: Uint8Array[]) => {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const u32 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
};
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const offsets = (file: Uint8Array) => {
  const text = String.fromCharCode(...file);
  const at = text.indexOf("stco") + 4;
  const v = new DataView(file.buffer, file.byteOffset);
  return [v.getUint32(at + 8), v.getUint32(at + 12)];
};

describe("mp4 faststart", () => {
  const ftyp = box("ftyp", new TextEncoder().encode("qt  "), u32(0));
  const payload = new Uint8Array(64).map((_, i) => i + 1);
  const mdat = box("mdat", payload);
  const chunkA = ftyp.length + 8,
    chunkB = ftyp.length + 8 + 32;
  const moov = box(
    "moov",
    box("trak", box("mdia", box("minf", box("stbl", box("stco", u32(0, 2, chunkA, chunkB)))))),
  );
  it("moves the index before the media and shifts chunk offsets so they still point at the same bytes", () => {
    const original = join(ftyp, mdat, moov);
    const out = faststart(original.slice().buffer)!;
    expect(out).not.toBeNull();
    expect(out.length).toBe(original.length);
    const text = String.fromCharCode(...out);
    expect(text.indexOf("moov")).toBeLessThan(text.indexOf("mdat"));
    const [a, b] = offsets(out);
    expect(out[a!]).toBe(original[chunkA]);
    expect(out[b!]).toBe(original[chunkB]);
    expect(a).toBe(chunkA + moov.length);
  });
  it("leaves files that already start with the index, fragmented files and junk alone", () => {
    expect(faststart(join(ftyp, moov, mdat).buffer)).toBeNull();
    expect(faststart(join(ftyp, box("moov"), box("moof"), mdat).buffer)).toBeNull();
    expect(faststart(new Uint8Array([0, 0, 0, 99, 1, 2, 3, 4]).buffer)).toBeNull();
  });
});
