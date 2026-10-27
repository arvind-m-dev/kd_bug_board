import { neonQuery, neonExecute } from "./neon.server";
import { getRequest } from "@tanstack/react-start/server";
import { checkOrigin, requireAdmin } from "./portal-access.server";
import { decryptPortal, encryptPortal } from "./portal-crypto.server";
import { actorFor, bugDetail } from "./bug-workflow.server";
import {
  MEDIA_CLOSED_STATUSES,
  MEDIA_MAX_FILES,
  maxBytesFor,
  MEDIA_ON,
  MEDIA_OFF,
  MEDIA_PENDING_MINUTES,
  MEDIA_PENDING_HOLD_MINUTES,
  MEDIA_PUT_TTL,
  MEDIA_URL_TTL,
  isMediaType,
  mayDeleteMedia,
  mayUploadMedia,
  mediaKey,
  mediaKind,
  providerName,
  safeFileName,
  type CleanupDays,
  type LibraryItem,
  type MediaConfig,
  type MediaItem,
  type MediaSource,
  type MediaStatus,
  type MediaType,
  type prepareMediaSchema,
  type finishMediaSchema,
  type renameMediaSchema,
  type saveMarksSchema,
  type TrashedMedia,
  type MediaUsage,
  MEDIA_THUMB_MAX,
  thumbKey,
  readMarks,
  type mediaStorageSchema,
  downloadName,
} from "./bug-media";
import { formatBugCode } from "./bug-workflow";
import { TRASH_DAYS } from "./trash";
import type { BugAccess } from "./bug-workflow";
import type { z } from "zod";

/** The only file that talks to the bucket. The SDK is imported lazily so no other server function pays for it. */
const REQUIRED = [
  "MEDIA_S3_ENDPOINT",
  "MEDIA_S3_BUCKET",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
] as const;
type Config = {
  endpoint: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};
/** The hosting bucket from the environment (source 'default'): a fallback when Admin has not saved a workspace bucket. */
function envConfig(): { config: Config | null; missing: string[] } {
  const env = (k: string) => (process.env[k] ?? "").trim();
  const missing = REQUIRED.filter((k) => !env(k));
  if (missing.length) return { config: null, missing };
  return {
    config: {
      endpoint: env("MEDIA_S3_ENDPOINT"),
      bucket: env("MEDIA_S3_BUCKET"),
      region: env("MEDIA_S3_REGION") || "auto",
      forcePathStyle: env("MEDIA_S3_FORCE_PATH_STYLE") !== "0",
      accessKeyId: env("MEDIA_S3_ACCESS_KEY_ID"),
      secretAccessKey: env("MEDIA_S3_SECRET_ACCESS_KEY"),
    },
    missing: [],
  };
}
/** What Admin chose in Settings → Media storage; the secret is stored encrypted with BUGFLOW_PORTAL_ENCRYPTION_KEY. */
type Stored = {
  source: MediaSource;
  custom?: {
    endpoint: string;
    bucket: string;
    region: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretCiphertext: string;
  };
  cleanupDays?: CleanupDays;
  cleanupBy?: string;
  /** Storage limit Admin set for the usage meter (bytes); unset = the R2 free plan's 10 GB for R2, else none. */
  quotaBytes?: number;
};
async function storedChoice(): Promise<Stored> {
  const { rows } = await neonQuery(`select value from bugflow.settings where key='media_storage'`);
  const v = rows[0]?.["value"] as Stored | undefined;
  return v && (v.source === "default" || v.source === "custom") ? v : { source: "default" };
}
type Resolved = {
  config: Config | null;
  missing: string[];
  source: MediaSource | "none";
  defaultAvailable: boolean;
  stored: Stored;
};
let cached: { at: number; value: Resolved } | null = null;
export const forgetMediaConfig = () => {
  cached = null;
};
/** The bucket in use: Admin's own bucket when chosen and decryptable, else the environment's. Cached briefly; saving a choice clears the cache. */
export async function mediaConfig(): Promise<Resolved> {
  if (cached && Date.now() - cached.at < 30000) return cached.value;
  const stored = await storedChoice();
  const env = envConfig();
  let value: Resolved = {
    config: env.config,
    missing: env.missing,
    source: env.config ? "default" : "none",
    defaultAvailable: !!env.config,
    stored,
  };
  if (stored.source === "custom" && stored.custom) {
    const c = stored.custom;
    const secret = await decryptPortal(c.secretCiphertext).catch(() => null);
    value = secret
      ? {
          config: {
            endpoint: c.endpoint,
            bucket: c.bucket,
            region: c.region || "auto",
            forcePathStyle: c.forcePathStyle,
            accessKeyId: c.accessKeyId,
            secretAccessKey: secret,
          },
          missing: [],
          source: "custom",
          defaultAvailable: !!env.config,
          stored,
        }
      : {
          config: null,
          missing: ["BUGFLOW_PORTAL_ENCRYPTION_KEY"],
          source: "none",
          defaultAvailable: !!env.config,
          stored,
        };
  }
  cached = { at: Date.now(), value };
  return value;
}
/** What the client needs to know (no secrets): whether uploads are on, and the limits. */
export const mediaClientConfig = async (): Promise<MediaConfig> => {
  const { config, stored } = await mediaConfig();
  if (!config) return MEDIA_OFF;
  // Workspace loads are frequent, so the clean-up schedule gets a cheap, throttled chance to run here (once per 15 minutes per instance).
  if (stored.cleanupDays && Date.now() - lastAuto > 15 * 60000)
    await sweep(5).catch(() => undefined);
  return MEDIA_ON;
};
const NOT_CONNECTED = "Media storage is not connected. Ask your Admin to connect it in Settings.";

