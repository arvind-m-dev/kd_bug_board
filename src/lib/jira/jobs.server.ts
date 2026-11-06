import { processJiraInbox } from "./inbox.server";
import { processJiraOutbox } from "./outbox.server";
import { reconcileJira } from "./reconcile.server";

// What a scheduler (or the Admin's "Sync now") runs. Every part is bounded and safe to repeat or overlap:
// the queues lease their rows, and reconciliation only adds to the queues.

/** One bounded pass over both queues: what Jira reported first, then what BugFlow changed. */
export async function processJira() {
  const inbox = await processJiraInbox({ budgetMs: 12_000 });
  const outbox = await processJiraOutbox({ budgetMs: 12_000 });
  return { inbox, outbox };
}

/** Looks for anything missed (and keeps Jira's notifications registered), then works the queues once. */
export async function reconcileAndProcess() {
  const reconcile = await reconcileJira();
  return { reconcile, ...(await processJira()) };
}
