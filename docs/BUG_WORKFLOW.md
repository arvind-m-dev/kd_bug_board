# Bug workflow

Source: `src/lib/bugflow.ts` (`transitions`, `canTransition`) and `src/lib/bug-workflow.ts` (`mayUpdateStatus`, `statusPath`, `mayVerify`). Tests: `src/test/bug-workflow.test.ts`.

## Statuses
NEW, VALIDATING, VALIDATED, READY_FOR_ASSIGNMENT, ASSIGNED, IN_PROGRESS, RECHECK, RESOLVED, NEEDS_INFORMATION, REOPENED, DUPLICATE, NOT_A_BUG, WONT_FIX.

## Allowed transitions
| From | To |
| --- | --- |
| NEW | VALIDATING, NEEDS_INFORMATION, DUPLICATE, NOT_A_BUG |
| VALIDATING | VALIDATED, NEEDS_INFORMATION, DUPLICATE, NOT_A_BUG, WONT_FIX |
| VALIDATED | READY_FOR_ASSIGNMENT |
| READY_FOR_ASSIGNMENT | ASSIGNED |
| ASSIGNED | IN_PROGRESS, NOT_A_BUG, DUPLICATE, WONT_FIX |
| IN_PROGRESS | RECHECK, NEEDS_INFORMATION, NOT_A_BUG, DUPLICATE, WONT_FIX |
| RECHECK | RESOLVED, REOPENED |
| RESOLVED | REOPENED |
| NEEDS_INFORMATION | VALIDATING, IN_PROGRESS |
| REOPENED | IN_PROGRESS, ASSIGNED, NOT_A_BUG, DUPLICATE, WONT_FIX |
| DUPLICATE / NOT_A_BUG / WONT_FIX | VALIDATING |

Admin extra: REOPENED / VALIDATED / READY_FOR_ASSIGNMENT → VALIDATING.

## Who may move
- **Admin**: any allowed transition except the special cases below.
- **QA with `validate`**: any allowed transition except special cases.
- **Developer (must be assignee)**: ASSIGNED/REOPENED → IN_PROGRESS (`progress`); IN_PROGRESS → RECHECK (`recheck`); → NEEDS_INFORMATION (`progress`); ASSIGNED/IN_PROGRESS/REOPENED → NOT_A_BUG/DUPLICATE/WONT_FIX (`disposition`).
- **Reporter/member**: no status moves, except reopening a RESOLVED bug they reported (with `report`).

## Special rules
- RESOLVED only via the **verify** action (pass), never a plain status change. RECHECK → REOPENED also only via verify (fail).
- Verifier: Admin or QA with `verify`; never the assignee who made the fix.
- ASSIGNED reached only via the assign action.
- RESOLVED → REOPENED: Admin, `verify` holders, or the original reporter.
- `statusPath` lets the UI jump through triage steps (VALIDATING → VALIDATED → READY_FOR_ASSIGNMENT) in one action, max 4 hops; never across development/closing states.
- Closed for edits: RESOLVED, NOT_A_BUG, DUPLICATE, WONT_FIX.

## Handoff
Report (NEW) → QA validates → assign (developer task "fix") → developer IN_PROGRESS → RECHECK → QA verifies → RESOLVED or REOPENED.

Dashboard grouping: `STATUS_GROUPS` (each status in exactly one group).
