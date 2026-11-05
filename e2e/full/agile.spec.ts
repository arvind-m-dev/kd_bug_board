import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { tag, adminSignIn } from "./helpers";

/**
 * Agile area: due dates, backlog, sprints, board and the member portal's Sprint/Board tabs.
 * Everything runs in a fresh E2E project so starting a sprint never collides with a real active sprint.
 * Serial: later steps build on records created earlier (shared Admin page).
 */
const BASE = "http://localhost:4799";
const T = tag("agile");
const PROJECT = `${T} project`;
const S1 = `${T} S1`;
const S2 = `${T} S2`;
const PAST_DUE = "2026-10-01";

type BugRef = { title: string; code: string; id: string };
const bugs: Record<string, BugRef> = {};
let epicCode = "";
let memberName = "";
let portalUrl = "";
let memberBugTitle = "";

let ctx: BrowserContext;
let page: Page;

test.describe.configure({ mode: "serial" });

async function newContext(browser: Browser) {
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

async function pickThemed(
  scope: Page | ReturnType<Page["locator"]>,
  label: string,
  option: string,
) {
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function raiseBug(title: string, dueOn?: string) {
  await page.goto("/admin/bugs");
  await page.getByRole("button", { name: "Raise a bug" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Raise a bug" });
  await dlg.locator("textarea[name=description]").fill(`${title} description (E2E agile)`);
  await dlg.locator("textarea[name=steps]").fill("Open the page\nDo the thing");
  await dlg.locator("input[name=title]").fill(title);
  await dlg.getByLabel("Project").selectOption({ label: PROJECT });
  if (dueOn) await dlg.locator("input[name=dueOn]").fill(dueOn);
  await dlg.getByRole("button", { name: "Submit bug" }).click();
  await expect(page.getByRole("dialog", { name: "Bug details" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Bug details" })).toBeHidden();
}

async function readBugRef(title: string): Promise<BugRef> {
  await page.goto(`/admin/bugs?q=${encodeURIComponent(title)}`);
  const row = page.locator("tr[data-bug-row]").filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const id = (await row.getAttribute("data-bug-row"))!;
  const code = (await row.getByRole("button", { name: /^Copy bug ID / }).innerText()).trim();
  return { title, code, id };
}

async function bugRow(b: BugRef) {
  await page.goto(`/admin/bugs?q=${encodeURIComponent(b.title)}`);
  const row = page.locator(`tr[data-bug-row="${b.id}"]`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

async function statusMenu(b: BugRef, current: string, item: RegExp) {
  const row = await bugRow(b);
  await row.getByRole("button", { name: `Status of ${b.code}: ${current}` }).click();
  await page.getByRole("menuitem", { name: item }).first().click();
}

const sprintCard = (name: string) =>
  page.locator(".bf-panel").filter({ has: page.getByRole("heading", { name }) });
const stat = (card: ReturnType<typeof sprintCard>, label: string) =>
  card
    .locator(".bf-sprint-stat")
    .filter({ hasText: new RegExp(`^\\d+${label}$`) })
    .locator("strong");

async function gotoBoard() {
  await page.goto("/admin/board");
  await expect(page.locator(".bf-board-col-head").first()).toBeVisible({ timeout: 20_000 });
  await pickThemed(page, "Project", PROJECT);
}
const column = (label: string) =>
  page.locator(".bf-board-col").filter({
    has: page.locator(".bf-board-col-head", { hasText: new RegExp(`^${label}\\d+$`) }),
  });
const card = (b: BugRef) => page.locator(".bf-board-card").filter({ hasText: b.code });

async function gotoBacklog() {
  await page.goto("/admin/backlog");
  await expect(page.getByRole("button", { name: /new item/i })).toBeVisible({ timeout: 20_000 });
  await pickThemed(page, "Project", PROJECT);
}
const backlogRow = (title: string) =>
  page.locator(".bf-backlog-row").filter({
    has: page.locator(".bf-backlog-title", {
      hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    }),
  });

test.beforeAll(async ({ browser }) => {
  ctx = await newContext(browser);
  page = await ctx.newPage();
  await adminSignIn(page);
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  if (page) await cleanup();
  await ctx?.close();
});

test("setup: Admin creates an E2E project and raises bugs in it", async () => {
  await page.goto("/admin/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New project" });
  await dlg.getByPlaceholder("Application or website name").fill(PROJECT);
  await dlg.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(`Project “${PROJECT}” created`)).toBeVisible({ timeout: 15_000 });

  for (const [key, due] of [
    ["A", PAST_DUE],
    ["B", undefined],
    ["C", undefined],
  ] as const) {
    await raiseBug(`${T} bug ${key}`, due);
    bugs[key] = await readBugRef(`${T} bug ${key}`);
  }
  expect(bugs["A"]!.code).toMatch(/\d/);
});

test("due dates: past due date shows Overdue badge, overdue card/filter and calendar mark", async () => {
  const a = bugs["A"]!;
  const row = await bugRow(a);
  await expect(row.locator(".bf-due-badge")).toHaveText(/Overdue \d+d/);
  await expect(row.locator(".bf-due-badge")).toHaveAttribute("title", `Due ${PAST_DUE}`);

  // Overdue status card (SQL total) and the overdue filter.
  await page.goto("/admin/bugs");
  const overdueCard = page.locator(".bf-status-card").filter({ hasText: "Overdue" });
  await expect(overdueCard).toBeVisible({ timeout: 20_000 });
  expect(Number(await overdueCard.locator("strong").innerText())).toBeGreaterThanOrEqual(1);
  await page.goto(`/admin/bugs?filter=overdue&q=${encodeURIComponent(T)}`);
  await expect(page.locator(`tr[data-bug-row="${a.id}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`tr[data-bug-row="${bugs["B"]!.id}"]`)).toHaveCount(0);

  // Calendar view: the day is marked overdue; picking it filters to bugs due then.
  await page.goto(`/admin/bugs?cal=1&q=${encodeURIComponent(T)}`);
  await expect(page.locator(".bf-due-cal")).toBeVisible({ timeout: 20_000 });
  // Navigate the month grid back to October 2026.
  for (let i = 0; i < 3 && !(await page.getByText(/October 2026/).isVisible()); i++)
    await page
      .getByRole("button", { name: /previous/i })
      .first()
      .click();
  await expect(page.getByText(/October 2026/)).toBeVisible();
  const day = page.locator(".bf-due-cal .bf-cal-overdue").filter({ hasText: /^1$/ });
  await expect(day.first()).toBeVisible();
  await day.first().click();
  await expect(page.locator(".bf-due-cal-side")).toContainText(`due ${PAST_DUE}`);
  await expect(page.locator(`tr[data-bug-row="${a.id}"]`)).toBeVisible();
  await expect(page.locator(`tr[data-bug-row="${bugs["C"]!.id}"]`)).toHaveCount(0);
});

test("backlog: epic, story, task; parents, estimate, ready and reorder persist", async () => {
  await gotoBacklog();
  const create = async (
    kind: "Epic" | "Story" | "Task",
    title: string,
    epic?: string,
    est?: string,
  ) => {
    await page.getByRole("button", { name: /new item/i }).click();
    const dlg = page.getByRole("dialog", { name: "New backlog item" });
    if (kind !== "Story") {
      await dlg.getByRole("combobox", { name: "Kind" }).click();
      await page.getByRole("option", { name: kind, exact: true }).click();
    }
    await dlg.locator("input[name=title]").fill(title);
    if (epic) await dlg.getByLabel("Epic", { exact: true }).selectOption({ label: epic });
    if (est) await dlg.locator("input[name=estimate]").fill(est);
    await dlg.getByRole("button", { name: "Create" }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });
    await expect(backlogRow(title)).toBeVisible({ timeout: 15_000 });
  };
  const epic = `${T} Epic`;
  const story = `${T} Story`;
  const task = `${T} Task`;
  await create("Epic", epic);
  await create("Story", story, epic, "3");
  await create("Task", task);

  await expect(backlogRow(story)).toContainText(`in ${epic}`);
  await expect(backlogRow(epic).locator(".bf-backlog-kind")).toHaveText(/epic/i);
  epicCode = (await backlogRow(epic).locator(".font-mono").innerText()).trim();
  const storyCode = (await backlogRow(story).locator(".font-mono").innerText()).trim();
  const taskCode = (await backlogRow(task).locator(".font-mono").innerText()).trim();

  // Epics take no parent; a story can only sit under an epic (never under a task), so no loop can be built.
  await expect(backlogRow(epic).locator("select")).toHaveCount(0);
  const storyParent = page.getByLabel(`Parent for ${storyCode}`);
  await expect(storyParent.locator("option", { hasText: task })).toHaveCount(0);

  // Task under the story.
  await page.getByLabel(`Parent for ${taskCode}`).selectOption({ label: `Story: ${story}` });
  await expect(backlogRow(task)).toContainText(`in ${story}`, { timeout: 15_000 });

  // Estimate + ready on the task.
  const estimate = page.getByLabel(`Estimate for ${taskCode}`);
  await estimate.fill("5");
  await estimate.blur();
  await expect(page.locator(".bf-backlog[data-busy]")).toHaveCount(0, { timeout: 15_000 });
  const ready = backlogRow(task).getByRole("checkbox");
  // Controlled checkbox: it flips only after the save + refetch, so click and then wait for the state.
  await ready.click();
  await expect(ready).toBeChecked({ timeout: 15_000 });
  await page.waitForTimeout(1000);

  // Reorder: drag the task above the epic.
  const titles = async () =>
    (await page.locator(".bf-backlog-row .bf-backlog-title").allInnerTexts()).map((s) => s.trim());
  const idx = (list: string[], t: string) => list.findIndex((x) => x.startsWith(t));
  const before = await titles();
  expect(idx(before, task)).toBeGreaterThan(idx(before, epic));
  await backlogRow(task).dragTo(backlogRow(epic));
  await expect
    .poll(
      async () => {
        const t = await titles();
        return idx(t, task) < idx(t, epic);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Everything persists after a reload.
  await page.reload();
  await gotoBacklog();
  await expect(backlogRow(task)).toContainText(`in ${story}`);
  await expect(backlogRow(story)).toContainText(`in ${epic}`);
  await expect(page.getByLabel(`Estimate for ${taskCode}`)).toHaveValue("5");
  await expect(page.getByLabel(`Estimate for ${storyCode}`)).toHaveValue("3");
  await expect(backlogRow(task).getByRole("checkbox")).toBeChecked();
  const after = await titles();
  expect(idx(after, task)).toBeLessThan(idx(after, epic));
});

test("sprints: create (date order enforced), add, start, summary, two-sprint guard, epic refused, remove", async () => {
  await page.goto("/admin/sprints");
  const openCreate = async () => {
    await page.getByRole("button", { name: /new sprint/i }).click();
    const dlg = page.getByRole("dialog", { name: "New sprint" });
    await dlg.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: PROJECT, exact: true }).click();
    return dlg;
  };
  let dlg = await openCreate();
  await dlg.locator("input[name=name]").fill(S1);
  await dlg.locator("input[name=startsOn]").fill("2026-11-10");
  await dlg.locator("input[name=endsOn]").fill("2026-11-01");
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(dlg.getByText("The end date must be on or after the start date.")).toBeVisible({
    timeout: 15_000,
  });
  await dlg.locator("input[name=endsOn]").fill("2026-11-20");
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(dlg).toBeHidden({ timeout: 15_000 });
  const s1 = sprintCard(S1);
  await expect(s1).toContainText("Planned");
  await expect(s1).toContainText("2026-11-10 → 2026-11-20");

  dlg = await openCreate();
  await dlg.locator("input[name=name]").fill(S2);
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(dlg).toBeHidden({ timeout: 15_000 });
  const s2 = sprintCard(S2);
  await expect(s2).toContainText("Planned");

  const add = async (sprint: ReturnType<typeof sprintCard>, ref: string) => {
    await sprint.getByLabel("Bug number to add").fill(ref);
    await sprint.getByRole("button", { name: "Add" }).click();
  };
  await add(s1, bugs["A"]!.code);
  await expect(s1.locator("tr", { hasText: bugs["A"]!.code })).toBeVisible({ timeout: 15_000 });
  await add(s1, bugs["B"]!.id); // plain number works too
  await expect(s1.locator("tr", { hasText: bugs["B"]!.code })).toBeVisible({ timeout: 15_000 });
  await expect(stat(s1, "Committed")).toHaveText("2");

  await s1.getByRole("button", { name: "Start" }).click();
  await expect(s1).toContainText("Active", { timeout: 15_000 });
  await add(s1, bugs["C"]!.code);
  await expect(s1.locator("tr", { hasText: bugs["C"]!.code })).toBeVisible({ timeout: 15_000 });
  await expect(stat(s1, "Committed")).toHaveText("2");
  await expect(stat(s1, "Added")).toHaveText("1");
  await expect(stat(s1, "Open")).toHaveText("3");
  await expect(stat(s1, "Done")).toHaveText("0");

  // A bug cannot be in two open sprints.
  await add(s2, bugs["A"]!.code);
  await expect(page.getByText(/cannot already be in another open sprint/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(s2.locator("tr", { hasText: bugs["A"]!.code })).toHaveCount(0);
  await expect(s2.getByLabel("Bug number to add")).toHaveValue(bugs["A"]!.code); // kept for retry

  // Epics are never sprint items.
  await s2.getByLabel("Bug number to add").fill(epicCode);
  await s2.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(/Could not add this bug/).last()).toBeVisible({ timeout: 15_000 });
  await expect(s2.locator("tr", { hasText: epicCode })).toHaveCount(0);

  // Remove B from S1.
  await s1
    .locator("tr", { hasText: bugs["B"]!.code })
    .getByRole("button", { name: "Remove from sprint" })
    .click();
  await expect(s1.locator("tr", { hasText: bugs["B"]!.code })).toHaveCount(0, { timeout: 15_000 });
  await expect(stat(s1, "Committed")).toHaveText("1");
  await expect(stat(s1, "Open")).toHaveText("2");

  await page.reload();
  await expect(sprintCard(S1)).toContainText("Active", { timeout: 20_000 });
  await expect(sprintCard(S1).locator("tr")).toHaveCount(2);
});

test("board: cards in the right column; single transition applies; assign/verify open the bug; disallowed refused", async () => {
  const a = bugs["A"]!;
  const b = bugs["B"]!;
  const c = bugs["C"]!;
  // Prepare: C → Needs information (single allowed move to In progress); B → Ready for assignment.
  await statusMenu(c, "New", /^Needs information/);
  await page.getByRole("button", { name: "Save without note" }).click();
  await expect(
    page.getByRole("button", { name: `Status of ${c.code}: Needs information` }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await statusMenu(b, "New", /^Validate/);
  await expect(
    page.getByRole("button", { name: `Status of ${b.code}: Ready for assignment` }),
  ).toBeVisible({
    timeout: 15_000,
  });

  await gotoBoard();
  await expect(column("To do").locator(".bf-board-card", { hasText: a.code })).toBeVisible({
    timeout: 15_000,
  });
  await expect(column("To do").locator(".bf-board-card", { hasText: c.code })).toBeVisible();
  await expect(card(a)).toContainText(/Overdue \d+d/);

  // Disallowed: a New bug cannot go to In progress. The Move menu omits it, and a drag there is refused.
  const aMenu = page.getByLabel(`Move ${a.code}`);
  await expect(aMenu.locator("option", { hasText: "In progress" })).toHaveCount(0);
  await expect(aMenu.locator("option", { hasText: "Retest" })).toHaveCount(0);
  await card(a).dragTo(column("In progress"));
  await page.waitForTimeout(1500);
  await expect(column("To do").locator(".bf-board-card", { hasText: a.code })).toBeVisible();

  // Exactly one allowed transition: drag C (Needs information) to In progress.
  await card(c).dragTo(column("In progress"));
  await expect(column("In progress").locator(".bf-board-card", { hasText: c.code })).toBeVisible({
    timeout: 15_000,
  });
  // Then Move menu to Retest (In progress → Ready for QA retest).
  await page.getByLabel(`Move ${c.code}`).selectOption({ label: "Retest" });
  await expect(column("Retest").locator(".bf-board-card", { hasText: c.code })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await gotoBoard();
  await expect(column("Retest").locator(".bf-board-card", { hasText: c.code })).toBeVisible({
    timeout: 15_000,
  });
  await expect(card(c)).toContainText("Ready for QA retest");

  // Verify needed: Retest → Done opens the bug instead of guessing.
  await page.getByLabel(`Move ${c.code}`).selectOption({ label: "Done" });
  await expect(page).toHaveURL(new RegExp(`/admin/bugs\\?.*bug=${c.id}`), { timeout: 15_000 });
  await expect(page.getByText("Record the retest verdict on the bug.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Bug details" })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");

  // Assign needed: Ready for assignment → Assigned opens the bug.
  await gotoBoard();
  await page.getByLabel(`Move ${b.code}`).selectOption({ label: "Assigned" });
  await expect(page).toHaveURL(new RegExp(`/admin/bugs\\?.*bug=${b.id}`), { timeout: 15_000 });
  await expect(page.getByText("Assign the bug to someone first.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Status unchanged by those "open" drops.
  await gotoBoard();
  await expect(column("To do").locator(".bf-board-card", { hasText: b.code })).toBeVisible({
    timeout: 15_000,
  });
  await expect(column("Retest").locator(".bf-board-card", { hasText: c.code })).toBeVisible();

  // Pass C's retest from the list, so the sprint has one done item.
  await statusMenu(c, "Ready for QA retest", /^Pass retest/);
  await expect(page.getByRole("button", { name: `Status of ${c.code}: Resolved` })).toBeVisible({
    timeout: 15_000,
  });
  await gotoBoard();
  await expect(column("Done").locator(".bf-board-card", { hasText: c.code })).toBeVisible({
    timeout: 15_000,
  });
});

test("sprints: done count, close with carry-over into the next sprint", async () => {
  await page.goto("/admin/sprints");
  const s1 = sprintCard(S1);
  await expect(s1).toContainText("Active", { timeout: 20_000 });
  await expect(stat(s1, "Done")).toHaveText("1");
  await expect(stat(s1, "Open")).toHaveText("1");

  await s1.getByRole("combobox", { name: "Carry unfinished bugs to" }).click();
  await page.getByRole("option", { name: S2, exact: true }).click();
  await s1.getByRole("button", { name: "Close" }).click();
  await expect(s1).toContainText("Closed", { timeout: 15_000 });
  await expect(s1.getByLabel("Bug number to add")).toHaveCount(0);
  await expect(s1.getByRole("button", { name: "Remove from sprint" })).toHaveCount(0);

  const s2 = sprintCard(S2);
  const carried = s2.locator("tr", { hasText: bugs["A"]!.code });
  await expect(carried).toBeVisible({ timeout: 15_000 });
  await expect(carried.locator(".bf-sprint-carry")).toHaveText("carried");
  await expect(s2.locator("tr", { hasText: bugs["C"]!.code })).toHaveCount(0); // resolved: not carried
  await expect(stat(s2, "Carried in")).toHaveText("1");
});

test("member portal: Sprint and Board tabs show only bugs the panel may see", async ({
  browser,
}) => {
  memberName = `${T} member`;
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Add member" }).click();
  const dlg = page.getByRole("dialog", { name: "Create a portal" });
  await dlg.getByPlaceholder("Person’s name").fill(memberName);
  await dlg.getByPlaceholder("name@company.com").fill(`e2e-agile-${Date.now()}@example.com`);
  await dlg.getByText("Advanced access scope").click();
  await dlg.locator("label.bf-permission", { hasText: PROJECT }).getByRole("checkbox").click();
  // A tester without "view all": sees only bugs they reported or are assigned to.
  await dlg
    .locator("label.bf-permission", { hasText: "View all project bugs (read only)" })
    .getByRole("checkbox")
    .click();
  await dlg.getByRole("button", { name: "Save member & generate portal link" }).click();
  const linkInput = dlg.getByLabel("Private portal link");
  await expect(linkInput).toBeVisible({ timeout: 20_000 });
  const link = await linkInput.inputValue();
  portalUrl = BASE + new URL(link).pathname;
  await page.keyboard.press("Escape");

  const mctx = await newContext(browser);
  try {
    const m = await mctx.newPage();
    await m.goto(portalUrl);
    // Member raises one bug of their own.
    memberBugTitle = `${T} member bug`;
    await m.getByRole("button", { name: "Raise a bug" }).first().click({ timeout: 20_000 });
    const rd = m.getByRole("dialog", { name: "Raise a bug" });
    await rd.locator("textarea[name=description]").fill(`${memberBugTitle} description`);
    await rd.locator("textarea[name=steps]").fill("Step one");
    await rd.locator("input[name=title]").fill(memberBugTitle);
    await rd.getByRole("button", { name: "Submit bug" }).click();
    await expect(rd).toBeHidden({ timeout: 20_000 });
    await m.keyboard.press("Escape");

    bugs["M"] = await readBugRef(memberBugTitle);
    // Admin adds the member's bug to S2 (which already holds A, a bug this member may not see).
    await page.goto("/admin/sprints");
    const s2 = sprintCard(S2);
    await s2.getByLabel("Bug number to add").fill(bugs["M"]!.code);
    await s2.getByRole("button", { name: "Add" }).click();
    await expect(s2.locator("tr", { hasText: bugs["M"]!.code })).toBeVisible({ timeout: 15_000 });

    await m.goto(portalUrl);
    await m.getByRole("button", { name: "Sprint", exact: true }).click();
    const ms2 = m.locator(".bf-panel").filter({ has: m.getByRole("heading", { name: S2 }) });
    await expect(ms2).toBeVisible({ timeout: 20_000 });
    await expect(ms2).toContainText(bugs["M"]!.code);
    await expect(ms2).not.toContainText(bugs["A"]!.code);
    await expect(ms2).not.toContainText(bugs["A"]!.title);
    await expect(m.locator("body")).not.toContainText(S1); // closed sprint not listed

    await m.getByRole("button", { name: "Board", exact: true }).click();
    await expect(m.locator(".bf-board-col-head").first()).toBeVisible({ timeout: 20_000 });
    await expect(m.locator(".bf-board-card", { hasText: bugs["M"]!.code })).toBeVisible({
      timeout: 15_000,
    });
    for (const k of ["A", "B", "C"])
      await expect(m.locator(".bf-board-card", { hasText: bugs[k]!.code })).toHaveCount(0);
    // A tester has no workflow moves on their own new bug: no Move menu.
    await expect(m.getByLabel(`Move ${bugs["M"]!.code}`)).toHaveCount(0);
  } finally {
    await mctx.close();
  }
});

/** Runs from afterAll so it happens even when a serial step fails. Each step is best-effort. */
async function cleanup() {
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.warn(`[agile cleanup] ${name} failed: ${(e as Error).message.split("\n")[0]}`);
    }
  };
  await step("close sprints", async () => {
    // S2: planned → start → close (only E2E sprints are touched).
    await page.goto("/admin/sprints");
    const s2 = sprintCard(S2);
    await expect(s2).toBeVisible({ timeout: 20_000 });
    if ((await s2.getByRole("button", { name: "Start" }).count()) > 0) {
      await s2.getByRole("button", { name: "Start" }).click();
      await expect(s2).toContainText("Active", { timeout: 15_000 });
    }
    if ((await s2.getByRole("button", { name: "Close" }).count()) > 0) {
      await s2.getByRole("button", { name: "Close" }).click();
      await expect(s2).toContainText("Closed", { timeout: 15_000 });
    }
    const s1 = sprintCard(S1);
    if ((await s1.count()) && (await s1.getByRole("button", { name: "Close" }).count()) > 0) {
      await s1.getByRole("button", { name: "Close" }).click();
      await expect(s1).toContainText("Closed", { timeout: 15_000 });
    }
  });

  for (const b of Object.values(bugs))
    await step(`trash ${b.code}`, async () => {
      const row = await bugRow(b);
      await row.getByRole("button", { name: `Delete ${b.code}` }).click();
      await page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog"))
        .getByRole("button", { name: "Move to Trash" })
        .click();
      await expect(page.locator(`tr[data-bug-row="${b.id}"]`)).toHaveCount(0, { timeout: 15_000 });
    });

  if (memberName)
    await step("delete member", async () => {
      await page.goto(`/admin/users`);
      await page
        .getByRole("button", { name: `Delete ${memberName}` })
        .first()
        .click({ timeout: 20_000 });
      await page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog"))
        .getByRole("button", { name: "Delete member" })
        .click();
      await expect(page.getByRole("button", { name: `Delete ${memberName}` })).toHaveCount(0, {
        timeout: 15_000,
      });
    });

  await step("archive project", async () => {
    await page.goto("/admin/projects");
    await page.getByRole("button", { name: `Archive ${PROJECT}` }).click({ timeout: 20_000 });
    await page
      .getByRole("alertdialog")
      .or(page.getByRole("dialog"))
      .getByRole("button", { name: "Archive project" })
      .click();
    await expect(page.getByRole("button", { name: `Archive ${PROJECT}` })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
}
