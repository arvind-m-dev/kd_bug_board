# Authentication and permissions

No secret values belong in this file.

## Admin
- Credentials from `BUGFLOW_ADMIN_EMAIL` / `BUGFLOW_ADMIN_PASSWORD`, checked only on the server.
- Success creates an `admin_sessions` row (token hash, 8 hours) mapped to the active admin portal. Cookie: Secure, HttpOnly, Partitioned, SameSite=None (embedded preview), max-age 8h. Sign-in reads the session back before navigating.
- Throttle: 10 failed attempts per client address per 15 minutes (`sign-in-throttle.server.ts`), also on OAuth consent.
- Mutations validate same origin (`checkOrigin`; no-op outside Start runtime, i.e. MCP).
- Session ending mid-use (`isAdminSessionError`) clears caches and returns to `/login?redirect=…` (same-site paths only).

### Temporary one-click sign-in (`BUGFLOW_DEMO_LOGIN=1`)
- Removed 2026-10-29 during a security pass, then **restored the same day at the owner's request** (marketing capture still running). Anyone opening `/login` becomes Admin while the flag is `1`.
- `/login` shows a "Login without credentials" link. It calls `demoAdminAccess` → `demoUnlockAdmin`, which runs the normal `unlockAdmin` with the server-side `BUGFLOW_ADMIN_EMAIL`/`PASSWORD` (origin check, throttle, hashed 8h session unchanged). Credentials never reach the browser.
- **To retire it:** unset `BUGFLOW_DEMO_LOGIN` (Vercel + `.env.local`) and redeploy; optionally delete the code (`demoUnlockAdmin`, the link in `admin-access.tsx`, `demo-login.test.ts`).

## Member portal links
- Created by Admin; default expiry 90 days. Stored as hash plus server-encrypted copy so Admin can re-copy.
- Every read validates: portal active, not revoked, not expired, user active and not deleted, role.
- Scope: `portal_projects` limits visible projects.

## Permissions (`src/lib/onboarding.ts`)
`view`, `view_all` (read all project bugs), `report`, `comment`, `evidence`, `validate`, `assign`, `verify`, `progress`, `recheck`, `disposition`, `plan` (set due dates / sprints).

| Role preset | Permissions |
| --- | --- |
| tester / other | view, view_all, report, comment, evidence |
| developer | + progress, recheck, disposition |
| qa | + validate, assign, verify, plan |

Admin bypasses permission lists but not transition rules.

## Key rules (`src/lib/bug-workflow.ts`)
- See bug: admin, qa, `view_all`, reporter, or assignee.
- Edit: not in closed statuses; reporter with `report` or Admin; non-Admin cannot change priority/severity.
- Verify: admin or QA with `verify`, bug in RECHECK, not the assignee.
- Media upload: reporter with `report`, assignee with `progress`, or `validate`/`verify` holders. Mark-up: uploader only.

## AI tokens / OAuth
- `bf_ai_` tokens hashed (SHA-256) in `ai_tokens`; each bound to one panel and inherits its exact permissions/scope; revocable.
- OAuth 2.1 + PKCE: consent signs in as Admin or with a portal link; codes single-use and hashed; issued token is an `ai_tokens` row.
- AI onboarding requires a live Admin session; generated text never grants permissions — only an authorized member save does.
