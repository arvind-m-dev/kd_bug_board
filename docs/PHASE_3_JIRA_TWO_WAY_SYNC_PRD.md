# Phase 3 PRD — Jira Cloud two-way bug synchronization

Status: Proposed  
Date: 2026-11-05  
Product: BugFlow / Bug Board  
Phase boundary: Jira Cloud, bugs, one Jira project mapping per BugFlow project

## 1. Summary

An Admin connects a BugFlow project to a Jira Cloud site, Jira project, and optionally a Jira Software board. From that point:

- an eligible Jira Bug created in the mapped Jira project is created in BugFlow;
- a BugFlow bug created in the mapped BugFlow project is created in Jira;
- supported edits made on either side are propagated to the linked record on the other side;
- Jira workflow changes are translated into valid BugFlow workflow actions, and BugFlow workflow changes use valid Jira transitions;
- every inbound Jira change is scoped, version-safe, idempotent, and audited in BugFlow;
- failed deliveries remain recoverable and visible rather than being silently dropped;
- a reconciliation process repairs missed webhooks and detects drift.

This phase synchronizes records that power the boards. It does not attempt to reproduce Jira's visual board UI inside BugFlow or BugFlow's board UI inside Jira.

## 2. Product decision

### 2.1 Backend/endpoints-first is supported

The first delivery may expose only server endpoints and database-backed administration, with the settings UI added afterward. This is enough to prove the complete flow if the connection and mapping records are configured through a protected bootstrap endpoint or migration.

However, OAuth connection endpoints alone do not constitute two-way synchronization. The minimum complete backend consists of:

1. OAuth connect and callback endpoints;
2. connection and mapping persistence;
3. a Jira webhook endpoint;
4. a durable inbound inbox;
5. a durable outbound outbox;
6. a sync processor endpoint/job;
7. a reconciliation endpoint/job;
8. status, retry, pause, reconnect, and disconnect operations.

### 2.2 Supported Jira product

MVP supports Jira Cloud only. Jira Server and Jira Data Center are out of scope because their authentication, installation, network accessibility, and webhook models require a separate design.

### 2.3 Authentication

Use one BugFlow-owned Atlassian OAuth 2.0 (3LO) integration. Tokens are held only by the BugFlow server. Do not collect customer API tokens and do not ask every customer to create an OAuth application.

For company use, a Jira/site Admin approves the integration and a company-managed integration account authorizes it. The authorizing account must have the project permissions required for every enabled operation.

## 3. Goals

- Create a corresponding bug when a bug is raised on either connected board.
- Keep core bug fields synchronized in both directions.
- Preserve BugFlow's 13-status domain workflow and Jira's configured workflow.
- Preserve BugFlow's access, verification, concurrency, audit, sprint, and soft-deletion rules.
- Avoid duplicate records and infinite update loops.
- Survive webhook duplication, missing webhooks, temporary API failure, process restarts, and rate limits.
- Give Admins a clear operational view of connection health, pending work, failures, and conflicts.

## 4. Non-goals for MVP

- Jira Server or Data Center.
- Synchronizing arbitrary Jira issue types; only the configured Jira Bug issue type is imported.
- Full two-way epics, stories, tasks, and parent hierarchy.
- Creating Jira projects, boards, users, workflows, statuses, or custom fields automatically.
- Copying media binaries into Jira or importing Jira attachment binaries into R2.
- Comment synchronization.
- Delete propagation in either direction.
- Mirroring Jira board filters, swimlanes, quick filters, or column layout.
- Multiple Jira issues linked to one BugFlow bug, or one Jira issue linked to multiple BugFlow bugs.
- Guaranteed ordering between unrelated bugs.

## 5. Existing BugFlow rules the integration must preserve

The sync layer is not allowed to write arbitrary bug rows directly without applying these rules:

