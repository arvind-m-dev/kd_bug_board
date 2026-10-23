import { neonQuery, neonExecute } from './neon.server';
import { checkOrigin, requireAdmin } from './portal-access.server';

/** Admin controls whether the MCP endpoint answers and whether app connectors may sign in with OAuth. */
export type McpConfig = { enabled: boolean; oauth: boolean };
const DEFAULT: McpConfig = { enabled: true, oauth: true };

let cache: { at: number; value: McpConfig } | null = null;
export const forgetMcpConfig = () => { cache = null; };
/** Read the toggles; cached briefly so the hot MCP/OAuth paths skip a round trip. */
export async function mcpConfig(): Promise<McpConfig> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const { rows } = await neonQuery(`select value from bugflow.settings where key='mcp'`);
  const v = rows[0]?.['value'] as Partial<McpConfig> | undefined;
  const value: McpConfig = { enabled: v?.enabled !== false, oauth: v?.oauth !== false };
  cache = { at: Date.now(), value }; return value;
}
/** Admin saves the toggles; audited. Returns the saved config. */
export async function saveMcpConfig(next: McpConfig): Promise<McpConfig> {
  checkOrigin(); const admin = await requireAdmin();
  const value: McpConfig = { enabled: !!next.enabled, oauth: !!next.oauth };
  await neonExecute([
    { query: `insert into bugflow.settings(key,value) values('mcp',$1::jsonb) on conflict (key) do update set value=excluded.value`, params: [JSON.stringify(value)] },
    { query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.mcp',$3::jsonb)`, params: [crypto.randomUUID(), admin.userId, JSON.stringify(value)] },
  ]);
  forgetMcpConfig(); return value;
}
export const defaultMcpConfig = () => DEFAULT;
