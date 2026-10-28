# Changelog

Newest first. Earlier history: `git log` and `roadmap.md`.

## 2026-10-28 — Neutral "Bug Board" branding
- **Change**: Removed "Futurist Global" from all user-facing text, page titles/meta, share previews, MCP instructions, AI onboarding prompt, origin-check error and README; product now reads "Bug Board". "for Futurist Global teams" → "for your team". Theme palette display name "Futurist Teal" → "Teal" (palette `id: "teal"` unchanged, so saved themes still work).
- **Reason**: Company name to be added back later.
- **Files**: `src/lib/bugflow.ts` (`SHARE_TITLE`, `pageHead`), `src/routes/*` metadata, `workspace.tsx`, `personal-portal.tsx`, `sign-out.tsx`, `use-member-favicon.tsx`, `mcp.server.ts`, `onboarding.server.ts`, `portal-access.server.ts`, `appearance.ts`, `src/test/bugflow.test.ts` (describe label), README, docs. Text only; no logic, routes or schema changed. No migrations.
- **Tests**: 198/198 pass, tsc clean, lint 0 errors / 18 warnings (baseline), build OK.
- **Re-adding the name later**: search for `Bug Board`; most page titles derive from `pageHead` in `src/lib/bugflow.ts`, but headers, portal and sign-out text are separate literals.

## 2026-10-28 — Planned features recorded
- Added the remaining items from the 2026-10-22 media/theme brief to "Planned / deferred" in `docs/FEATURES.md` after checking the code (Drive is a "Coming later" placeholder; no text comments on recordings). Docs only; no code or tests changed.

## 2026-10-28 — Project documentation set
- **Change**: Added `docs/` (PROJECT_CONTEXT, PROJECT_OVERVIEW, FEATURES, ARCHITECTURE, DATABASE, AUTH_AND_PERMISSIONS, BUG_WORKFLOW, API_REFERENCE, STORAGE_AND_DEPLOYMENT, TESTING, CHANGELOG, DECISIONS).
- **Reason**: Persistent, repository-based context so future sessions can resume without conversation history.
- **Code affected**: none. No migrations.
- **Tests**: Baseline run before writing docs — 198/198 tests pass, tsc clean, lint 0 errors / 18 warnings, build OK.
- **Notes**: Found doc drift — `README.md` migration range (says 001…010, actual 001…020) and `roadmap.md` (media uploads marked deferred but implemented). Recorded in PROJECT_CONTEXT; source docs left unchanged.