- `bugs.id` remains BugFlow's identity; the formatted prefix/code is display-only.
- Bug creation is idempotent through a request ID.
- Bug changes use the current `updated_at` value as an optimistic version.
- Activity, status history, assignment, verification, and the mutation must be committed atomically.
- The 13 statuses and transition graph in `src/lib/bugflow.ts` remain authoritative for BugFlow.
- Moving to `RESOLVED` represents a QA verification outcome, not a generic status edit.
- Assignment may advance a validated bug to `ASSIGNED` and carries project-access rules.
- Non-Admin edits cannot change priority or severity.
- Due dates are calendar dates and BugFlow overdue state is derived using the workspace time zone.
- Sprints allow at most one open membership per bug and one active sprint per project.
- Backlog epics cannot be added to sprints.
- Deleted BugFlow bugs are soft-deleted and remain recoverable; Jira must not remotely delete them.
- Member project scope and portal permissions must not be widened by an inbound Jira change.
- All integration actions must produce immutable activity records.

## 6. Personas and authorization

### BugFlow Admin

- Connects, maps, pauses, reconnects, or disconnects Jira.
- Chooses Jira site/project/board/issue type.
- Maps fields, priorities, statuses, sprints, and users.
- Runs initial import/export previews.
- Resolves conflicts and retries failures.

### Jira authorizing account

- Grants OAuth access to BugFlow.
- Its Jira permissions cap what BugFlow can read or change.
- Recommended to be a company-managed integration account rather than a personal employee account.

### Jira user

- Creates or edits bugs in Jira normally.
- Does not receive a BugFlow portal automatically.
- May be mapped to an existing BugFlow user for attribution and assignment.

### BugFlow member

- Continues using existing role and project permissions.
- Does not receive additional authority because Jira is connected.
- Their eligible BugFlow changes may be exported using the integration identity.

## 7. Connection configuration

One active mapping connects:

```text
BugFlow project
    ↕
Jira Cloud site + Jira project + Jira Bug issue type
    ↕
optional Jira Software board used for sprint, estimate, and rank APIs
```

MVP allows one active Jira mapping for each BugFlow project. A Jira project may map to only one active BugFlow project in the same workspace.

Required configuration:

- Jira Cloud resource/cloud ID;
- Jira site URL and display name;
- Jira project ID and key;
- Jira Bug issue type ID;
- optional board ID;
- status mapping with canonical inbound status;
- priority mapping;
- optional severity custom-field mapping;
- optional BugFlow-code custom-field mapping;
- optional environment, module, steps, expected, and actual field mappings;
- assignee policy;
- sprint and estimate switches;
- import JQL constrained to the mapped project and issue type;
- sync enabled/paused state.

## 8. Endpoints

All routes are handled explicitly in `src/server.ts`, following the existing MCP/OAuth pattern. Browser administration endpoints require a live Admin session and same-origin validation. Jira callbacks and internal jobs use their own authentication.

### Public/admin connection endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/integrations/jira/connect` | Require Admin, create OAuth state/PKCE, redirect to Atlassian |
| `GET` | `/api/integrations/jira/callback` | Validate state, exchange code, discover accessible sites, save encrypted grant |
| `GET` | `/api/integrations/jira/resources` | List accessible sites, projects, boards, issue types, fields, statuses |
| `POST` | `/api/integrations/jira/configure` | Validate and save one project mapping |
| `POST` | `/api/integrations/jira/preview` | Dry-run initial import/export and expose duplicates/errors |
| `POST` | `/api/integrations/jira/activate` | Confirm preview, register webhook, enqueue initial work |
| `GET` | `/api/integrations/jira/status` | Connection, webhook, queue, cursor, and conflict health |
| `POST` | `/api/integrations/jira/sync-now` | Enqueue reconciliation; do not perform an unbounded sync in the request |
| `POST` | `/api/integrations/jira/retry` | Retry selected failed operations |
| `POST` | `/api/integrations/jira/pause` | Stop new export processing and inbound application while retaining events |
| `POST` | `/api/integrations/jira/reconnect` | Start OAuth again without discarding mappings/links |
| `POST` | `/api/integrations/jira/disconnect` | Revoke/erase credentials and webhook; retain bugs and link history |

