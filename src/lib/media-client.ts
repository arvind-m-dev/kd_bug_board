import { MEDIA_MAX_EDGE, MEDIA_TYPES, MEDIA_QUALITY, formatBytes, maxBytesFor, mediaKind, rejectReason, resolveContentType, safeFileName, videoPlan, type MediaType } from './bug-media';

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
export type VideoProgress = (fraction: number, doneSeconds: number, totalSeconds: number) => void;
const recorderMime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? null;
/**
 * Re-encodes a recording in the browser at a bitrate chosen from its length, so it lands near 80 MB. Plays it through silently
 * at normal speed (so it takes as long as the recording runs) and records the stream; no library download, no server work.
 */
export async function compressVideo(file: File, onProgress: VideoProgress, signal?: AbortSignal): Promise<{ blob: Blob; contentType: MediaType }> {
  const mime = recorderMime(); if (!mime) throw new Error('This browser cannot compress recordings. Use Chrome, Edge, Firefox or Safari 15+, or upload a file under 100 MB.');
  const url = URL.createObjectURL(file); const video = document.createElement('video'); video.src = url; video.preload = 'auto'; video.playsInline = true; video.muted = false; video.volume = 1;
  const ac = new AudioContext();
  try {
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('This recording cannot be read by the browser. Export it as MP4 (H.264) and try again.')); });
    const duration = video.duration; const plan = videoPlan(duration);
    if (!plan) throw new Error(`This recording runs ${Math.round(duration / 60)} minutes — too long to fit under 100 MB. Trim it to the part that shows the bug, or split it.`);
    // Audio is routed through an AudioContext so nothing is heard while it still reaches the recorder; the video track comes straight from the element.
    const dest = ac.createMediaStreamDestination(); ac.createMediaElementSource(video).connect(dest);
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }); const grab = capture.captureStream ?? capture.mozCaptureStream;
    let stream: MediaStream; let stopDraw = () => {};
    if (grab) stream = grab.call(video);
    else { // Safari: draw frames onto a canvas and capture that
      const c = document.createElement('canvas'); const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight)); c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
      const ctx = c.getContext('2d')!; let raf = 0; const draw = () => { ctx.drawImage(video, 0, 0, c.width, c.height); raf = requestAnimationFrame(draw); }; draw(); stopDraw = () => cancelAnimationFrame(raf);
      stream = c.captureStream(30);
    }
    const out = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: plan.videoBitsPerSecond, audioBitsPerSecond: plan.audioBitsPerSecond });
    const chunks: Blob[] = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const blob = await new Promise<Blob>((resolve, reject) => {
      const fail = (err: Error) => { try { if (rec.state !== 'inactive') rec.stop(); } catch { /* already stopped */ } video.pause(); reject(err); };
      signal?.addEventListener('abort', () => fail(new Error('Compression cancelled.')), { once: true });
      video.ontimeupdate = () => onProgress(Math.min(1, video.currentTime / duration), video.currentTime, duration);
      video.onended = () => { if (rec.state !== 'inactive') rec.stop(); };
      rec.onerror = () => fail(new Error('Compression failed in this browser. Try Chrome or upload a shorter recording.'));
      rec.onstop = () => { stopDraw(); if (signal?.aborted) return; onProgress(1, duration, duration); resolve(new Blob(chunks, { type: mime.split(';')[0]! })); };
      rec.start(1000);
      video.play().catch(() => fail(new Error('The recording could not be played for compression.')));
    });
    return { blob, contentType: mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm' };
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); void ac.close().catch(() => undefined); }
}
/** Validates, compresses and names one file; returns an error message instead when it cannot be attached. Recordings over the limit are compressed first. */
export async function prepareFile(file: File, video?: { onProgress: VideoProgress; signal?: AbortSignal | undefined }): Promise<{ ok: true; file: PreparedFile } | { ok: false; error: string }> {
  const reason = rejectReason(file.name, file.type, file.size); if (reason) return { ok: false, error: reason };
  const type = resolveContentType(file.name, file.type)!;
  let r: { blob: Blob; contentType: MediaType; width: number | null; height: number | null };
  try {
    r = mediaKind(type) === 'image' ? await compressImage(file, type)
      : mediaKind(type) === 'video' && file.size > maxBytesFor(type) ? { ...(await compressVideo(file, video?.onProgress ?? (() => undefined), video?.signal)), width: null, height: null }
      : { blob: file as Blob, contentType: type, width: null, height: null };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'The file could not be prepared.' }; }
  if (r.blob.size > maxBytesFor(r.contentType)) return { ok: false, error: `Still ${formatBytes(r.blob.size)} after compression — the limit is ${formatBytes(maxBytesFor(r.contentType))}.` };
  const base = safeFileName(file.name).replace(/\.[^.]+$/, '') || 'file'; const ext = r.contentType === type ? (file.name.match(/\.[^.]+$/)?.[0] ?? '') : `.${MEDIA_TYPES[r.contentType].ext}`;
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
