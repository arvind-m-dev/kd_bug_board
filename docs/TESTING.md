# Testing

## Commands
| Check | Command |
| --- | --- |
| Unit tests (Vitest, jsdom) | `npm test` |
| Type check | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Production build | `npm run build` |

Tests live in `src/test/` (setup `src/test/setup.ts`, config `vitest.config.ts`). They cover pure rules and component behavior; there is no automated end-to-end suite or database integration test.

## Coverage map (selected)
Workflow `bug-workflow.test.ts`, `status-groups.test.ts` · edits `bug-edit.test.ts` · access `admin-route-access.test.ts`, `portal-access.test.ts`, `sign-in-throttle.test.ts`, `oauth.test.ts` · media `bug-media.test.ts`, `media-cors.test.ts`, `media-endpoint.test.ts`, `mp4-faststart.test.ts`, `video-marks.test.ts`, `mark-hit.test.ts` · trash `trash.test.ts`, `trash-bin-feedback.test.tsx` · members `member-management.test.ts`, `onboarding.test.ts` · reports/export `person-reports.test.ts`, `bug-sheet.test.ts`, `export.test.ts`, `period.test.ts` · notifications `notifications.test.ts` · theme `appearance.test.ts`, `color.test.ts` · seasonal scenes `seasonal-*.test.ts`.

## Added tests

## Manual end-to-end scenarios (run in `npm run dev`)
1. Admin sign-in → create project → create QA, developer, tester portals.
2. Tester reports bug with screenshot → QA validates → assigns developer.
3. Developer IN_PROGRESS → RECHECK; developer cannot verify.
4. QA verify pass → RESOLVED; fail → REOPENED.
5. Revoke a portal → link stops working immediately.
6. Delete bug/media → appears in Trash → restore.
7. MCP: `whoami` / `list_bugs` with a member token shows only that scope.

## Baseline 2026-10-28 (branch `feat/theme-worlds`, uncommitted `seasonal-sky.ts`)
- `npm test`: 39 files, 198 tests, all passed.
- `tsc --noEmit`: exit 0.
- `eslint .`: 0 errors, 18 warnings (`react-refresh/only-export-components`, pre-existing).
- `vite build`: success.
- Manual E2E scenarios: not run in this session.
