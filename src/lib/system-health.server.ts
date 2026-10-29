import { getRequest } from "@tanstack/react-start/server";
import { neonQuery } from "./neon.server";
import { requireAdmin } from "./portal-access.server";
import { decryptPortal } from "./portal-crypto.server";
import { formatBytes } from "./bug-media";
import {
  overallState,
  usageLevel,
  worse,
  type HealthCheck,
  type StorageAlarm,
  type SystemHealth,
  type UsageMeter,
} from "./system-health";

/** The newest column or table each migration adds; the highest one present is the schema version in use. */
const MIGRATIONS: [string, string, string | null][] = [
  ["011", "portals", "online_until"],
  ["012", "bug_media", null],
  ["013", "portals", "appearance"],
  ["014", "bug_media", "derived_from"],
  ["015", "bugs", "purged_at"],
  ["016", "ai_tokens", null],
  ["017", "oauth_codes", null],
  ["018", "bug_media", "marks"],
  ["019", "bug_media", "restorable_until"],
  ["020", "bug_media", "has_thumb"],
  ["021", "bugs", "due_on"],
  ["022", "sprints", null],
  ["023", "bugs", "kind"],
  ["024", "bugs", "code_prefix"],
  ["025", "admin_sessions", "created_at"],
];
export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1]![0];

/**
 * The database storage limit: Neon's Free plan allows 1 GB per project (https://neon.com/docs/introduction/plans).
 * DATABASE_STORAGE_LIMIT_GB overrides it; 0 means no limit (paid plans have none).
 */
function databaseLimit(): { bytes: number | null; label: string } {
  const raw = (process.env["DATABASE_STORAGE_LIMIT_GB"] ?? "").trim();
  const gb = raw === "" ? 1 : Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) return { bytes: null, label: "No limit set" };
  return {
    bytes: Math.round(gb * 1024 ** 3),
    label: raw === "" ? "Neon Free plan · 1 GB per project" : `Limit you set · ${gb} GB`,
  };
}
const SIZE_SQL = `pg_database_size(current_database())::bigint`;
/** Plain-words usage line, e.g. "120 MB of 1 GB used (12%) · 904 MB left". */
function usageSummary(m: UsageMeter) {
  if (!m.limitBytes) return `${formatBytes(m.usedBytes)} used.`;
  const pct = Math.round((m.usedBytes / m.limitBytes) * 100);
  const left = Math.max(0, m.limitBytes - m.usedBytes);
  return `${formatBytes(m.usedBytes)} of ${formatBytes(m.limitBytes)} used (${pct}%) · ${formatBytes(left)} left.`;
}
const FULL_ACTION = {
  database:
    "Free space (empty the Trash, remove demo data) or move to a paid Neon plan before writes stop at the limit.",
  storage:
    "Empty the Trash or delete files from closed bugs (Settings → Storage & services → clean-up), or raise the plan.",
};

const env = (k: string) => !!(process.env[k] ?? "").trim();
const ms = (start: number) => Date.now() - start;

/** Runs one check; a check that throws is reported as down with its message, never hidden. */
async function check(
  key: string,
  label: string,
  work: () => Promise<Omit<HealthCheck, "key" | "label">>,
): Promise<HealthCheck> {
  try {
    return { key, label, ...(await work()) };
  } catch (e) {
    return {
      key,
      label,
      state: "fail",
      summary: e instanceof Error ? e.message : "The check failed.",
      facts: [],
    };
  }
}

async function database(): Promise<Omit<HealthCheck, "key" | "label">> {
  const start = Date.now();
  const { rows } = await neonQuery(
    `select split_part(version(),' ',2) as pg, ${SIZE_SQL} as size,
      (select count(*) from bugflow.bugs where deleted_at is null)::int as bugs,
      (select count(*) from bugflow.portals p join bugflow.users u on u.id=p.user_id where p.type<>'admin' and p.active and u.active and u.deleted_at is null and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()))::int as portals,
      (select count(*) from bugflow.admin_sessions where expires_at>now())::int as sessions,
      (select coalesce(jsonb_agg(c.table_name||'.'||coalesce(c.column_name,'')),'[]'::jsonb) from information_schema.columns c where c.table_schema='bugflow') as cols,
      (select coalesce(jsonb_agg(t.table_name),'[]'::jsonb) from information_schema.tables t where t.table_schema='bugflow') as tables`,
  );
  const took = ms(start);
  const r = rows[0] ?? {};
  const cols = new Set((r["cols"] as string[]) ?? []);
  const tables = new Set((r["tables"] as string[]) ?? []);
  const applied = MIGRATIONS.filter(([, t, c]) => (c ? cols.has(`${t}.${c}`) : tables.has(t))).map(
    ([n]) => n,
  );
  const missing = MIGRATIONS.map(([n]) => n).filter((n) => !applied.includes(n));
  const slow = took > 3000;
  const limit = databaseLimit();
  const meter: UsageMeter = {
    usedBytes: Number(r["size"] ?? 0),
    limitBytes: limit.bytes,
    limitLabel: limit.label,
  };
  const level = usageLevel(meter);
  return {
    state: worse(missing.length ? "fail" : slow ? "warn" : "ok", level),
    ms: took,
    meter,
    summary: missing.length
      ? `Connected, but migration${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not applied.`
      : `Connected in ${took} ms${slow ? " (slow — the database may be waking from sleep)" : ""}. Schema up to date (${LATEST_MIGRATION}). ${usageSummary(meter)}`,
    facts: [
      { label: "PostgreSQL", value: String(r["pg"] ?? "") },
      { label: "Bugs", value: String(r["bugs"] ?? 0) },
      { label: "Active member portals", value: String(r["portals"] ?? 0) },
      { label: "Admin sessions", value: String(r["sessions"] ?? 0) },
    ],
    ...(missing.length
      ? {
          action: `Apply ${missing.map((n) => `database/${n}_*.sql`).join(", ")} with npm run db:migrate.`,
        }
      : level !== "ok"
        ? { action: FULL_ACTION.database }
        : {}),
  };
}

