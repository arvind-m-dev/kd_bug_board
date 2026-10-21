import { neonQuery, neonExecute } from './neon.server';
import { requireAdmin, checkOrigin } from './portal-access.server';
import { DEFAULT_PALETTE, paletteById } from './appearance';

/** The workspace palette. Not sensitive, so portals can read it too. */
export async function readAppearance() {
  const { rows } = await neonQuery(`select value from bugflow.settings where key='appearance'`);
  const v = rows[0]?.['value'] as { palette?: string } | undefined;
  return { palette: paletteById(v?.palette ?? DEFAULT_PALETTE).id };
}

export async function writeAppearance(palette: string) {
  checkOrigin(); const admin = await requireAdmin();
  await neonExecute([
    { query: `insert into bugflow.settings(key,value) values('appearance',$1::jsonb) on conflict (key) do update set value=excluded.value`, params: [JSON.stringify({ palette })] },
    { query: `insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'settings.appearance',$3::jsonb)`, params: [crypto.randomUUID(), admin.userId, JSON.stringify({ palette, name: paletteById(palette).name })] },
  ]);
  return { palette };
}
