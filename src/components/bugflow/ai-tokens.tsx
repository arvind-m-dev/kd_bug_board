import { useState } from "react";
import { shareOrigin } from "@/lib/share-origin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ConfirmAction, ErrorNotice, actionError } from "./action-feedback";
import { ThemedSelect } from "./themed-select";
import {
  createAiToken,
  createPortalAiToken,
  getAiTokens,
  getPortalAiTokens,
  revokeAiToken,
  revokePortalAiToken,
} from "@/lib/ai-tokens.functions";
import { getMcpConfig, saveMcpConfig } from "@/lib/mcp-config.functions";
import type { AiToken, NewAiToken } from "@/lib/ai-tokens";
import { timeAgo } from "@/lib/format";

type Scope =
  | { kind: "admin" }
  | { kind: "portal"; token: string; type: "reporter" | "qa" | "developer" | "member" };
type Member = { id: string; name: string; type: string };

/** A value with its own copy button: URLs, commands and config snippets. */
function CopyBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed — select the text and copy it by hand.");
    }
  };
  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold">{label}</span>
      <div className="bf-token-secret">
        <code className={value.includes("\n") ? "whitespace-pre" : undefined}>{value}</code>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          onClick={() => void copy()}
        >
          {copied ? <Check className="text-success" size={15} /> : <Copy size={15} />}
        </Button>
      </div>
      {hint && <small className="text-xs text-muted-foreground">{hint}</small>}
    </div>
  );
}
/** Ready-to-paste connection settings for one token (or a placeholder before one exists). */
function connectionSnippets(mcpUrl: string, secret: string) {
  const fullUrl = `${mcpUrl}?token=${secret}`;
  return {
    fullUrl,
    claudeCode: `claude mcp add --transport http bugflow ${mcpUrl} --header "Authorization: Bearer ${secret}"`,
    json: JSON.stringify(
      { mcpServers: { bugflow: { url: mcpUrl, headers: { Authorization: `Bearer ${secret}` } } } },
      null,
      2,
    ),
    desktop: JSON.stringify(
      { mcpServers: { bugflow: { command: "npx", args: ["-y", "mcp-remote", fullUrl] } } },
      null,
      2,
    ),
  };
}