### Jira and internal endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/integrations/jira/webhook/:connectionId` | Authenticate, validate size/type, persist event, return quickly |
| `POST` | `/api/internal/jira/process` | Claim and process bounded inbox/outbox batches |
| `POST` | `/api/internal/jira/reconcile` | Incremental Jira search, drift detection, webhook renewal |

Internal endpoints require a dedicated `JIRA_JOB_SECRET` bearer credential and must never accept browser cookies as authorization. They can be invoked by a hosting scheduler. Processing is bounded so it fits the serverless runtime; additional work remains queued.

## 9. Data model — migration 027

Create `database/027_jira_sync.sql` with additive, idempotent statements.

### `bugflow.integration_actors`

One non-login system actor used to attribute Jira activity without impersonating an Admin or member.

- `id uuid primary key` referencing/paired with a system user;
- `kind = 'jira'`;
- display name such as `Jira Sync`.

### `bugflow.jira_connections`

- `id uuid primary key`;
- `cloud_id text not null`;
- `site_url text not null`;
- `site_name text not null`;
- `authorized_account_id text`;
- encrypted access token and rotating refresh token;
- token expiry and granted scopes;
- token generation/version for atomic refresh rotation;
- state: `connected`, `paused`, `reauthorization_required`, `revoked`, `error`;
- webhook ID and expiry;
- last successful API call, last event, last reconciliation, last error;
- created/updated/disconnected timestamps.

Token ciphertext is never returned to the browser. Encryption uses a dedicated `JIRA_TOKEN_ENCRYPTION_KEY`, not `DATABASE_URL`, the Admin password, or an application signing secret used elsewhere.

### `bugflow.jira_project_mappings`

- connection and BugFlow project IDs;
- Jira project ID/key, issue type ID, optional board ID;
- status, priority, field, and user-policy mappings as validated JSON;
- import JQL suffix or normalized filter settings;
- feature switches for sprint, estimate, rank, media links;
- active/paused state and initial-sync state;
- unique active BugFlow-project mapping;
- unique active connection/Jira-project mapping.

### `bugflow.jira_issue_links`

- BugFlow bug ID;
- Jira immutable issue ID;
- current Jira key;
- mapping ID;
- origin: `bugflow` or `jira`;
- last normalized BugFlow snapshot;
- last normalized Jira snapshot;
- last Jira `updated` time;
- last BugFlow version;
- last synchronized time;
- state: `linked`, `conflict`, `remote_missing`, `local_trashed`, `disabled`;
- unique Jira issue per connection;
- unique active link per BugFlow bug.

Always identify Jira records by immutable Jira issue ID. Store the issue key for display because keys can change when issues move between projects.

### `bugflow.jira_inbox`

- event ID and connection ID;
- deduplication key;
- event type, Jira issue ID/key, Jira updated time;
- raw payload with retention limit;
- state: `pending`, `processing`, `done`, `retry`, `conflict`, `dead`;
- attempt count, next attempt, lease owner/expiry, last error;
- received/processed timestamps.

### `bugflow.jira_outbox`

- operation ID and mapping/link/bug IDs;
- operation: `create`, `update_fields`, `transition`, `assign`, `sprint`, `estimate`, `link`, `refresh_webhook`;
- stable idempotency/deduplication key;
- base BugFlow version and normalized desired payload;
- state, attempt count, next attempt, lease, error;
- created/processed timestamps.

The outbox record is inserted in the same Neon transaction as the local BugFlow mutation that requires export.

### `bugflow.jira_conflicts`

- link, field, local value, remote value, base value;
- local/remote change metadata;
- reason and resolution state;
- resolver, resolution, and timestamps.

### `bugflow.jira_user_mappings`

- connection ID;
- BugFlow user ID;
- Atlassian account ID;
- last known display name/email when available;
- mapping source and confirmation state.

Email may suggest a match during setup, but Atlassian account ID is the remote identity.

## 10. Normalized sync model

The sync engine translates both systems into one internal representation before comparing:

