import { neonQuery, neonExecute } from './neon.server';
import { requireAdmin, checkOrigin } from './portal-access.server';
import { normalizeAppearance, paletteById, styleById, type Appearance } from './appearance';

/** The workspace appearance. Not sensitive, so portals can read it too. */
export async function readAppearance(): Promise<Appearance> {
  const { rows } = await neonQuery(`select value from bugflow.settings where key='appearance'`);
  return normalizeAppearance(rows[0]?.['value']);
}

/** Saves the workspace theme. With forAllPortals, every member's personal theme is cleared too, so everyone sees this one. */
export async function writeAppearance(appearance: Appearance, forAllPortals = false) {
  checkOrigin(); const admin = await requireAdmin();
  const name = appearance.palette === 'custom' ? `Custom ${appearance.accent ?? ''}`.trim() : paletteById(appearance.palette).name;
  const { results } = await neonExecute<{ results: { rows: Record<string, unknown>[] }[] }>([
    { query: `insert into bugflow.settings(key,value) values('appearance',$1::jsonb) on conflict (key) do update set value=excluded.value`, params: [JSON.stringify(appearance)] },
    { query: forAllPortals ? `update bugflow.portals set appearance=null where appearance is not null returning id` : `select null where false`, params: [] },
    { query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.appearance',$3::jsonb)`, params: [crypto.randomUUID(), admin.userId, JSON.stringify({ scope: forAllPortals ? 'all portals' : 'workspace', palette: appearance.palette, name, style: styleById(appearance.style).name, fonts: appearance.fonts, motion: appearance.motion, hidden: appearance.hide.length })] },
  ]);
  return { appearance, portalsReset: forAllPortals ? (results[1]?.rows.length ?? 0) : 0 };
}
