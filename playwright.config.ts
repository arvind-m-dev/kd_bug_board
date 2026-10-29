import { defineConfig } from "@playwright/test";

/**
 * Browser smoke tests over the production build against the real database (read-only pages; the only write the
 * suite may cause is a demo sign-in session). Run `npm run build` first, then `npm run test:e2e`.
 * Kept out of `npm test`: vitest stays fast and database-free.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: { baseURL: "http://localhost:4788", viewport: { width: 1280, height: 800 } },
  webServer: {
    command: "node --env-file=.env.local .output/server/index.mjs",
    port: 4788,
    env: { PORT: "4788" },
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