```ts
type SyncedBug = {
  title: string
  description: string
  steps: string[]
  expected: string
  actual: string
  priority: string
  severity: string | null
  status: string
  assignee: string | null
  dueOn: string | null
  environment: string
  module: string
  sprint: string | null
  estimate: number | null
}
```

Jira descriptions use Atlassian Document Format. Conversion must be deterministic and preserve a BugFlow-managed section structure. BugFlow must not overwrite unrelated Jira description content outside its managed block unless the Admin explicitly maps the whole description as managed.

## 11. Field behavior

| Field | Direction | Rule |
|---|---|---|
| Title / Jira summary | Both | Conflict if both changed differently from base |
| Description | Both | ADF conversion; managed-section strategy |
| Steps | Both if mapped | Custom field or managed description section |
| Expected/actual | Both if mapped | Custom fields or managed description sections |
| Priority | Both | Explicit value mapping; unsupported value is conflict |
| Severity | Both if custom field mapped | No Jira field is assumed |
| Status | Both | Explicit workflow mapping; never assign status as a normal field |
| Assignee | Both | Only confirmed user mappings; no BugFlow user creation |
| Due date | Both | Plain `YYYY-MM-DD`; BugFlow overdue remains derived |
| Environment/module | Both if mapped | Options normalized; no silent creation of BugFlow settings |
| Sprint | Both when enabled | Mapping required; BugFlow invariant still enforced |
| Estimate | Both when enabled | Explicit units/field selection |
| Rank | Deferred | Jira and BugFlow ranking semantics differ |
| Comments | Deferred | Avoid duplicates/mentions/permission leaks in MVP |
| Media | Link-only outbound | No binary copying in MVP |
| Delete/trash | Neither | Mark missing/trashed and require Admin action |

## 12. Create flows

### 12.1 BugFlow → Jira

1. Existing `reportBug` validates access, project scope, report permission, options, and request ID.
2. The same database transaction creates the bug, details, steps, history, activity, and a `jira_outbox(create)` row when the project has an active mapping.
3. The response to the reporter does not wait for Jira.
4. A processor claims the outbox row.
5. It refreshes OAuth if needed under a per-connection advisory lock.
6. It reads Jira create metadata and creates the issue with the mapped Bug issue type.
7. It creates `jira_issue_links`, stores normalized snapshots, and records `jira.created` activity.
8. Failure is retried or surfaced; the BugFlow bug remains valid and visible with sync state.

### 12.2 Jira → BugFlow

1. Jira emits an issue-created webhook.
2. The webhook endpoint authenticates the request, resolves the connection, enforces payload limits, and inserts a deduplicated inbox row.
3. The processor fetches the current Jira issue from Jira rather than trusting the webhook as the full source of truth.
4. It verifies mapped project, configured Bug issue type, and optional import filter.
5. If already linked, the event becomes an update.
6. It searches only for a deterministic integration marker/link; title similarity alone never auto-links.
7. It maps the Jira reporter to a BugFlow user when confirmed. Otherwise it uses the Jira integration actor as reporter and stores remote reporter metadata in activity/link data.
8. It creates the BugFlow bug, details, steps, history, activity, and link atomically with a deterministic request ID derived from connection + Jira issue ID.
9. The imported bug starts at the explicitly mapped BugFlow status. If Jira status cannot be represented legally, create it as `NEW` and open a mapping conflict rather than bypassing the workflow.

## 13. Update flows

### 13.1 BugFlow → Jira

All Jira-relevant BugFlow mutations append an outbox operation in their existing atomic statement. This includes report edits, status, priority, severity, assignment, verification, due date, sprint membership, and estimate changes.

The processor compares the base snapshot, current BugFlow state, and current Jira state:

- local-only change: apply to Jira;
- same change on both sides: acknowledge and refresh snapshots;
- both changed differently: create a conflict;
- Jira permission/schema/workflow failure: mark actionable failure;
- transient failure/rate limit: retry with backoff and jitter.

### 13.2 Jira → BugFlow

The inbound processor fetches the latest Jira issue and performs the same three-way comparison. It applies changes through a new internal Jira sync service that shares pure domain rules with the browser server functions but acts as the integration actor.

