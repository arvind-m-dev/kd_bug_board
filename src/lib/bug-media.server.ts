import { neonQuery, neonExecute } from './neon.server';
import { checkOrigin, requireAdmin } from './portal-access.server';
import { decryptPortal, encryptPortal } from './portal-crypto.server';
import { actorFor, bugDetail } from './bug-workflow.server';
import { MEDIA_MAX_BYTES, MEDIA_MAX_FILES, MEDIA_ON, MEDIA_OFF, MEDIA_PENDING_MINUTES, MEDIA_PUT_TTL, MEDIA_URL_TTL, isMediaType, mayDeleteMedia, mayUploadMedia, mediaKey, mediaKind, providerName, safeFileName, type LibraryItem, type MediaConfig, type MediaItem, type MediaSource, type MediaStatus, type MediaType, type prepareMediaSchema, type finishMediaSchema, type renameMediaSchema, type mediaStorageSchema, downloadName } from './bug-media';
import { formatBugCode } from './bug-workflow';
import type { BugAccess } from './bug-workflow';
import type { z } from 'zod';

/** The only file that talks to the bucket. The SDK is imported lazily so no other server function pays for it. */
const REQUIRED = ['MEDIA_S3_ENDPOINT', 'MEDIA_S3_BUCKET', 'MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY'] as const;
type Config = { endpoint: string; bucket: string; region: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
/** The bucket from the environment ("default"), if all four variables are set. */
function envConfig(): { config: Config | null; missing: string[] } {
  const env = (k: string) => (process.env[k] ?? '').trim();
  const missing = REQUIRED.filter(k => !env(k));
  if (missing.length) return { config: null, missing };
  return { config: { endpoint: env('MEDIA_S3_ENDPOINT'), bucket: env('MEDIA_S3_BUCKET'), region: env('MEDIA_S3_REGION') || 'auto', forcePathStyle: env('MEDIA_S3_FORCE_PATH_STYLE') !== '0', accessKeyId: env('MEDIA_S3_ACCESS_KEY_ID'), secretAccessKey: env('MEDIA_S3_SECRET_ACCESS_KEY') }, missing: [] };
}
/** What Admin chose in Settings → Media storage; the secret is stored encrypted with BUGFLOW_PORTAL_ENCRYPTION_KEY. */
type Stored = { source: MediaSource; custom?: { endpoint: string; bucket: string; region: string; forcePathStyle: boolean; accessKeyId: string; secretCiphertext: string } };
async function storedChoice(): Promise<Stored> {
  const { rows } = await neonQuery(`select value from bugflow.settings where key='media_storage'`);
  const v = rows[0]?.['value'] as Stored | undefined;
  return v && (v.source === 'default' || v.source === 'custom') ? v : { source: 'default' };
}
type Resolved = { config: Config | null; missing: string[]; source: MediaSource | 'none'; defaultAvailable: boolean; stored: Stored };
let cached: { at: number; value: Resolved } | null = null;
export const forgetMediaConfig = () => { cached = null; };
/** The bucket in use: Admin's own bucket when chosen and decryptable, else the environment's. Cached briefly; saving a choice clears the cache. */
export async function mediaConfig(): Promise<Resolved> {
  if (cached && Date.now() - cached.at < 30000) return cached.value;
  const stored = await storedChoice(); const env = envConfig();
  let value: Resolved = { config: env.config, missing: env.missing, source: env.config ? 'default' : 'none', defaultAvailable: !!env.config, stored };
  if (stored.source === 'custom' && stored.custom) {
    const c = stored.custom; const secret = await decryptPortal(c.secretCiphertext).catch(() => null);
    value = secret ? { config: { endpoint: c.endpoint, bucket: c.bucket, region: c.region || 'auto', forcePathStyle: c.forcePathStyle, accessKeyId: c.accessKeyId, secretAccessKey: secret }, missing: [], source: 'custom', defaultAvailable: !!env.config, stored }
      : { config: null, missing: ['BUGFLOW_PORTAL_ENCRYPTION_KEY'], source: 'none', defaultAvailable: !!env.config, stored };
  }
  cached = { at: Date.now(), value }; return value;
}
/** What the client needs to know (no secrets): whether uploads are on, and the limits. */
export const mediaClientConfig = async (): Promise<MediaConfig> => ((await mediaConfig()).config ? MEDIA_ON : MEDIA_OFF);
const NOT_CONNECTED = 'Media storage is not connected. Ask your Admin to connect it in Settings.';

let client: { key: string; promise: Promise<import('@aws-sdk/client-s3').S3Client> } | null = null;
function s3(cfg: Config) {
  const key = [cfg.endpoint, cfg.bucket, cfg.region, cfg.forcePathStyle, cfg.accessKeyId, cfg.secretAccessKey].join('|');
  if (client?.key !== key) client = { key, promise: import('@aws-sdk/client-s3').then(({ S3Client }) => new S3Client({
    region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // R2/B2 reject the checksum headers newer SDKs add by default; presigned PUTs must not require them.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  })) };
  return client.promise;
}
/** Runs a bucket call, logs the real error server-side and throws a short message that names nothing sensitive. */
async function storageCall<T>(label: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (err) {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number }; message?: string };
    console.error(`[media] ${label} failed:`, e.name ?? '', e.message ?? err);
    const code = e.name ?? e.Code ?? ''; const status = e.$metadata?.httpStatusCode ?? 0;
    if (code === 'NoSuchBucket') throw new Error('The configured media bucket was not found.');
    if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || status === 401) throw new Error('Storage rejected the media credentials.');
    if (code === 'AccessDenied' || status === 403) throw new Error('Storage denied the request. Check the API token permissions.');
    if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|TimeoutError/i.test(`${code} ${e.message ?? ''}`)) throw new Error('Media storage could not be reached.');
    throw new Error('The media storage request failed.');
  }
}
const isNotFound = (e: unknown) => { const x = e as { name?: string; $metadata?: { httpStatusCode?: number } }; return x?.name === 'NotFound' || x?.name === 'NoSuchKey' || x?.$metadata?.httpStatusCode === 404; };

async function signPut(cfg: Config, key: string, contentType: string, size: number) {
  const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')]);
  return getSignedUrl(await s3(cfg), new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType, ContentLength: size, IfNoneMatch: '*' }), { expiresIn: MEDIA_PUT_TTL });
}
async function signGet(cfg: Config, key: string, contentType: string, name: string) {
  const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')]);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return getSignedUrl(await s3(cfg), new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`, ResponseCacheControl: 'private, max-age=300' }), { expiresIn: MEDIA_URL_TTL });
}
async function head(cfg: Config, key: string): Promise<{ size: number; contentType: string } | null> {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  return storageCall('head', async () => {
    try { const r = await (await s3(cfg)).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })); return { size: Number(r.ContentLength ?? 0), contentType: String(r.ContentType ?? '') }; }
    catch (e) { if (isNotFound(e)) return null; throw e; }
  });
}
async function remove(cfg: Config, key: string) {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  await storageCall('delete', async () => { try { await (await s3(cfg)).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })); } catch (e) { if (!isNotFound(e)) throw e; } });
}

