import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminSessions, lockOtherDevices } from "@/lib/portal-access.functions";
import { timeAgo } from "@/lib/format";
import { actionError, ConfirmAction, ErrorNotice } from "./action-feedback";

/**
 * Settings → System health: every device currently signed in as Admin (one row per live session)
 * and a "Sign out other devices" action that keeps only this one. Sessions expire on their own
 * after 8 hours; this is for leaving a shared or lost device behind sooner.
 */
export function SignedInDevices() {
  const [open, setOpen] = useState(false);
  const read = useServerFn(getAdminSessions);
  const lock = useServerFn(lockOtherDevices);
  const q = useQuery({
    queryKey: ["admin-sessions"],
    queryFn: () => read(),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const signOut = useMutation({
    mutationFn: () => lock(),
    onSettled: () => void q.refetch(),
  });
  const sessions = q.data ?? [];
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2 className="flex items-center gap-2">
          <MonitorSmartphone size={18} />
          Signed-in devices
          {q.data && (
            <span className="bf-tag" role="status">
              {sessions.length} active
            </span>
          )}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={others === 0 || signOut.isPending}
          onClick={() => setOpen(true)}
        >
          {signOut.isPending ? "Signing out…" : "Sign out other devices"}
        </Button>
      </div>
      {q.isError && (
        <ErrorNotice
          message={actionError(q.error, "The signed-in devices could not be loaded.")}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      )}
      {!q.data && q.isPending && (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          Loading sessions…
        </p>
      )}
      {sessions.map((s, i) => (
        <div key={`${s.createdAt}-${i}`} className="bf-setting-row">
          <span className="bf-stat-icon bf-tone-info">
            <ShieldCheck size={19} />
          </span>
          <div className="min-w-0">
            <h3>
              {s.current ? "This device" : "Another device"}
              {s.current && <span className="bf-tag ml-2">current</span>}
            </h3>
            <p>
              Signed in {timeAgo(s.createdAt)} · session ends{" "}
              {new Date(s.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
          </div>
        </div>
      ))}
      {q.data && sessions.length === 1 && (
        <p className="px-1 pb-2 text-xs text-muted-foreground">
          Only this device is signed in. Sessions on other devices would appear here.
        </p>
      )}
      <ConfirmAction
        open={open}
        onOpenChange={setOpen}
        title="Sign out other devices?"
        description={`${others} other ${others === 1 ? "session" : "sessions"} will end immediately. This device stays signed in. Anyone using the Admin panel elsewhere will be returned to the sign-in page.`}
        confirmLabel="Sign out others"
        onConfirm={async () => {
          await signOut.mutateAsync();
        }}
      />
    </div>
  );
}
