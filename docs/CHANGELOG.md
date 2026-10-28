# Changelog

Newest first. Earlier history: `git log` and `roadmap.md`.

## 2026-10-28 — Phase 2.2: sprints (Admin)
- **Feature**: a Sprints page (`/admin/sprints`, in the Bugs nav group). Create a sprint for a project (name, goal, start/end), add/remove bugs, Start it (one active sprint per project, enforced by a partial unique index) and Close it — optionally carrying still-open bugs into another open sprint, recorded with `carried_from_sprint_id`. Each card shows committed / added / open / done / carried, computed from membership history (`summarizeSprint`). A bug can be in only one open sprint at a time.
- **Data**: migration `022_sprints.sql` — `sprints`, `sprint_items`. Applied to Neon and verified.
- **Rules** (`src/lib/sprints.ts`): `maySprint`, `canChangeSprintState`, `summarizeSprint`, `carryCandidates`, zod schemas. Server (`sprints.server.ts`): create/update/start/close/add/remove, Admin-gated, audited to `activity` as `sprint.*` (item add/remove are quiet in the bell via `sprint.item_`).
- **Scope**: Admin-only for now (it is an `/admin` route). Member/`plan`-holder planning from a portal, a read-only "current sprint" portal tab, and the `get_sprint` MCP tool are still pending.
- **Tests**: `sprints.test.ts` (6); 216/216 pass, tsc clean, lint 0 errors / 18 warnings, build OK. Not clicked through in a browser.

## 2026-10-28 — Phase 2.1b (part): due-date calendar + retest skill
- **Feature**: All Bugs gets a **Calendar** toggle (`?cal=1`). A month grid (shadcn `Calendar`/react-day-picker) marks days that hold an open bug with a due date, overdue days in red; picking a day filters the list to bugs due then (`?due=YYYY-MM-DD`, survives refresh), Clear day resets. Marks come from the loaded page, matching the other client-side filters.
- **Skill**: `.claude/skills/retest/SKILL.md` — runs the automated gates (tsc/test/lint/build), DB re-apply check, and a per-feature manual browser checklist for everything on this branch.
- **Files**: `bug-workspace.tsx` (`DueCalendar`, `dayKey`), `styles.css`. No schema/server changes.
- **Tests**: 210/210 pass, tsc clean, lint 0 errors / 18 warnings, build OK. Not clicked through in a browser.
- **Pending (2.1b)**: notification-bell due reminders (needs per-viewer scoping; the current bell is Admin activity-based).

## 2026-10-28 — Seasonal creatures don't reset on refresh
- **Change**: in the 3D worlds the bats, bugs, ghosts and sleigh snapped back to the same starting spot and replayed the same motion on every reload, because the animation clock started at 0 and each creature's phase/timers were seeded deterministically. Now a per-load `startOffset = Math.random()*600` seeds the clock, and each creature's start timer, wander phase (`seed`), drift distance and direction take a `Math.random` offset. The scene *layout* stays seeded (Theme Studio Shuffle unchanged); only the motion varies per visit, so a refresh looks like the creatures kept wandering rather than resetting. Same offset added to the geometry world's clock.
- **Files**: `src/components/bugflow/seasonal-scene.ts`, `minimal-geometry-scene.ts`. No schema/server changes.
- **Tests**: 210/210 pass (seasonal choreography/physics tests use injected RNG, unaffected), tsc clean, lint 0 errors / 18 warnings, build OK. Not clicked through in a browser.

## 2026-10-28 — No theme flash on refresh
- **Fix**: on reload the default theme flashed for a frame before the chosen one applied. The boot script painted the cached theme pre-paint, but `ThemeProvider` initialised its state to `DEFAULT_APPEARANCE`, so React's first apply-effect overwrote the boot theme with the default until the mount effect read the cache. Now `dark`, `workspace` and `personal` are seeded from the cache in their `useState` initialisers (SSR-safe: `read()` returns null server-side), so the first client paint already matches the boot script.
- `ThemeToggle` shows the SSR default (dark) icon until `ready` to avoid a hydration mismatch from the lazily-read mode.
- **Files**: `src/components/bugflow/theme-toggle.tsx`. No schema/server changes.
- **Tests**: 210/210 pass, tsc clean, lint 0 errors / 18 warnings, build OK. Not clicked through in a browser.

