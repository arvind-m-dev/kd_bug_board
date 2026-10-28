# Storage and deployment

Names only; never record values.

## Environment variables
| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon connection |
| `BUGFLOW_ADMIN_EMAIL`, `BUGFLOW_ADMIN_PASSWORD` | yes | Admin sign-in |
| `BUGFLOW_PORTAL_ENCRYPTION_KEY` | yes | Encrypts portal link copies and workspace bucket secret |
| `VITE_SITE_URL` | recommended | Public origin for copied links and OG image |
| `DATABASE_STORAGE_LIMIT_GB` | no | Storage meter limit (default 1; 0 = none) |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | no | AI onboarding drafts |
| `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | no | Fallback media bucket (workspace setting wins) |
| `MEDIA_S3_REGION`, `MEDIA_S3_FORCE_PATH_STYLE` | no | Defaults `auto`, `1` (R2) |
| `DATABASE_DOH` | local only | DNS-over-HTTPS workaround |
| `BUGFLOW_DEMO_LOGIN` | no, **temporary** | `1` = one-click Admin sign-in with no password. Anyone with the URL becomes Admin. Remove after marketing |

Template: `.env.example`. Local values in `.env.local` (not committed).

## Media (Cloudflare R2)
- Upload: browser → presigned PUT direct to bucket; `<key>.thumb.jpg` preview alongside. Bucket CORS **must list every app origin** (localhost and production), or uploads fail. Settings → Media storage → Test runs a preflight per origin (`corsBlockedOrigins`).
- View: signed GET links, stable per 5-minute window.
- Removal: Trash 30 days (`restorable_until`), then media sweep deletes the object.
- Quota/cleanup configurable in Settings → Media storage.

## Build and deploy
- Build: `npm run build` (Vite + Nitro → `.output/`). Vercel uses `vercel.json` (`npm install`, `npm run build`).
- Migrations: run `npm run db:migrate` against the target `DATABASE_URL` **before** deploying code that needs them. Migrations are additive/idempotent.
- Health check: `GET /api/health`.
- Deploy only through the existing Vercel process with explicit approval; not part of routine feature work.

## Rollback
Redeploy the previous Vercel build. Migrations are additive, so older code keeps working with newer schema; do not drop columns to roll back.
