import { neonQuery, neonExecute } from "./neon.server";
import { requireAdmin, checkOrigin } from "./portal-access.server";
import { NOTIFICATION_DAYS, type NotificationItem } from "./notifications";

export async function listNotifications(limit: number) {
  const admin = await requireAdmin();
  const { rows } = await neonQuery(
    `with st as (select coalesce((select read_at from bugflow.notification_state where user_id=$1),'epoch'::timestamptz) r, coalesce((select cleared_at from bugflow.notification_state where user_id=$1),'epoch'::timestamptz) c)
     select a.id,a.action,a.detail,a.bug_id::text as bug_id,b.title,u.name as actor,to_json(a.created_at) as at,(a.created_at>st.r) as unread,count(*) over() as total,count(*) filter (where a.created_at>st.r) over() as unread_total
     from bugflow.activity a cross join st join bugflow.users u on u.id=a.actor_id left join bugflow.bugs b on b.id=a.bug_id
     where a.created_at>now()-make_interval(days=>$2) and a.created_at>st.c
     order by a.created_at desc,a.id desc limit $3`,
    [admin.userId, NOTIFICATION_DAYS, limit],
  );
  const items: NotificationItem[] = rows.map((r) => ({
    id: String(r["id"]),
    action: String(r["action"]),
    bugId: r["bug_id"] ? String(r["bug_id"]) : null,
    title: r["title"] ? String(r["title"]) : "",
    actor: String(r["actor"]),
    at: String(r["at"]),
    unread: Boolean(r["unread"]),
    status:
      typeof (r["detail"] as Record<string, unknown> | null)?.["status"] === "string"
        ? String((r["detail"] as Record<string, unknown>)["status"])
        : "",
  }));
  return {
    items,
    total: Number(rows[0]?.["total"] ?? 0),
    unread: Number(rows[0]?.["unread_total"] ?? 0),
  };
}

export async function markNotifications(kind: "read" | "clear") {
  checkOrigin();
  const admin = await requireAdmin();
  await neonExecute(
    kind === "read"
      ? `insert into bugflow.notification_state(user_id,read_at) values($1,now()) on conflict (user_id) do update set read_at=now()`
      : `insert into bugflow.notification_state(user_id,read_at,cleared_at) values($1,now(),now()) on conflict (user_id) do update set read_at=now(),cleared_at=now()`,
    [admin.userId],
  );
  return { ok: true };
}
