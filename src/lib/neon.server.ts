type Statement = { query: string; params?: unknown[] };
type NeonResult = { rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[]; rowCount: number | null; command: string };
type NeonBatchResult = { results: NeonResult[] };
type NeonResponse = { status: number; retryAfter: string | null; text: string; json: any; elapsedMs: number };
type NeonErrorKind = 'unreachable' | 'stale_connection' | 'endpoint_blocked' | 'maybe_committed' | 'too_large' | 'rate_limited' | 'unavailable' | 'input' | 'statement' | 'rejected';
type NeonError = Error & { status: number; code?: string; body: string; kind: NeonErrorKind };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toBody = (q: string | Statement[], params: unknown[]) => typeof q === 'string' ? { query: q, params } : { queries: q };
// Direct Neon connection via DATABASE_URL, normalized to a status/json response so errors classify uniformly.
async function directFetch(url: string, body: { query?: string; params?: unknown[]; queries?: Statement[] }, headers: Record<string, string>): Promise<NeonResponse> {
  const started = Date.now();
  try {
    const { neon, neonConfig } = await import('@neondatabase/serverless');
    if (process.env['DATABASE_DOH'] === '1' && !neonConfig.fetchFunction) neonConfig.fetchFunction = (await import('./dev-dns.server')).dohFetch;
    const sql = neon(url, { fullResults: true });
    const result = body.queries
      ? { results: await sql.transaction(body.queries.map((s) => sql.query(s.query, s.params ?? [])), { readOnly: headers['Neon-Batch-Read-Only'] === 'true' }) }
      : await sql.query(body.query!, body.params ?? []);
    const json = JSON.parse(JSON.stringify(result));
    return { status: 200, retryAfter: null, text: '', json, elapsedMs: Date.now() - started };
  } catch (err: any) {
    // DNS/connection failures happen before anything is sent, so nothing can have been saved.
    const cause = err?.sourceError?.cause?.code ?? err?.cause?.code;
    if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(cause)) return { status: 0, retryAfter: null, text: '', json: { message: `Cannot reach database host (${cause})`, unreachable: true }, elapsedMs: Date.now() - started };
    const json = { message: String(err?.message ?? err), code: err?.code };
    return { status: err?.code ? 400 : 0, retryAfter: null, text: json.message, json, elapsedMs: Date.now() - started };
  }
}
async function neonFetch(body: unknown, headers: Record<string, string>): Promise<NeonResponse> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Missing DATABASE_URL');
  return directFetch(url, body as Parameters<typeof directFetch>[1], headers);
}
const isStale = (json: any) => json?.code === '28P01' || json?.code === '28000' || /^(password authentication failed|Control plane request failed: endpoint cannot be found)/.test(json?.message ?? '');
const isEndpointBlocked = (json: any) => /^(The endpoint has been disabled|Control plane request failed: endpoint is)/.test(json?.message ?? '');
function neonFailure(r: NeonResponse, write: boolean): NeonError {
  const { status, json, elapsedMs } = r; let hint: string; let kind: NeonErrorKind;
  if (json?.unreachable) { kind = 'unreachable'; hint = 'the database host could not be reached (DNS or network); nothing was sent'; }
  else if (isStale(json)) { kind = 'stale_connection'; hint = 'the stored connection string no longer works: stop retrying; replace DATABASE_URL with a current Neon connection string'; }
  else if (isEndpointBlocked(json)) { kind = 'endpoint_blocked'; hint = 'Neon is not serving this endpoint (disabled, or a quota or billing limit): log Neon\'s message; never retry unchanged'; }
  else if (status === 413) { kind = 'too_large'; hint = 'request too large: split bulk writes into several `queries` batches; never retry unchanged'; }
  else if (status === 507) { kind = 'too_large'; hint = 'result too large: add LIMIT and paginate; never retry unchanged'; }
  else if (status === 429) { kind = 'rate_limited'; hint = 'rate limited: batch with `queries`, cache, re-run after Retry-After'; }
  else if (status === 0 || status === 502) {
    const slow = /^(TimeoutError|AbortError)/.test(json?.message ?? '') || elapsedMs >= 25_000;
    kind = write ? 'maybe_committed' : slow ? 'statement' : 'unavailable';
    hint = slow ? 'too slow: add an index, LIMIT, paginate, or move the work into Neon; never retry unchanged' : 'could not reach Neon, or the network failed: see status.neon.tech and retry later';
    if (write) hint = `the statement may have committed: check the row before re-running; ${hint}`;
  } else if (json?.code === '42P01') { kind = 'statement'; hint = 'table renamed or removed: stop'; }
  else if (/^2[23]/.test(json?.code ?? '')) { kind = 'input'; hint = 'the values break a constraint or a type (unique, foreign key, check, cast): validate the input; never retry unchanged'; }
  else if (/^Control plane request failed/.test(json?.message ?? '')) { kind = 'unavailable'; hint = 'Neon control-plane outage, not the statement and not the string: see status.neon.tech and retry later (reads only)'; }
  else if (status === 400) { kind = 'statement'; hint = 'fix the statement; never retry unchanged'; }
  else if (status >= 500) { kind = 'unavailable'; hint = 'Neon error (a bare "Control plane request failed" is a Neon control-plane outage; a persistent 500 can be plan-quota exhaustion): log it'; }
  else { kind = 'rejected'; hint = 'request rejected, not retryable'; }
  const code = json?.code || json?.type;
  return Object.assign(new Error(`Neon ${status}${code ? ` ${code}` : ''}: ${json?.message ?? r.text.slice(0, 300)} (${hint})`), { status, code, body: r.text, kind });
}
export function neonUserError(err: unknown): { status: number; message: string } {
  switch ((err as Partial<NeonError>)?.kind) {
    case 'unreachable': return { status: 503, message: 'Cannot reach the database from this network. Nothing was saved — check your internet or DNS settings and try again.' };
    case 'stale_connection': return { status: 503, message: 'The database connection configured for this app no longer works. The app owner has to update DATABASE_URL.' };
    case 'endpoint_blocked': return { status: 503, message: 'The database behind this app is not available right now. The app owner should check its endpoint and plan in Neon.' };
    case 'maybe_committed': return { status: 503, message: 'The change may have been saved. Refresh to check before trying again.' };
    case 'too_large': return { status: 413, message: 'This request or its result is too large for one call. Narrow it and try again.' };
    case 'rate_limited': return { status: 429, message: 'The database is busy. Try again in a moment.' };
    case 'unavailable': return { status: 503, message: 'The database is temporarily unavailable. Try again in a moment.' };
    case 'input': return { status: 400, message: 'The database rejected these values. Check the input and try again.' };
    default: return { status: 500, message: 'The database request could not be completed.' };
  }
}
export async function neonQuery<T = NeonResult>(query: string | Statement[], params: unknown[] = [], headers: Record<string, string> = {}): Promise<T> {
  const deadline = Date.now() + 30_000; const left = () => Math.max(0, deadline - Date.now()); let retried429 = false;
  for (let attempt = 1; ; attempt++) {
    const r = await neonFetch(toBody(query, params), headers);
    if (r.status >= 200 && r.status < 300) return r.json as T;
    if (isStale(r.json) || isEndpointBlocked(r.json)) throw neonFailure(r, false);
    if (r.status === 429 && !retried429) { retried429 = true; const seconds = Math.min(Math.max(Number(r.retryAfter) || 1, 1), 15); await sleep(Math.min(seconds * 1000, left())); continue; }
    const backoff = 500 * 2 ** (attempt - 1);
    if ((r.status === 0 || r.status === 500 || r.status === 503) && attempt < 3 && backoff < left()) { await sleep(backoff); continue; }
    throw neonFailure(r, false);
  }
}
export async function neonExecute<T = NeonResult>(query: string | Statement[], params: unknown[] = [], headers: Record<string, string> = {}): Promise<T> {
  const r = await neonFetch(toBody(query, params), headers);
  if (r.status >= 200 && r.status < 300) return r.json as T;
  throw neonFailure(r, true);
}