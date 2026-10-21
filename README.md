# Futurist Global Bug Board

Bug reporting, assignment and QA verification for Futurist Global teams. Admins manage projects and members; reporters, QA and developers work through private portal links.

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
| `AI_API_KEY` | no | Enables AI welcome drafts. Defaults to Google Gemini; free key at https://aistudio.google.com/apikey |
| `AI_BASE_URL` / `AI_MODEL` | no | Use another OpenAI-compatible provider, e.g. `https://api.openai.com/v1` + `gpt-5-mini` |

## Database

Schema changes live in versioned SQL files under [`database/`](database/), applied in order (`001` … `010`).

## Scripts

- `npm run dev` – dev server (loads `.env.local`)
- `npm run build` – production build
- `npm test` – unit tests