/** Secret shown once after creating a token, with every way to connect already filled in. */
function TokenReveal({
  value,
  mcpUrl,
  onDone,
}: {
  value: NewAiToken;
  mcpUrl: string;
  onDone: () => void;
}) {
  const c = connectionSnippets(mcpUrl, value.secret);
  const local = /\/\/(localhost|127\.|\[::1\])/.test(mcpUrl);
  return (
    <div className="bf-token-reveal">
      <strong className="text-sm">Your new AI token{value.label ? ` (${value.label})` : ""}</strong>
      <p className="text-xs text-muted-foreground">
        Copy what your AI client needs now: the token is shown only once. Anything below that
        contains the token is a password: do not share it, and revoke the token if it leaks.
      </p>
      <CopyBlock
        label="Full connection URL (token included)"
        value={c.fullUrl}
        hint="Paste this one URL into any client that asks only for a server URL: claude.ai or ChatGPT custom connectors, Cursor, Windsurf."
      />
      <CopyBlock label="Claude Code command" value={c.claudeCode} hint="Run it in a terminal." />
      <CopyBlock
        label="Cursor / VS Code / Windsurf config (mcp.json)"
        value={c.json}
        hint="Paste into the client's MCP settings file; the token travels as a header, not in the URL."
      />
      <CopyBlock
        label="Claude Desktop config (claude_desktop_config.json)"
        value={c.desktop}
        hint="Claude Desktop → Settings → Developer → Edit config. Needs Node.js installed."
      />
      <CopyBlock label="Token only" value={value.secret} />
      {local && (
        <p className="text-xs text-warning">
          This address only works on this computer. Cloud clients such as claude.ai or ChatGPT need
          the deployed address of BugFlow instead of localhost.
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="justify-self-start"
        title="Hide the token now that you have copied it"
        onClick={onDone}
      >
        Done
      </Button>
    </div>
  );
}

/**
 * AI access tokens for the Model Context Protocol endpoint. Admin can issue a token for any panel; a member issues one for
 * their own panel. A token carries that panel's permissions and project scope, and is revocable at any time.
 */
export function AiTokens({ scope, members = [] }: { scope: Scope; members?: Member[] }) {
  const client = useQueryClient();
  const isAdmin = scope.kind === "admin";
  const origin = shareOrigin();
  const key = isAdmin ? ["ai-tokens"] : ["ai-tokens", scope.kind === "portal" ? scope.token : ""];
  const readAdmin = useServerFn(getAiTokens);
  const readPortal = useServerFn(getPortalAiTokens);
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      isAdmin
        ? readAdmin()
        : readPortal({
            data: {
              token: (scope as Extract<Scope, { kind: "portal" }>).token,
              type: (scope as Extract<Scope, { kind: "portal" }>).type,
            },
          }),
    retry: false,
    staleTime: 10000,
  });
  const makeAdmin = useServerFn(createAiToken);
  const makePortal = useServerFn(createPortalAiToken);
  const dropAdmin = useServerFn(revokeAiToken);
  const dropPortal = useServerFn(revokePortalAiToken);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("admin");
  const [fresh, setFresh] = useState<NewAiToken | null>(null);
  const [revoking, setRevoking] = useState<AiToken | null>(null);
  const [guide, setGuide] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      if (isAdmin)
        return makeAdmin({
          data: { scope: target === "admin" ? "admin" : { portalId: target }, label },
        });
      const p = scope as Extract<Scope, { kind: "portal" }>;
      return makePortal({ data: { token: p.token, type: p.type, label } });
    },
    onSuccess: async (t) => {
      setFresh(t);
      setLabel("");
      await client.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(actionError(e, "The token could not be created.")),
  });
  const mcpUrl = `${origin}/api/mcp`;
  return (
    <div className="bf-ai-tokens">
      {isAdmin && <McpControls mcpUrl={mcpUrl} />}
      <div className="bf-setting-row">
        <span className="bf-stat-icon bf-tone-info">
          <Bot size={19} />
        </span>
        <div>
          <h3>AI access (MCP)</h3>
          <p>
            Let an AI client — Claude, Cursor, VS Code, ChatGPT — read and report bugs{" "}
            {isAdmin ? "as any panel" : "for you"}. Each token carries{" "}
            {isAdmin ? "that panel's" : "your"} permissions and project scope, and can be revoked
            any time.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          title="Show the steps to connect an AI client to this workspace"
          onClick={() => setGuide((g) => !g)}
        >
          <BookOpen />
          How to connect
          <ChevronDown className={guide ? "rotate-180" : ""} />
        </Button>
      </div>
      {guide && (
        <div className="bf-media-guide">
          <CopyBlock
            label="Server URL (Streamable HTTP)"
            value={mcpUrl}
            hint="The exact address of this workspace's MCP server."
          />
          <ol>
            <li>
              <strong>Create a token</strong> below. BugFlow then shows every option already filled
              in with your token, ready to copy: a full URL, a Claude Code command and config files.
            </li>
            <li>
              <strong>Where the token goes</strong>, if you set a client up by hand: either as a
              header <code>Authorization: Bearer bf_ai_…</code>, or at the end of the URL as{" "}
              <code>{mcpUrl}?token=bf_ai_…</code>. Replace <code>bf_ai_…</code> with your whole
              token.
            </li>
            <li>
              <strong>Changing a token</strong>: create a new one, paste it where the old one was
              (the header or the <code>?token=</code> part of the URL), then revoke the old one
              below.
            </li>
            <li>
              Then ask your AI things like “list my open bugs” or “report this crash as a bug”.
            </li>
          </ol>
        </div>
      )}
      {fresh ? (
        <TokenReveal value={fresh} mcpUrl={mcpUrl} onDone={() => setFresh(null)} />
      ) : (
        <form
          className="bf-token-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {isAdmin && (
            <label className="grid gap-1 text-xs">
              <span className="font-semibold">Panel this token acts as</span>
              <ThemedSelect
                label="Panel"
                value={target}
                onChange={setTarget}
                options={[
                  { value: "admin", label: "Admin panel (full access)" },
                  ...members.map((m) => ({ value: m.id, label: `${m.name} · ${m.type} panel` })),
                ]}
              />
            </label>
          )}
          <label className="grid min-w-0 flex-1 gap-1 text-xs">
            <span className="font-semibold">Label (optional)</span>
            <Input
              value={label}
              maxLength={60}
              placeholder="e.g. Claude on my laptop"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={create.isPending}
            title="Create a new AI token for the chosen panel; the secret is shown once"
          >
            {create.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}Create token
          </Button>
        </form>
      )}
      {q.isError && (
        <ErrorNotice
          message={actionError(q.error, "Tokens could not be loaded.")}
          onRetry={() => {
            void q.refetch();
          }}
        />
      )}
      {q.data && q.data.length > 0 && (
        <ul className="bf-token-list">
          {q.data.map((t) => (
            <li key={t.id}>
              <span className="bf-stat-icon bf-tone-neutral">
                <KeyRound size={15} />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm">{t.label || "AI token"}</strong>
                <small className="block text-xs text-muted-foreground">
                  {isAdmin ? `${t.scopeLabel} · ` : ""}created {timeAgo(t.createdAt)}
                  {t.lastUsedAt ? ` · last used ${timeAgo(t.lastUsedAt)}` : " · never used"}
                </small>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                title="Revoke this token; any AI client using it loses access immediately"
                onClick={() => setRevoking(t)}
              >
                <Trash2 />
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.length === 0 && !fresh && (
        <p className="px-1 text-xs text-muted-foreground">No AI tokens yet.</p>
      )}
      <ConfirmAction
        open={revoking !== null}
        onOpenChange={(o) => {
          if (!o) setRevoking(null);
        }}
        destructive
        title={`Revoke ${revoking?.label || "this token"}?`}
        description="Any AI client using this token loses access immediately. This cannot be undone; create a new token if you need access again."
        confirmLabel="Revoke token"
        onConfirm={async () => {
          if (!revoking) return;
          try {
            if (isAdmin) await dropAdmin({ data: { id: revoking.id } });
            else {
              const p = scope as Extract<Scope, { kind: "portal" }>;
              await dropPortal({ data: { token: p.token, type: p.type, id: revoking.id } });
            }
            await client.invalidateQueries({ queryKey: key });
            toast.success("Token revoked");
            setRevoking(null);
          } catch (e) {
            toast.error(actionError(e, "The token could not be revoked."));
          }
        }}
      />
    </div>
  );
}

/** Admin toggles: turn the whole MCP endpoint on/off, and app-connector (OAuth) sign-in on/off, plus the endpoint URL to copy. */
function McpControls({ mcpUrl }: { mcpUrl: string }) {
  const client = useQueryClient();
  const read = useServerFn(getMcpConfig);
  const save = useServerFn(saveMcpConfig);
  const q = useQuery({
    queryKey: ["mcp-config"],
    queryFn: () => read(),
    retry: false,
    staleTime: 30000,
  });
  const [copied, setCopied] = useState(false);
  const m = useMutation({
    mutationFn: (next: { enabled: boolean; oauth: boolean }) => save({ data: next }),
    onSuccess: (c) => {
      client.setQueryData(["mcp-config"], c);
    },
    onError: (e) => toast.error(actionError(e, "The setting could not be saved.")),
  });
  const cfg = q.data ?? { enabled: true, oauth: true };
  const set = (patch: Partial<{ enabled: boolean; oauth: boolean }>) =>
    m.mutate({ ...cfg, ...patch });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      toast.success("Endpoint copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed.");
    }
  };
  return (
    <div className="bf-mcp-controls">
      <div className="bf-mcp-endpoint">
        <span className="text-xs text-muted-foreground">Connect AI clients to</span>
        <code>{mcpUrl}</code>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          aria-label="Copy endpoint"
          title="Copy the MCP endpoint URL to paste into an AI client"
          onClick={() => void copy()}
        >
          {copied ? <Check className="text-success" size={15} /> : <Copy size={15} />}
        </Button>
      </div>
      <label className="bf-switch-row">
        <span className="text-sm">
          AI access (MCP) is on
          <small className="block text-xs text-muted-foreground">
            Off: no AI client can read or report bugs, and every token stops working.
          </small>
        </span>
        <Switch
          checked={cfg.enabled}
          disabled={m.isPending}
          onCheckedChange={(v) => set({ enabled: v })}
          aria-label="AI access on"
          title="Turn the whole MCP endpoint on or off. Off: no AI client works and every token stops."
        />
      </label>
      <label className="bf-switch-row" data-disabled={!cfg.enabled || undefined}>
        <span className="text-sm">
          App connectors (OAuth)
          <small className="block text-xs text-muted-foreground">
            On: claude.ai and ChatGPT can connect by signing in, no pasted token. Off: paste a token
            instead.
          </small>
        </span>
        <Switch
          checked={cfg.oauth}
          disabled={m.isPending || !cfg.enabled}
          onCheckedChange={(v) => set({ oauth: v })}
          aria-label="App connectors on"
          title="Let claude.ai and ChatGPT connect by signing in (OAuth). Off: paste a token instead."
        />
      </label>
    </div>
  );
}
