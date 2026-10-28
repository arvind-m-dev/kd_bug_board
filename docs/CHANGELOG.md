# Changelog

Newest first. Earlier history: `git log` and `roadmap.md`.

## 2026-10-28 — Planned features recorded
- Added the remaining items from the 2026-10-22 media/theme brief to "Planned / deferred" in `docs/FEATURES.md` after checking the code (Drive is a "Coming later" placeholder; no text comments on recordings). Docs only; no code or tests changed.

## 2026-10-28 — Project documentation set
- **Change**: Added `docs/` (PROJECT_CONTEXT, PROJECT_OVERVIEW, FEATURES, ARCHITECTURE, DATABASE, AUTH_AND_PERMISSIONS, BUG_WORKFLOW, API_REFERENCE, STORAGE_AND_DEPLOYMENT, TESTING, CHANGELOG, DECISIONS).
- **Reason**: Persistent, repository-based context so future sessions can resume without conversation history.
- **Code affected**: none. No migrations.
- **Tests**: Baseline run before writing docs — 198/198 tests pass, tsc clean, lint 0 errors / 18 warnings, build OK.
- **Notes**: Found doc drift — `README.md` migration range (says 001…010, actual 001…020) and `roadmap.md` (media uploads marked deferred but implemented). Recorded in PROJECT_CONTEXT; source docs left unchanged.
