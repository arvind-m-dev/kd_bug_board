// Apply one SQL migration file to DATABASE_URL in a single transaction.
//   npm run db:migrate -- database/011_presence.sql
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { neonExecute } from '../src/lib/neon.server';

const file = process.argv[2];
if (!file) { console.error('Usage: db:migrate <file.sql>'); process.exit(1); }
const sql = readFileSync(resolve(file), 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const statements = sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
await neonExecute(statements.map(query => ({ query })));
console.log(`Applied ${file}: ${statements.length} statement(s).`);
