import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSearch } from "@tanstack/react-router";
import { CircleCheck, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import {
  checkJiraConnectionFn,
  disconnectJiraFn,
  getJiraStatus,
  pauseJiraFn,
  resumeJiraFn,
  selectJiraSiteFn,
  startJiraConnectFn,
} from "@/lib/jira/jira.functions";
import { JIRA_CALLBACK_OUTCOMES, isCallbackOutcome } from "@/lib/jira/oauth";
import { JIRA_STATE_LABEL, type JiraConnectionState, type JiraStatus } from "@/lib/jira/types";
import { actionError, ConfirmAction, ErrorNotice } from "./action-feedback";
import { JiraHealth, JiraPeople, JiraProjects } from "./jira-sync";

const TONE: Record<JiraConnectionState, string> = {
  connected: "text-success",
  paused: "text-warning",
  pending_site: "text-warning",
  reauthorization_required: "text-destructive",
  error: "text-destructive",
  revoked: "",
};
const MISSING: Record<string, string> = {
  JIRA_CLIENT_ID: "the Atlassian app's client ID",
  JIRA_CLIENT_SECRET: "the Atlassian app's client secret",
  JIRA_TOKEN_ENCRYPTION_KEY: "a 64-character hex key for encrypting Jira tokens",
  JIRA_PUBLIC_ORIGIN: "this app's public https address",
};

/**
 * Settings → Jira: the Atlassian connection (connect, verify, pause, reconnect, disconnect) and, once connected,
 * the project mappings, the people links and the state of the running sync (jira-sync.tsx). Connecting does not
 * synchronize anything by itself.
 */
export function JiraSettings() {
  const client = useQueryClient();
  const read = useServerFn(getJiraStatus);
  const start = useServerFn(startJiraConnectFn);
  const check = useServerFn(checkJiraConnectionFn);
  const selectSite = useServerFn(selectJiraSiteFn);
  const pause = useServerFn(pauseJiraFn);
  const resume = useServerFn(resumeJiraFn);
  const disconnect = useServerFn(disconnectJiraFn);
  const search = useSearch({ strict: false }) as { jira?: unknown };
  const outcome = isCallbackOutcome(search.jira) ? search.jira : null;
  const q = useQuery({
    queryKey: ["jira-status"],
    queryFn: () => read(),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"" | "pause" | "disconnect">("");
  const apply = (next: JiraStatus) => client.setQueryData(["jira-status"], next);
  async function run(kind: string, work: () => Promise<JiraStatus | void>) {
    if (busy) return;
    setBusy(kind);
    setError("");
    try {
      const next = await work();
      if (next) apply(next);
    } catch (cause) {
      setError(actionError(cause, "That did not work. Please try again."));
    } finally {
      setBusy("");
    }
  }
  const connect = () =>
    run("connect", async () => {
      const { url } = await start();
      window.location.assign(url);
    });

  const s = q.data;
  const c = s?.available ? s.connection : null;
  const elsewhere =
    s?.available && typeof window !== "undefined" && window.location.origin !== s.origin
      ? s.origin
      : null;
  const usable = c && (c.state === "connected" || c.state === "paused");
  return (
    <>
      <div className="bf-panel">
        <div className="bf-panel-heading">
          <h2 className="flex items-center gap-2">
            <Link2 size={18} />
            Jira connection
            {c && (
              <span className={`bf-tag ${TONE[c.state]}`} role="status">
                {JIRA_STATE_LABEL[c.state]}
              </span>
            )}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            <RefreshCw className={q.isFetching ? "animate-spin" : undefined} />
            {q.isFetching ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {q.isError && (
          <ErrorNotice
            message={actionError(q.error, "The Jira connection could not be read.")}
            onRetry={() => void q.refetch()}
            retrying={q.isFetching}
          />
        )}
        {outcome && outcome !== "connected" && outcome !== "choose_site" && (
          <ErrorNotice message={JIRA_CALLBACK_OUTCOMES[outcome]} />
        )}
        {error && <ErrorNotice message={error} />}
        {!s && q.isPending && (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">
            Reading the connection…
          </p>
        )}

        {s && !s.available && (
          <div className="bf-setting-row">
            <span className="bf-stat-icon bf-tone-info">
              <Link2 size={19} />
            </span>
            <div className="min-w-0">
              <h3>Unavailable</h3>
              {s.reason === "database_not_ready" ? (
                <p>
                  The database is not prepared for Jira yet: migration{" "}
                  <code>027_jira_sync.sql</code> has not been applied to this database.
                </p>
              ) : (
                <>
                  <p>Jira cannot be connected until the server has:</p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {s.missing.map((m) => (
                      <li key={m}>
                        <code>{m}</code> — {MISSING[m] ?? "required"}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <span className="bf-tag">Unavailable</span>
          </div>
        )}

        {s?.available && !c && (
          <div className="bf-setting-row">
            <span className="bf-stat-icon bf-tone-info">
              <Link2 size={19} />
            </span>
            <div className="min-w-0">
              <h3>Not connected</h3>
              <p>
                Sign in to Atlassian to let Bug Board reach one Jira Cloud site. Connecting does not
                copy any bug: syncing starts only after a project is mapped and switched on.
              </p>
              {s.allowedSite && (
                <p className="text-xs text-muted-foreground">
                  Only this site may be connected: <strong>{s.allowedSite}</strong>
                </p>
              )}
              {elsewhere && (
                <p className="text-xs">
                  Open Bug Board at <strong>{elsewhere}</strong> to connect. Atlassian returns there
                  after sign-in.
                </p>
              )}
            </div>
            <Button type="button" disabled={!!busy || !!elsewhere} onClick={connect}>
              {busy === "connect" ? "Opening Atlassian…" : "Connect Jira"}
            </Button>
          </div>
        )}

        {c?.state === "pending_site" && (
          <div className="bf-setting-row">
            <span className="bf-stat-icon bf-tone-warning">
              <Link2 size={19} />
            </span>
            <div className="min-w-0">
              <h3>Choose the Jira site</h3>
              <p>
                This Atlassian account gave access to more than one site. Pick the one to connect.
              </p>
              {c.pendingSites.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  The list of sites is unavailable right now. Refresh, or disconnect and sign in
                  again.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {c.pendingSites.map((site) => (
                  <Button
                    key={site.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void run("site", () => selectSite({ data: { cloudId: site.id } }))
                    }
                  >
                    {site.name} · {site.url.replace(/^https?:\/\//, "")}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!!busy}
              onClick={() => setConfirm("disconnect")}
            >
              Cancel sign-in
            </Button>
          </div>
        )}

        {c && c.state !== "pending_site" && (
          <>
            <div className="bf-setting-row">
              <span
                className={`bf-stat-icon ${c.state === "connected" ? "bf-tone-success" : "bf-tone-warning"}`}
              >
                {c.state === "connected" ? <CircleCheck size={19} /> : <Link2 size={19} />}
              </span>
              <div className="min-w-0">
                <h3>{c.siteName ?? "Jira site"}</h3>
                <p className="break-all">{c.siteUrl ?? "Site address unavailable"}</p>
                <p className="text-xs text-muted-foreground">
                  Authorized by <strong className="font-medium">{c.account ?? "unknown"}</strong>
                  {" · "}
                  {c.lastVerifiedAt
                    ? `last read from Jira ${timeAgo(c.lastVerifiedAt)}`
                    : "not yet verified by a read from Jira"}
                </p>
                {c.lastError && <p className="text-xs text-destructive">{c.lastError}</p>}
                {c.state === "paused" && (
                  <p className="text-xs">Paused: nothing is sent to or applied from Jira.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Connecting alone synchronizes nothing: a project is kept in step once it is mapped
                  and switched on below.
                </p>
              </div>
              <span className={`bf-tag ${TONE[c.state]}`}>{JIRA_STATE_LABEL[c.state]}</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => void run("check", () => check())}
              >
                {busy === "check" ? "Checking…" : "Check connection"}
              </Button>
              {c.state === "connected" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => setConfirm("pause")}
                >
                  Pause
                </Button>
              )}
              {c.state === "paused" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void run("resume", () => resume())}
                >
                  {busy === "resume" ? "Resuming…" : "Resume"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!busy || !!elsewhere}
                onClick={connect}
              >
                {busy === "connect" ? "Opening Atlassian…" : "Sign in again"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={!!busy}
                onClick={() => setConfirm("disconnect")}
              >
                Disconnect
              </Button>
            </div>
          </>
        )}

        <ConfirmAction
          open={confirm === "pause"}
          onOpenChange={(open) => setConfirm(open ? "pause" : "")}
          title="Pause Jira?"
          description="Nothing will be sent to Jira or applied from Jira until you resume. The connection and all records stay as they are."
          confirmLabel="Pause"
          onConfirm={async () => {
            apply(await pause());
          }}
        />
        <ConfirmAction
          open={confirm === "disconnect"}
          onOpenChange={(open) => setConfirm(open ? "disconnect" : "")}
          title="Disconnect Jira?"
          description="The saved Atlassian sign-in is erased and every project mapping stops. No bug is deleted in Bug Board or in Jira. To remove the app's access on the Atlassian side too, open your Atlassian account → Connected apps."
          confirmLabel="Disconnect"
          destructive
          onConfirm={async () => {
            apply(await disconnect());
          }}
        />
      </div>
      {usable && (
        <>
          <JiraProjects canEdit={c.state === "connected"} />
          <JiraPeople canSearch={c.state === "connected"} />
          <JiraHealth />
        </>
      )}
    </>
  );
}