let client: { key: string; promise: Promise<import("@aws-sdk/client-s3").S3Client> } | null = null;
function s3(cfg: Config) {
  const key = [
    cfg.endpoint,
    cfg.bucket,
    cfg.region,
    cfg.forcePathStyle,
    cfg.accessKeyId,
    cfg.secretAccessKey,
  ].join("|");
  if (client?.key !== key)
    client = {
      key,
      promise: import("@aws-sdk/client-s3").then(
        ({ S3Client }) =>
          new S3Client({
            region: cfg.region,
            endpoint: cfg.endpoint,
            forcePathStyle: cfg.forcePathStyle,
            credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
            // R2/B2 reject the checksum headers newer SDKs add by default; presigned PUTs must not require them.
            requestChecksumCalculation: "WHEN_REQUIRED",
            responseChecksumValidation: "WHEN_REQUIRED",
          }),
      ),
    };
  return client.promise;
}
/** Runs a bucket call, logs the real error server-side and throws a short message that names nothing sensitive. */
async function storageCall<T>(label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    const e = err as {
      name?: string;
      Code?: string;
      $metadata?: { httpStatusCode?: number };
      message?: string;
    };
    console.error(`[media] ${label} failed:`, e.name ?? "", e.message ?? err);
    const code = e.name ?? e.Code ?? "";
    const status = e.$metadata?.httpStatusCode ?? 0;
    if (code === "NoSuchBucket") throw new Error("The configured media bucket was not found.");
    if (code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch" || status === 401)
      throw new Error("Storage rejected the media credentials.");
    if (code === "AccessDenied" || status === 403)
      throw new Error("Storage denied the request. Check the API token permissions.");
    if (
      /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|TimeoutError/i.test(`${code} ${e.message ?? ""}`)
    )
      throw new Error("Media storage could not be reached.");
    throw new Error("The media storage request failed.");
  }
}
const isNotFound = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404;
};

async function signPut(cfg: Config, key: string, contentType: string, size: number) {
  const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);
  return getSignedUrl(
    await s3(cfg),
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
      IfNoneMatch: "*",
    }),
    { expiresIn: MEDIA_PUT_TTL },
  );
}
const SIGN_WINDOW = 300;
const signingWindow = () =>
  new Date(Math.floor(Date.now() / (SIGN_WINDOW * 1000)) * SIGN_WINDOW * 1000);
