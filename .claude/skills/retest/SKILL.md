---
name: retest
description: Re-verify the Bug Board build — run the automated gates (types, tests, lint, build) and walk the manual browser checklist for every feature shipped on this branch (Phase 2 due dates, URL view-state, theme flash, seasonal motion, sidebar). Use when the user says "retest", "re-verify", "check everything still works", or after a batch of changes.
---

# Retest Bug Board

Verify nothing regressed. Run the automated gates first; they are the source of truth for logic. Then do the manual browser checklist for anything visual (the automated gates never open a page).

## 1. Automated gates (always run, in this order)

```bash
npx tsc --noEmit          # types: must be clean
npm test                  # vitest: all files pass
npm run lint              # eslint: 0 errors; ~18 react-refresh warnings are the known baseline
npm run build             # vite build: must exit 0
npm run test:e2e          # Playwright smoke (needs the build above): 5 specs, real headless Chromium
```

The e2e suite boots the built server on :4788 against the real database (read-only pages; a demo sign-in session is its only write) and saves screenshots to `e2e/shots/` — READ those images to visually confirm the pages. The signed-in sweep self-skips when `BUGFLOW_DEMO_LOGIN` is off.

Report each result plainly (pass / fail with the first error). A warning count above the baseline (18) is a regression — name the new ones. Do **not** claim a browser was checked; these gates do not open one.

If a pure rule changed, the matching unit test must still cover it: `due-dates.test.ts`, `bug-edit.test.ts`, `bug-sheet.test.ts`, `seasonal-choreography.test.ts`, `seasonal-physics.test.ts`, `appearance.test.ts`, plus the rest under `src/test/`.

## 2. Database (only if a migration was touched)

Migrations are idempotent. To re-apply the latest and confirm:

```bash
npm run db:migrate -- database/021_due_dates.sql   # or the file changed
```

Verify with a read-only probe (never write workspace settings from a script — the user runs the app live on :8080):

```bash
node --env-file=.env.local -e "import('@neondatabase/serverless').then(async ({neon})=>{const s=neon(process.env.DATABASE_URL);console.log(await s\`select column_name from information_schema.columns where table_schema='bugflow' and table_name='bugs' and column_name='due_on'\`)})"
```

## 3. Manual browser checklist (needs a human or an enabled browser tool)

Beyond the e2e smoke, interactive flows still need a human (or extend `e2e/smoke.spec.ts`). Start it with `npm run dev` (serves :8080) and either walk these yourself or drive an enabled browser tool. Check on Admin plus one developer and one QA portal where scope matters.

**Due dates (Phase 2.1a)**
- [ ] Report/edit a bug as Admin or a `plan` holder: the Due date field shows; a non-planner (plain reporter) never sees it.
- [ ] A past date on an open bug shows a red "Overdue Nd" badge; due today/tomorrow shows an amber badge; a closed bug (Resolved/Duplicate/Not a bug/Won't fix) shows none.
- [ ] Overview shows an "Overdue" card with a count; clicking it filters the list to overdue bugs. The count matches the list.
- [ ] Settings → Options → Workspace time zone: changing it shifts what counts as "today"/overdue.
- [ ] A non-planner editing a bug cannot change its due date (field absent; server ignores any value).
- [ ] All Bugs → Calendar toggle shows a month grid; days with open due bugs are dotted, overdue days red; picking a day filters the list to that day and the choice survives a refresh (`?cal=1&due=`); Clear day resets.

**Bug ID prefixes**
- [ ] Settings → Options → Bug ID prefixes: add e.g. DEPLOY and PROD; the report form now shows a prefix picker; a new bug filed as DEPLOY shows `DEPLOY-…` everywhere (list, board, sprints, trash, exports).
- [ ] Old bugs keep `BF-…`; a non-Admin editing a bug cannot change its prefix; Admin can, and the change is audited.

**Sprints (Phase 2.2)**
- [ ] `/admin/sprints`: create a sprint for a project; it starts as Planned.
- [ ] Add a bug by number — only bugs in the sprint's project are accepted, and a bug already in an open sprint is refused.
- [ ] Start the sprint; starting a second sprint in the same project is refused until the first is closed.
- [ ] After start, bugs added later count as "Added"; the card shows committed / added / open / done.
- [ ] Close the sprint with a carry-to target — still-open bugs appear in the target marked "carried"; a closed sprint is read-only.
- [ ] Sprint create/start/close show in the bell; add/remove do not (they stay on the bug's activity log).

**Backlog (Phase 2.4)**
- [ ] `/admin/backlog`: open items of the picked project in rank order; dragging a row re-ranks it and the order survives a refresh.
- [ ] New item (story/task/epic) appears at the end; bugs raised normally also show here, and stories never appear in All bugs or its counts.
- [ ] An epic can hold stories/tasks/bugs; a story can hold tasks; loops are refused; the epic's progress bar moves as children close.
- [ ] Estimate and Ready save inline; "Sprint" sends an item to the project's open sprint (epics never offer it).

**Scrum board (Phase 2.3)**
- [ ] `/admin/board`: every bug appears in exactly one column; counts per column match the list.
- [ ] Dragging Assigned → In progress (as a developer on their own bug, or Admin) applies directly with a toast; while dragging, unreachable columns dim.
- [ ] Dropping onto Assigned or dropping a Retest card onto Done opens the bug (assign / verify dialog) — the drag alone never resolves a bug.
- [ ] The per-card "Move to…" menu offers the same moves (keyboard path).
- [ ] A stale card (changed elsewhere) errors politely and the board refreshes.
- [ ] AI access: `get_sprint` returns the project's open sprint in compact text, and is refused for a project outside the token's scope.

**View state across refresh**
- [ ] Page through the bug table, the member table, and the Overview urgent list, then refresh — the same page stays (URL has `?page=` / `?urgent=`).
- [ ] Switch a Trash tab, refresh — the same tab stays (`?tab=`).

**Theme (no flash)**
- [ ] Pick a non-default theme (and a light theme), refresh several times — the chosen theme paints immediately, no flash to the default. The light/dark toggle icon settles a beat after load (expected).

**Seasonal worlds (random, refresh-stable)**
- [ ] On Halloween/Christmas/geometry themes, refresh repeatedly — the bats, bugs, ghosts and sleigh start in different places and keep wandering; they do not snap back to the same opening. Nothing starts stuck mid-screen.
- [ ] Theme Studio → Shuffle still gives a repeatable layout for the same seed.

**Sidebar**
- [ ] Section titles read as quiet headers; the sub-tabs under them are inset with a guide line and clearly nested. Collapsed sidebar centers the icons (no stray indent).

## 4. Report format
State: gates (pass/fail each), DB (if touched), and which manual items you could not check (say so — do not assume). End with anything that regressed or needs a human eye.
