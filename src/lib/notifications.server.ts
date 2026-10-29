import { neonQuery, neonExecute } from "./neon.server";
import { requireAdmin, checkOrigin } from "./portal-access.server";
import { NOTIFICATION_DAYS, QUIET_ACTION_PREFIXES, type NotificationItem } from "./notifications";

const ref = (detail: unknown, key: string) => {
  const v = (detail as Record<string, unknown> | null)?.[key];
  return typeof v === "string" && v ? v : null;
};
export async function listNotifications(limit: number) {
  const admin = await requireAdmin();
  const { rows } = await neonQuery(
    `with st as (select coalesce((select read_at from bugflow.notification_state where user_id=$1),'epoch'::timestamptz) r, coalesce((select cleared_at from bugflow.notification_state where user_id=$1),'epoch'::timestamptz) c)
     select a.id,a.action,a.detail,a.bug_id::text as bug_id,b.title,u.name as actor,to_json(a.created_at) as at,(a.created_at>st.r) as unread,count(*) over() as total,count(*) filter (where a.created_at>st.r) over() as unread_total
     from bugflow.activity a cross join st join bugflow.users u on u.id=a.actor_id left join bugflow.bugs b on b.id=a.bug_id
     where a.created_at>now()-make_interval(days=>$2) and a.created_at>st.c
       and not (a.action like any ($4::text[]))
     order by a.created_at desc,a.id desc limit $3`,
    [
      admin.userId,
      NOTIFICATION_DAYS,
      limit,
      QUIET_ACTION_PREFIXES.map((p) => `${p.replace(/_/g, "\\_")}%`),
    ],
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
    portalId: ref(r["detail"], "portalId"),
    userId: ref(r["detail"], "userId"),
    projectId: ref(r["detail"], "projectId"),
  }));
  const due = await dueReminders(admin.userId);
  return {
    items: [...due, ...items],
    total: Number(rows[0]?.["total"] ?? 0) + due.length,
    unread: Number(rows[0]?.["unread_total"] ?? 0) + due.filter((d) => d.unread).length,
  };
}

/**
 * Synthetic reminders, computed on read (no stored rows, no background job): open bugs that are overdue or due by
 * tomorrow in the workspace time zone. They sit on top of the bell and count as unread once per day — "mark read"
 * quietens them until the next day; clearing the bell does not remove a bug that is still due.
 */
async function dueReminders(userId: string): Promise<NotificationItem[]> {
  const { workspaceTimeZone, workspaceToday } = await import("./bug-workflow.server");
  const [tz, today] = await Promise.all([workspaceTimeZone(), workspaceToday()]);
  const { rows } = await neonQuery(
    `select b.id::text as id,b.title,b.due_on::text as due_on,(b.due_on<$2::date) as overdue,
       (coalesce((select read_at from bugflow.notification_state where user_id=$1),'epoch'::timestamptz)
         < (date_trunc('day', now() at time zone $3) at time zone $3)) as unread
     from bugflow.bugs b
     where b.deleted_at is null and b.due_on is not null and b.due_on <= $2::date + 1
       and b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')
     order by b.due_on,b.id limit 12`,
    [userId, today, tz],
  );
  const now = new Date().toISOString();
  return rows.map((r) => ({
    id: `due-${String(r["id"])}-${today}`,
    action: r["overdue"] === true ? "bug.overdue" : "bug.due_soon",
    bugId: String(r["id"]),
    title: String(r["title"]),
    actor: "Due date",
    at: now,
    unread: Boolean(r["unread"]),
    status: "",
    portalId: null,
    userId: null,
    projectId: null,
  }));
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

/**
 * Where a notification's bug stands before Admin is taken to it: still there, in the Trash, or deleted forever,
 * with who did it and when, so a click on a stale notification explains itself instead of opening an empty view.
 */
export async function bugState(bugId: string) {
  await requireAdmin();
  const { rows } = await neonQuery(
    `select b.title,to_json(b.deleted_at) as deleted_iso,to_json(b.purged_at) as purged_iso,
      (select u.name from bugflow.activity a join bugflow.users u on u.id=a.actor_id where a.bug_id=b.id and a.action='bug.deleted' order by a.created_at desc limit 1) as deleted_by,
      coalesce(
        (select u.name from bugflow.activity a join bugflow.users u on u.id=a.actor_id where a.bug_id=b.id and a.action='bug.purged' order by a.created_at desc limit 1),
        -- "Empty Trash" writes one entry without a bug id, at the same moment the bug was purged.
        (select u.name from bugflow.activity a join bugflow.users u on u.id=a.actor_id where a.action='trash.emptied' and a.created_at between b.purged_at-interval '10 seconds' and b.purged_at+interval '10 seconds' order by a.created_at desc limit 1)
      ) as purged_by
    from bugflow.bugs b where b.id=$1 limit 1`,
    [bugId],
  );
  const r = rows[0];
  if (!r) return { state: "missing" as const };
  const title = String(r["title"]);
  if (r["purged_iso"])
    return {
      state: "purged" as const,
      title,
      by: r["purged_by"] ? String(r["purged_by"]) : "the Trash clean-up (after 30 days)",
      at: String(r["purged_iso"]),
      deletedBy: r["deleted_by"] ? String(r["deleted_by"]) : null,
    };
  if (r["deleted_iso"])
    return {
      state: "trashed" as const,
      title,
      by: r["deleted_by"] ? String(r["deleted_by"]) : "Admin",
      at: String(r["deleted_iso"]),
    };
  return { state: "ok" as const, title };
}