async function signGet(cfg: Config, key: string, contentType: string, name: string) {
  const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return getSignedUrl(
    await s3(cfg),
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      ResponseCacheControl: "private, max-age=300",
    }),
    // Signed from the start of the current 5-minute window: the same file gets the same link for those 5 minutes,
    // so reopening it (or a refetch) is served from the browser cache instead of downloading it again.
    // The extra 5 minutes keeps every link valid for at least MEDIA_URL_TTL.
    { expiresIn: MEDIA_URL_TTL + SIGN_WINDOW, signingDate: signingWindow() },
  );
}
async function head(
  cfg: Config,
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  return storageCall("head", async () => {
    try {
      const r = await (await s3(cfg)).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: String(r.ContentType ?? "") };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  });
}
async function remove(cfg: Config, key: string) {
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  await storageCall("delete", async () => {
    try {
      await (await s3(cfg)).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  });
}

const ITEM = `m.id,m.bug_id,m.key,m.name,m.content_type,m.kind,m.size,m.width,m.height,m.uploaded_by,m.derived_from,m.at_seconds,m.marks,m.marks_version,m.has_thumb,u.name as uploader,to_json(m.created_at) as created_iso`;
async function toItems(rows: Record<string, unknown>[], withUrls: boolean): Promise<MediaItem[]> {
  const { config } = await mediaConfig();
  const expiresAt = new Date(Date.now() + MEDIA_URL_TTL * 1000).toISOString();
  return Promise.all(
    rows.map(async (r) => {
      const contentType = String(r["content_type"]) as MediaType;
      const name = String(r["name"]);
      const url =
        withUrls && config
          ? await signGet(
              config,
              String(r["key"]),
              contentType,
              downloadName(name, contentType),
            ).catch(() => null)
          : null;
      const thumbUrl =
        withUrls && config && r["has_thumb"] === true
          ? await signGet(
              config,
              thumbKey(String(r["key"])),
              "image/jpeg",
              `${name} preview.jpg`,
            ).catch(() => null)
          : null;
      return {
        id: String(r["id"]),
        bugId: String(r["bug_id"]),
        thumbUrl,
        name,
        contentType,
        kind: mediaKind(contentType),
        size: Number(r["size"]),
        width: r["width"] == null ? null : Number(r["width"]),
        height: r["height"] == null ? null : Number(r["height"]),
        uploadedById: String(r["uploaded_by"]),
        uploadedBy: String(r["uploader"]),
        createdAt: String(r["created_iso"]),
        url,
        expiresAt: url ? expiresAt : null,
        derivedFrom: r["derived_from"] == null ? null : String(r["derived_from"]),
        atSeconds: r["at_seconds"] == null ? null : Number(r["at_seconds"]),
        marks: readMarks(r["marks"]),
        marksVersion: Number(r["marks_version"] ?? 0),
      };
    }),
  );
}
/** Ready files on a bug, newest last. Callers must already have proved the bug is in the actor's scope; pass withUrls only for actors holding 'evidence'. */
export async function listMedia(bugId: string, withUrls: boolean): Promise<MediaItem[]> {
  const { rows } = await neonQuery(
    `select ${ITEM} from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by where m.bug_id=$1 and m.status='ready' and m.deleted_at is null order by m.created_at,m.id limit ${MEDIA_MAX_FILES}`,
    [bugId],
  );
  return toItems(rows, withUrls);
}

/** Step 1 of an upload: permission checks, a pending row, and a signed PUT the browser uses directly. */
export async function prepareUpload(access: BugAccess, data: z.infer<typeof prepareMediaSchema>) {
  checkOrigin();
  const actor = await actorFor(access);
  const { config } = await mediaConfig();
  if (!config) throw new Error(NOT_CONNECTED);
  const { bug } = await bugDetail(access, data.bugId);
  if (!mayUploadMedia(actor, bug))
    throw new Error(
      actor.role === "admin"
        ? "Files cannot be attached to this bug."
        : "Only the reporter, the assigned developer, QA or Admin can attach files, and only while the bug is open.",
    );
  const key = mediaKey(data.bugId, data.id, data.contentType);
  // One transaction: the bug row is locked so two concurrent prepares cannot both pass the per-bug cap.
  const { results } = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    { query: `select 1 from bugflow.bugs where id=$1 for update`, params: [data.bugId] },
    {
      query: `insert into bugflow.bug_media(id,bug_id,key,name,content_type,size,kind,uploaded_by,uploaded_via,derived_from,at_seconds)
    select $1,$2,$3,$4,$5,$6,$7,$8,$9,$11,$12 where (select count(*) from bugflow.bug_media x where x.bug_id=$2 and x.deleted_at is null and (x.status='ready' or (x.created_at>now()-interval '${MEDIA_PENDING_HOLD_MINUTES} minutes' and x.id<>$1)))<$10
      and ($11::uuid is null or exists(select 1 from bugflow.bug_media d where d.id=$11 and d.bug_id=$2 and d.status='ready' and d.deleted_at is null))
    on conflict (id) do update set name=excluded.name,size=excluded.size,created_at=now() where bugflow.bug_media.uploaded_by=excluded.uploaded_by and bugflow.bug_media.bug_id=excluded.bug_id and bugflow.bug_media.content_type=excluded.content_type and bugflow.bug_media.status='pending' and bugflow.bug_media.deleted_at is null returning id`,
      params: [
        data.id,
        data.bugId,
        key,
        safeFileName(data.name),
        data.contentType,
        data.size,
        mediaKind(data.contentType),
        actor.userId,
        actor.role,
        MEDIA_MAX_FILES,
        data.derivedFrom,
        data.atSeconds,
      ],
    },
  ]);
  if (!results[1]?.rows.length) {
    const { rows } = await neonQuery(`select 1 from bugflow.bug_media where id=$1 limit 1`, [
      data.id,
    ]);
    throw new Error(
      rows.length
        ? "This upload id is already in use. Start the upload again."
        : `This bug already has ${MEDIA_MAX_FILES} files. Remove one to add another.`,
    );
  }
  await sweep().catch(() => undefined);
  return {
    uploadUrl: await storageCall("sign", () => signPut(config, key, data.contentType, data.size)),
    headers: { "Content-Type": data.contentType, "If-None-Match": "*" },
    thumbUrl: data.thumbSize
      ? await storageCall("sign", () =>
          signPut(config, thumbKey(key), "image/jpeg", data.thumbSize!),
        )
      : null,
    expiresAt: new Date(Date.now() + MEDIA_PUT_TTL * 1000).toISOString(),
  };
}
/** Step 2: the server checks the object really arrived (exists, type, size) before anyone can see it. */
export async function finishUpload(
  access: BugAccess,
  data: z.infer<typeof finishMediaSchema>,
): Promise<MediaItem> {
  checkOrigin();
  const actor = await actorFor(access);
  const { config } = await mediaConfig();
  if (!config) throw new Error(NOT_CONNECTED);
  const { rows } = await neonQuery(
    `select ${ITEM},m.status from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by where m.id=$1 and m.deleted_at is null and m.uploaded_by=$2 limit 1`,
    [data.id, actor.userId],
  );
  const row = rows[0];
  if (!row) throw new Error("This upload is no longer valid. Start it again.");
  const bugId = String(row["bug_id"]);
  const { bug } = await bugDetail(access, bugId);
  if (String(row["status"]) === "ready")
    return (await toItems([row], actor.permissions.includes("evidence")))[0]!;
  if (!mayUploadMedia(actor, bug))
    throw new Error("Files cannot be attached to this bug any more.");
  const key = String(row["key"]);
  const contentType = String(row["content_type"]);
  const obj = await head(config, key);
  if (!obj) throw new Error("The file did not arrive in storage. Try the upload again.");
  const limit = maxBytesFor(contentType as MediaType);
  const bad =
    obj.size <= 0 ||
    obj.size > limit ||
    (obj.contentType && obj.contentType.split(";")[0]!.trim() !== contentType) ||
    !isMediaType(contentType);
  if (bad) {
    await remove(config, key).catch(() => undefined);
    await neonExecute(
      `update bugflow.bug_media set deleted_at=now(),deleted_by=$2,purged_at=now() where id=$1`,
      [data.id, actor.userId],
    );
    throw new Error(
      obj.size > limit
        ? `The uploaded file is larger than ${Math.round(limit / 1048576)} MB and was discarded.`
        : "The uploaded file did not match what was announced and was discarded.",
    );
  }
  // The preview is optional: it counts only when it really arrived as a small JPEG.
  const preview = data.thumb ? await head(config, thumbKey(key)).catch(() => null) : null;
  const hasThumb =
    !!preview &&
    preview.size > 0 &&
    preview.size <= MEDIA_THUMB_MAX &&
    (!preview.contentType || preview.contentType.startsWith("image/jpeg"));
  if (data.thumb && !hasThumb) await remove(config, thumbKey(key)).catch(() => undefined);
  await neonExecute([
    {
      query: `with u as (update bugflow.bug_media set status='ready',ready_at=now(),size=$6,width=$7,height=$8,has_thumb=$10 where id=$1 and status='pending' and deleted_at is null returning id)
      insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $2,$3,$4,'bug.media_added',jsonb_build_object('media',$5::text,'kind',$9::text,'size',$6::bigint) from u`,
      params: [
        data.id,
        crypto.randomUUID(),
        bugId,
        actor.userId,
        String(row["name"]),
        obj.size,
        data.width,
        data.height,
        String(row["kind"]),
        hasThumb,
      ],
    },
  ]);
  return (
    await toItems(
      [{ ...row, size: obj.size, width: data.width, height: data.height, has_thumb: hasThumb }],
      actor.permissions.includes("evidence"),
    )
  )[0]!;
}
/** Gives a file a new name (what people see everywhere); only the uploader or Admin, like removal. */
export async function renameMedia(
  access: BugAccess,
  data: z.infer<typeof renameMediaSchema>,
): Promise<MediaItem> {
  checkOrigin();
  const actor = await actorFor(access);
  const { rows } = await neonQuery(
    `select ${ITEM} from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by where m.id=$1 and m.status='ready' and m.deleted_at is null limit 1`,
    [data.id],
  );
  const row = rows[0];
  if (!row) throw new Error("This file is no longer available.");
  await bugDetail(access, String(row["bug_id"]));
  if (!mayDeleteMedia(actor, { uploadedById: String(row["uploaded_by"]) }))
    throw new Error("Only the person who attached a file, or Admin, can rename it.");
  const name = safeFileName(data.name);
  const was = String(row["name"]);
  if (name !== was)
    await neonExecute([
      { query: `update bugflow.bug_media set name=$2 where id=$1`, params: [data.id, name] },
      {
        query: `insert into bugflow.activity(id,bug_id,actor_id,action,detail) values($1,$2,$3,'bug.media_renamed',jsonb_build_object('media',$4::text,'from',$5::text))`,
        params: [crypto.randomUUID(), String(row["bug_id"]), actor.userId, name, was],
      },
    ]);
  return (await toItems([{ ...row, name }], actor.permissions.includes("evidence")))[0]!;
}
/**
 * Saves a recording's timed marks, sent by the uploader's browser right after the upload (marks are drawn on the local
 * file before it goes up). Only the uploader, who must still be allowed to attach files to the bug. The version must
 * match what the editor loaded, so a concurrent edit is refused instead of overwritten; the change is audited atomically.
 */
