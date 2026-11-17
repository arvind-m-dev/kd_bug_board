# Claude implementation guide — Phase 3 Jira two-way sync

This file is the implementation handoff for Claude Code, Cursor, or another coding agent working in this repository.

The product requirements are in [`docs/PHASE_3_JIRA_TWO_WAY_SYNC_PRD.md`](docs/PHASE_3_JIRA_TWO_WAY_SYNC_PRD.md). Read that document completely before changing code. Also read [`AGENTS.md`](AGENTS.md) and treat it as mandatory architecture guidance.

## Mission

Implement the remaining Phase 3 capability: connect BugFlow to Jira Cloud and provide reliable two-way synchronization between a mapped BugFlow project and Jira project/board.

After activation:

- a Jira Bug created by any Jira user in the mapped project is created once in BugFlow;
- a BugFlow bug created by any authorized BugFlow reporter is created once in Jira;
- supported field changes flow in both directions;
- Jira and BugFlow status changes respect both workflow systems;
- failures are queued, retryable, observable, and auditable;
- duplicate or replayed events never duplicate bugs or history;
- reconciliation repairs missed webhooks and drift.

Do not replace BugFlow with a Jira UI. Synchronize the records that feed each board.

## Current product state

Phases through 2.4 are implemented. Do not rebuild them.

- React 19, TanStack Start/Router/Query, Tailwind 4, shadcn/Radix.
- Nitro server entry in `src/server.ts`.
- Neon Postgres with migrations through `database/026_ai_token_expiry.sql`.
- Core bug writes in `src/lib/bug-workflow.server.ts`.
- Pure workflow and permission rules in `src/lib/bugflow.ts` and `src/lib/bug-workflow.ts`.
- Five-column board in `src/lib/board.ts` over the same 13-status workflow.
- Sprints in `src/lib/sprints.ts` and `src/lib/sprints.server.ts`.
- Backlog items in `src/lib/backlog.ts` and `src/lib/backlog.server.ts`.
- Existing Jira CSV is export-only and is not the live integration.
- MCP/OAuth routes are a separate AI-client feature; do not combine their tokens or authorization model with Atlassian OAuth.

## Temporary demo-login requirement

The demo login must remain enabled and unchanged during Phase 3 development and testing.

- Do not remove, restrict, rename, hide, or production-gate the current demo login.
- Do not alter demo credentials or demo-login behavior.
- Do not treat the Jira integration as permission to change authentication.
- The product owner will explicitly request the production login change later.

If a security or deployment change appears to require disabling demo login, stop and report the dependency instead of changing it.

## Mandatory personal Jira Free trial

Before connecting BugFlow to any company or production Jira site, complete the integration against the product owner's personal Jira Cloud Free site.

The trial environment is:

```text
Personal Gmail Atlassian account
        ↓
Personal Jira Cloud Free site and test board
        ↕
BugFlow development/staging environment
```

Trial rules:

- Use a personal Jira Cloud Free site, not the company Jira site.
- Use only a dedicated test Jira project and board.
- Use dummy/test data only. Do not copy company bugs, customer data, credentials, production media, or personal information into the trial.
- Prefix trial records so they can be found and removed, for example `TRIAL-JIRA-...` or `E2E-JIRA-...`.
- The trial is API-based synchronization. AI is not required to perform the sync; Jira REST APIs, OAuth, webhooks, the BugFlow inbox/outbox, and reconciliation perform it.
- Do not connect to a company Jira account or production Jira project until the product owner explicitly approves that next step.
- Do not apply trial credentials or migrations to a production BugFlow deployment.
- Keep the existing BugFlow demo login enabled and unchanged throughout the trial.

The trial must prove both directions:

### BugFlow to personal Jira

1. Create a dummy bug in BugFlow.
2. Confirm exactly one linked Jira Bug is created on the personal test board.
3. Change mapped fields in BugFlow and confirm they update in Jira.
4. Change BugFlow status through the existing QA/developer controls and confirm Jira performs the configured transition.
5. Confirm retrying or replaying the operation does not create another Jira issue.

### Personal Jira to BugFlow

1. Create a dummy Bug on the personal Jira test board.
2. Confirm exactly one linked BugFlow bug is created.
3. Change mapped Jira fields and confirm they update in BugFlow.
4. Change Jira status and confirm BugFlow applies the mapped transition without bypassing BugFlow workflow or QA-verification rules.
5. Replay or duplicate a webhook and confirm it does not duplicate the BugFlow bug or its history.

### Trial observations

During the trial, record:

