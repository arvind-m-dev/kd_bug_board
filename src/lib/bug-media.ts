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
export const MEDIA_MAX_BYTES = 26_214_400; // 25 MB after compression (images, PDFs)
export const MEDIA_MAX_VIDEO_BYTES = 104_857_600; // 100 MB per recording, after browser compression
export const MEDIA_VIDEO_INPUT_MAX = 2_147_483_648; // a 2 GB recording is still accepted: it is compressed in the browser first
export const MEDIA_VIDEO_TARGET_BYTES = 80 * 1024 * 1024; // what compression aims for
export const MEDIA_MAX_FILES = 10; // per bug
/** Bugs in these statuses count as closed for clean-up (same set the 'open' filter excludes). */
export const MEDIA_CLOSED_STATUSES = ['RESOLVED', 'DUPLICATE', 'NOT_A_BUG', 'WONT_FIX'] as const;
export const isClosedForMedia = (status: string) => (MEDIA_CLOSED_STATUSES as readonly string[]).includes(status);
export const CLEANUP_CHOICES = [0, 7, 30, 90] as const;
export type CleanupDays = (typeof CLEANUP_CHOICES)[number];
export const MEDIA_URL_TTL = 600; // seconds a signed view link lasts
export const MEDIA_PUT_TTL = 900; // seconds a signed upload link lasts
export const MEDIA_PENDING_MINUTES = 120; // an upload that never finished is forgotten after this
export const MEDIA_MAX_EDGE = 1920; // images are resized to this longest edge in the browser
export const MEDIA_QUALITY = 0.82;

