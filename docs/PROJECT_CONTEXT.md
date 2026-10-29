# Project context (read first)

Concise source of truth for a new coding session. Details live in the linked docs; `AGENTS.md` holds the binding architecture rules.

Last verified: 2026-10-28 on branch `feat/theme-worlds` (commit `c1c9bb6` + uncommitted user edit to `src/components/bugflow/seasonal-sky.ts`).

## What this is
Bug Board ("BugFlow"): bug reporting, triage, assignment and QA verification. One Admin (env-configured) manages projects and members; members (tester, developer, QA, other) work through private portal links. AI clients connect over MCP. See [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

## Stack
TanStack Start (React 19, file routes in `src/routes`), Tailwind + shadcn/ui, Neon Postgres (`bugflow` schema), S3-compatible media (Cloudflare R2), Vercel.

## Where things live
| Area | Files |
| --- | --- |
| Pure domain rules | `src/lib/bugflow.ts` (statuses, transitions), `src/lib/bug-workflow.ts` (permission checks, schemas) |
| Server functions (RPC) | `src/lib/*.functions.ts` → implementations in `src/lib/*.server.ts` |
| Raw HTTP routes | `src/server.ts` (`/api/health`, `/api/presence`, `/api/mcp`, `/api/oauth/*`, `/.well-known/oauth-*`) |
| UI | `src/components/bugflow/*`, shadcn in `src/components/ui` |
| Migrations | `database/NNN_*.sql`, applied by `npm run db:migrate` |
| Tests | `src/test/*.test.ts(x)` (Vitest) |

## Current state
- All features in [FEATURES.md](FEATURES.md) marked *Implemented* exist in code with unit tests; not all were manually exercised this session.
- Active branch work: 3D background "theme worlds" and scene-quality setting (`seasonal-*.ts`, `scene-quality.ts`, `minimal-geometry-scene.ts`).
- Migrations through `020_media_thumbs.sql`.

## Baseline (2026-10-28)
`npm test` 200/200 pass (40 files) · `tsc --noEmit` clean · `eslint .` 0 errors, 18 warnings (react-refresh) · `vite build` OK. See [TESTING.md](TESTING.md).

## Commands
`npm run dev` (port 8080, loads `.env.local`) · `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run build` · `npm run db:migrate`.

## Critical constraints
- Never weaken server authorization; every bug read/write goes through scoped server functions with `accessSchema` (admin / portal / ai).
- Status changes must respect `canTransition` + `mayUpdateStatus`; only the verify action resolves a bug; fixer cannot verify own fix.
- Writes are version-checked and write audit rows in the same statement.
- Deletes go to 30-day Trash; never hard-delete rows (`purged_at` keeps history).
- Schema changes only as new numbered, idempotent SQL files.
- Never record secrets in docs or code. User runs dev server on :8080 while agents work; do not save workspace settings from scripts.

## Known issues / drift
- Bucket CORS must include every app origin (prod uploads fail otherwise). Verified 2026-10-28: localhost:8080 and kd-bug-board.vercel.app allowed for PUT/GET.
- Lint: 18 react-refresh warnings (pre-existing).

## Next recommended step
Phase 2 plan: `.lovable/plan/phase-2-plan-2026-10-28.md` (Phase 2 + 3; decisions D1–D6 agreed 2026-10-28, no Jira sync). No new feature list was attached to the documentation task of 2026-10-28. Known open items: "Planned / deferred" in [FEATURES.md](FEATURES.md) (Drive connector, public media links, timestamped video comments, real-bucket media test). Before new work: read this file, [FEATURES.md](FEATURES.md), the doc for the area, then `git status`.

## Doc index
[OVERVIEW](PROJECT_OVERVIEW.md) · [FEATURES](FEATURES.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [AUTH](AUTH_AND_PERMISSIONS.md) · [WORKFLOW](BUG_WORKFLOW.md) · [API](API_REFERENCE.md) · [STORAGE/DEPLOY](STORAGE_AND_DEPLOYMENT.md) · [TESTING](TESTING.md) · [CHANGELOG](CHANGELOG.md) · [DECISIONS](DECISIONS.md)