export async function saveVideoMarks(access: BugAccess, data: z.infer<typeof saveMarksSchema>) {
  checkOrigin();
  const actor = await actorFor(access);
  const { rows } = await neonQuery(
    `select bug_id,kind,uploaded_by from bugflow.bug_media where id=$1 and status='ready' and deleted_at is null limit 1`,
    [data.id],
  );
  const row = rows[0];
  if (!row) throw new Error("This recording is no longer available.");
  if (row["kind"] !== "video") throw new Error("Only recordings can have timed marks.");
  // Mark-up belongs to the upload: only the person who attached the recording can add its timed marks.
  if (String(row["uploaded_by"]) !== actor.userId)
    throw new Error("Only the person who attached this recording can mark it up.");
  const bugId = String(row["bug_id"]);
  const { bug } = await bugDetail(access, bugId);
  if (!mayUploadMedia(actor, bug))
    throw new Error(
      "Only the reporter, the assigned developer, QA or Admin can mark up recordings, and only while the bug is open.",
    );
  const saved = await neonQuery(
    `with u as (update bugflow.bug_media set marks=$2::jsonb, marks_version=marks_version+1 where id=$1 and marks_version=$3 returning bug_id,marks_version),
      a as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $4,u.bug_id,$5,'bug.media_marked',jsonb_build_object('media',$1::text,'marks',$6::int) from u)
      select marks_version from u`,
    [
      data.id,
      JSON.stringify(data.marks),
      data.version,
      crypto.randomUUID(),
      actor.userId,
      data.marks.length,
    ],
  );
  const version = saved.rows[0]?.["marks_version"];
  if (version == null)
    throw new Error(
      "Someone else changed these marks meanwhile. Close the recording, reopen it and try again.",
    );
  return { version: Number(version) };
}
/** Everything the actor attached (Admin: everything anyone attached), newest first, with the bug each file belongs to. */
export async function listLibrary(access: BugAccess): Promise<LibraryItem[]> {
  const actor = await actorFor(access);
  if (!actor.permissions.includes("view")) throw new Error("Bug access is not permitted.");
  const mine = actor.role !== "admin";
  const { rows } = await neonQuery(
    `select ${ITEM},b.title as bug_title,b.status as bug_status from bugflow.bug_media m join bugflow.users u on u.id=m.uploaded_by join bugflow.bugs b on b.id=m.bug_id
    where m.status='ready' and m.deleted_at is null and b.deleted_at is null ${mine ? "and m.uploaded_by=$1" : ""} order by m.created_at desc,m.id limit 500`,
    mine ? [actor.userId] : [],
  );
  const items = await toItems(rows, actor.permissions.includes("evidence"));
  return items.map((it, i) => ({
    ...it,
    bugCode: formatBugCode(it.bugId),
    bugTitle: String(rows[i]!["bug_title"]),
    bugStatus: String(rows[i]!["bug_status"]),
  }));
}
/** Removes a file to the Trash: hidden immediately and audited atomically; it stays restorable for TRASH_DAYS before the sweep deletes it from storage. */
export async function deleteMedia(access: BugAccess, id: string) {
  checkOrigin();
  const actor = await actorFor(access);
  const { rows } = await neonQuery(
    `select m.id,m.bug_id,m.key,m.name,m.kind,m.uploaded_by from bugflow.bug_media m where m.id=$1 and m.deleted_at is null limit 1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("This file was already removed.");
  await bugDetail(access, String(row["bug_id"]));
  if (!mayDeleteMedia(actor, { uploadedById: String(row["uploaded_by"]) }))
    throw new Error("Only the person who attached a file, or Admin, can remove it.");
  const { rows: done } = await neonExecute(
    `with u as (update bugflow.bug_media set deleted_at=now(),deleted_by=$2,restorable_until=now()+make_interval(days=>$7) where id=$1 and deleted_at is null returning id)
    insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $3,$4,$2,'bug.media_deleted',jsonb_build_object('media',$5::text,'kind',$6::text) from u returning id`,
    [
      id,
      actor.userId,
      crypto.randomUUID(),
      String(row["bug_id"]),
      String(row["name"]),
      String(row["kind"]),
      TRASH_DAYS,
    ],
  );
  if (!done.length) throw new Error("This file was already removed.");
  return { deleted: true, restorableDays: TRASH_DAYS };
}
/** A removed file the actor may act on in the Trash: restorable, on a bug they can see, uploaded by them (Admin: anyone). */
async function trashedFile(access: BugAccess, id: string) {
  const actor = await actorFor(access);
  const { rows } = await neonQuery(
    `select id,bug_id,key,name,kind,uploaded_by from bugflow.bug_media where id=$1 and status='ready' and deleted_at is not null and purged_at is null and restorable_until>now() limit 1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("This file is no longer in the Trash.");
  if (!mayDeleteMedia(actor, { uploadedById: String(row["uploaded_by"]) }))
    throw new Error("Only the person who attached a file, or Admin, can restore or delete it.");
  return { actor, row, bugId: String(row["bug_id"]) };
}
/** Brings a removed file back onto its bug (the bug must not be in the Trash, and must have room). */
export async function restoreMedia(access: BugAccess, id: string) {
  checkOrigin();
  const { actor, row, bugId } = await trashedFile(access, id);
  await bugDetail(access, bugId).catch(() => {
    throw new Error("The bug this file belongs to is not available. Restore the bug first.");
  });
  const { rows } = await neonExecute(
    `with room as (select count(*)::int as n from bugflow.bug_media where bug_id=$4 and status='ready' and deleted_at is null),
    r as (update bugflow.bug_media set deleted_at=null,deleted_by=null,restorable_until=null where id=$1 and deleted_at is not null and purged_at is null and restorable_until>now() and (select n from room)<$5 returning id)
    insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $2,$4,$3,'bug.media_restored',jsonb_build_object('media',$6::text) from r returning id`,
    [id, crypto.randomUUID(), actor.userId, bugId, MEDIA_MAX_FILES, String(row["name"])],
  );
  if (!rows.length)
    throw new Error(
      `This file could not be restored: the bug already has ${MEDIA_MAX_FILES} files, or the file left the Trash.`,
    );
  return { restored: true, bugId, name: String(row["name"]) };
}
/** Deletes a removed file from storage now instead of waiting for the Trash to expire. */
export async function deleteMediaForever(access: BugAccess, id: string) {
  checkOrigin();
  const { actor, row, bugId } = await trashedFile(access, id);
  const { rows } = await neonExecute(
    `with p as (update bugflow.bug_media set restorable_until=null where id=$1 and deleted_at is not null and purged_at is null returning id)
    insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $2,$4,$3,'bug.media_purged',jsonb_build_object('media',$5::text) from p returning id`,
    [id, crypto.randomUUID(), actor.userId, bugId, String(row["name"])],
  );
  if (!rows.length) throw new Error("This file is no longer in the Trash.");
  const purged = await purge(String(row["key"]), id);
  return { purged };
}
/** Files the actor removed in the last TRASH_DAYS that can still be restored (Admin: everyone's). */
export async function listMediaTrash(access: BugAccess): Promise<TrashedMedia[]> {
  const actor = await actorFor(access);
  if (!actor.permissions.includes("view")) throw new Error("Bug access is not permitted.");
  const mine = actor.role !== "admin";
  const { rows } = await neonQuery(
    `select m.id,m.bug_id,m.name,m.kind,m.size,b.title as bug_title,u.name as uploader,to_json(m.deleted_at) as deleted_iso,to_json(m.restorable_until) as until_iso,(b.deleted_at is not null) as bug_trashed
    from bugflow.bug_media m join bugflow.bugs b on b.id=m.bug_id join bugflow.users u on u.id=m.uploaded_by
    where m.status='ready' and m.deleted_at is not null and m.purged_at is null and m.restorable_until>now() and b.purged_at is null ${mine ? "and m.uploaded_by=$1" : ""}
    order by m.deleted_at desc limit 200`,
    mine ? [actor.userId] : [],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    bugId: String(r["bug_id"]),
    bugCode: formatBugCode(String(r["bug_id"])),
    bugTitle: String(r["bug_title"]),
    name: String(r["name"]),
    kind: String(r["kind"]),
    size: Number(r["size"]),
    uploadedBy: String(r["uploader"]),
    deletedAt: String(r["deleted_iso"]),
    restorableUntil: String(r["until_iso"]),
    bugInTrash: r["bug_trashed"] === true,
  }));
}
async function purge(key: string, id: string) {
  const { config } = await mediaConfig();
  if (!config) return false;
  try {
    await remove(config, key);
    await remove(config, thumbKey(key)).catch(() => undefined);
    await neonExecute(
      `update bugflow.bug_media set purged_at=now() where id=$1 and purged_at is null`,
      [id],
    );
    return true;
  } catch {
    return false;
  }
}
const CLOSED = `(${MEDIA_CLOSED_STATUSES.map((s) => `'${s}'`).join(",")})`;
/**
 * Soft-deletes every file on bugs that have been closed for at least `days` days (0 = all closed bugs now), one audit row per bug
 * in the name of `actorId` (the Admin who asked, or who set the schedule). Returns how many files were removed; objects are purged by the sweep.
 */