const ITEM = `m.id,m.bug_id,m.key,m.name,m.content_type,m.kind,m.size,m.width,m.height,m.uploaded_by,m.derived_from,m.at_seconds,u.name as uploader,to_json(m.created_at) as created_iso`;
async function toItems(rows: Record<string, unknown>[], withUrls: boolean): Promise<MediaItem[]> {
  const { config } = await mediaConfig(); const expiresAt = new Date(Date.now() + MEDIA_URL_TTL * 1000).toISOString();
  return Promise.all(rows.map(async r => {
    const contentType = String(r['content_type']) as MediaType; const name = String(r['name']);
    const url = withUrls && config ? await signGet(config, String(r['key']), contentType, downloadName(name, contentType)).catch(() => null) : null;
    return { id: String(r['id']), bugId: String(r['bug_id']), name, contentType, kind: mediaKind(contentType), size: Number(r['size']), width: r['width'] == null ? null : Number(r['width']), height: r['height'] == null ? null : Number(r['height']), uploadedById: String(r['uploaded_by']), uploadedBy: String(r['uploader']), createdAt: String(r['created_iso']), url, expiresAt: url ? expiresAt : null, derivedFrom: r['derived_from'] == null ? null : String(r['derived_from']), atSeconds: r['at_seconds'] == null ? null : Number(r['at_seconds']) };
  }));
}
/** Ready files on a bug, newest last. Callers must already have proved the bug is in the actor's scope; pass withUrls only for actors holding 'evidence'. */
export async function listMedia(bugId: string, withUrls: boolean): Promise<MediaItem[]> {
  const { rows } = await neonQuery(`select ${ITEM} from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by where m.bug_id=$1 and m.status='ready' and m.deleted_at is null order by m.created_at,m.id limit ${MEDIA_MAX_FILES}`, [bugId]);
  return toItems(rows, withUrls);
}

