# Deploy Bug Board to Vercel and connect Jira

For whoever deploys Bug Board and connects it to a company Jira Cloud site. Do the parts in order. Part A alone
gives a working Bug Board; Jira is optional and can be added any time later.

## 0. Bug Board without Jira

Bug Board is complete on its own. Without the Jira settings, or before anyone connects Jira:

- every portal, bug, board, sprint, backlog, report, Trash and AI-access feature works exactly as before;
- Settings → Jira shows "Unavailable" with the settings that are missing, and nothing is ever sent anywhere;
- disconnecting or pausing Jira later leaves every bug in place on both sides.

This is covered by the test suite (`without027` database checks run every feature with no Jira tables at all).

## A. Clean deploy on Vercel

1. **Database.** Create a new Neon project (or a new branch) for this deploy. Never reuse the trial database.
   Apply every migration to it from a local checkout:

   ```sh
   DATABASE_URL="<new database connection string>" npm run db:migrate
   ```

   (A `DATABASE_URL` set on the command line wins over `.env.local`.)
2. **Vercel project.** Import the GitHub repository into Vercel. Build settings come from `vercel.json`.
3. **Environment variables** (Vercel → Settings → Environment Variables). Values are never written in docs or chat.

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the new database |
   | `BUGFLOW_ADMIN_EMAIL`, `BUGFLOW_ADMIN_PASSWORD` | the Admin sign-in |
   | `BUGFLOW_PORTAL_ENCRYPTION_KEY` | new: `openssl rand -hex 32` |
   | `VITE_SITE_URL` | `https://<your domain>` |
   | `BUGFLOW_DEMO_LOGIN` | **leave unset** unless you want one-click Admin access for anyone with the URL |
   | Media (`MEDIA_S3_*`) | optional; or set the bucket later in Settings → Media storage |

   Do **not** set `BUGFLOW_TRUST_PROXY` on Vercel (it is only for a local HTTPS tunnel).
4. **Deploy**, open `https://<your domain>/api/health`, then sign in as Admin.
5. **Media bucket CORS**: add the new domain to the bucket's allowed origins, then Settings → Media storage → Test.

## B. Jira settings and the scheduler (only when connecting Jira)

### B1. Atlassian app (one per Bug Board deploy)

At developer.atlassian.com → Console → Create → **OAuth 2.0 integration**, preferably under a company account:

- **Permissions → Jira API**, classic scopes: `read:jira-work`, `write:jira-work`, `manage:jira-webhook`,
  `read:jira-user`. (Bug Board also asks for `offline_access` itself, to stay signed in.)
- **Authorization → callback URL**: `https://<your domain>/api/integrations/jira/callback`
- **Distribution → Sharing**: on, if the person who will sign in is not the app's owner.
- Copy the Client ID and Secret into Vercel (below).

### B2. More environment variables

| Name | Value |
|---|---|
| `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` | from the Atlassian app |
| `JIRA_TOKEN_ENCRYPTION_KEY` | new: `openssl rand -hex 32` |
| `JIRA_JOB_SECRET` | new: `openssl rand -hex 32` |
| `JIRA_PUBLIC_ORIGIN` | `https://<your domain>` |
| `JIRA_ALLOWED_SITE_URL` | `https://<company>.atlassian.net`, so no other Jira site can be connected by mistake |
| `CRON_SECRET` | only with Vercel Cron (B3): new, 32+ characters |

Redeploy after adding them.

### B3. Scheduler (required for syncing)

Something must call the sync every minute. It finds missed changes and retries failures; Bug Board also sends
each change the moment it is saved, and Jira notifies Bug Board instantly over HTTPS, so the scheduler is the
safety net.

- **Vercel Pro**: add to `vercel.json`, then deploy. Vercel calls it with `CRON_SECRET`.

  ```json
  { "crons": [{ "path": "/api/internal/jira/reconcile", "schedule": "* * * * *" }] }
  ```

  (On the Hobby plan Vercel refuses schedules more often than daily; use the next option instead.)
- **Free (any plan)**: cron-job.org (or similar) → new job, every minute:
  `POST https://<your domain>/api/internal/jira/reconcile` with header `Authorization: Bearer <JIRA_JOB_SECRET>`.
  A `200` reply means it ran; `401` means the secret is wrong; `503` means `JIRA_JOB_SECRET` is not set.

## C. What the company Jira admin provides

1. **Jira Cloud** (not Server / Data Center).
2. **Approval of the Atlassian app** if the company restricts third-party apps.
3. **A dedicated integration account** (for example "Bug Board Sync") to sign in with. If a person's own account
   is used and they leave or lose access, syncing stops.
4. That account's **permissions in the Jira project**: Browse projects, Create issues, Edit issues, Transition
   issues, Assign issues, Modify reporter, Schedule issues (due date and sprints); and the global **Browse users
   and groups** (to find people). Without Modify reporter, sync still works and the reporter is shown as text.
5. **The project and its Bug issue type.** The board that shows this project shows the synced bugs; a board
   filtered to only part of a project is not supported yet.
6. **A Jira status for each Bug Board status** (Bug Board has 13; several may share one Jira status). Decide which
   Jira status means "Won't fix", used when a bug is moved to Trash (if that option is on).
7. **People**: everyone who should appear in Jira by name needs a Jira account (invited by the Jira admin; Bug
   Board never creates Jira accounts).

## D. Switching it on (in Bug Board, as Admin)

1. Settings → Jira → **Sign in to Jira** with the integration account → pick the company site.
2. **Map a project**: the Bug Board project, the Jira project, issue type Bug. Check the suggested status and
   priority mapping; choose the options:
   - assignee, due date, sprints, estimate;
   - name labels for people without a Jira account;
   - **Deleting**: Trash closes the Jira issue / a Jira delete moves the bug to Trash (both off by default).
3. **Save** → **Check against Jira** → **Switch on**.
4. **Sync existing bugs** (shows the counts each way before anything moves).
5. People → **Sync members**: links everyone whose email Jira knows; link or add the rest by hand.
6. Pilot with **one project** for a week before mapping more.

## E. Checks after switching on

| Check | Expected |
|---|---|
| Change a bug's priority in Bug Board | Jira shows it within seconds |
| Change the issue's title in Jira | Bug Board shows it within seconds (notifications) or a minute (scheduler) |
| Settings → Jira → Sync | "Jira notifies Bug Board of changes" (HTTPS deploy), last full check under 2 minutes ago |
| Sync log | Lines both ways, with names; no stopped errors |
| Same bug twice? | Nothing, or real duplicates to link or dismiss |

## F. If something goes wrong

- **"Sign in again" shown**: the Atlassian sign-in expired or was revoked; sign in again, nothing is lost.
- **Stopped work in the Sync log**: read the reason (usually a Jira permission or a status with no transition),
  fix it in Jira, then **Retry stopped work**.
- **A decision waiting**: the same field was changed on both sides; choose which value to keep.
- **Pause** stops all syncing for a project; **Disconnect** stops everything. Neither deletes anything.
