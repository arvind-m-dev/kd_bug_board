import { MEDIA_MAX_BYTES, MEDIA_MAX_EDGE, MEDIA_QUALITY, formatBytes, mediaKind, rejectReason, resolveContentType, safeFileName, type MediaType } from './bug-media';

/** Browser-only helpers: shrink images before upload and PUT straight to the bucket with progress. */
export type PreparedFile = { blob: Blob; contentType: MediaType; name: string; size: number; originalSize: number; width: number | null; height: number | null };

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  return new Promise(resolve => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); resolve(null); }; img.src = url; });
}
const canWebp = () => { try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; } };
/** Resizes to ≤1920 px and re-encodes (WebP when possible, else JPEG); keeps the original when that is not smaller. Re-encoding also drops EXIF/GPS data. */
async function compressImage(file: File, type: MediaType): Promise<{ blob: Blob; contentType: MediaType; width: number | null; height: number | null }> {
  const keep = { blob: file as Blob, contentType: type, width: null, height: null };
  if (type === 'image/gif') return keep;
  const src = await decode(file); if (!src) return keep;
  const w = 'width' in src ? src.width : 0, h = 'height' in src ? src.height : 0; if (!w || !h) return keep;
  const scale = Math.min(1, MEDIA_MAX_EDGE / Math.max(w, h)); const tw = Math.round(w * scale), th = Math.round(h * scale);
  const small = scale === 1 && file.size < 400 * 1024; // already small: keep as is, just record dimensions
  if (small) return { ...keep, width: w, height: h };
  const canvas = document.createElement('canvas'); canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext('2d'); if (!ctx) return { ...keep, width: w, height: h };
  ctx.drawImage(src, 0, 0, tw, th); if ('close' in src) src.close();
  const out: MediaType = type === 'image/jpeg' ? 'image/jpeg' : canWebp() ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, out, MEDIA_QUALITY));
  if (!blob || (blob.size >= file.size && scale === 1)) return { ...keep, width: w, height: h };
  return { blob, contentType: out, width: tw, height: th };
}
/** Validates, compresses and names one file; returns an error message instead when it cannot be attached. */
export async function prepareFile(file: File): Promise<{ ok: true; file: PreparedFile } | { ok: false; error: string }> {
  const reason = rejectReason(file.name, file.type, file.size); if (reason) return { ok: false, error: reason };
  const type = resolveContentType(file.name, file.type)!;
  const r = mediaKind(type) === 'image' ? await compressImage(file, type) : { blob: file as Blob, contentType: type, width: null, height: null };
  if (r.blob.size > MEDIA_MAX_BYTES) return { ok: false, error: `Still ${formatBytes(r.blob.size)} after compression — the limit is ${formatBytes(MEDIA_MAX_BYTES)}.` };
  const base = safeFileName(file.name).replace(/\.[^.]+$/, '') || 'file'; const ext = r.contentType === type ? (file.name.match(/\.[^.]+$/)?.[0] ?? '') : r.contentType === 'image/webp' ? '.webp' : '.jpg';
  return { ok: true, file: { blob: r.blob, contentType: r.contentType, name: safeFileName(base + (ext || '')), size: r.blob.size, originalSize: file.size, width: r.width, height: r.height } };
}
/** PUT to the signed URL with upload progress and cancel. A status of 0 almost always means the bucket's CORS rule is missing. */
export function uploadPut(url: string, headers: Record<string, string>, blob: Blob, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('PUT', url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => { if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412) resolve(); /* 412: object already there (retry after a failed finish); finish verifies it */ else reject(new Error(xhr.status === 403 ? 'Storage refused the upload link (expired or wrong bucket policy). Try again.' : `Storage refused the upload (HTTP ${xhr.status}).`)); };
    xhr.onerror = () => reject(new Error('The upload could not reach storage. This is usually the bucket CORS rule — see Settings → Media storage.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}
