// Apply or remove demo data in ONE transaction against DATABASE_URL.
//   npm run demo:seed    → removes existing demo data, then inserts fresh demo data
//   npm run demo:remove  → removes demo data only
import { readFileSync } from 'node:fs';
import { neonExecute, neonQuery } from '../../src/lib/neon.server';

/** Split a SQL file into statements: one per line, except a DO $$ … END $$; block which is one statement. */
function statements(file: string) {
  const out: string[] = []; let block: string[] | null = null;
  for (const line of readFileSync(new URL(file, import.meta.url), 'utf8').split('\n')) {
    if (block) { block.push(line); if (line.trim() === 'END $$;') { out.push(block.join('\n').replace(/;\s*$/, '')); block = null; } continue; }
    if (!line.trim() || line.startsWith('--')) continue;
    if (line.startsWith('DO $$')) { block = [line]; continue; }
    out.push(line.replace(/;\s*$/, ''));
  }
  return out;
}

const mode = process.argv[2];
if (mode !== 'seed' && mode !== 'remove' && mode !== 'check') { console.error('Usage: apply.ts seed|remove|check'); process.exit(1); }
const queries = [...statements('./remove.sql'), ...(mode !== 'remove' ? statements('./seed.sql') : [])].map(query => ({ query }));
if (mode === 'check') {
  // Dry run: run everything, then fail on purpose so the transaction rolls back and nothing is saved.
  try { await neonExecute([...queries, { query: "select 1/0 as dry_run_rollback" }]); }
  catch (e) { const m = String((e as Error).message); console.log(/division by zero/.test(m) ? `Dry run OK: ${queries.length} statements succeeded, then rolled back.` : `Dry run FAILED: ${m}`); }
  process.exit(0);
}
await neonExecute(queries);
const { rows } = await neonQuery<{ rows: Record<string, unknown>[] }>(`select (select count(*) from bugflow.users where email like '%@demo.bugboard.test')::int as people,
  (select count(*) from bugflow.bugs where project_id='de300000-0000-4000-8000-000000000001')::int as bugs,
  (select count(*) from bugflow.bugs where project_id<>'de300000-0000-4000-8000-000000000001' or project_id is null)::int as real_bugs`);
console.log(mode === 'seed' ? 'Demo data seeded:' : 'Demo data removed:', rows[0]);