async function storage(): Promise<Omit<HealthCheck, "key" | "label">> {
  const { mediaStatus, mediaUsage } = await import("./bug-media.server");
  const [s, u] = await Promise.all([mediaStatus(true), mediaUsage().catch(() => null)]);
  if (!s.configured)
    return {
      state: "off",
      summary: s.missing.length
        ? `Not connected (${s.missing.join(", ")} missing).`
        : "Not connected. Uploads are off; members can still add Drive links.",
      facts: [],
      action: "Connect a bucket in Settings → Storage & services.",
    };
  const t = s.test;
  // Used space as measured from the bucket's own file list (falls back to the app's records).
  const meter: UsageMeter | undefined = u
    ? {
        usedBytes: u.usedBytes,
        limitBytes: u.quotaBytes,
        limitLabel: u.quotaIsDefault
          ? "Cloudflare R2 free tier · 10 GB"
          : u.quotaBytes
            ? `Limit you set · ${formatBytes(u.quotaBytes)}`
            : "No limit set",
      }
    : undefined;
  const level = meter ? usageLevel(meter) : "ok";
  const facts = [
    { label: "Provider", value: s.provider },
    { label: "Bucket", value: s.bucket },
    { label: "Files", value: `${s.files} · ${formatBytes(s.bytes)}` },
    { label: "Unfinished uploads", value: String(s.pending) },
    { label: "In Trash", value: String(s.awaitingPurge) },
  ];
  if (!t?.ok)
    return {
      ...(meter ? { meter } : {}),
      state: t?.corsBlocked?.length ? worse("warn", level) : "fail",
      ...(t ? { ms: t.ms } : {}),
      summary: t?.message ?? "The bucket did not answer.",
      facts,
      action: t?.corsBlocked?.length
        ? "Add the blocked address to the bucket's CORS rule (Settings → Storage & services shows the rule)."
        : "Check the bucket name and API token in Settings → Storage & services.",
    };
  return {
    state: level,
    ms: t.ms,
    ...(meter ? { meter } : {}),
    summary: `${s.appOrigins.length ? `${t.message} Browser uploads allowed from ${s.appOrigins.join(", ")}.` : t.message}${meter ? ` ${usageSummary(meter)}` : ""}`,
    facts,
    ...(level !== "ok" ? { action: FULL_ACTION.storage } : {}),
  };
}

async function encryption(): Promise<Omit<HealthCheck, "key" | "label">> {
  if (!env("BUGFLOW_PORTAL_ENCRYPTION_KEY"))
    return {
      state: "fail",
      summary:
        "BUGFLOW_PORTAL_ENCRYPTION_KEY is not set: portal links cannot be copied and a saved bucket cannot be used.",
      facts: [],
      action: "Set it in the hosting environment (the same value everywhere this app runs).",
    };
  const { rows } = await neonQuery(
    `select token_ciphertext from bugflow.portals where token_ciphertext is not null and active and revoked_at is null order by created_at desc limit 20`,
  );
  const results = await Promise.all(
    rows.map((r) =>
      decryptPortal(String(r["token_ciphertext"])).then(
        () => true,
        () => false,
      ),
    ),
  );
  const bad = results.filter((ok) => !ok).length;
  return {
    state: bad ? "fail" : "ok",
    summary: bad
      ? `${bad} of ${results.length} saved portal links cannot be opened with this key — it differs from the key they were saved with.`
      : results.length
        ? `Opens all ${results.length} recent saved portal links.`
        : "Set. No saved portal links to check yet.",
    facts: [],
    ...(bad
      ? {
          action:
            "Use the same BUGFLOW_PORTAL_ENCRYPTION_KEY on every server (local .env.local and Vercel). Changing it makes saved links uncopyable.",
        }
      : {}),
  };
}

