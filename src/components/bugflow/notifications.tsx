import { useState } from "react";
import { SkeletonRows } from "./loading";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Bell,
  Bug,
  ArrowRight,
  MessageSquare,
  UserCheck,
  ClipboardCheck,
  Flag,
  Trash2,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getBugState, getNotifications, updateNotifications } from "@/lib/notifications.functions";
import { formatBugCode } from "@/lib/bug-workflow";
import {
  NOTIFICATION_DAYS,
  notificationLabel,
  notificationTone,
  type NotificationItem,
  notificationHref,
} from "@/lib/notifications";
import { ConfirmAction, ErrorNotice, actionError } from "./action-feedback";
import { dateLabel, dayHeading, statusLabel, timeAgo } from "@/lib/format";

const iconFor = (a: string) =>
  a.startsWith("member.") || a.startsWith("portal.")
    ? UserCheck
    : a.includes("comment")
      ? MessageSquare
      : a.includes("assign")
        ? UserCheck
        : a.includes("verify")
          ? ClipboardCheck
          : a.includes("priority")
            ? Flag
            : Bug;

/** Notifications arrive newest first; keep that order and cut it into days. */
function groupByDay(items: NotificationItem[]) {
  const groups: { day: string; items: NotificationItem[] }[] = [];
  for (const n of items) {
    const day = dayHeading(n.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(n);
    else groups.push({ day, items: [n] });
  }
  return groups;
}
function useNotifications(limit: number) {
  const fn = useServerFn(getNotifications);
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: () => fn({ data: { limit } }),
    retry: false,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}
function useMark() {
  const fn = useServerFn(updateNotifications);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: "read" | "clear") => fn({ data: { kind } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

function Item({ n, onClick }: { n: NotificationItem; onClick?: () => void }) {
  const Icon = iconFor(n.action);
  const navigate = useNavigate();
  const lookup = useServerFn(getBugState);
  const bugId = n.action.startsWith("bug.") ? n.bugId : null;
  /** A bug notification opens that bug (highlighted in the list); a deleted bug says who deleted it and when. */
  async function openBug(e: React.MouseEvent) {
    if (!bugId || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onClick?.();
    try {
      const s = await lookup({ data: { bugId } });
      const code = formatBugCode(bugId, "codePrefix" in s ? s.codePrefix : "BF");
      if (s.state === "ok") {
        void navigate({ href: `/admin/bugs?bug=${bugId}` });
        return;
      }
      if (s.state === "missing") {
        toast.error(`${code} no longer exists`);
        return;
      }
      if (s.state === "trashed") {
        toast.error(`${code} was deleted by ${s.by}`, {
          description: `${timeAgo(s.at)} (${dateLabel(s.at)}) · “${s.title}” is in the Trash and can be restored there.`,
          action: { label: "Open Trash", onClick: () => void navigate({ to: "/admin/trash" }) },
        });
        return;
      }
      toast.error(`${code} was deleted forever by ${s.by}`, {
        description: `${timeAgo(s.at)} (${dateLabel(s.at)})${s.deletedBy ? ` · first moved to the Trash by ${s.deletedBy}` : ""} · “${s.title}” cannot be opened any more.`,
      });
    } catch (err) {
      toast.error(actionError(err, "This bug could not be opened."));
    }
  }
  const className = `bf-notice ${n.unread ? "bf-notice-unread" : ""}`;
  const body = (
    <>
      <span className="bf-notice-icon">
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <strong className="text-sm">{notificationLabel(n.action)}</strong>
          {n.unread && (
            <span
              className="bf-notice-dot"
              data-tone={notificationTone(n.action, n.status)}
              aria-label="Unread"
            />
          )}
          {n.status && <span className="bf-notice-tag ml-auto">{statusLabel(n.status)}</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {n.title || (n.action.startsWith("bug.") ? "Bug update" : "Team & access")} · by {n.actor}
        </span>
        <time className="block text-xs text-muted-foreground" title={dateLabel(n.at)}>
          {timeAgo(n.at)}
        </time>
      </span>
    </>
  );
  // Bug notifications are plain links (so a new tab gets the same ?bug= address) with a checked open on click.
  return bugId ? (
    <a href={`/admin/bugs?bug=${bugId}`} className={className} onClick={(e) => void openBug(e)}>
      {body}
    </a>
  ) : (
    <a
      href={notificationHref(n)}
      className={className}
      onClick={(e) => {
        onClick?.();
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        void navigate({ href: notificationHref(n) });
      }}
    >
      {body}
    </a>
  );
}

export function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const q = useNotifications(5);
  const mark = useMark();
  const unread = q.data?.unread ?? 0;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && unread) mark.mutate("read");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative"
          aria-label={`Notifications${unread ? `: ${unread} unread` : ""}`}
        >
          <Bell size={17} />
          {unread > 0 && <span className="bf-badge">{unread > 99 ? "99+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <strong className="text-sm">Notifications</strong>
          {unread > 0 && <span className="bf-unread-pill">{unread} unread</span>}
        </div>
        <div className="grid max-h-[360px] gap-2 overflow-y-auto p-3">
          {q.isPending ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : q.isError ? (
            <ErrorNotice
              message={actionError(q.error, "Notifications could not be loaded.")}
              onRetry={() => q.refetch()}
            />
          ) : !q.data.items.length ? (
            <p className="py-6 text-center text-xs text-muted-foreground">You’re all caught up.</p>
          ) : (
            q.data.items.map((n) => <Item key={n.id} n={n} onClick={() => setOpen(false)} />)
          )}
        </div>
        <div className="border-t p-3">
          <Button asChild variant="secondary" className="w-full">
            <Link to="/admin/notifications" onClick={() => setOpen(false)}>
              View all notifications
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationsPage() {
  const q = useNotifications(200);
  const mark = useMark();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [confirm, setConfirm] = useState(false);
  if (q.isPending) return <SkeletonRows rows={5} label="Loading notifications" />;
  if (q.isError)
    return (
      <ErrorNotice
        message={actionError(q.error, "Notifications could not be loaded.")}
        onRetry={() => q.refetch()}
      />
    );
  const items = tab === "unread" ? q.data.items.filter((n) => n.unread) : q.data.items;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={tab === "all" ? "default" : "outline"}
          onClick={() => setTab("all")}
        >
          All ({q.data.total})
        </Button>
        <Button
          size="sm"
          variant={tab === "unread" ? "default" : "outline"}
          onClick={() => setTab("unread")}
        >
          Unread ({q.data.unread})
        </Button>
        <span className="text-xs text-muted-foreground">
          Showing the last {NOTIFICATION_DAYS} days
        </span>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button
            size="sm"
            variant="outline"
            disabled={!q.data.unread || mark.isPending}
            onClick={() => mark.mutate("read")}
          >
            <CheckCheck />
            Mark all read
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!q.data.total}
            onClick={() => setConfirm(true)}
          >
            <Trash2 />
            Clear all
          </Button>
          <ConfirmAction
            open={confirm}
            onOpenChange={setConfirm}
            destructive
            title="Clear notifications?"
            description={`This clears all notifications from the last ${NOTIFICATION_DAYS} days. Bug history is kept.`}
            confirmLabel="Clear all"
            onConfirm={async () => {
              await mark.mutateAsync("clear");
            }}
          />
        </div>
      </div>
      {items.length ? (
        groupByDay(items).map((g) => (
          <section
            key={g.day}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"
            aria-label={g.day}
          >
            <h2 className="bf-day-heading">
              {g.day}
              <span>{g.items.length}</span>
            </h2>
            {g.items.map((n) => (
              <Item key={n.id} n={n} />
            ))}
          </section>
        ))
      ) : (
        <div className="bf-empty">
          <Bell />
          <h3>Nothing new</h3>
          <p className="text-sm text-muted-foreground">
            Bug updates from the last {NOTIFICATION_DAYS} days will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