- Jira site, project, board, issue type, field, and status identifiers;
- the field and status mappings used;
- OAuth scopes actually required by the exercised endpoints;
- webhook registration/renewal behavior;
- API errors, rate-limit headers, and retry results;
- created BugFlow ID ↔ Jira immutable issue ID/key pairs;
- sync latency in both directions;
- conflicts and unsupported fields/transitions;
- whether the personal Free plan prevents any required test.

The trial is successful only when dummy records create and update exactly once in both directions, actor/source attribution is understandable, failed operations recover, a missed webhook is repaired by reconciliation, and no BugFlow authorization or workflow invariant is bypassed.

## Non-negotiable design

### Jira Cloud only

Support Jira Cloud in this phase. Do not add Jira Server or Jira Data Center compatibility.

### OAuth 2.0 authorization code integration

Use one BugFlow-owned Atlassian OAuth 2.0 (3LO) application.

- Tokens stay server-side.
- Use state and PKCE.
- Encrypt access and rotating refresh tokens at rest.
- Serialize refreshes per connection and replace rotating refresh tokens atomically.
- Do not collect Jira API tokens.
- Do not ask each customer to create a separate Atlassian application.

### Endpoints-first delivery

The backend may be completed before the full Settings UI. OAuth endpoints alone are not a completed sync.

The minimum complete backend includes:

1. connection endpoints;
2. configuration/mapping persistence;
3. authenticated webhook receiver;
4. durable inbound inbox;
5. transactional outbound outbox;
6. bounded processor job/endpoint;
7. reconciliation and webhook-renewal job/endpoint;
8. health, retry, pause, reconnect, and disconnect operations.

### Neon is the durable queue

Use Neon tables for inbox, outbox, leases, cursors, conflicts, and link state. Do not introduce another managed queue for the MVP unless the product owner approves it.

### Dedicated Jira system actor

Inbound Jira changes act as a dedicated non-login `Jira Sync` system actor.

- Never forge an Admin browser session.
- Never pass a made-up browser `access` object.
- Never impersonate the remote Jira user as a BugFlow member.
- Store remote actor metadata for attribution where allowed.
- Jira cannot create portals, grant permissions, widen project scope, reactivate users, or bypass soft deletion.

### No direct unsafe writes

Do not implement inbound sync as ad-hoc `update bugflow.bugs` statements that bypass domain behavior.

Create a server-only integration-domain service that reuses the pure rules and applies:

- the 13-status transition graph;
- optimistic versions;
- request-ID idempotency;
- immutable activity/status/assignment/verification history;
- due-date validation;
- sprint invariants;
- soft-deletion behavior;
- atomic mutation and audit writes.

### Transactional outbox

Whenever a local committed change must reach Jira, write the outbox operation in the same Neon transaction as the BugFlow mutation. Never make the Jira HTTP request inside the user-facing database transaction.

### Durable inbox

The Jira webhook handler validates and persists a bounded event, then returns quickly. Processing fetches the current Jira issue and does not trust a webhook payload as a complete current record.

### Reconciliation is mandatory

Webhooks are an acceleration mechanism, not the sole source of truth. Implement an overlap-safe incremental Jira search and deduplication. Renew expiring webhooks. Provide a wider periodic integrity scan.

### No last-write-wins

Store the last common normalized snapshot. Use a three-way comparison:

- changed only in BugFlow: send to Jira;
- changed only in Jira: apply to BugFlow;
- same normalized result: acknowledge;
- different fields changed: merge;
- the same field changed differently: create a conflict.

Never silently overwrite simultaneous edits.

## MVP scope

Synchronize these fields when configured:

- title / Jira summary;
- description;
- reproduction steps;
- expected result;
- actual result;
- priority;
- severity through a mapped Jira custom field;
- status;
- assignee through confirmed user mapping;
- due date;
- environment and module;
- sprint membership;
- estimate;
- BugFlow link and Jira issue key/ID.

Out of scope for this phase:

- attachment binary copying;
- comment synchronization;
- remote delete propagation;
- arbitrary issue types;
- story/task/epic hierarchy sync;
- rank sync;
- user provisioning;
- Jira project/board/workflow creation;
- Jira Server/Data Center.

BugFlow media may be represented in Jira by authenticated BugFlow links. Do not make R2 objects public.

## Workflow rules

BugFlow has 13 statuses; Jira workflows are configurable. Require an explicit mapping.

- One Jira status maps to one canonical inbound BugFlow status.
- Multiple BugFlow statuses may map to one Jira status.
- Outbound status changes use Jira's available-transition API; do not edit the status field directly.
- If no single valid Jira transition matches, create a conflict.
- Never infer `DUPLICATE`, `NOT_A_BUG`, or `WONT_FIX` from generic Jira `Done`.
- Jira `Done` may resolve BugFlow automatically only when BugFlow is already `RECHECK`; record an integration-attributed verification with remote change metadata.
- For any other state, Jira `Done` becomes an actionable status conflict. Do not forge QA verification.

