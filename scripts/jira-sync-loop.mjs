// Local stand-in for a scheduler: calls the app's two Jira job endpoints on a timer.
//   node --env-file=.env.jira-trial scripts/jira-sync-loop.mjs
// Needs the app running at JIRA_PUBLIC_ORIGIN and JIRA_JOB_SECRET set (the same value the app has).
// Every 10 s it works the queues; every minute it also asks Jira what changed (this is what picks up Jira
// changes when Jira cannot notify the app, e.g. on http://localhost). Stop with Ctrl+C. It prints one line
// only when something happened or failed, and never prints the secret.
const origin = (process.env.JIRA_PUBLIC_ORIGIN ?? "").replace(/\/$/, "");
const secret = process.env.JIRA_JOB_SECRET ?? "";
if (!origin || secret.length < 32) {
  console.error(
    "Set JIRA_PUBLIC_ORIGIN and JIRA_JOB_SECRET (at least 32 characters), e.g. with --env-file=.env.jira-trial.",
  );
  process.exit(1);
}
const PROCESS_MS = 10_000;
const RECONCILE_EVERY = 6; // every 6th round, i.e. once a minute

const busy = (part) =>
  part &&
  typeof part === "object" &&
  !("skipped" in part) &&
  Object.entries(part).some(([k, v]) => k !== "webhooks" && typeof v === "number" && v > 0);
async function call(path) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} answered ${response.status} ${JSON.stringify(body)}`);
  return body;
}

console.log(
  `Jira sync loop → ${origin} (queues every ${PROCESS_MS / 1000}s, full check every ${(PROCESS_MS * RECONCILE_EVERY) / 1000}s)`,
);
for (let round = 0; ; round++) {
  const full = round % RECONCILE_EVERY === 0;
  try {
    const result = await call(full ? "/api/internal/jira/reconcile" : "/api/internal/jira/process");
    if (
      Object.values(result).some(busy) ||
      Object.values(result).some((p) => p && typeof p === "object" && "skipped" in p && round === 0)
    )
      console.log(new Date().toISOString().slice(11, 19), JSON.stringify(result));
  } catch (error) {
    console.error(new Date().toISOString().slice(11, 19), "failed:", error.message);
  }
  await new Promise((resolve) => setTimeout(resolve, PROCESS_MS));
}
