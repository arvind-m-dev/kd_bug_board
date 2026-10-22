import { z } from 'zod';
import { LOCKED_FOR_EDIT } from './bug-workflow';

/**
 * Pure rules for private bug media (screenshots, recordings, PDFs) kept in an S3-compatible bucket.
 * Nothing here touches the network or the browser; the server enforces every rule after the bug-scope check.
 */
export const MEDIA_TYPES = {
  'image/png': { ext: 'png', kind: 'image' }, 'image/jpeg': { ext: 'jpg', kind: 'image' }, 'image/webp': { ext: 'webp', kind: 'image' }, 'image/gif': { ext: 'gif', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' }, 'video/webm': { ext: 'webm', kind: 'video' }, 'application/pdf': { ext: 'pdf', kind: 'pdf' },
} as const;
export type MediaType = keyof typeof MEDIA_TYPES;
export type MediaKind = (typeof MEDIA_TYPES)[MediaType]['kind'];
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES) as MediaType[];
export const MEDIA_MAX_BYTES = 26_214_400; // 25 MB after compression
export const MEDIA_MAX_FILES = 10; // per bug
export const MEDIA_URL_TTL = 600; // seconds a signed view link lasts
export const MEDIA_PUT_TTL = 900; // seconds a signed upload link lasts
export const MEDIA_PENDING_MINUTES = 120; // an upload that never finished is forgotten after this
export const MEDIA_MAX_EDGE = 1920; // images are resized to this longest edge in the browser
export const MEDIA_QUALITY = 0.82;

export type MediaItem = { id: string; bugId: string; name: string; contentType: MediaType; kind: MediaKind; size: number; width: number | null; height: number | null; uploadedById: string; uploadedBy: string; createdAt: string; url: string | null; expiresAt: string | null };
export type MediaConfig = { enabled: boolean; maxBytes: number; maxFiles: number; accept: string[] };
export const MEDIA_OFF: MediaConfig = { enabled: false, maxBytes: MEDIA_MAX_BYTES, maxFiles: MEDIA_MAX_FILES, accept: MEDIA_ACCEPT };
export const MEDIA_ON: MediaConfig = { ...MEDIA_OFF, enabled: true };

export const isMediaType = (v: string): v is MediaType => v in MEDIA_TYPES;
export const mediaKind = (t: MediaType): MediaKind => MEDIA_TYPES[t].kind;
/** Object key: numeric bug id + the client-generated uuid + whitelisted extension. The filename never reaches the key. */
export const mediaKey = (bugId: string, id: string, contentType: MediaType) => `bugs/${bugId}/${id}.${MEDIA_TYPES[contentType].ext}`;
/** Display name only: no control characters or path separators, no leading dots, at most 140 characters. */
export function safeFileName(name: string) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must go
  const s = name.replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (s || 'file').slice(0, 140);
}
const EXT_TYPES: Record<string, MediaType> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf' };
/** The MIME type to upload as, from the browser's type with an extension fallback (some browsers send ''). */
export function resolveContentType(fileName: string, fileType: string): MediaType | null {
  const t = fileType.toLowerCase().split(';')[0]!.trim();
  if (isMediaType(t)) return t;
  if (t === 'image/jpg') return 'image/jpeg';
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return (!t || t === 'application/octet-stream') && EXT_TYPES[ext] ? EXT_TYPES[ext]! : null;
}
/** Why a file cannot be attached, before any network work; null means it may proceed. */
export function rejectReason(fileName: string, fileType: string, size: number): string | null {
  const t = fileType.toLowerCase(); const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (t.includes('heic') || t.includes('heif') || ext === 'heic' || ext === 'heif') return 'Convert HEIC photos to JPEG first (iPhone: Settings → Camera → Formats → Most Compatible).';
  if (t === 'video/quicktime' || ext === 'mov') return 'Export .mov recordings as MP4 first — browsers cannot play or compress them.';
  const type = resolveContentType(fileName, fileType);
  if (!type) return 'Only PNG, JPEG, WebP, GIF, MP4, WebM and PDF files can be attached.';
  if (size <= 0) return 'This file is empty.';
  if (mediaKind(type) !== 'image' && size > MEDIA_MAX_BYTES) return `Too large (${formatBytes(size)}) — the limit is ${formatBytes(MEDIA_MAX_BYTES)} per file.`;
  return null;
}
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024); if (mb >= 1024) return `${+(mb / 1024).toFixed(1)} GB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

type Actor = { userId: string; role: string; permissions: string[] };
type BugLike = { reporterId: string; status: string; assigneeId: string | null; assignees?: { id: string }[] };
/** Who may attach a file: Admin; the reporter (with 'report'); an assignee or co-assignee (with 'progress'); QA (with 'validate' or 'verify'). Non-Admins cannot attach to closed bugs. */
export function mayUploadMedia(actor: Actor, bug: BugLike) {
  if (actor.role === 'admin') return true;
  if (LOCKED_FOR_EDIT.includes(bug.status)) return false;
  const has = (p: string) => actor.permissions.includes(p);
  if (has('report') && bug.reporterId === actor.userId) return true;
  const assigned = bug.assigneeId === actor.userId || (bug.assignees ?? []).some(a => a.id === actor.userId);
  if (assigned && has('progress')) return true;
  return has('validate') || has('verify');
}
/** Who may remove a file: Admin or the person who uploaded it, in any bug status (reclaiming storage is always possible). */
export const mayDeleteMedia = (actor: Actor, item: { uploadedById: string }) => actor.role === 'admin' || item.uploadedById === actor.userId;

const id = z.string().uuid(); const bugId = z.string().regex(/^[1-9]\d*$/);
export const prepareMediaSchema = z.object({ bugId, id, name: z.string().trim().min(1).max(255), contentType: z.enum(MEDIA_ACCEPT as [MediaType, ...MediaType[]]), size: z.number().int().min(1).max(MEDIA_MAX_BYTES) }).strict();
export const finishMediaSchema = z.object({ id, width: z.number().int().min(1).max(20000).nullable().default(null), height: z.number().int().min(1).max(20000).nullable().default(null) }).strict();
export const deleteMediaSchema = z.object({ id }).strict();
export const mediaStatusSchema = z.object({ test: z.boolean().default(false) }).strict();
export type MediaStatus = { configured: boolean; missing: string[]; provider: string; bucket: string; endpointHost: string; files: number; bytes: number; awaitingPurge: number; pending: number; test: { ok: boolean; ms: number; message: string } | null };

/** The hosting the endpoint points at, for the Settings card. */
export function providerName(endpoint: string) {
  const h = (() => { try { return new URL(endpoint).hostname; } catch { return ''; } })();
  return h.endsWith('r2.cloudflarestorage.com') ? 'Cloudflare R2' : h.includes('backblazeb2.com') ? 'Backblaze B2' : h.endsWith('amazonaws.com') ? 'Amazon S3' : h ? 'S3-compatible storage' : '';
}
