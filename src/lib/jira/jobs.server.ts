import { processJiraInbox } from "./inbox.server";
import { processJiraOutbox } from "./outbox.server";
import { matchPeopleByEmail } from "./people.server";
import { reconcileJira } from "./reconcile.server";
import { JIRA_SYNC_USER_ID } from "./types";

// What a scheduler (or the Admin's "Sync now") runs. Every part is bounded and safe to repeat or overlap:
// the queues lease their rows, and reconciliation only adds to the queues.

/** One bounded pass over both queues: what Jira reported first, then what BugFlow changed. */
export async function processJira() {
  const inbox = await processJiraInbox({ budgetMs: 12_000 });
  const outbox = await processJiraOutbox({ budgetMs: 12_000 });
  return { inbox, outbox };
}

/** Members are matched to Jira accounts by email at most this often per server (each member is one Jira read). */
const PEOPLE_EVERY_MS = 60 * 60_000;
let peopleAt = 0;
async function matchPeople(): Promise<number | "skipped" | "failed"> {
  if (Date.now() - peopleAt < PEOPLE_EVERY_MS) return "skipped";
  peopleAt = Date.now();
  try {
    return await matchPeopleByEmail(JIRA_SYNC_USER_ID);
  } catch (error) {
    console.error(`[jira-people] ${error instanceof Error ? error.name : "unknown error"}`);
    return "failed";
  }
}

/** Looks for anything missed (and keeps Jira's notifications registered), then works the queues once. */
export async function reconcileAndProcess() {
  const reconcile = await reconcileJira();
  const people = "skipped" in reconcile ? "skipped" : await matchPeople();
  return { reconcile, people, ...(await processJira()) };
}