It must not call browser server functions with forged access. It must not use an Admin cookie. It must not widen portal project access.

## 14. Status and verification mapping

Every Jira status maps to one canonical BugFlow status. Multiple BugFlow statuses may map to one Jira status, but the configuration must choose the canonical inbound BugFlow status for that Jira status.

Outbound BugFlow status change:

1. read available Jira transitions for the issue;
2. choose the configured transition matching the target Jira status;
3. if exactly one valid transition exists, execute it;
4. if none or multiple ambiguous transitions exist, create an actionable conflict;
5. confirm the resulting Jira status before advancing the snapshots.

Inbound Jira status change:

- follow BugFlow's transition graph;
- allow safe triage paths already supported by `statusPath`;
- never manufacture assignment or verification data;
- a Jira move to a status mapped to `RESOLVED` cannot create a false BugFlow QA verification.

MVP policy for Jira `Done` → BugFlow `RESOLVED`:

- if the BugFlow bug is `RECHECK`, record an integration verification with Jira actor/change metadata and resolve it;
- otherwise create a status conflict requiring BugFlow Admin/QA review;
- terminal dispositions (`DUPLICATE`, `NOT_A_BUG`, `WONT_FIX`) need distinct Jira status or resolution mappings and cannot be inferred from generic `Done`.

This policy protects the meaning of BugFlow's QA gate while still supporting a real two-way workflow.

## 15. Sprint behavior

Sprint sync is enabled only when a Jira Software board is selected.

- Jira sprint IDs map to BugFlow sprint IDs.
- Initial configuration chooses whether Jira or BugFlow creates sprint containers. MVP recommendation: import Jira sprint containers and treat Jira as authority for sprint name/dates/state.
- Bug membership is two-way.
- An inbound move is rejected into conflict if it would place a BugFlow bug in two open sprints or cross projects.
- Closing a Jira sprint updates the mapped BugFlow sprint; BugFlow carry-over remains an explicit BugFlow operation and must not silently move Jira issues without configured behavior.
- Epics remain excluded from BugFlow sprints.

## 16. Loop prevention and idempotency

- Every Jira issue has one immutable link row.
- Every inbound event has a deduplication key.
- Every outbound operation has a stable operation/deduplication key.
- Creation request IDs are deterministically derived from the remote identity.
- The link stores last-common normalized field snapshots.
- A webhook that merely reflects an outstanding outbound operation acknowledges that operation; it does not enqueue the same change back.
- The engine compares values, not only actors, because Jira automation or another account can reproduce the same update.
- Processing uses database leases so multiple serverless invocations cannot own one event concurrently.

## 17. Conflict policy

Do not use unconditional last-write-wins.

Automatically merge when different fields changed on each side. Automatically acknowledge equal normalized changes. Create one conflict per field when both sides changed that field differently from the last common value.

Admin resolutions:

- Use BugFlow value and enqueue Jira update;
- Use Jira value and apply audited BugFlow update;
- Keep both only for fields with a defined merge operation;
- Ignore until either side changes again;
- Unlink record.

Failed reads keep the confirmation/detail open and offer retry. Unconfigured or inaccessible values display as unavailable, never fabricated success.

## 18. Webhooks and reconciliation

Webhooks provide low-latency notification but are not the source of truth. The processor fetches the current issue before applying a change.

Dynamic OAuth webhooks expire and must be refreshed. The reconciliation job:

- renews webhooks before expiry;
- searches Jira for issues updated after an overlap-safe cursor;
- imports eligible unlinked bugs;
- re-enqueues linked issues whose remote timestamp/snapshot diverges;
- detects missing/inaccessible Jira issues;
- checks stale processing leases;
- updates connection health.

Use an overlap window and deduplication because Jira timestamps and job boundaries can race. A daily wider integrity scan provides an additional repair path.

## 19. Retry and failure classification