async function clearClosed(days: number, actorId: string, limit = 200) {
  const { rows } = await neonExecute(
    `with victims as (select m.id from bugflow.bug_media m join bugflow.bugs b on b.id=m.bug_id where m.deleted_at is null and b.deleted_at is null and b.status in ${CLOSED} and b.updated_at<now()-make_interval(days=>$1) limit $3),
    upd as (update bugflow.bug_media set deleted_at=now(),deleted_by=$2 where id in (select id from victims) returning bug_id),
    audit as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select gen_random_uuid(),bug_id,$2,'bug.media_cleared',jsonb_build_object('count',count(*),'reason',case when $1=0 then 'manual' else 'auto' end,'days',$1) from upd group by bug_id returning bug_id)
    select count(*)::int as n from upd`,
    [days, actorId, limit],
  );
  return Number(rows[0]?.["n"] ?? 0);
}
let lastAuto = 0;
/** Best-effort housekeeping: forgets uploads that never finished, applies the clean-up schedule, and retries object deletions that failed. */
export async function sweep(limit = 10) {
  const { config, stored } = await mediaConfig();
  if (!config) return;
  if (stored.cleanupDays && stored.cleanupBy && Date.now() - lastAuto > 15 * 60000) {
    lastAuto = Date.now();
    await clearClosed(stored.cleanupDays, stored.cleanupBy).catch(() => 0);
  }
  const { rows } = await neonQuery(
    `with stale as (update bugflow.bug_media set deleted_at=now() where status='pending' and deleted_at is null and created_at<now()-interval '${MEDIA_PENDING_MINUTES} minutes' returning id,key)
    select id,key from stale union all (select id,key from bugflow.bug_media where deleted_at is not null and purged_at is null and (restorable_until is null or restorable_until<now()) order by deleted_at limit $1)`,
    [limit],
  );
  for (const r of rows.slice(0, limit)) await purge(String(r["key"]), String(r["id"]));
}
/** Admin removes every file on one bug at once (offered on resolved and closed bugs); audited as one entry. */
export async function clearBugMedia(access: BugAccess, bugId: string) {
  checkOrigin();
  const actor = await actorFor(access);
  if (actor.role !== "admin")
    throw new Error("Only Admin can remove all files from a bug at once.");
  await bugDetail(access, bugId);
  const { rows } = await neonExecute(
    `with upd as (update bugflow.bug_media set deleted_at=now(),deleted_by=$2 where bug_id=$1 and deleted_at is null returning id),
    audit as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $3,$1,$2,'bug.media_cleared',jsonb_build_object('count',count(*),'reason','manual') from upd having count(*)>0 returning id)
    select count(*)::int as n from upd`,
    [bugId, actor.userId, crypto.randomUUID()],
  );
  await sweep(MEDIA_MAX_FILES).catch(() => undefined);
  return { removed: Number(rows[0]?.["n"] ?? 0) };
}
/** Settings → Media storage → Clean-up: files on closed bugs go after this many days (0 = off); "now" removes them straight away. */
export async function saveMediaCleanup(
  data: { cleanupDays: CleanupDays } | { now: true },
): Promise<MediaStatus> {
  checkOrigin();
  const admin = await requireAdmin();
  const current = await storedChoice();
  if ("now" in data) {
    const n = await clearClosed(0, admin.userId, 1000);
    await neonExecute(
      `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.media_cleanup',$3::jsonb)`,
      [crypto.randomUUID(), admin.userId, JSON.stringify({ now: true, removed: n })],
    );
    forgetMediaConfig();
    await sweep(50).catch(() => undefined);
    return mediaStatus(false);
  }
  const next: Stored = { ...current, cleanupDays: data.cleanupDays, cleanupBy: admin.userId };
  await neonExecute([
    {
      query: `insert into bugflow.settings(key,value) values('media_storage',$1::jsonb) on conflict (key) do update set value=excluded.value`,
      params: [JSON.stringify(next)],
    },
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.media_cleanup',$3::jsonb)`,
      params: [crypto.randomUUID(), admin.userId, JSON.stringify({ days: data.cleanupDays })],
    },
  ]);
  forgetMediaConfig();
  return mediaStatus(false);
}
const R2_FREE_BYTES = 10 * 1024 ** 3;
let usageCache: {
  at: number;
  bucket: string;
  scan: {
    bytes: number;
    objects: number;
    previewBytes: number;
    previews: number;
    truncated: boolean;
  };
} | null = null;
/**
 * Settings → Media storage → Usage: what the bucket really holds (every object listed and summed, previews included,
 * cached for a minute), split by kind from our own rows, against the limit Admin set. S3 APIs cannot report a
 * provider's remaining quota, so "remaining" is measured against that limit.
 */
