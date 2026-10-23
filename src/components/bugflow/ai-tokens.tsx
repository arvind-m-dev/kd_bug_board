import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { BookOpen, Bot, Check, ChevronDown, Copy, KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ConfirmAction, ErrorNotice, actionError } from './action-feedback';
import { ThemedSelect } from './themed-select';
import { createAiToken, createPortalAiToken, getAiTokens, getPortalAiTokens, revokeAiToken, revokePortalAiToken } from '@/lib/ai-tokens.functions';
import { getMcpConfig, saveMcpConfig } from '@/lib/mcp-config.functions';
import type { AiToken, NewAiToken } from '@/lib/ai-tokens';
import { timeAgo } from '@/lib/format';

type Scope = { kind: 'admin' } | { kind: 'portal'; token: string; type: 'reporter' | 'qa' | 'developer' | 'member' };
type Member = { id: string; name: string; type: string };

/** Secret shown once after creating a token: copy it, then it is gone. */
function TokenReveal({ value, onDone }: { value: NewAiToken; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value.secret); setCopied(true); toast.success('Token copied'); } catch { toast.error('Copy failed — select the token and copy it by hand.'); } };
  return <div className="bf-token-reveal">
    <strong className="text-sm">Your new AI token{value.label ? ` (${value.label})` : ''}</strong>
    <p className="text-xs text-muted-foreground">Copy it now — it is shown only once. Paste it into your AI client as the Bearer token or MCP token.</p>
    <div className="bf-token-secret"><code>{value.secret}</code><Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label="Copy token" onClick={() => void copy()}>{copied ? <Check className="text-success" size={15} /> : <Copy size={15} />}</Button></div>
    <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={onDone}>Done</Button>
  </div>;
}

/**
 * AI access tokens for the Model Context Protocol endpoint. Admin can issue a token for any panel; a member issues one for
 * their own panel. A token carries that panel's permissions and project scope, and is revocable at any time.
 */
export function AiTokens({ scope, members = [] }: { scope: Scope; members?: Member[] }) {
  const client = useQueryClient();
  const isAdmin = scope.kind === 'admin';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const key = isAdmin ? ['ai-tokens'] : ['ai-tokens', scope.kind === 'portal' ? scope.token : ''];
  const readAdmin = useServerFn(getAiTokens); const readPortal = useServerFn(getPortalAiTokens);
  const q = useQuery({ queryKey: key, queryFn: () => isAdmin ? readAdmin() : readPortal({ data: { token: (scope as Extract<Scope, { kind: 'portal' }>).token, type: (scope as Extract<Scope, { kind: 'portal' }>).type } }), retry: false, staleTime: 10000 });
  const makeAdmin = useServerFn(createAiToken); const makePortal = useServerFn(createPortalAiToken);
  const dropAdmin = useServerFn(revokeAiToken); const dropPortal = useServerFn(revokePortalAiToken);
  const [label, setLabel] = useState(''); const [target, setTarget] = useState('admin'); const [fresh, setFresh] = useState<NewAiToken | null>(null);
  const [revoking, setRevoking] = useState<AiToken | null>(null); const [guide, setGuide] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      if (isAdmin) return makeAdmin({ data: { scope: target === 'admin' ? 'admin' : { portalId: target }, label } });
      const p = scope as Extract<Scope, { kind: 'portal' }>; return makePortal({ data: { token: p.token, type: p.type, label } });
    },
    onSuccess: async t => { setFresh(t); setLabel(''); await client.invalidateQueries({ queryKey: key }); },
    onError: e => toast.error(actionError(e, 'The token could not be created.')),
  });
  const mcpUrl = `${origin}/api/mcp`;
  return <div className="bf-ai-tokens">
    {isAdmin && <McpControls mcpUrl={mcpUrl} />}
    <div className="bf-setting-row"><span className="bf-stat-icon bf-tone-info"><Bot size={19} /></span><div><h3>AI access (MCP)</h3>
      <p>Let an AI client — Claude, Cursor, VS Code, ChatGPT — read and report bugs {isAdmin ? 'as any panel' : 'for you'}. Each token carries {isAdmin ? "that panel's" : 'your'} permissions and project scope, and can be revoked any time.</p></div>
      <Button type="button" size="sm" variant="ghost" onClick={() => setGuide(g => !g)}><BookOpen />How to connect<ChevronDown className={guide ? 'rotate-180' : ''} /></Button></div>
    {guide && <div className="bf-media-guide"><ol>
      <li><strong>Endpoint</strong>: <code>{mcpUrl}</code> (Streamable HTTP).</li>
      <li><strong>Create a token</strong> below and copy it.</li>
      <li><strong>Claude Code</strong>: <code>claude mcp add --transport http bugflow {mcpUrl} --header "Authorization: Bearer &lt;token&gt;"</code></li>
      <li><strong>Cursor / VS Code / others</strong>: add an MCP server of type HTTP with that URL and an <code>Authorization: Bearer &lt;token&gt;</code> header.</li>
      <li>Then ask your AI things like “list my open bugs” or “report this crash as a bug”.</li>
    </ol></div>}
    {fresh ? <TokenReveal value={fresh} onDone={() => setFresh(null)} /> : <form className="bf-token-form" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
      {isAdmin && <label className="grid gap-1 text-xs"><span className="font-semibold">Panel this token acts as</span>
        <ThemedSelect label="Panel" value={target} onChange={setTarget} options={[{ value: 'admin', label: 'Admin panel (full access)' }, ...members.map(m => ({ value: m.id, label: `${m.name} · ${m.type} panel` }))]} /></label>}
      <label className="grid min-w-0 flex-1 gap-1 text-xs"><span className="font-semibold">Label (optional)</span><Input value={label} maxLength={60} placeholder="e.g. Claude on my laptop" onChange={e => setLabel(e.target.value)} /></label>
      <Button type="submit" size="sm" disabled={create.isPending}>{create.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}Create token</Button>
    </form>}
    {q.isError && <ErrorNotice message={actionError(q.error, 'Tokens could not be loaded.')} onRetry={() => { void q.refetch(); }} />}
    {q.data && q.data.length > 0 && <ul className="bf-token-list">{q.data.map(t => <li key={t.id}>
      <span className="bf-stat-icon bf-tone-neutral"><KeyRound size={15} /></span>
      <span className="min-w-0"><strong className="block truncate text-sm">{t.label || 'AI token'}</strong><small className="block text-xs text-muted-foreground">{isAdmin ? `${t.scopeLabel} · ` : ''}created {timeAgo(t.createdAt)}{t.lastUsedAt ? ` · last used ${timeAgo(t.lastUsedAt)}` : ' · never used'}</small></span>
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(t)}><Trash2 />Revoke</Button>
    </li>)}</ul>}
    {q.data && q.data.length === 0 && !fresh && <p className="px-1 text-xs text-muted-foreground">No AI tokens yet.</p>}
    <ConfirmAction open={revoking !== null} onOpenChange={o => { if (!o) setRevoking(null); }} destructive title={`Revoke ${revoking?.label || 'this token'}?`} description="Any AI client using this token loses access immediately. This cannot be undone; create a new token if you need access again." confirmLabel="Revoke token"
      onConfirm={async () => { if (!revoking) return; try { if (isAdmin) await dropAdmin({ data: { id: revoking.id } }); else { const p = scope as Extract<Scope, { kind: 'portal' }>; await dropPortal({ data: { token: p.token, type: p.type, id: revoking.id } }); } await client.invalidateQueries({ queryKey: key }); toast.success('Token revoked'); setRevoking(null); } catch (e) { toast.error(actionError(e, 'The token could not be revoked.')); } }} />
  </div>;
}

