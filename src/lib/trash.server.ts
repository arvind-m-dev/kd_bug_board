import { neonBatch, neonExecute } from "./neon.server";
import { checkOrigin, requireAdmin } from "./portal-access.server";
import { formatBugCode } from "./bug-workflow";
import { TRASH_DAYS, type TrashData, type TrashItemRef } from "./trash";

const N = (v: unknown) => Number(v ?? 0);
/** Media sweep (bug-media.server) deletes the objects of rows soft-deleted here; imported lazily so nothing else pays for the SDK. */
const sweepMedia = async (limit: number) => {
  await (await import("./bug-media.server")).sweep(limit).catch(() => undefined);
};

/**
 * Items older than TRASH_DAYS leave the Trash for good: bugs and members get purged_at, files of those bugs are soft-deleted
 * for the media sweep. The audit row names whoever moved the item to the Trash. Throttled per server instance.
 */
let lastExpiry = 0;
export async function maybeExpireTrash() {
  if (Date.now() - lastExpiry < 3_600_000) return;
  lastExpiry = Date.now();
  const { results } = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    {
      query: `with expired as (update bugflow.bugs b set purged_at=now() where b.deleted_at<now()-make_interval(days=>$1) and b.purged_at is null returning b.id),
      files as (update bugflow.bug_media m set deleted_at=now() where m.bug_id in (select id from expired) and m.deleted_at is null returning m.id),
      audit as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select gen_random_uuid(),e.id,d.actor_id,'bug.purged',jsonb_build_object('reason','auto','days',$1::int)
        from expired e join lateral (select a.actor_id from bugflow.activity a where a.bug_id=e.id and a.action='bug.deleted' order by a.created_at desc limit 1) d on true returning 1)
      select (select count(*) from expired)::int as bugs,(select count(*) from files)::int as files`,
      params: [TRASH_DAYS],
    },
    {
      query: `with expired as (update bugflow.users u set purged_at=now() where u.deleted_at<now()-make_interval(days=>$1) and u.purged_at is null returning u.id),
      audit as (insert into bugflow.activity(id,actor_id,action,detail) select gen_random_uuid(),d.actor_id,'member.purge',jsonb_build_object('userId',e.id::text,'reason','auto','days',$1::int)
        from expired e join lateral (select a.actor_id from bugflow.activity a where a.action='member.delete' and a.detail->>'userId'=e.id::text order by a.created_at desc limit 1) d on true returning 1)
      select (select count(*) from expired)::int as members`,
      params: [TRASH_DAYS],
    },
  ]);
  if (N(results[0]?.rows[0]?.["files"])) await sweepMedia(50);
}

/** Admin's Trash: bugs and members restorable for TRASH_DAYS, plus files removed in that time (for the record). */
export async function listTrash(): Promise<TrashData> {
  await requireAdmin();
  await maybeExpireTrash().catch(() => undefined);
  const [bugs, members, files] = await neonBatch([
    {
      query: `select b.id,b.title,b.status,pr.name as project,to_json(b.deleted_at) as deleted_iso,
        coalesce((select u.name from bugflow.activity a join bugflow.users u on u.id=a.actor_id where a.bug_id=b.id and a.action='bug.deleted' order by a.created_at desc limit 1),'Admin') as deleted_by,
        (select count(*) from bugflow.bug_media m where m.bug_id=b.id and m.status='ready' and m.deleted_at is null)::int as files
      from bugflow.bugs b join bugflow.projects pr on pr.id=b.project_id
      where b.deleted_at is not null and b.purged_at is null and b.deleted_at>now()-make_interval(days=>$1) order by b.deleted_at desc,b.id desc limit 500`,
      params: [TRASH_DAYS],
    },
    {
      query: `select u.id,u.name,u.email,to_json(u.deleted_at) as deleted_iso,
        coalesce((select ua.name from bugflow.activity a join bugflow.users ua on ua.id=a.actor_id where a.action='member.delete' and a.detail->>'userId'=u.id::text order by a.created_at desc limit 1),'Admin') as deleted_by,
        coalesce((select jsonb_agg(distinct p.type) from bugflow.portals p where p.user_id=u.id and p.type<>'admin'),'[]'::jsonb) as roles
      from bugflow.users u where u.deleted_at is not null and u.purged_at is null and u.deleted_at>now()-make_interval(days=>$1) order by u.deleted_at desc limit 500`,
      params: [TRASH_DAYS],
    },
    {
      query: `select m.id,m.name,m.kind,m.size,m.bug_id,b.title as bug_title,to_json(m.deleted_at) as deleted_iso,coalesce(u.name,'Clean-up') as deleted_by
      from bugflow.bug_media m join bugflow.bugs b on b.id=m.bug_id left join bugflow.users u on u.id=m.deleted_by
      where m.deleted_at is not null and m.status='ready' and m.deleted_at>now()-make_interval(days=>$1) order by m.deleted_at desc limit 200`,
      params: [TRASH_DAYS],
    },
  ] as const);
  return {
    days: TRASH_DAYS,
    bugs: bugs.rows.map((r) => ({
      id: String(r["id"]),
      code: formatBugCode(String(r["id"])),
      title: String(r["title"]),
      project: String(r["project"]),
      status: String(r["status"]),
      deletedAt: String(r["deleted_iso"]),
      deletedBy: String(r["deleted_by"]),
      files: N(r["files"]),
    })),
    members: members.rows.map((r) => ({
      id: String(r["id"]),
      name: String(r["name"]),
      email: String(r["email"]),
      roles: Array.isArray(r["roles"]) ? (r["roles"] as unknown[]).map(String) : [],
      deletedAt: String(r["deleted_iso"]),
      deletedBy: String(r["deleted_by"]),
    })),
    files: files.rows.map((r) => ({
      id: String(r["id"]),
      name: String(r["name"]),
      kind: String(r["kind"]),
      size: N(r["size"]),
      bugId: String(r["bug_id"]),
      bugCode: formatBugCode(String(r["bug_id"])),
      bugTitle: String(r["bug_title"]),
      deletedAt: String(r["deleted_iso"]),
      deletedBy: String(r["deleted_by"]),
    })),
  };
}