export async function mediaUsage(refresh = false): Promise<MediaUsage> {
  await requireAdmin();
  const { config, stored } = await mediaConfig();
  const { rows } = await neonQuery(
    `select kind,count(*) filter(where deleted_at is null)::int as files,coalesce(sum(size) filter(where deleted_at is null),0)::bigint as bytes,
      count(*) filter(where deleted_at is not null and purged_at is null)::int as trash_files,coalesce(sum(size) filter(where deleted_at is not null and purged_at is null),0)::bigint as trash_bytes
    from bugflow.bug_media where status='ready' group by kind`,
  );
  const kind = (k: string) => {
    const r = rows.find((x) => x["kind"] === k);
    return { files: Number(r?.["files"] ?? 0), bytes: Number(r?.["bytes"] ?? 0) };
  };
  const trashFiles = rows.reduce((n, r) => n + Number(r["trash_files"] ?? 0), 0);
  const trashBytes = rows.reduce((n, r) => n + Number(r["trash_bytes"] ?? 0), 0);
  let scan: NonNullable<typeof usageCache>["scan"] | null = null;
  let scanError: string | null = null;
  if (config) {
    if (
      !refresh &&
      usageCache &&
      usageCache.bucket === config.bucket &&
      Date.now() - usageCache.at < 60_000
    )
      scan = usageCache.scan;
    else
      try {
        const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
        const client = await s3(config);
        let token: string | undefined;
        const total = { bytes: 0, objects: 0, previewBytes: 0, previews: 0, truncated: false };
        for (let page = 0; page < 100; page++) {
          const out = await storageCall("list", () =>
            client.send(
              new ListObjectsV2Command({
                Bucket: config.bucket,
                ContinuationToken: token,
                MaxKeys: 1000,
              }),
              { requestTimeout: 15000 },
            ),
          );
          for (const o of out.Contents ?? []) {
            total.bytes += Number(o.Size ?? 0);
            total.objects++;
            if (o.Key?.endsWith(".thumb.jpg")) {
              total.previewBytes += Number(o.Size ?? 0);
              total.previews++;
            }
          }
          token = out.IsTruncated ? out.NextContinuationToken : undefined;
          if (!token) break;
          if (page === 99) total.truncated = true;
        }
        scan = total;
        usageCache = { at: Date.now(), bucket: config.bucket, scan };
      } catch (e) {
        scanError = (e as Error).message;
      }
  }
  const isR2 = !!config && providerName(config.endpoint) === "Cloudflare R2";
  const quota = stored.quotaBytes ?? (isR2 ? R2_FREE_BYTES : null);
  const known = kind("image").bytes + kind("video").bytes + kind("pdf").bytes + trashBytes;
  const used = scan?.bytes ?? known;
  return {
    configured: !!config,
    provider: config ? providerName(config.endpoint) : "",
    bucket: config?.bucket ?? "",
    usedBytes: used,
    objects: scan?.objects ?? null,
    measured: !!scan,
    truncated: scan?.truncated ?? false,
    scanError,
    quotaBytes: quota,
    quotaIsDefault: stored.quotaBytes == null && quota !== null,
    remainingBytes: quota === null ? null : Math.max(0, quota - used),
    images: kind("image"),
    videos: kind("video"),
    pdfs: kind("pdf"),
    previews: { files: scan?.previews ?? 0, bytes: scan?.previewBytes ?? 0 },
    trash: { files: trashFiles, bytes: trashBytes },
    otherBytes: scan ? Math.max(0, scan.bytes - known - scan.previewBytes) : 0,
    measuredAt: new Date(usageCache?.at ?? Date.now()).toISOString(),
  };
}
/** Settings → Media storage → Usage: the limit the meter measures against (null = back to the default). */
export async function saveMediaQuota(gb: number | null): Promise<MediaUsage> {
  checkOrigin();
  const admin = await requireAdmin();
  const current = await storedChoice();
  const next: Stored = { ...current };
  if (gb === null) delete next.quotaBytes;
  else next.quotaBytes = Math.round(gb * 1024 ** 3);
  await neonExecute([
    {
      query: `insert into bugflow.settings(key,value) values('media_storage',$1::jsonb) on conflict (key) do update set value=excluded.value`,
      params: [JSON.stringify(next)],
    },
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.media_quota',$3::jsonb)`,
      params: [crypto.randomUUID(), admin.userId, JSON.stringify({ gb })],
    },
  ]);
  forgetMediaConfig();
  return mediaUsage();
}
/** Settings → Media storage: configuration, usage from our own rows and, on request, a real round trip to the bucket. */
export async function mediaStatus(test: boolean): Promise<MediaStatus> {
  await requireAdmin();
  if (test) checkOrigin();
  const { config, missing, source, defaultAvailable, stored } = await mediaConfig();
  const { rows } = await neonQuery(
    `select count(*) filter(where m.status='ready' and m.deleted_at is null)::int as files, coalesce(sum(m.size) filter(where m.status='ready' and m.deleted_at is null),0)::bigint as bytes, count(*) filter(where m.deleted_at is not null and m.purged_at is null)::int as awaiting, count(*) filter(where m.status='pending' and m.deleted_at is null)::int as pending, count(*) filter(where m.status='ready' and m.deleted_at is null and b.status in ${CLOSED})::int as closed_files, coalesce(sum(m.size) filter(where m.status='ready' and m.deleted_at is null and b.status in ${CLOSED}),0)::bigint as closed_bytes from bugflow.bug_media m join bugflow.bugs b on b.id=m.bug_id`,
  );
  const r = rows[0] ?? {};
  const host = (() => {
    try {
      return config ? new URL(config.endpoint).hostname : "";
    } catch {
      return "";
    }
  })();
  const c = stored.custom;
  const custom = c
    ? {
        endpoint: c.endpoint,
        bucket: c.bucket,
        region: c.region,
        forcePathStyle: c.forcePathStyle,
        accessKeyIdHint: `${c.accessKeyId.slice(0, 4)}…${c.accessKeyId.slice(-2)}`,
      }
    : null;
  const base: MediaStatus = {
    configured: !!config,
    source,
    defaultAvailable,
    cleanupDays: stored.cleanupDays ?? 0,
    closedFiles: Number(r["closed_files"] ?? 0),
    closedBytes: Number(r["closed_bytes"] ?? 0),
    canStoreSecrets: !!(process.env["BUGFLOW_PORTAL_ENCRYPTION_KEY"] ?? "").trim(),
    custom,
    missing,
    provider: config ? providerName(config.endpoint) : "",
    bucket: config?.bucket ?? "",
    endpointHost: host,
    files: Number(r["files"] ?? 0),
    bytes: Number(r["bytes"] ?? 0),
    awaitingPurge: Number(r["awaiting"] ?? 0),
    pending: Number(r["pending"] ?? 0),
    appOrigins: appOrigins(),
    test: null,
  };
  if (!test || !config) return base;
  const started = Date.now();
  try {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    await storageCall("list", () =>
      s3(config).then((c) =>
        c.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }), {
          requestTimeout: 8000,
        }),
      ),
    );
    await sweep().catch(() => undefined);
    const again = await mediaStatus(false);
    const ms = Date.now() - started;
    const corsBlocked = await corsBlockedOrigins(config, again.appOrigins);
    return {
      ...again,
      test: corsBlocked.length
        ? {
            ok: false,
            ms,
            corsBlocked,
            message: `Bucket ${config.bucket} answered, but its CORS rule blocks uploads from ${corsBlocked.join(", ")}. Add ${corsBlocked.length > 1 ? "these addresses" : "this address"} to AllowedOrigins (see the setup guide below).`,
          }
        : { ok: true, ms, message: `Bucket ${config.bucket} answered in ${ms} ms.` },
    };
  } catch (e) {
    return {
      ...base,
      test: { ok: false, ms: Date.now() - started, message: (e as Error).message },
    };
  }
}
/** The addresses people open this app at: the current request's, plus the production URL when Vercel provides it. */
function appOrigins(): string[] {
  const list: string[] = [];
  try {
    list.push(new URL(getRequest().url).origin);
  } catch {
    /* outside a request */
  }
  const prod = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
  if (prod) list.push(`https://${prod.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`);
  return [...new Set(list)];
}
/**
 * Uploads go straight from the browser to the bucket, so the bucket's CORS rule must allow each app address. This
 * asks the bucket the same preflight question a browser asks (no credentials, nothing written) and returns the
 * addresses it refuses. A bucket that cannot be asked counts as allowing, so the check never blocks a working setup.
 */
