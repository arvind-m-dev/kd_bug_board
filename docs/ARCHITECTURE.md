# Architecture

Binding rules: `AGENTS.md`. This doc maps the code.

## Layers
1. **Routes** (`src/routes`): thin TanStack file routes; each sets its own `head` via `pageHead`. `/admin*` routes share a server-session `beforeLoad` that redirects to `/login?redirect=<path>` (`admin-route-access.ts`, `safeReturnPath`). Portal routes (`/reporter|developer|qa|member/$portalToken`) validate the token themselves.
2. **Components** (`src/components/bugflow`): presentation only. Data via TanStack Query (`query-cache.ts`).
3. **Server functions** (`src/lib/*.functions.ts`): input parsing (zod) and dispatch only; logic in matching `*.server.ts`.
4. **Pure domain** (`src/lib/bugflow.ts`, `bug-workflow.ts`, `bug-media.ts`, `trash.ts`, `notifications.ts`, …): no I/O; unit-tested.
5. **Data**: `neon.server.ts` (`neonQuery`) against the `bugflow` schema.

## Access model in code
Every bug-related server function takes `access` (`accessSchema`): Admin session cookie, a portal token, or (MCP only) an AI token. The server resolves it to a `BugActor { role, userId, permissions, projectIds }` and checks pure rules (`maySeeBug`, `mayUpdateStatus`, `mayVerify`, `mayEditBug`, media rules). Same functions serve Admin UI, portals and MCP.

## Raw HTTP (`src/server.ts`)
`/api/health` (select 1), `/api/presence`, `/api/mcp` and `/mcp` (stateless Streamable HTTP, CORS-open), `/api/oauth/*`, `/.well-known/oauth-*` → `oauth-routes.server.ts`. Everything else → TanStack Start handler; portal paths get extra headers.

## Media flow
Browser asks `prepareMediaUpload` → presigned PUT → browser uploads direct to bucket (plus `<key>.thumb.jpg`) → `finishMediaUpload` records `bug_media`. Viewing uses signed GET links stable per 5-minute window. Bucket config: workspace setting (encrypted secret) else `MEDIA_S3_*`.

## Writes and concurrency
Bug edits/changes: optimistic `version` (= `bugs.updated_at`) + request ID; one SQL statement checks version and writes the audit row (`bug_mutations`, `activity`). Video marks use `marks_version`.

## Frontend shared services
`media-queue.ts` (tab-wide upload queue), `action-feedback.tsx` (confirm/error/retry), theme provider (`appearance.ts`), `share-origin.ts` (links use `VITE_SITE_URL` when on localhost).

## Decorative scenes
Three.js scenes (`brand-scene.ts`, `seasonal-*.ts`, `minimal-geometry-scene.ts`) gated by `scene-quality.ts`; no data access.