/** Brings a bug (with its attachments) or a member back. A member returns deactivated with revoked links: Admin activates them and issues a new link. */
export async function restoreTrashItem(item: TrashItemRef) {
  checkOrigin();
  const admin = await requireAdmin();
  if (item.kind === "bug") {
    const { rows } = await neonExecute(
      `with r as (update bugflow.bugs set deleted_at=null,updated_at=clock_timestamp() where id=$1 and deleted_at is not null and purged_at is null returning id)
      insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $2,r.id,$3,'bug.restored','{}'::jsonb from r returning bug_id`,
      [item.id, crypto.randomUUID(), admin.userId],
    );
    if (!rows.length) throw new Error("This bug is no longer in the Trash.");
    return { kind: "bug" as const, id: item.id, label: formatBugCode(item.id) };
  }
  const { rows } = await neonExecute(
    `with r as (update bugflow.users set deleted_at=null,active=false where id=$1 and deleted_at is not null and purged_at is null returning id,name)
    insert into bugflow.activity(id,actor_id,action,detail) select $2,$3,'member.restore',jsonb_build_object('userId',r.id::text,'name',r.name) from r returning detail->>'name' as name`,
    [item.id, crypto.randomUUID(), admin.userId],
  );
  if (!rows.length) throw new Error("This member is no longer in the Trash.");
  return { kind: "member" as const, id: item.id, label: String(rows[0]!["name"]) };
}

/** Takes one item out of the Trash for good: a bug's files leave storage; history, comments and references stay. */
export async function deleteTrashItemForever(item: TrashItemRef) {
  checkOrigin();
  const admin = await requireAdmin();
  if (item.kind === "bug") {
    const { rows } = await neonExecute(
      `with p as (update bugflow.bugs set purged_at=now() where id=$1 and deleted_at is not null and purged_at is null returning id),
      f as (update bugflow.bug_media set deleted_at=now(),deleted_by=$3 where bug_id in (select id from p) and deleted_at is null returning id),
      a as (insert into bugflow.activity(id,bug_id,actor_id,action,detail) select $2,p.id,$3,'bug.purged',jsonb_build_object('files',(select count(*) from f)) from p returning 1)
      select (select count(*) from p)::int as n,(select count(*) from f)::int as files`,
      [item.id, crypto.randomUUID(), admin.userId],
    );
    if (!N(rows[0]?.["n"])) throw new Error("This bug is no longer in the Trash.");
    if (N(rows[0]?.["files"])) await sweepMedia(20);
    return { kind: "bug" as const, files: N(rows[0]?.["files"]) };
  }
  const { rows } = await neonExecute(
    `with p as (update bugflow.users set purged_at=now() where id=$1 and deleted_at is not null and purged_at is null returning id)
    insert into bugflow.activity(id,actor_id,action,detail) select $2,$3,'member.purge',jsonb_build_object('userId',p.id::text) from p returning 1`,
    [item.id, crypto.randomUUID(), admin.userId],
  );
  if (!rows.length) throw new Error("This member is no longer in the Trash.");
  return { kind: "member" as const, files: 0 };
}

/** Empties the Trash in one transaction and records one audit entry with the counts. */
export async function emptyTrash() {
  checkOrigin();
  const admin = await requireAdmin();
  const { rows } = await neonExecute(
    `with b as (update bugflow.bugs set purged_at=now() where deleted_at is not null and purged_at is null returning id),
    f as (update bugflow.bug_media set deleted_at=now(),deleted_by=$2 where bug_id in (select id from b) and deleted_at is null returning id),
    u as (update bugflow.users set purged_at=now() where deleted_at is not null and purged_at is null returning id),
    a as (insert into bugflow.activity(id,actor_id,action,detail) select $1,$2,'trash.emptied',jsonb_build_object('bugs',(select count(*) from b),'members',(select count(*) from u),'files',(select count(*) from f)) returning 1)
    select (select count(*) from b)::int as bugs,(select count(*) from u)::int as members,(select count(*) from f)::int as files`,
    [crypto.randomUUID(), admin.userId],
  );
  const r = rows[0] ?? {};
  if (N(r["files"])) await sweepMedia(50);
  return { bugs: N(r["bugs"]), members: N(r["members"]), files: N(r["files"]) };
}
