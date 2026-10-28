# Project overview

## Purpose
Bug Board is a QA workspace: people report bugs with evidence, QA triages and assigns them, developers fix, and QA verifies the fix before a bug is resolved.

## Technologies
- **Frontend/SSR**: TanStack Start + TanStack Router (file-based routes), React 19, TanStack Query, Tailwind CSS, shadcn/ui (Radix), Three.js scenes for decorative backgrounds.
- **Backend**: TanStack Start server functions (`createServerFn`) and a custom fetch handler in `src/server.ts` (Nitro output).
- **Database**: Neon Postgres via `@neondatabase/serverless`, schema `bugflow`.
- **Media**: S3-compatible bucket (Cloudflare R2) via `@aws-sdk/client-s3`, presigned browser uploads.
- **AI**: MCP server (`@modelcontextprotocol/sdk`) with OAuth 2.1 + PKCE; optional OpenAI-compatible API (`@ai-sdk/openai`) for onboarding drafts.
- **Hosting**: Vercel (`vercel.json`: `npm install`, `npm run build`).

## User roles and portals
| Who | Entry | Notes |
| --- | --- | --- |
| Admin | `/login` → `/admin*` | Single owner from `BUGFLOW_ADMIN_EMAIL`/`PASSWORD`; 8-hour hashed session |
| Tester / reporter | `/reporter/$portalToken` or `/member/$portalToken` | Report, comment, view |
| Developer | `/developer/$portalToken` | Progress assigned bugs, request recheck, disposition |
| QA | `/qa/$portalToken` | Validate, assign, verify |
| AI client | `/api/mcp` | Bearer AI token scoped to one panel |

Role presets: `rolePermissions` in `src/lib/onboarding.ts`. Details: [AUTH_AND_PERMISSIONS.md](AUTH_AND_PERMISSIONS.md).

## Major modules
Bug workflow · Projects & members · Media (upload queue, marks, trash) · Notifications & activity · Reports/dashboard/export · Appearance/themes · AI (MCP, OAuth, tokens, onboarding) · System health. See [FEATURES.md](FEATURES.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Key external dependencies
Neon (`DATABASE_URL`), S3/R2 bucket (workspace setting or `MEDIA_S3_*`), optional AI provider (`AI_API_KEY`). Variable list: [STORAGE_AND_DEPLOYMENT.md](STORAGE_AND_DEPLOYMENT.md).