export type MediaItem = { id: string; bugId: string; name: string; contentType: MediaType; kind: MediaKind; size: number; width: number | null; height: number | null; uploadedById: string; uploadedBy: string; createdAt: string; url: string | null; expiresAt: string | null; derivedFrom: string | null; atSeconds: number | null };
/** A file in someone's media library: the item plus the bug it belongs to. */
export type LibraryItem = MediaItem & { bugCode: string; bugTitle: string; bugStatus: string };
export const MEDIA_NAME_MAX = 120;
/** In-app links: they open the bug (and the file) for whoever is signed in or has their portal open; never a public URL. */
export const mediaLinkPath = (bugId: string, mediaId?: string) => `/media/${bugId}${mediaId ? `?m=${mediaId}` : ''}`;
/** A download file name always carries the right extension, whatever the person called the file. */
export const downloadName = (name: string, contentType: MediaType) => { const ext = MEDIA_TYPES[contentType].ext; return name.toLowerCase().endsWith(`.${ext}`) || (ext === 'jpg' && name.toLowerCase().endsWith('.jpeg')) ? name : `${name}.${ext}`; };
/** mm:ss for a position in a recording. */
export const clock = (seconds: number) => { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export type MediaConfig = { enabled: boolean; maxBytes: number; maxVideoBytes: number; maxFiles: number; accept: string[] };
export const MEDIA_OFF: MediaConfig = { enabled: false, maxBytes: MEDIA_MAX_BYTES, maxVideoBytes: MEDIA_MAX_VIDEO_BYTES, maxFiles: MEDIA_MAX_FILES, accept: MEDIA_ACCEPT };
export const MEDIA_ON: MediaConfig = { ...MEDIA_OFF, enabled: true };

export const isMediaType = (v: string): v is MediaType => v in MEDIA_TYPES;
export const mediaKind = (t: MediaType): MediaKind => MEDIA_TYPES[t].kind;
/** The size limit that applies to a file of this type once it is in the bucket. */
export const maxBytesFor = (t: MediaType) => (mediaKind(t) === 'video' ? MEDIA_MAX_VIDEO_BYTES : MEDIA_MAX_BYTES);
/**
 * How to re-encode a recording so it lands near the target size: a bitrate from its duration, clamped to a sane range.
 * Null when even the lowest acceptable bitrate would still break the limit (the recording is too long: trim or split it).
 */
export function videoPlan(durationSeconds: number): { videoBitsPerSecond: number; audioBitsPerSecond: number; estimatedBytes: number } | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const audio = 64_000; const budget = (MEDIA_VIDEO_TARGET_BYTES * 8) / durationSeconds - audio;
  const video = Math.round(Math.min(2_500_000, Math.max(350_000, budget)));
  const estimatedBytes = Math.round(((video + audio) * durationSeconds) / 8);
  return estimatedBytes > MEDIA_MAX_VIDEO_BYTES ? null : { videoBitsPerSecond: video, audioBitsPerSecond: audio, estimatedBytes };
}
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
  if (mediaKind(type) === 'video' && size > MEDIA_VIDEO_INPUT_MAX) return `Too large (${formatBytes(size)}) — recordings up to ${formatBytes(MEDIA_VIDEO_INPUT_MAX)} can be compressed here; trim or split this one first.`;
  if (mediaKind(type) === 'pdf' && size > MEDIA_MAX_BYTES) return `Too large (${formatBytes(size)}) — the limit is ${formatBytes(MEDIA_MAX_BYTES)} per PDF.`;
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
export const prepareMediaSchema = z.object({ bugId, id, name: z.string().trim().min(1).max(255), contentType: z.enum(MEDIA_ACCEPT as [MediaType, ...MediaType[]]), size: z.number().int().min(1).max(MEDIA_MAX_VIDEO_BYTES), derivedFrom: id.nullable().default(null), atSeconds: z.number().min(0).max(360000).nullable().default(null) }).strict().refine(v => v.size <= maxBytesFor(v.contentType), { message: 'This file is larger than the limit for its type.', path: ['size'] });
export const clearMediaSchema = z.object({ bugId }).strict();
export const mediaCleanupSchema = z.object({ cleanupDays: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)]) }).strict();
export const renameMediaSchema = z.object({ id, name: z.string().trim().min(1).max(MEDIA_NAME_MAX) }).strict();
export const finishMediaSchema = z.object({ id, width: z.number().int().min(1).max(20000).nullable().default(null), height: z.number().int().min(1).max(20000).nullable().default(null) }).strict();
export const deleteMediaSchema = z.object({ id }).strict();
export const mediaStatusSchema = z.object({ test: z.boolean().default(false) }).strict();
export type MediaSource = 'default' | 'custom';
/** What the Settings card shows: never a secret. */
export type MediaStatus = { configured: boolean; source: MediaSource | 'none'; defaultAvailable: boolean; canStoreSecrets: boolean; cleanupDays: CleanupDays; closedFiles: number; closedBytes: number; custom: { endpoint: string; bucket: string; region: string; forcePathStyle: boolean; accessKeyIdHint: string } | null; missing: string[]; provider: string; bucket: string; endpointHost: string; files: number; bytes: number; awaitingPurge: number; pending: number; test: { ok: boolean; ms: number; message: string } | null };
/** Choosing where files live: the default bucket from the environment, or a bucket the Admin enters here (secret kept encrypted; blank on update keeps the saved one). */
export const mediaStorageSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('default') }).strict(),
  z.object({ source: z.literal('custom'), endpoint: z.string().trim().url().max(300).refine(u => u.startsWith('https://'), 'The endpoint must start with https://'), bucket: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Bucket names are 3–63 lower-case letters, digits, dots or dashes'), region: z.string().trim().regex(/^[a-z0-9-]{0,32}$/).default(''), forcePathStyle: z.boolean().default(true), accessKeyId: z.string().trim().max(128).default(''), secretAccessKey: z.string().trim().max(256).default('') }).strict(),
]);
/** Provider presets for the form: endpoint shape and the right defaults. */
export const STORAGE_PROVIDERS = [
  { id: 'r2', name: 'Cloudflare R2', endpoint: 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com', region: 'auto', forcePathStyle: true, note: 'Free 10 GB and no egress fees. Recommended.' },
  { id: 'b2', name: 'Backblaze B2', endpoint: 'https://s3.<REGION>.backblazeb2.com', region: 'us-west-004', forcePathStyle: true, note: 'Use the S3-compatible endpoint shown on the bucket page.' },
  { id: 's3', name: 'Amazon S3', endpoint: 'https://s3.<REGION>.amazonaws.com', region: 'us-east-1', forcePathStyle: false, note: 'Set the bucket region.' },
  { id: 'other', name: 'Other S3-compatible', endpoint: 'https://', region: '', forcePathStyle: true, note: 'MinIO, Wasabi, DigitalOcean Spaces and similar.' },
] as const;

/** The hosting the endpoint points at, for the Settings card. */
export function providerName(endpoint: string) {
  const h = (() => { try { return new URL(endpoint).hostname; } catch { return ''; } })();
  return h.endsWith('r2.cloudflarestorage.com') ? 'Cloudflare R2' : h.includes('backblazeb2.com') ? 'Backblaze B2' : h.endsWith('amazonaws.com') ? 'Amazon S3' : h ? 'S3-compatible storage' : '';
}
