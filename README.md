# Bug Board

Bug reporting, assignment and QA verification for your team. Admins manage projects and members; reporters, QA and developers work through private portal links.

## Stack

TanStack Start (React 19), Tailwind CSS + shadcn/ui, Neon Postgres, deployed on Vercel.

## Local development

```sh
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:8080
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon connection string (Neon console → Connect) |
| `BUGFLOW_ADMIN_EMAIL` | yes | Admin sign-in email |
| `BUGFLOW_ADMIN_PASSWORD` | yes | Admin sign-in password |
| `BUGFLOW_PORTAL_ENCRYPTION_KEY` | yes | Encrypts saved member portal links (`openssl rand -hex 32`) |
| `VITE_SITE_URL` | recommended | Live site address. Portal, file and MCP links copied on a local dev server use it instead of `localhost` |
| `DATABASE_STORAGE_LIMIT_GB` | no | Database limit for the storage meter in Settings → System health. Default 1 (Neon Free plan); `0` = no limit (paid plans) |
| `AI_API_KEY` | no | Enables AI welcome drafts. Defaults to Google Gemini; free key at https://aistudio.google.com/apikey |
| `AI_BASE_URL` / `AI_MODEL` | no | Use another OpenAI-compatible provider, e.g. `https://api.openai.com/v1` + `gpt-5-mini` |
| `MEDIA_S3_ENDPOINT` / `MEDIA_S3_BUCKET` / `MEDIA_S3_ACCESS_KEY_ID` / `MEDIA_S3_SECRET_ACCESS_KEY` | no | All four together enable private screenshot, recording and PDF uploads to an S3-compatible bucket (Cloudflare R2 free tier; guide in Settings → Media storage) | These are only a hosting fallback: the workspace bucket Admin enters in Settings → Media storage (secret stored encrypted with `BUGFLOW_PORTAL_ENCRYPTION_KEY`) is the default for every portal and takes precedence.
| `MEDIA_S3_REGION` / `MEDIA_S3_FORCE_PATH_STYLE` | no | Defaults `auto` and `1` (right for R2); set the region for Backblaze B2 or AWS S3 |

## Database

Schema changes live in versioned SQL files under [`database/`](database/), applied in order (`001` … `020`).

## Scripts

- `npm run dev` – dev server (loads `.env.local`)
- `npm run build` – production build
- `npm test` – unit tests

## AI access (MCP)

BugFlow is a [Model Context Protocol](https://modelcontextprotocol.io) server, so any MCP client (Claude Code, Claude.ai, Cursor, VS Code, ChatGPT) can read and report bugs.

- **Endpoint**: `/api/mcp` (also `/mcp`), Streamable HTTP, stateless. CORS-open; the token is the credential.
- **Auth**: a Bearer **AI token**. Each token belongs to one panel — the Admin panel or a member panel — and inherits exactly that panel's permissions and project scope, so an AI can never see or do more than that person. Tokens are stored only as a SHA-256 hash (`bugflow.ai_tokens`, migration `016`) and are revocable at any time.
- **Create a token**: Admin in Settings → AI access (for the Admin panel or any member panel); a member in their portal → AI access tab (their own panel). The secret is shown once.
- **Tools**: `whoami`, `list_projects`, `list_bugs`, `get_bug`, `report_bug`, `update_bug_status`, `comment_bug`, and `assign_bug` (panels with the assign permission). There is no delete tool.
- **Connect from Claude Code**:
  ```
  claude mcp add --transport http bugflow https://<your-app>/api/mcp --header "Authorization: Bearer <token>"
  ```
  Cursor and VS Code take the same URL and header. No new environment variables are required.
- **Connect from claude.ai / ChatGPT (OAuth)**: add a custom connector pointing at `https://<your-app>/api/mcp`. The connector walks an OAuth 2.1 authorization-code + PKCE flow (discovery at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, dynamic client registration at `/api/oauth/register`, a consent page at `/api/oauth/authorize`, and `/api/oauth/token`). On the consent page the user signs in as Admin (email + password) or with a member portal link and approves. The issued access token is an ordinary AI token (migration `017`: `oauth_clients`, `oauth_codes`), so an OAuth connection is scoped per panel and revocable in Settings → AI access like any other token.
- **Token-efficient output**: tools answer in compact text (a one-line-per-bug table for `list_bugs`, a short labelled block for `get_bug`) rather than verbose JSON, so an AI reads and understands many bugs for far fewer tokens.
