import path from "node:path";
import { defineConfig } from "vitest/config";

// Database checks: the real server code against a throwaway local Postgres that scripts/db-check.mjs starts
// and deletes. Not part of `npm test`, and never connected to DATABASE_URL.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/db/**/*.dbtest.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
