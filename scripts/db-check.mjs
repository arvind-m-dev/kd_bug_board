// Database checks: runs the real server code against a throwaway LOCAL Postgres.
//   npm run test:db
// Starts a private Postgres in a temp folder on 127.0.0.1 (random port), builds a fresh database for each suite in
// src/test/db (a suite named without* gets every migration except the Jira one), runs them, then stops the server and
// deletes the folder. It never reads DATABASE_URL and never connects anywhere but 127.0.0.1.
// Needs PostgreSQL's own programs (initdb, pg_ctl) on PATH, e.g. `brew install postgresql@16`.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const JIRA_MIGRATION = /^027_/;
const only = process.argv.slice(2);
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const quiet = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

for (const tool of ["initdb", "pg_ctl"])
  if (spawnSync(tool, ["--version"]).status !== 0) {
    console.error(
      `${tool} was not found. Install PostgreSQL locally (e.g. brew install postgresql@16).`,
    );
    process.exit(1);
  }

const dir = mkdtempSync(join(tmpdir(), "bugflow-dbcheck-"));
const data = join(dir, "data");
const port = await freePort();
const connect = (database) => new pg.Client({ host: "127.0.0.1", port, user: "bf", database });
let code = 1;
try {
  quiet("initdb", ["-D", data, "-U", "bf", "--auth=trust", "-E", "UTF8"]);
  // TCP on loopback only; no unix socket, so the temp path's length does not matter.
  quiet("pg_ctl", [
    "-D",
    data,
    "-w",
    "-l",
    join(dir, "server.log"),
    "-o",
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off`,
    "start",
  ]);

  const files = readdirSync("database")
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  // Each suite gets a database of its own, so no suite sees another's rows.
  const suites = readdirSync("src/test/db")
    .filter((f) => f.endsWith(".dbtest.ts"))
    .map((f) => f.replace(".dbtest.ts", ""))
    // `npm run test:db -- admin027 sprints027` runs only those suites.
    .filter((name) => !only.length || only.includes(name))
    .sort();
  const admin = connect("postgres");
  await admin.connect();
  for (const suite of suites) {
    const wanted = suite.startsWith("without")
      ? files.filter((f) => !JIRA_MIGRATION.test(f))
      : files;
    await admin.query(`create database "${suite}"`);
    const db = connect(suite);
    await db.connect();
    for (const file of wanted) {
      // Same statement splitting as database/migrate.ts, one transaction per file, so a file the real runner
      // would mis-split fails here too.
      const sql = readFileSync(join("database", file), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      const statements = sql
        .split(/;\s*(?:\n|$)/)
        .map((s) => s.trim())
        .filter(Boolean);
      await db.query("begin");
      try {
        for (const s of statements) await db.query(s);
        await db.query("commit");
      } catch (error) {
        throw new Error(`${file} failed on ${suite}: ${error.message}`);
      }
    }
    await db.end();
    console.log(`${suite}: ${wanted.length} migration files applied`);
  }
  await admin.end();

  code = 0;
  for (const suite of suites) {
    const run = spawnSync(
      "node",
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--config",
        "vitest.db.config.ts",
        `${suite}.dbtest`,
        ...process.argv.slice(2),
      ],
      {
        stdio: "inherit",
        env: { ...process.env, BF_DB_PORT: String(port), BF_DB_NAME: suite, DATABASE_URL: "" },
      },
    );
    if (run.status !== 0) code = 1;
  }
} catch (error) {
  console.error(error.message);
} finally {
  spawnSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
