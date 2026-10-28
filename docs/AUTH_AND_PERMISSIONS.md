# Authentication and permissions

No secret values belong in this file.

## Admin
- Credentials from `BUGFLOW_ADMIN_EMAIL` / `BUGFLOW_ADMIN_PASSWORD`, checked only on the server.
- Success creates an `admin_sessions` row (token hash, 8 hours) mapped to the active admin portal. Cookie: Secure, HttpOnly, Partitioned, SameSite=None (embedded preview), max-age 8h. Sign-in reads the session back before navigating.
- Throttle: 10 failed attempts per client address per 15 minutes (`sign-in-throttle.server.ts`), also on OAuth consent.
- Mutations validate same origin (`checkOrigin`; no-op outside Start runtime, i.e. MCP).
- Session ending mid-use (`isAdminSessionError`) clears caches and returns to `/login?redirect=…` (same-site paths only).

### Temporary one-click sign-in (`BUGFLOW_DEMO_LOGIN=1`) — added 2026-10-28
- **Security impact:** while on, anyone who can open `/login` becomes Admin with no password. The user chose to enable it on the live site during marketing, knowing this. Turn it off (unset the variable, redeploy) as soon as possible.
- `/login` shows a "Login without credentials" link under the Sign in button. It calls `demoAdminAccess` → `demoUnlockAdmin`, which runs the normal `unlockAdmin` with `BUGFLOW_ADMIN_EMAIL`/`PASSWORD` from the server environment (origin check, throttle, hashed 8h session all unchanged). Credentials never reach the browser.
- Off (or any value other than `1`): the button is hidden and the server function refuses. The password form always stays available.

## Member portal links
- Created by Admin; default expiry 90 days. Stored as hash plus server-encrypted copy so Admin can re-copy.
- Every read validates: portal active, not revoked, not expired, user active and not deleted, role.
- Scope: `portal_projects` limits visible projects.

## Permissions (`src/lib/onboarding.ts`)
`view`, `view_all` (read all project bugs), `report`, `comment`, `evidence`, `validate`, `assign`, `verify`, `progress`, `recheck`, `disposition`.

| Role preset | Permissions |
| --- | --- |
| tester / other | view, view_all, report, comment, evidence |
| developer | + progress, recheck, disposition |
| qa | + validate, assign, verify |

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