/** Admin toggles: turn the whole MCP endpoint on/off, and app-connector (OAuth) sign-in on/off, plus the endpoint URL to copy. */
function McpControls({ mcpUrl }: { mcpUrl: string }) {
  const client = useQueryClient();
  const read = useServerFn(getMcpConfig); const save = useServerFn(saveMcpConfig);
  const q = useQuery({ queryKey: ['mcp-config'], queryFn: () => read(), retry: false, staleTime: 30000 });
  const [copied, setCopied] = useState(false);
  const m = useMutation({ mutationFn: (next: { enabled: boolean; oauth: boolean }) => save({ data: next }), onSuccess: c => { client.setQueryData(['mcp-config'], c); }, onError: e => toast.error(actionError(e, 'The setting could not be saved.')) });
  const cfg = q.data ?? { enabled: true, oauth: true };
  const set = (patch: Partial<{ enabled: boolean; oauth: boolean }>) => m.mutate({ ...cfg, ...patch });
  const copy = async () => { try { await navigator.clipboard.writeText(mcpUrl); setCopied(true); toast.success('Endpoint copied'); window.setTimeout(() => setCopied(false), 1500); } catch { toast.error('Copy failed.'); } };
  return <div className="bf-mcp-controls">
    <div className="bf-mcp-endpoint"><span className="text-xs text-muted-foreground">Connect AI clients to</span><code>{mcpUrl}</code><Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label="Copy endpoint" onClick={() => void copy()}>{copied ? <Check className="text-success" size={15} /> : <Copy size={15} />}</Button></div>
    <label className="bf-switch-row"><span className="text-sm">AI access (MCP) is on<small className="block text-xs text-muted-foreground">Off: no AI client can read or report bugs, and every token stops working.</small></span><Switch checked={cfg.enabled} disabled={m.isPending} onCheckedChange={v => set({ enabled: v })} aria-label="AI access on" /></label>
    <label className="bf-switch-row" data-disabled={!cfg.enabled || undefined}><span className="text-sm">App connectors (OAuth)<small className="block text-xs text-muted-foreground">On: claude.ai and ChatGPT can connect by signing in, no pasted token. Off: paste a token instead.</small></span><Switch checked={cfg.oauth} disabled={m.isPending || !cfg.enabled} onCheckedChange={v => set({ oauth: v })} aria-label="App connectors on" /></label>
  </div>;
}