- `429`: respect `Retry-After`, exponential backoff with jitter.
- network/`5xx`: retry with capped exponential backoff.
- `401`: attempt one locked token refresh; then mark reauthorization required.
- `403`: permanent until permissions change; show required operation/project.
- `400`/validation: mapping or payload failure; do not retry unchanged.
- `404`: re-fetch accessible resources; then mark remote missing/inaccessible.
- transition conflict/`409`: refresh issue/transitions and re-evaluate once, then conflict.
- dead-letter only after configured attempts; never delete the operation.

## 20. Security requirements

- OAuth authorization code flow with state and PKCE.
- Rotating refresh token replacement is atomic and serialized per connection.
- Tokens encrypted at rest and never exposed to client JavaScript.
- Webhook bearer/JWT authentication verified according to Atlassian's OAuth webhook contract.
- Strict payload size and event allowlist.
- No same-origin check on authenticated Jira webhooks; retain same-origin validation on browser mutations.
- Internal job endpoints protected by a separate secret and rate limited.
- No secrets or full webhook payloads in application logs.
- Disconnect revokes/deletes credentials and webhook registrations where possible.
- Jira cannot grant BugFlow permissions, create portals, reactivate users, or expand project scope.
- Integration activity records include Jira issue ID/key and remote actor metadata without leaking restricted profile data to member views.

## 21. Environment and infrastructure

Required configuration:

- `JIRA_CLIENT_ID`;
- `JIRA_CLIENT_SECRET`;
- `JIRA_TOKEN_ENCRYPTION_KEY`;
- `JIRA_JOB_SECRET`;
- public `VITE_SITE_URL`/production origin for OAuth callback and webhook URLs.

Infrastructure:

- Neon remains the durable queue, lease, cursor, and state store;
- the existing Nitro server handles endpoints;
- a hosting scheduler invokes bounded process/reconcile endpoints;
- no new managed queue is required for MVP;
- metrics are surfaced through Settings → Health and Jira integration status.

## 22. Admin status model

Connection health is one of:

- Healthy;
- Initial sync running;
- Paused;
- Delayed/rate limited;
- Mapping conflict;
- Permission problem;
- Reauthorization required;
- Webhook renewal problem;
- Disconnected.

Display last webhook, last successful outbound write, last reconciliation, pending/retry/dead counts, conflict count, token status, and webhook expiry.

## 23. Delivery plan

### Stage 0 — Atlassian setup and contract fixtures

- Create Atlassian developer integration and dedicated Jira Cloud test site/project.
- Define exact scopes from the endpoint list.
- Record sanitized Jira payload/ADF/transition fixtures.
- Prove OAuth, project discovery, issue create/read/edit, transitions, webhooks, and rate-limit headers.

Exit: a command-level spike can create a Jira Bug, receive its webhook, and transition it using OAuth.

### Stage 1 — Persistence and OAuth endpoints

- Migration 027 tables, constraints, indexes, leases, and system actor.
- Token encryption and atomic refresh service.
- Connect/callback/resources/configure/status/pause/disconnect endpoints.
- Health checks and unit tests.

Exit: a company Jira Cloud site can be connected, mapped, paused, reauthorized, and disconnected without exposing tokens.

### Stage 2 — Outbound BugFlow → Jira

- Transactional outbox integrated into create/edit/change/verify/sprint/estimate writes.
- Bounded processor with create, edit, assignment, transition, and link operations.
- Retries, rate limits, errors, and audit activity.

Exit: a BugFlow bug and every MVP field change reliably appear in Jira, including recovery after injected failures.

### Stage 3 — Inbound Jira → BugFlow

- Authenticated webhook route and durable inbox.
- Jira issue fetch and normalization.
- Deterministic imported bug creation.
- Audited/version-safe updates through integration-domain service.
- Echo suppression and deduplication.

Exit: a Jira Bug and every MVP field change reliably appear in BugFlow without duplicate rows or permission bypass.

### Stage 4 — Reconciliation and conflicts

- Incremental reconciliation with overlap cursor.
- Three-way field comparison and conflict records.
- Retry, replay, sync-now, missing-record handling, webhook renewal.
- Minimal Admin status/conflict interface or protected endpoint equivalents.