## Sprint rules

Enable sprint synchronization only when a Jira Software board is configured.

- Map Jira sprint IDs to BugFlow sprint IDs.
- Jira owns sprint container name, dates, and state for the MVP.
- Membership changes may flow both ways.
- Preserve one active sprint per BugFlow project.
- Preserve one open sprint membership per bug.
- Refuse cross-project membership.
- Keep epics out of BugFlow sprints.
- Do not silently perform BugFlow carry-over while processing Jira sprint closure.

## Required endpoints

Implement explicit handling in `src/server.ts` or a small Jira route dispatcher called from it.

Admin/session endpoints:

- `GET /api/integrations/jira/connect`
- `GET /api/integrations/jira/callback`
- `GET /api/integrations/jira/resources`
- `POST /api/integrations/jira/configure`
- `POST /api/integrations/jira/preview`
- `POST /api/integrations/jira/activate`
- `GET /api/integrations/jira/status`
- `POST /api/integrations/jira/sync-now`
- `POST /api/integrations/jira/retry`
- `POST /api/integrations/jira/pause`
- `POST /api/integrations/jira/reconnect`
- `POST /api/integrations/jira/disconnect`

Jira/internal endpoints:

- `POST /api/integrations/jira/webhook/:connectionId`
- `POST /api/internal/jira/process`
- `POST /api/internal/jira/reconcile`

Browser mutation endpoints require the existing Admin session and same-origin validation. Jira webhooks use Atlassian webhook authentication, not cookies or same-origin checks. Internal endpoints require `Authorization: Bearer <JIRA_JOB_SECRET>` and must not accept browser cookies as authority.

## Migration 027

Create `database/027_jira_sync.sql`. It must be additive and idempotent. The PRD defines the full columns and constraints. At minimum it introduces:

- `bugflow.integration_actors` or an equivalent explicit system-actor representation;
- `bugflow.jira_connections`;
- `bugflow.jira_project_mappings`;
- `bugflow.jira_issue_links`;
- `bugflow.jira_inbox`;
- `bugflow.jira_outbox`;
- `bugflow.jira_conflicts`;
- `bugflow.jira_user_mappings`;
- sprint mapping storage when sprint sync is implemented.

Use Jira immutable issue ID as identity. Jira issue key is display metadata because it can change.

Add the indexes needed for:

- pending work ordered by `next_attempt_at`;
- expired processing leases;
- webhook deduplication;
- unique Jira issue link per connection;
- unique active link per BugFlow bug;
- reconciliation by mapping and remote update time;
- unresolved conflicts;
- webhook expiry.

Do not apply a migration to a real database until the SQL and implementation using it are ready and the target `DATABASE_URL` has been confirmed.

## Expected server modules

Prefer small modules with explicit responsibilities:

```text
src/lib/jira/
  auth.server.ts          OAuth state, exchange, encryption, refresh
  client.server.ts        Typed Jira HTTP client and error classification
  routes.server.ts        Endpoint dispatcher and response handling
  schemas.ts              Zod schemas for configuration and webhook envelopes
  mapping.ts              Pure field/status/priority normalization
  adf.ts                  Deterministic Atlassian Document Format conversion
  inbox.server.ts         Persist, lease, process inbound work
  outbox.server.ts        Enqueue, lease, process outbound work
  sync.server.ts          Three-way comparison and orchestration
  reconcile.server.ts     Cursor scan, drift repair, webhook renewal
  conflicts.server.ts     Create and resolve field conflicts
  types.ts                Internal normalized model
```

Names may change when repository conventions demand it, but keep pure mapping rules separate from HTTP/database code.

## Environment variables

Add documented placeholders to `.env.example` and `README.md` only when the corresponding implementation exists:

- `JIRA_CLIENT_ID`
- `JIRA_CLIENT_SECRET`
- `JIRA_TOKEN_ENCRYPTION_KEY`
- `JIRA_JOB_SECRET`

Continue using the public production origin for callbacks and webhook URLs. Validate that production callback URLs are HTTPS; permit HTTP only for loopback local development.

## Implementation order and gates

Do not attempt the entire phase in one unreviewable change.

### Gate 0 — Atlassian contract spike

- Prove OAuth and accessible-resource discovery.
- Prove project, issue type, field, and workflow discovery.
- Create/read/edit/transition a Jira Bug.
- Register, receive, refresh, and remove a dynamic webhook.
- Save sanitized fixtures for tests.

Done when the spike demonstrates the complete external contract using a Jira development site.