## 2026-10-28 — View state survives a refresh
- **Fix**: table page numbers and tabs no longer reset on reload. Added `useUrlNumber` (built on `useUrlParam`) and moved to the URL: the bug table page (`?page=`), the member table page (`?page=`), the Overview urgent-list page (`?urgent=`), and the Trash tab (`?tab=`). A refresh or shared link reopens the same page/tab.
- **Scope**: Activity log pagination left as-is (cursor-based — a page index alone can't be restored). Bug-list filter/severity/search already round-trip through the route's search params.
- **Files**: `src/hooks/use-url-param.ts`, `bug-workspace.tsx`, `member-portals.tsx`, `dashboard-summary.tsx`, `trash-view.tsx`. No schema, no server changes.
- **Tests**: 210/210 pass, tsc clean, lint 0 errors / 18 warnings, build OK. Not clicked through in a browser.

## 2026-10-28 — Phase 2.1a: bug due dates
- **Feature**: an optional due date per bug. Overdue (date past, bug still open) and due-soon badges in the bug list; an **Overdue** Overview card and list filter; "today" is computed in a new **workspace time zone** (Settings → Options). Only planners set dates — new `plan` permission (Admin always; added to the QA preset).
- **Data**: migration `021_due_dates.sql` — `bugs.due_on date` + partial index. Applied to Neon and verified.
- **Rules** (`bugflow.ts`): `isOverdue`, `dueSoon`, `dueBadge`, `CLOSED_STATUSES`; `maySetDue` (`bug-workflow.ts`). Due date flows through `reportBug`/`editBugReport` (version-checked, audited in `bug.edited`; non-planners' values dropped/ignored server-side).
- **UI**: date field in the report/edit form (planners only); `DueBadge` in rows; `TimeZoneCard` in options settings; `saveTimeZone` server function.
- **Tests**: `due-dates.test.ts` (10 new); 210/210 pass, tsc clean, lint 0 errors / 18 warnings (baseline), build OK. Not yet clicked through in a browser.
- **Pending (2.1b)**: calendar view and notification-bell due reminders.

## 2026-10-28 — Verification: theme worlds and R2 bucket
- **Theme worlds**: all 5 worlds (geometry, halloween, winter, christmas, autumn) route to `Seasonal3D`; "3D quality" control saves `quality` (auto/low/high) and reaches both scene builders. tsc clean, 200/200 tests, build OK. Not viewed in a browser (no headless browser installed; dev server was down).
- **R2 bucket** (`bugboard-media`, custom source): CORS preflight PUT/GET allowed for `http://localhost:8080` and `https://kd-bug-board.vercel.app`; signed PUT (with `If-None-Match: *`) → 200, signed GET → 200 with matching body, delete → 404, using the stored encrypted credentials. Probe object under `bugs/_probe/` removed. No app rows written.
- **Still open**: click-through in the real app (upload with thumbnail, compression, mark-up; 3D worlds per quality level).

## 2026-10-28 — Doc drift fixed
- `README.md` migration range now `001 … 020`; `roadmap.md` marks media uploads done (real-bucket test still pending) and splits a merged line; removed both items from "Known issues" in `PROJECT_CONTEXT.md`. Docs only.

## 2026-10-28 — Nav bar stays on top when scrolling
- **Fix**: `.bf-bulk-bar` z-index 30 → 19 and `.bf-armed-hint` 20 → 10 in `src/styles.css`, so they scroll under the sticky `.bf-topbar` (z 20) instead of over it; the bulk bar also no longer covers the mobile sidebar (30) / scrim (29).
- **Rule**: in-page content must stay below z-index 20. Fixed overlays (save bar, FABs, upload tray, dialogs/popovers) and pointer-less seasonal effects stay above on purpose.
- **Tests**: CSS only; build OK. Not checked in a browser.
- **Follow-up (seasonal 3D themes)**: with a 3D theme on, panel headings, toolbars, pagers and form buttons are lifted to z 37 (above the 3D layer) and slid over the nav bar (reported with a screenshot of Overview → "Needs your attention"). Added `body:has(.bf-seasonal-3d)` overrides: settings tabs and bulk bar 38, nav bar 39, mobile scrim 42, sidebar 43. Build OK; not checked in a browser.

## 2026-10-28 — Temporary one-click Admin sign-in
- **Change**: `/login` shows a "Login without credentials" link under Sign in when `BUGFLOW_DEMO_LOGIN=1`. Server-side `demoUnlockAdmin` reuses `unlockAdmin` with env credentials; `adminStatus` returns an extra `demo` flag. Password form unchanged.
- **Reason**: Open access while marketing material is made; the user chose to enable it on the live site, understanding that anyone with the URL becomes Admin.
- **Files**: `src/lib/portal-access.server.ts`, `src/lib/portal-access.functions.ts`, `src/components/bugflow/admin-access.tsx`, `src/test/demo-login.test.ts`, `.env.example`. No migrations.
- **Tests**: 200/200 pass (2 new), tsc clean, lint 0 errors / 18 warnings, build OK; env var name absent from client bundle. Not clicked through in a browser.
- **Remove later**: unset `BUGFLOW_DEMO_LOGIN` (Vercel + `.env.local`) and redeploy; optionally delete the code above.

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
