// Sends a Bug Board change to Jira right after it is saved, instead of waiting for the scheduler. The scheduler
// stays the safety net: if this is cut short (the server stops, Jira is down), the entry is still in the queue
// and the next scheduled pass sends it. Never throws; never delays the save that triggered it.

/** Bounded so a slow Jira cannot keep a serverless function alive for long. */
const BUDGET_MS = 8_000;
let running: Promise<void> | null = null;
let again = false;

/** Vercel's per-request context (the same hook `@vercel/functions` uses); absent elsewhere. */
type RequestContext = { waitUntil?: (p: Promise<unknown>) => void };
function keepAlive(work: Promise<void>) {
  const store = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as
    { get?: () => RequestContext | undefined } | undefined;
  try {
    store?.get?.()?.waitUntil?.(work);
  } catch {
    // Not on Vercel, or no request: a long-running Node server simply keeps going.
  }
}

async function pass() {
  do {
    again = false;
    const { processJiraOutbox } = await import("./outbox.server");
    await processJiraOutbox({ budgetMs: BUDGET_MS });
  } while (again);
}

/** Starts one outbox pass now, or asks the running one to go round once more. */
export function kickJiraOutbox() {
  if (process.env["JIRA_SEND_ON_SAVE"] === "0") return;
  if (running) {
    again = true;
    return;
  }
  running = pass()
    .catch((error: unknown) => {
      console.error(`[jira-kick] ${error instanceof Error ? error.name : "unknown error"}`);
    })
    .finally(() => {
      running = null;
    });
  keepAlive(running);
}