### Gate 1 — Storage and connection

- Migration 027.
- Encryption and OAuth state/PKCE.
- Atomic rotating refresh.
- Connect/callback/resources/configure/status/pause/reconnect/disconnect.
- Unit and database tests.

Done when a company Jira Cloud site can be connected and disconnected without exposing credentials.

### Gate 2 — BugFlow to Jira

- Add outbox inserts to existing atomic BugFlow writes.
- Implement bounded claims and processing.
- Create Jira issue and link.
- Export supported edits and transitions.
- Retry/rate-limit/error classification.

Done when injected network failures cannot lose a committed BugFlow change and retries cannot duplicate Jira issues.

### Gate 3 — Jira to BugFlow

- Authenticated webhook and inbox.
- Current issue fetch and eligibility filter.
- Deterministic imported creation.
- Domain-safe inbound update service.
- Echo suppression and deduplication.

Done when duplicate and reordered webhook deliveries cannot duplicate bugs or history.

### Gate 4 — Reconciliation and conflicts

- Overlap-safe cursor scan.
- Three-way comparison.
- Per-field conflicts and resolutions.
- Sync-now, replay, dead work, webhook renewal.

Done when a deliberately dropped webhook is repaired and simultaneous edits cannot silently overwrite each other.

### Gate 5 — Sprints, UI, and hardening

- Board/sprint discovery and mapping.
- Sprint container and membership behavior.
- Settings, health, queue, and conflict UI.
- Full E2E, load, chaos, permission, and token-revocation tests.

Done when the PRD acceptance criteria pass against the Jira test site.

## Test requirements

At every gate:

- run focused Vitest suites for the changed domain logic;
- run `npm test` before handoff;
- run `npm run build` before handoff;
- add Playwright coverage when user-visible configuration or end-to-end behavior exists;
- do not run the write-heavy full E2E suite against an unconfirmed database;
- never use the production Jira project for automated tests;
- name test-created Jira/BugFlow records with a clearly removable prefix.

Required scenarios include:

- Jira create to BugFlow create;
- BugFlow create to Jira create and echo acknowledgement;
- every MVP field in both directions;
- simultaneous same-field conflict;
- simultaneous different-field merge;
- duplicate, reordered, and dropped webhook;
- access-token refresh and revoked authorization;
- permission loss;
- Jira rate limiting and transient failure;
- Jira issue moved out of the mapped project;
- BugFlow trash/restore;
- QA verification protection;
- sprint invariant violations;
- disconnect without record deletion.

## Coding constraints

- Preserve TanStack Start file-based routes and shadcn controls.
- Put pure rules in `src/lib`, presentation in `src/components/bugflow`, and secrets/network integrations in `.server.ts` modules.
- Validate every external payload with Zod or narrow explicit guards.
- Use `checkOrigin()` for cookie-authorized mutations; do not apply it to authenticated Jira/internal requests.
- Reuse existing Admin-session checks.
- Reuse shared confirmation/error/retry presentation.
- Keep failed confirmations open and make failed reads retryable.
- Never show a successful or connected state until a live Jira read verifies it.
- Never fabricate Jira projects, fields, statuses, users, or records when disconnected.
- Keep external error text safe; retain detailed classified errors server-side.
- Do not log tokens, authorization codes, client secrets, PKCE verifiers, job secrets, or complete sensitive webhook bodies.
- Respect Jira `Retry-After` and bounded processing time.
- Use leases/advisory locks for concurrency, not process memory.
- Keep notification noise low; operational sync events belong in activity/health unless user action is required.

## Definition of done

Do not call Phase 3 complete until all PRD acceptance criteria pass. In particular:

- bugs created by anyone on either connected side appear exactly once on the other side;
- supported changes flow both ways;
- missed events are repaired;
- simultaneous edits are merged or surfaced as conflicts;
- no Jira event can bypass BugFlow authorization or QA semantics;
- every applied change is audited;
- connection loss and permissions errors are visible and recoverable;
- pausing or disconnecting never deletes either side's records;
- demo login remains exactly as it was before Phase 3.

## Before writing code

Confirm or obtain these external inputs:

1. company Jira Cloud site;
2. pilot Jira project and board;
3. company-managed Atlassian authorizing account;
4. Jira Bug issue type ID;
5. Jira custom-field strategy versus BugFlow-managed description sections;
6. complete Jira ↔ BugFlow status and resolution mapping;
7. production scheduler choice;
8. development/test Jira site and cleanup convention.

If those are not available, implement only code that can be verified without pretending the live connection exists. Use sanitized fixtures for pure and contract-boundary tests, and clearly report the remaining external dependency.