Exit: a deliberately dropped webhook is repaired and simultaneous edits do not silently overwrite one another.

### Stage 5 — Sprint integration and hardening

- Board discovery, Jira sprint mapping, sprint membership, state, and estimate sync.
- Full integration UI under Settings.
- Notifications/health integration.
- Load, chaos, security, and full E2E suites.

Exit: mapped board sprint behavior respects both Jira and BugFlow invariants under retries and concurrency.

## 24. Test plan

### Pure/unit tests

- status/priority/field mapping;
- ADF conversion and normalization;
- three-way merge and conflict detection;
- webhook deduplication keys;
- operation idempotency keys;
- retry classification/backoff;
- OAuth state and token encryption;
- Jira payload validation;
- sprint invariant translation.

### Database integration tests

- creation/link uniqueness under concurrency;
- inbox/outbox leases and retry claims;
- atomic BugFlow mutation + outbox;
- deterministic inbound request ID;
- atomic refresh-token rotation;
- conflict creation/resolution;
- disconnect and retention behavior.

### Contract tests

- Atlassian accessible resources;
- project/issue type/create/edit metadata;
- ADF create/edit;
- available transitions and transition execution;
- dynamic webhook register/refresh/delete;
- Jira Software board/sprint/estimate endpoints when enabled.

### Full E2E

- Jira create → webhook → BugFlow create;
- BugFlow create → outbox → Jira create → echo webhook acknowledgement;
- edit each MVP field in both directions;
- simultaneous same-field conflict;
- simultaneous different-field merge;
- dropped webhook repaired by reconciliation;
- duplicate/out-of-order webhook;
- expired access token and rotating refresh;
- revoked grant/permission loss;
- Jira issue moved out of project;
- BugFlow trash and restore;
- status verification gate;
- sprint conflict and closure;
- rate limiting and transient failures;
- disconnect stops writes without deleting records.

## 25. Acceptance criteria

- One Admin-approved Jira Cloud connection can map a BugFlow project to a Jira project/board.
- An eligible Jira Bug created by any Jira user appears once in BugFlow.
- A BugFlow bug created by any authorized BugFlow reporter appears once in Jira.
- MVP fields synchronize both ways with explicit mappings.
- Changes are normally visible on the other side within 60 seconds; reconciliation repairs missed events within 15 minutes under normal service conditions.
- Duplicate/replayed webhooks and repeated jobs create no duplicate bug, history, or link.
- A failed Jira call cannot roll back or lose a committed BugFlow change.
- A Jira event cannot bypass project scope, reactivate a user, create portal access, or grant a permission.
- Generic Jira Done cannot silently forge BugFlow QA verification.
- Unsupported mappings and simultaneous edits produce visible conflicts.
- Every applied inbound/outbound change is attributable and auditable.
- Pausing/disconnecting stops propagation without deleting either side's bug.
- Webhooks renew automatically and drift repair works after a dropped event.
- Secrets remain server-only and encrypted at rest.

## 26. Launch sequence

1. Internal test site with synthetic records.
2. Shadow mode: receive/reconcile and show proposed inbound/outbound operations without applying them.
3. One-way BugFlow → Jira pilot.
4. Two-way pilot for one non-critical company project.
5. Expand projects after two weeks without unresolved duplication/data-loss incidents.
6. Enable sprint synchronization separately after core bug sync is stable.

## 27. Open configuration decisions before implementation

These are configuration choices, not architecture blockers:

1. Which company Jira Cloud site, project, and board will be the pilot?
2. Is Jira's Bug issue type the only inbound type?
3. Will Jira use custom fields for BugFlow severity, steps, expected, actual, environment, module, and BugFlow code, or will these live in a managed description block?
4. Which Jira statuses/resolutions map to all 13 BugFlow statuses, and which BugFlow status is canonical inbound when mappings are many-to-one?
5. Should Jira or BugFlow own sprint container names/dates/state? Recommended: Jira for MVP.
6. Which company-managed Atlassian account authorizes the integration?
7. What scheduler will call the internal processor and reconciliation endpoints in production?