async function signIn(): Promise<Omit<HealthCheck, "key" | "label">> {
  const ok = env("BUGFLOW_ADMIN_EMAIL") && env("BUGFLOW_ADMIN_PASSWORD");
  return {
    state: ok ? "ok" : "fail",
    summary: ok
      ? "Admin email and password are configured."
      : "Admin email or password is not set.",
    facts: [],
  };
}

async function siteAddress(): Promise<Omit<HealthCheck, "key" | "label">> {
  const site = (import.meta.env["VITE_SITE_URL"] as string | undefined) ?? "";
  let here = "";
  try {
    here = new URL(getRequest().url).origin;
  } catch {
    /* outside a request */
  }
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(here);
  if (!site)
    return {
      state: "warn",
      summary: "VITE_SITE_URL is not set: links copied on a local dev server point to localhost.",
      facts: here ? [{ label: "This address", value: here }] : [],
      action: "Set VITE_SITE_URL to the live address, then rebuild/restart.",
    };
  return {
    state: "ok",
    summary: local ? `Links copied here use ${site}.` : `Live address ${site}.`,
    facts: here ? [{ label: "This address", value: here }] : [],
  };
}

async function aiServices(): Promise<Omit<HealthCheck, "key" | "label">> {
  const { mcpConfig } = await import("./mcp-config.server");
  const mcp = await mcpConfig();
  const drafts = env("AI_API_KEY");
  return {
    state: drafts || mcp.enabled ? "ok" : "off",
    summary: `AI welcome drafts ${drafts ? "on" : "off (no AI_API_KEY)"} · AI access (MCP) ${mcp.enabled ? "on" : "off"}${mcp.enabled ? ` · app connectors ${mcp.oauth ? "on" : "off"}` : ""}.`,
    facts: [],
  };
}

async function deployment(): Promise<Omit<HealthCheck, "key" | "label">> {
  const vercel = process.env["VERCEL_ENV"];
  const sha = process.env["VERCEL_GIT_COMMIT_SHA"];
  const facts = vercel
    ? [
        { label: "Environment", value: vercel },
        ...(process.env["VERCEL_REGION"]
          ? [{ label: "Region", value: String(process.env["VERCEL_REGION"]) }]
          : []),
        ...(sha ? [{ label: "Commit", value: sha.slice(0, 7) }] : []),
      ]
    : [{ label: "Environment", value: "Local dev server" }];
  return {
    state: "ok",
    summary: vercel ? `Running on Vercel (${vercel}).` : "Running on a local dev server.",
    facts: [...facts, { label: "Server time", value: new Date().toISOString() }],
  };
}

/** Every check runs in parallel; each reports its own state, so one failing service never hides the others. */
export async function systemHealth(): Promise<SystemHealth> {
  await requireAdmin();
  const checks = await Promise.all([
    check("database", "Database (Neon PostgreSQL)", database),
    check("storage", "Media storage (bucket)", storage),
    check("encryption", "Encryption key", encryption),
    check("sign-in", "Admin sign-in", signIn),
    check("site", "Site address", siteAddress),
    check("ai", "AI services", aiServices),
    check("deployment", "Deployment", deployment),
  ]);
  return { checkedAt: new Date().toISOString(), overall: overallState(checks), checks };
}

/**
 * The Admin panel's storage alarm: database and bucket use against their limits. Cheap enough for every page: one
 * database query, no bucket requests (bucket use comes from the app's file records, which track what was uploaded).
 */
export async function storageAlarms(): Promise<StorageAlarm[]> {
  await requireAdmin();
  const { mediaLimitBytes } = await import("./bug-media.server");
  const [{ rows }, mediaLimit] = await Promise.all([
    neonQuery(
      `select ${SIZE_SQL} as db, (select coalesce(sum(size),0) from bugflow.bug_media where status='ready' and purged_at is null)::bigint as media`,
    ),
    mediaLimitBytes().catch(() => null),
  ]);
  const r = rows[0] ?? {};
  const out: StorageAlarm[] = [];
  const add = (key: StorageAlarm["key"], label: string, used: number, limit: number | null) => {
    const level = usageLevel({ usedBytes: used, limitBytes: limit });
    if (limit && (level === "warn" || level === "fail"))
      out.push({ key, label, level, usedBytes: used, limitBytes: limit });
  };
  add("database", "Database", Number(r["db"] ?? 0), databaseLimit().bytes);
  add("storage", "Media storage", Number(r["media"] ?? 0), mediaLimit);
  return out;
}