export async function corsBlockedOrigins(cfg: Config, origins: string[]): Promise<string[]> {
  const base = cfg.forcePathStyle
    ? `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}`
    : (() => {
        const u = new URL(cfg.endpoint);
        u.hostname = `${cfg.bucket}.${u.hostname}`;
        return u.origin;
      })();
  const probe = `${base}/bugs/cors-check.jpg`;
  const blocked = await Promise.all(
    origins.map(async (origin) => {
      try {
        const r = await fetch(probe, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type,if-none-match",
          },
          signal: AbortSignal.timeout(5000),
        });
        const allow = r.headers.get("access-control-allow-origin");
        return r.ok && (allow === "*" || allow === origin) ? null : origin;
      } catch {
        return null;
      }
    }),
  );
  return blocked.filter((o): o is string => o !== null);
}
/** Settings → Media storage: save the workspace bucket (secret encrypted at rest) and test it, or fall back to the hosting bucket. */
export async function saveMediaStorage(
  data: z.infer<typeof mediaStorageSchema>,
): Promise<MediaStatus> {
  checkOrigin();
  const admin = await requireAdmin();
  const current = await storedChoice();
  let next: Stored;
  if (data.source === "default") next = { ...current, source: "default" };
  else {
    if (!(process.env["BUGFLOW_PORTAL_ENCRYPTION_KEY"] ?? "").trim())
      throw new Error(
        "Set BUGFLOW_PORTAL_ENCRYPTION_KEY first so the secret key can be stored encrypted.",
      );
    // Blank key fields keep what is saved; a new access key ID needs its own secret.
    const accessKeyId = data.accessKeyId || current.custom?.accessKeyId || "";
    if (!accessKeyId) throw new Error("Enter the access key ID.");
    if (
      data.accessKeyId &&
      data.accessKeyId !== current.custom?.accessKeyId &&
      !data.secretAccessKey
    )
      throw new Error("Enter the secret access key that belongs to this access key ID.");
    const secretCiphertext = data.secretAccessKey
      ? await encryptPortal(data.secretAccessKey)
      : (current.custom?.secretCiphertext ?? "");
    if (!secretCiphertext) throw new Error("Enter the secret access key.");
    next = {
      ...current,
      source: "custom",
      custom: {
        endpoint: data.endpoint.replace(/\/+$/, ""),
        bucket: data.bucket,
        region: data.region,
        forcePathStyle: data.forcePathStyle,
        accessKeyId,
        secretCiphertext,
      },
    };
  }
  await neonExecute([
    {
      query: `insert into bugflow.settings(key,value) values('media_storage',$1::jsonb) on conflict (key) do update set value=excluded.value`,
      params: [JSON.stringify(next)],
    },
    {
      query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.media_storage',$3::jsonb)`,
      params: [
        crypto.randomUUID(),
        admin.userId,
        JSON.stringify(
          next.source === "custom"
            ? {
                source: "workspace bucket",
                bucket: next.custom!.bucket,
                provider: providerName(next.custom!.endpoint),
              }
            : { source: "hosting bucket" },
        ),
      ],
    },
  ]);
  forgetMediaConfig();
  return mediaStatus(true);
}
