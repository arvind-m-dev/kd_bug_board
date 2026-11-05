import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Full end-to-end suite (writes data): members, portals, bug lifecycle, sprints, board, backlog, media.
 * Runs against the database in `.env.local` (demo data; owner approved writes 2026-11-05). Every record a spec
 * creates is named `E2E-…` and cleaned up by that spec; workspace-wide settings (theme, time zone, storage) are
 * never saved. Start the built server once (`node --env-file=.env.local .output/server/index.mjs` with PORT=4799),
 * then `npx playwright test -c playwright.full.config.ts`.
 */
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
} catch {
  throw new Error("Missing .env.local");
}
if (process.env["BUGFLOW_DEMO_LOGIN"] !== "1")
  throw new Error("Full suite needs BUGFLOW_DEMO_LOGIN=1");

export default defineConfig({
  testDir: "./e2e/full",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:4799",
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --env-file=.env.local .output/server/index.mjs",
    port: 4799,
    env: { PORT: "4799" },
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
