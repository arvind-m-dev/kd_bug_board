# Jira sync — how to connect, and what is still untested

Written for the product owner. Everything for the two-way sync is built and tested on this machine against a
stand-in for Jira. **No real Jira site has been connected yet.** That is the one gap, and this page is how to
close it on your personal Jira Free site.

Nothing here touches the company Jira, the live database or the demo login.

## What "untested" means

These are the things only a real Jira can prove. Each is built from Atlassian's published API description, but
none has been seen working live:

| What | Why it matters |
|---|---|
| Atlassian sign-in end to end | Connect, token refresh, reconnect |
| Creating, editing and moving a Jira issue | The heart of Bug Board → Jira |
| Jira's search finding a new issue within 90 seconds | This is what stops a second issue being created after a lost reply |
| The **Labels** field being on the Bug create screen | Needed for the same safeguard; "Switch on" refuses without it |
| Jira transitions that ask for extra fields | Such a move shows as a decision for you, not a silent failure |
| Setting the reporter to a member's own account | Jira may refuse depending on permissions |
| Sprints and story points through Jira's own fields | Built this way to avoid extra Jira permissions |
| Jira's push notifications (webhooks) | Need an https address; on your laptop the regular check is used instead |
| Rate limits and Jira being slow or down | Retries are built and tested, but not against the real limits |

## Your steps (about 20 minutes)

### 1. Jira site and project

1. Go to `atlassian.com/software/jira/free` and sign up with your **personal Gmail**.
2. Pick a site name, for example `yourname-trial`. Your site is then `https://yourname-trial.atlassian.net`.
3. When asked what to create, choose **Jira** and the **Scrum** template.
4. Name the project `BugFlow Trial` and make sure the key is `BFT`.
5. Open the project → **Project settings** → **Issue types** (may be called "Work types"). Check that **Bug**
   is in the list. If not, add it.
6. Click **Bug** in that list and check that **Labels** is among its fields. If not, add it.

### 2. The Atlassian app (lets Bug Board sign in)

1. Go to `developer.atlassian.com/console/myapps` → **Create** → **OAuth 2.0 integration**. Any name.
2. **Permissions** → next to **Jira API** click **Add**, then **Configure**.
3. Under **Classic scopes** → **Edit scopes**, tick exactly these four and save:
   `read:jira-work`, `write:jira-work`, `manage:jira-webhook`, `read:jira-user`.
4. **Authorization** → next to **OAuth 2.0 (3LO)** click **Add**. Callback URL:
   `http://localhost:8081/api/integrations/jira/callback` → **Save changes**.
5. **Settings** → copy the **Client ID** and the **Secret**. Keep the page open for step 4.

### 3. A trial copy of the database

1. Open `console.neon.tech` → your project → **Branches** → **Create branch**.
2. Name it `jira-trial`, parent `main`. Create it.
3. Copy its **connection string** (the one starting with `postgresql://`).

### 4. Fill in the trial file

Open the file `.env.jira-trial` in this folder and fill these four lines. **Do not paste them in chat.**

```text
DATABASE_URL=            the connection string from step 3
JIRA_CLIENT_ID=          from step 2
JIRA_CLIENT_SECRET=      from step 2
JIRA_ALLOWED_SITE_URL=   https://yourname-trial.atlassian.net
```

The other lines are already filled in. `JIRA_ALLOWED_SITE_URL` is a safety lock: no other Jira site can be
connected by mistake.

### 5. Start it

Tell Claude "the trial file is filled" and it does this for you, or run it yourself in order:

```bash
# 1. Prepare the TRIAL database only (it refuses nothing by itself: check the file first)
node --env-file=.env.jira-trial node_modules/jiti/lib/jiti-cli.mjs database/migrate.ts database/027_jira_sync.sql
# 2. Build and start Bug Board on port 8081 with the trial settings
npm run build
PORT=8081 node --env-file=.env.jira-trial .output/server/index.mjs
# 3. In a second terminal: the timer that makes the sync run
node --env-file=.env.jira-trial scripts/jira-sync-loop.mjs
```

Before step 1, make sure `DATABASE_URL` in `.env.jira-trial` is **not** the same as in `.env.local`.

### 6. Connect and switch on

1. Open `http://localhost:8081`, sign in (demo login works as before), go to **Settings → Jira**.
2. **Connect Jira** → Atlassian asks for permission → **Accept**. The page should say *Connected*.
3. **Projects → Map a project**: choose your Bug Board project and `BFT`. The statuses are filled in for you;
   change any you want. **Save**, then **Switch on**. If something is missing in Jira, it is listed.
4. **People**: for each member, **Link to Jira** if they have an account on your Jira site.

Switching on sends nothing by itself. A bug goes to Jira when it is next reported or changed.

## What to try, and what to write down

Use test bugs only, with titles starting `TRIAL-JIRA-`.

| Try | Expect |
|---|---|
| Report a bug in Bug Board | One issue appears in `BFT` within about a minute |
| Change its title, steps, priority | The same issue changes; no second issue |
| Move its status in Bug Board | The Jira issue moves to the mapped column |
| Create a Bug in Jira | One bug appears in Bug Board, reported by "Jira Sync" |
| Edit that issue in Jira | The Bug Board bug changes |
| Move a Jira issue to Done | Bug Board does **not** resolve it; it shows under Sync as a decision |
| Change the same title on both sides | Neither is overwritten; it shows under Sync with both values |
| Stop the timer, change something in Jira, start it again | The change arrives after the next full check |

Please note for each: did it arrive once, how long it took, and anything that showed as "stopped".

## Good to know

- **Timer.** On your laptop the sync runs because of the script in step 5. A deployed Bug Board needs a
  scheduler calling the two job addresses (`/api/internal/jira/process` every minute or less,
  `/api/internal/jira/reconcile` every few minutes) with the secret `JIRA_JOB_SECRET`. Vercel's free plan
  allows one scheduled call a day, which is not enough; this needs a decision before going live.
- **Jira's push notifications** need an `https` address, which `localhost` is not. Without them everything
  still works, a little slower (up to a minute). To try them later: an https tunnel to port 8081,
  `BUGFLOW_TRUST_PROXY=1`, the tunnel address as `JIRA_PUBLIC_ORIGIN`, and the same address in the Atlassian
  app's callback URL.
- **Trash.** Deleting a bug never deletes the Jira issue, and the other way round.
- **Media files.** The trial database is a copy that still points at the real media storage. Do not delete
  files forever inside the trial.

## Choices made for you (say if you want them different)

| Choice | Now |
|---|---|
| Jira's Done resolving a bug | Never, unless you tick the box in the project mapping; then only for a bug waiting for retest |
| Who may move status from Jira | Anyone in Jira, but only along Bug Board's workflow |
| Priority, severity, due date changed in Jira | Not taken; Bug Board's value is the one that counts |
| Assigning from Jira | Only to a member linked under People who is on the project |
| Existing bugs when a project is switched on | Not sent in bulk; each goes when it is next changed |
| Sprints | Jira owns them; Bug Board mirrors the ones your bugs are in |

## Not included

- Comments and attachments are not copied (Jira gets a link back to the bug).
- Jira Server and Data Center are not supported, only Jira Cloud.
- The company Jira is not to be connected until you say so.