/** Step 1 of an upload: permission checks, a pending row, and a signed PUT the browser uses directly. */
export async function prepareUpload(access: BugAccess, data: z.infer<typeof prepareMediaSchema>) {
  checkOrigin(); const actor = await actorFor(access); const { config } = await mediaConfig(); if (!config) throw new Error(NOT_CONNECTED);
  const { bug } = await bugDetail(access, data.bugId);
  if (!mayUploadMedia(actor, bug)) throw new Error(actor.role === 'admin' ? 'Files cannot be attached to this bug.' : 'Only the reporter, the assigned developer, QA or Admin can attach files, and only while the bug is open.');
  const key = mediaKey(data.bugId, data.id, data.contentType);
  // One transaction: the bug row is locked so two concurrent prepares cannot both pass the per-bug cap.
  const { results } = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    { query: `select 1 from bugflow.bugs where id=$1 for update`, params: [data.bugId] },
    { query: `insert into bugflow.bug_media(id,bug_id,key,name,content_type,size,kind,uploaded_by,uploaded_via,derived_from,at_seconds)
    select $1,$2,$3,$4,$5,$6,$7,$8,$9,$11,$12 where (select count(*) from bugflow.bug_media x where x.bug_id=$2 and x.deleted_at is null and (x.status='ready' or x.created_at>now()-interval '${MEDIA_PENDING_MINUTES} minutes'))<$10
      and ($11::uuid is null or exists(select 1 from bugflow.bug_media d where d.id=$11 and d.bug_id=$2 and d.status='ready' and d.deleted_at is null))
    on conflict (id) do update set name=excluded.name,size=excluded.size where bugflow.bug_media.uploaded_by=excluded.uploaded_by and bugflow.bug_media.bug_id=excluded.bug_id and bugflow.bug_media.content_type=excluded.content_type and bugflow.bug_media.status='pending' and bugflow.bug_media.deleted_at is null returning id`,
      params: [data.id, data.bugId, key, safeFileName(data.name), data.contentType, data.size, mediaKind(data.contentType), actor.userId, actor.role, MEDIA_MAX_FILES, data.derivedFrom, data.atSeconds] },
  ]);
  if (!results[1]?.rows.length) {
    const { rows } = await neonQuery(`select 1 from bugflow.bug_media where id=$1 limit 1`, [data.id]);
    throw new Error(rows.length ? 'This upload id is already in use. Start the upload again.' : `This bug already has ${MEDIA_MAX_FILES} files. Remove one to add another.`);
  }
  await sweep().catch(() => undefined);
  return { uploadUrl: await storageCall('sign', () => signPut(config, key, data.contentType, data.size)), headers: { 'Content-Type': data.contentType, 'If-None-Match': '*' }, expiresAt: new Date(Date.now() + MEDIA_PUT_TTL * 1000).toISOString() };
}
/** Step 2: the server checks the object really arrived (exists, type, size) before anyone can see it. */
export async function finishUpload(access: BugAccess, data: z.infer<typeof finishMediaSchema>): Promise<MediaItem> {
  checkOrigin(); const actor = await actorFor(access); const { config } = await mediaConfig(); if (!config) throw new Error(NOT_CONNECTED);
  const { rows } = await neonQuery(`select ${ITEM},m.status from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by where m.id=$1 and m.deleted_at is null and m.uploaded_by=$2 limit 1`, [data.id, actor.userId]);
  const row = rows[0]; if (!row) throw new Error('This upload is no longer valid. Start it again.');
  const bugId = String(row['bug_id']); const { bug } = await bugDetail(access, bugId);
  if (String(row['status']) === 'ready') return (await toItems([row], actor.permissions.includes('evidence')))[0]!;
  if (!mayUploadMedia(actor, bug)) throw new Error('Files cannot be attached to this bug any more.');
  const key = String(row['key']); const contentType = String(row['content_type']);
  const obj = await head(config, key);
  if (!obj) throw new Error('The file did not arrive in storage. Try the upload again.');
  const bad = obj.size <= 0 || obj.size > MEDIA_MAX_BYTES || (obj.contentType && obj.contentType.split(';')[0]!.trim() !== contentType) || !isMediaType(contentType);
  if (bad) {
    await remove(config, key).catch(() => undefined);
    await neonExecute(`update bugflow.bug_media set deleted_at=now(),deleted_by=$2,purged_at=now() where id=$1`, [data.id, actor.userId]);
    throw new Error(obj.size > MEDIA_MAX_BYTES ? 'The uploaded file is larger than 25 MB and was discarded.' : 'The uploaded file did not match what was announced and was discarded.');
  }
  await neonExecute([
    { query: `with u as (update bugflow.bug_media set status='ready',ready_at=now(),size=$6,width=$7,height=$8 where id=$1 and status='pending' and deleted_at is null returning id)
      insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $2,$3,$4,'bug.media_added',jsonb_build_object('media',$5::text,'kind',$9::text,'size',$6::bigint) from u`,
      params: [data.id, crypto.randomUUID(), bugId, actor.userId, String(row['name']), obj.size, data.width, data.height, String(row['kind'])] },
  ]);
  return (await toItems([{ ...row, size: obj.size, width: data.width, height: data.height }], actor.permissions.includes('evidence')))[0]!;
}
/** Gives a file a new name (what people see everywhere); only the uploader or Admin, like removal. */
export async function renameMedia(access: BugAccess, data: z.infer<typeof renameMediaSchema>): Promise<MediaItem> {
  checkOrigin(); const actor = await actorFor(access);
  const { rows } = await neonQuery(`select ${ITEM} from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by where m.id=$1 and m.status='ready' and m.deleted_at is null limit 1`, [data.id]);
  const row = rows[0]; if (!row) throw new Error('This file is no longer available.');
  await bugDetail(access, String(row['bug_id']));
  if (!mayDeleteMedia(actor, { uploadedById: String(row['uploaded_by']) })) throw new Error('Only the person who attached a file, or Admin, can rename it.');
  const name = safeFileName(data.name); const was = String(row['name']);
  if (name !== was) await neonExecute([
    { query: `update bugflow.bug_media set name=$2 where id=$1`, params: [data.id, name] },
    { query: `insert into bugflow.activity(id,bug_id,actor_id,action,detail) values($1,$2,$3,'bug.media_renamed',jsonb_build_object('media',$4::text,'from',$5::text))`, params: [crypto.randomUUID(), String(row['bug_id']), actor.userId, name, was] },
  ]);
  return (await toItems([{ ...row, name }], actor.permissions.includes('evidence')))[0]!;
}
/** Everything the actor attached (Admin: everything anyone attached), newest first, with the bug each file belongs to. */
export async function listLibrary(access: BugAccess): Promise<LibraryItem[]> {
  const actor = await actorFor(access); if (!actor.permissions.includes('view')) throw new Error('Bug access is not permitted.');
  const mine = actor.role !== 'admin';
  const { rows } = await neonQuery(`select ${ITEM},b.title as bug_title,b.status as bug_status from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by join bugflow.bugs b on b.id=m.bug_id
    where m.status='ready' and m.deleted_at is null and b.deleted_at is null ${mine ? 'and m.uploaded_by=$1' : ''} order by m.created_at desc,m.id limit 500`, mine ? [actor.userId] : []);
  const items = await toItems(rows, actor.permissions.includes('evidence'));
  return items.map((it, i) => ({ ...it, bugCode: formatBugCode(it.bugId), bugTitle: String(rows[i]!['bug_title']), bugStatus: String(rows[i]!['bug_status']) }));
}
/** Removes a file: hidden immediately and audited atomically; the object is deleted right after (retried by the sweep if that fails). */
export async function deleteMedia(access: BugAccess, id: string) {
  checkOrigin(); const actor = await actorFor(access);
  const { rows } = await neonQuery(`select m.id,m.bug_id,m.key,m.name,m.kind,m.uploaded_by from bugflow.bug_media m where m.id=$1 and m.deleted_at is null limit 1`, [id]);
  const row = rows[0]; if (!row) throw new Error('This file was already removed.');
  await bugDetail(access, String(row['bug_id']));
  if (!mayDeleteMedia(actor, { uploadedById: String(row['uploaded_by']) })) throw new Error('Only the person who attached a file, or Admin, can remove it.');
  const { rows: done } = await neonExecute(`with u as (update bugflow.bug_media set deleted_at=now(),deleted_by=$2 where id=$1 and deleted_at is null returning id)
    insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $3,$4,$2,'bug.media_deleted',jsonb_build_object('media',$5::text,'kind',$6::text) from u returning id`,
    [id, actor.userId, crypto.randomUUID(), String(row['bug_id']), String(row['name']), String(row['kind'])]);
  if (!done.length) throw new Error('This file was already removed.');
  const purged = await purge(String(row['key']), id);
  return { deleted: true, purged };
}
async function purge(key: string, id: string) {
  const { config } = await mediaConfig(); if (!config) return false;
  try { await remove(config, key); await neonExecute(`update bugflow.bug_media set purged_at=now() where id=$1 and purged_at is null`, [id]); return true; }
  catch { return false; }
}
/** Best-effort housekeeping: forgets uploads that never finished and retries object deletions that failed. */
export async function sweep(limit = 10) {
  const { config } = await mediaConfig(); if (!config) return;
  const { rows } = await neonQuery(`with stale as (update bugflow.bug_media set deleted_at=now() where status='pending' and deleted_at is null and created_at<now()-interval '${MEDIA_PENDING_MINUTES} minutes' returning id,key)
    select id,key from stale union all (select id,key from bugflow.bug_media where deleted_at is not null and purged_at is null order by deleted_at limit $1)`, [limit]);
  for (const r of rows.slice(0, limit)) await purge(String(r['key']), String(r['id']));
}
/** Soft-deletes every file of a bug (used when the bug itself is deleted) and purges the objects. */
export async function deleteAllMedia(bugId: string, byUserId: string) {
  await neonExecute(`update bugflow.bug_media set deleted_at=now(),deleted_by=$2 where bug_id=$1 and deleted_at is null`, [bugId, byUserId]);
  await sweep(MEDIA_MAX_FILES).catch(() => undefined);
}
/** Settings → Media storage: configuration, usage from our own rows and, on request, a real round trip to the bucket. */
export async function mediaStatus(test: boolean): Promise<MediaStatus> {
  await requireAdmin(); if (test) checkOrigin(); const { config, missing, source, defaultAvailable, stored } = await mediaConfig();
  const { rows } = await neonQuery(`select count(*) filter(where status='ready' and deleted_at is null)::int as files, coalesce(sum(size) filter(where status='ready' and deleted_at is null),0)::bigint as bytes, count(*) filter(where deleted_at is not null and purged_at is null)::int as awaiting, count(*) filter(where status='pending' and deleted_at is null)::int as pending from bugflow.bug_media`);
  const r = rows[0] ?? {}; const host = (() => { try { return config ? new URL(config.endpoint).hostname : ''; } catch { return ''; } })();
  const c = stored.custom; const custom = c ? { endpoint: c.endpoint, bucket: c.bucket, region: c.region, forcePathStyle: c.forcePathStyle, accessKeyIdHint: `${c.accessKeyId.slice(0, 4)}…${c.accessKeyId.slice(-2)}` } : null;
  const base: MediaStatus = { configured: !!config, source, defaultAvailable, canStoreSecrets: !!(process.env['BUGFLOW_PORTAL_ENCRYPTION_KEY'] ?? '').trim(), custom, missing, provider: config ? providerName(config.endpoint) : '', bucket: config?.bucket ?? '', endpointHost: host, files: Number(r['files'] ?? 0), bytes: Number(r['bytes'] ?? 0), awaitingPurge: Number(r['awaiting'] ?? 0), pending: Number(r['pending'] ?? 0), test: null };
  if (!test || !config) return base;
  const started = Date.now();
  try {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    await storageCall('list', () => (s3(config)).then(c => c.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }), { requestTimeout: 8000 })));
    await sweep().catch(() => undefined);
    const again = await mediaStatus(false);
    return { ...again, test: { ok: true, ms: Date.now() - started, message: `Bucket ${config.bucket} answered in ${Date.now() - started} ms.` } };
  } catch (e) { return { ...base, test: { ok: false, ms: Date.now() - started, message: (e as Error).message } }; }
}
/** Settings → Media storage: use the default bucket, or save Admin's own bucket (secret encrypted at rest), then test it. */
export async function saveMediaStorage(data: z.infer<typeof mediaStorageSchema>): Promise<MediaStatus> {
  checkOrigin(); const admin = await requireAdmin(); const current = await storedChoice();
  let next: Stored;
  if (data.source === 'default') next = { source: 'default', ...(current.custom ? { custom: current.custom } : {}) };
  else {
    if (!(process.env['BUGFLOW_PORTAL_ENCRYPTION_KEY'] ?? '').trim()) throw new Error('Set BUGFLOW_PORTAL_ENCRYPTION_KEY first so the secret key can be stored encrypted.');
    // Blank key fields keep what is saved; a new access key ID needs its own secret.
    const accessKeyId = data.accessKeyId || current.custom?.accessKeyId || ''; if (!accessKeyId) throw new Error('Enter the access key ID.');
    if (data.accessKeyId && data.accessKeyId !== current.custom?.accessKeyId && !data.secretAccessKey) throw new Error('Enter the secret access key that belongs to this access key ID.');
    const secretCiphertext = data.secretAccessKey ? await encryptPortal(data.secretAccessKey) : current.custom?.secretCiphertext ?? '';
    if (!secretCiphertext) throw new Error('Enter the secret access key.');
    next = { source: 'custom', custom: { endpoint: data.endpoint.replace(/\/+$/, ''), bucket: data.bucket, region: data.region, forcePathStyle: data.forcePathStyle, accessKeyId, secretCiphertext } };
  }
  await neonExecute([
    { query: `insert into bugflow.settings(key,value) values('media_storage',$1::jsonb) on conflict (key) do update set value=excluded.value`, params: [JSON.stringify(next)] },
    { query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.media_storage',$3::jsonb)`, params: [crypto.randomUUID(), admin.userId, JSON.stringify(next.source === 'custom' ? { source: 'own bucket', bucket: next.custom!.bucket, provider: providerName(next.custom!.endpoint) } : { source: 'default bucket' })] },
  ]);
  forgetMediaConfig();
  return mediaStatus(true);
}
