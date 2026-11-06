import pg from "pg";

// Stand-ins for the database checks. The Neon HTTP driver is replaced by a direct connection to the throwaway
// local Postgres that `npm run test:db` starts (same untyped text parameters, same result shapes), and the
// browser-session module by a fixed Admin. The address is always 127.0.0.1 on the port the script chose:
// DATABASE_URL is never read, so these checks cannot reach a real database.

const port = Number(process.env["BF_DB_PORT"]);
const database = process.env["BF_DB_NAME"];
if (!port || !database) throw new Error("Database checks run through `npm run test:db`.");

// Plain dates stay "YYYY-MM-DD", as neon.server.ts configures the real driver.
pg.types.setTypeParser(1082, (v: string) => v);

export const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
export const PORTAL = "aaaaaaaa-0000-4000-8000-0000000000aa";
export const PROJECT = "bbbbbbbb-0000-4000-8000-000000000001";
export const CONN = "cccccccc-0000-4000-8000-000000000001";
export const MAP = "dddddddd-0000-4000-8000-000000000001";

export const pool = new pg.Pool({ host: "127.0.0.1", port, user: "bf", database, max: 6 });

type Statement = { query: string; params?: unknown[] };
const shape = (r: pg.QueryResult) =>
  JSON.parse(
    JSON.stringify({
      rows: r.rows,
      rowCount: r.rowCount,
      command: r.command,
      fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    }),
  );
/** Every statement the code under test sent, in order. */
export const statements: string[] = [];
async function run(query: string | Statement[], params: unknown[] = []) {
  if (typeof query === "string") {
    statements.push(query);
    return shape(await pool.query(query, params));
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const results = [];
    for (const s of query) {
      statements.push(s.query);
      results.push(shape(await client.query(s.query, s.params ?? [])));
    }
    await client.query("commit");
    return { results };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
/** Replaces `@/lib/neon.server`. */
export const neon = {
  neonQuery: run,
  neonExecute: run,
  neonBatch: async (s: Statement[]) => (await run([...s])).results,
  neonUserError: () => ({ status: 500, message: "The database request could not be completed." }),
};

const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the database checks`);
};
/** Replaces `@/lib/portal-access.server`: a signed-in Admin, no browser. */
export const session = {
  checkOrigin: () => undefined,
  requireAdmin: async () => ({ id: PORTAL, userId: ADMIN, name: "Admin", sessionHash: "h" }),
  adminSessionFromRequest: async () => null,
  ...Object.fromEntries(
    [
      "databaseCall",
      "demoLoginEnabled",
      "adminStatus",
      "demoUnlockAdmin",
      "unlockAdmin",
      "lockAdmin",
      "listMembers",
      "listProjects",
      "projectSummary",
      "setProjectArchived",
      "createProject",
      "saveMember",
      "changePortal",
      "readPortal",
    ].map((n) => [n, unavailable(n)]),
  ),
};

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const q = async (sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows as Row[];

/** An Admin, a project and (when asked) a connected Jira site, with an active mapping when `config` is given. */
export async function seed(withJira: boolean, config?: unknown) {
  await q(
    "insert into bugflow.users(id,name,email) values($1,'Admin','admin@example.test') on conflict do nothing",
    [ADMIN],
  );
  await q(
    "insert into bugflow.portals(id,user_id,type,token_hash) values($1,$2,'admin','hash-admin') on conflict do nothing",
    [PORTAL, ADMIN],
  );
  await q(
    "insert into bugflow.projects(id,name) values($1,'TRIAL-JIRA project') on conflict do nothing",
    [PROJECT],
  );
  if (!withJira) return;
  await q(
    "insert into bugflow.jira_connections(id,cloud_id,site_url,site_name,state,created_by) values($1,'11111111-2222-4333-8444-555555555555','https://trial.atlassian.net','trial','connected',$2) on conflict do nothing",
    [CONN, ADMIN],
  );
  if (!config) return;
  await q(
    "insert into bugflow.jira_project_mappings(id,connection_id,project_id,jira_project_id,jira_project_key,issue_type_id,config,state,created_by) values($1,$2,$3,'10000','BFT','10004',$4::jsonb,'active',$5) on conflict do nothing",
    [MAP, CONN, PROJECT, JSON.stringify(config), ADMIN],
  );
}
