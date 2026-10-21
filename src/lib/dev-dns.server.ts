// Local development only (DATABASE_DOH=1): resolve the database host through Cloudflare
// DNS-over-HTTPS for networks whose DNS refuses to resolve Neon hostnames.
import https from 'node:https';
import type { LookupFunction } from 'node:net';

const cache = new Map<string, { addresses: string[]; expires: number }>();
// Reuse warm TLS connections: opening a new one costs several round trips to the database region.
const agent = new https.Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 30_000 });

async function resolve(hostname: string): Promise<string[]> {
  const hit = cache.get(hostname);
  if (hit && hit.expires > Date.now()) return hit.addresses;
  // 1.1.1.1 is addressed by IP, so this lookup needs no DNS itself.
  const res = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`, { headers: { accept: 'application/dns-json' } });
  const json = (await res.json()) as { Answer?: { type: number; data: string; TTL: number }[] };
  const answers = (json.Answer ?? []).filter((a) => a.type === 1);
  if (!answers.length) throw Object.assign(new Error(`DNS-over-HTTPS found no address for ${hostname}`), { code: 'ENOTFOUND' });
  const addresses = answers.map((a) => a.data);
  cache.set(hostname, { addresses, expires: Date.now() + Math.min(...answers.map((a) => a.TTL)) * 1000 });
  return addresses;
}

const lookup: LookupFunction = (hostname, options, callback) => {
  resolve(hostname).then(
    (addresses) => {
      if (options.all) callback(null, addresses.map((address) => ({ address, family: 4 })));
      else callback(null, addresses[0]!, 4);
    },
    (error: NodeJS.ErrnoException) => callback(error, '', 4),
  );
};

/** Minimal fetch for the Neon HTTP driver that uses the DNS-over-HTTPS lookup above. */
export async function dohFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : undefined;
  return new Promise((resolveResponse, reject) => {
    const req = https.request(url, { agent, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers).entries()), lookup, signal: init.signal ?? undefined }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        resolveResponse(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500, headers }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
