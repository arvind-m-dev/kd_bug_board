import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { tag, adminSignIn, expectPortalClosed } from "./helpers";

/**
 * QA portal end-to-end: Admin creates an E2E QA member and an E2E developer, raises E2E bugs and assigns them; the
 * developer starts work and sends them for retest from their own portal; QA (separate, cookie-less context) passes one
 * retest, fails another (back to the developer), cannot start work / send for retest, cannot verify a bug they are
 * co-assigned to, sets and clears a due date (overdue badge), and reports a bug. Each change is checked in the Admin
 * view and history. Everything created is named with the run tag and cleaned up at the end.
 */
const BASE = "http://localhost:4799";
const base = tag("qa");
const qaName = `${base} QA`;
const devName = `${base} Dev`;
const titles = {
  pass: `${base} bug pass`,
  fail: `${base} bug fail`,
  co: `${base} bug coassigned`,
  qaReport: `${base} bug qa report`,
};
const PAST_DUE = "2026-01-15";

let admin: BrowserContext;
let qaCtx: BrowserContext;
let devCtx: BrowserContext;
let adminPage: Page;
let qaPage: Page;
let devPage: Page;
let qaPath = "";
let devPath = "";
let projectName = "";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function newCtx(browser: Browser) {
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

/** Open a bug list (admin /admin/bugs or a portal) filtered to this run's records. */
async function openList(page: Page, url: string, q = base) {
  await page.goto(url);
  const search = page.getByRole("textbox", { name: "Search bugs" });
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.fill(q);
}
const row = (page: Page, title: string) =>
  page.locator("tr").filter({ has: page.getByRole("button", { name: title, exact: true }) });

async function statusOf(r: Locator) {
  return r.getByRole("button", { name: /^Status of / });
}
async function openStatusMenu(page: Page, r: Locator) {
  await (await statusOf(r)).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}
async function closeMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}
async function codeOf(r: Locator) {
  const label = await r.getByRole("button", { name: /^Copy bug ID / }).getAttribute("aria-label");
  return label!.replace("Copy bug ID ", "");
}

/** Open the details dialog for a bug and expand its history; returns the dialog. */
async function openHistory(page: Page, title: string) {
  await row(page, title).getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Bug details" });
  await expect(dialog.locator(".bf-detail-title")).toHaveText(title, { timeout: 20_000 });
  await dialog.getByRole("button", { name: /Bug history|Bug lifecycle/ }).click();
  return dialog;
}

async function createMember(page: Page, name: string, role: "qa" | "developer") {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Add member" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create a portal" });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("Person’s name").fill(name);
  await dialog
    .getByPlaceholder("name@company.com")
    .fill(`${name.replace(/\s+/g, ".").toLowerCase()}@example.com`);
  await dialog.getByLabel("Collaborator role").selectOption(role);
  const advanced = dialog.locator("details");
  const projectLabels = advanced.locator("label.bf-permission");
  // Wait for the projects query; labels exist in the DOM even inside a closed or hidden <details>.
  await expect.poll(() => projectLabels.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  if (!projectName) projectName = ((await projectLabels.first().textContent()) || "").trim();
  // With a single project the scope picker is hidden and that project is pre-selected.
  if ((await advanced.getAttribute("hidden")) === null) {
    if ((await advanced.getAttribute("open")) === null) await advanced.locator("summary").click();
    const box = advanced
      .locator("label.bf-permission", { hasText: projectName })
      .getByRole("checkbox");
    await box.check();
  }
  await dialog.getByRole("button", { name: "Save member & generate portal link" }).click();
  const link = dialog.getByLabel("Private portal link");
  await expect(link).toHaveValue(/\/(qa|developer)\//, { timeout: 30_000 });
  const path = new URL(await link.inputValue()).pathname;
  expect(path.startsWith(role === "qa" ? "/qa/" : "/developer/")).toBe(true);
  await page.keyboard.press("Escape");
  return path;
}

async function raiseBug(page: Page, title: string, opts: { due?: string; project?: boolean } = {}) {
  await page.getByRole("button", { name: "Raise a bug" }).click();
  const dialog = page.getByRole("dialog", { name: "Raise a bug" });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('textarea[name="description"]')
    .fill(`${title} — description written by the QA e2e spec.`);
  await dialog
    .locator('textarea[name="steps"]')
    .fill("Open the page\nDo the thing\nSee the problem");
  await dialog.locator('input[name="title"]').fill(title);
  const project = dialog.getByLabel("Project", { exact: true });
  if (projectName && (await project.count())) await project.selectOption({ label: projectName });
  if (opts.due !== undefined) await dialog.locator('input[name="dueOn"]').fill(opts.due);
  await dialog.getByRole("button", { name: "Submit bug" }).click();
  // onSaved opens the new bug's details.
  const details = page.getByRole("dialog", { name: "Bug details" });
  await expect(details.locator(".bf-detail-title")).toHaveText(title, { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
}

async function assign(page: Page, title: string, people: string[]) {
  const r = row(page, title);
  await r.getByRole("button", { name: /^Assignee of / }).click();
  const pop = page.locator("[data-radix-popper-content-wrapper]").filter({ hasText: /^Assign / });
  await expect(pop).toBeVisible();
  if (people.length > 1) await pop.getByRole("checkbox", { name: "Multiple people" }).check();
  for (const p of people) {
    const search = pop.getByRole("textbox", { name: "Search people" });
    if (await search.count()) await search.fill(p);
    await pop
      .getByRole(people.length > 1 ? "checkbox" : "radio", { name: new RegExp(esc(p)) })
      .check();
  }
  await pop
    .getByRole("button", { name: /^(Validate & assign|Assign|Give access & assign)$/ })
    .click();
  await expect(await statusOf(r)).toHaveAttribute("aria-label", /: Assigned$/, { timeout: 30_000 });
  await page.keyboard.press("Escape");
}

/** Pick a "Move to" item; statuses that suggest a note (retest, reopen…) open the inline note box, saved without a note. */
async function moveTo(
  page: Page,
  title: string,
  label: RegExp,
  expected: RegExp,
  withNote = false,
) {
  const r = row(page, title);
  const menu = await openStatusMenu(page, r);
  await menu.getByRole("menuitem", { name: label }).click();
  if (withNote) {
    const save = r.getByRole("button", { name: "Save without note", exact: true });
    await expect(save).toBeVisible({ timeout: 10_000 });
    await save.click();
  }
  await expect(await statusOf(r)).toHaveAttribute("aria-label", expected, { timeout: 30_000 });
}

/** Move every bug whose title contains `prefix` to the Trash and delete every member whose name does. */
async function cleanup(page: Page, prefix: string) {
  await openList(page, "/admin/bugs", prefix);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1500);
    const rows = page
      .locator("tr")
      .filter({ hasText: prefix })
      .filter({ has: page.getByRole("button", { name: /^Delete / }) });
    if ((await rows.count()) === 0) break;
    const code = await codeOf(rows.first());
    await rows
      .first()
      .getByRole("button", { name: `Delete ${code}`, exact: true })
      .click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    // While the confirm dialog is open the page is aria-hidden, so wait for it to close before role queries.
    await expect(page.locator('[role="alertdialog"], [role="dialog"]')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.locator(`button[aria-label="Delete ${code}"]`)).toHaveCount(0, {
      timeout: 20_000,
    });
  }
  await page.goto("/admin/users");
  const s = page.getByRole("textbox", { name: "Search users" });
  await expect(s).toBeVisible({ timeout: 20_000 });
  await s.fill(prefix);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    const del = page.getByRole("button", { name: new RegExp(`^Delete ${esc(prefix)}`) });
    if ((await del.count()) === 0) break;
    const label = (await del.first().getAttribute("aria-label"))!;
    await del.first().click();
    await page.getByRole("button", { name: "Delete member", exact: true }).click();
    await expect(page.locator('[role="alertdialog"], [role="dialog"]')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.locator(`button[aria-label="${label}"]`)).toHaveCount(0, { timeout: 20_000 });
  }
}

test.describe.serial("QA portal", () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeAll(async ({ browser }) => {
    admin = await newCtx(browser);
    qaCtx = await newCtx(browser);
    devCtx = await newCtx(browser);
    adminPage = await admin.newPage();
    qaPage = await qaCtx.newPage();
    devPage = await devCtx.newPage();
  });

  test.afterAll(async () => {
    // Safety net: sweep anything this spec (area "qa") left behind, including earlier interrupted runs.
    await cleanup(adminPage, "E2E-qa-").catch((e) => console.warn("cleanup sweep failed", e));
    await Promise.all([admin?.close(), qaCtx?.close(), devCtx?.close()]);
  });

  test("setup: Admin creates QA + developer members and assigns three E2E bugs", async () => {
    await adminSignIn(adminPage);
    devPath = await createMember(adminPage, devName, "developer");
    qaPath = await createMember(adminPage, qaName, "qa");

    await openList(adminPage, "/admin/bugs");
    for (const t of [titles.pass, titles.fail, titles.co]) await raiseBug(adminPage, t);
    await openList(adminPage, "/admin/bugs");
    for (const t of [titles.pass, titles.fail, titles.co])
      await expect(await statusOf(row(adminPage, t))).toHaveAttribute("aria-label", /: New$/, {
        timeout: 30_000,
      });

    await assign(adminPage, titles.pass, [devName]);
    await assign(adminPage, titles.fail, [devName]);
    // Developer is the primary assignee, QA member a co-assignee (asked to re-validate).
    await assign(adminPage, titles.co, [devName, qaName]);
    await expect(
      row(adminPage, titles.co).getByRole("button", { name: /^Assignee of / }),
    ).toHaveAttribute("aria-label", new RegExp(`${esc(devName)}.*${esc(qaName)}`));
  });

  test("QA cannot start work on an assigned bug (development steps belong to the assignee)", async () => {
    await openList(qaPage, qaPath);
    const r = row(qaPage, titles.pass);
    await expect(await statusOf(r)).toHaveAttribute("aria-label", /: Assigned$/, {
      timeout: 30_000,
    });
    const menu = await openStatusMenu(qaPage, r);
    await expect(menu.getByRole("menuitem", { name: /^In progress/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /^Ready for QA retest/ })).toHaveCount(0);
    await closeMenu(qaPage);
  });

  test("developer starts work; QA still cannot send it for retest", async () => {
    await openList(devPage, devPath);
    for (const t of [titles.pass, titles.fail, titles.co])
      await moveTo(devPage, t, /^In progress/, /: In progress$/);

    await openList(qaPage, qaPath);
    const r = row(qaPage, titles.pass);
    await expect(await statusOf(r)).toHaveAttribute("aria-label", /: In progress$/, {
      timeout: 30_000,
    });
    const menu = await openStatusMenu(qaPage, r);
    await expect(menu.getByRole("menuitem", { name: /^Ready for QA retest/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /Pass retest/ })).toHaveCount(0);
    await closeMenu(qaPage);

    await openList(devPage, devPath);
    for (const t of [titles.pass, titles.fail, titles.co])
      await moveTo(devPage, t, /^Ready for QA retest/, /: Ready for QA retest$/, true);
  });

  test("QA sees the bugs in retest and passes one → Resolved (Admin view + history)", async () => {
    await openList(qaPage, qaPath);
    for (const t of [titles.pass, titles.fail, titles.co])
      await expect(await statusOf(row(qaPage, t))).toHaveAttribute(
        "aria-label",
        /: Ready for QA retest$/,
        {
          timeout: 30_000,
        },
      );
    const r = row(qaPage, titles.pass);
    const menu = await openStatusMenu(qaPage, r);
    await menu.getByRole("menuitem", { name: /Pass retest/ }).click();
    await expect(await statusOf(r)).toHaveAttribute("aria-label", /: Resolved$/, {
      timeout: 30_000,
    });

    // Persisted: reload the QA portal.
    await openList(qaPage, qaPath);
    await expect(await statusOf(row(qaPage, titles.pass))).toHaveAttribute(
      "aria-label",
      /: Resolved$/,
      {
        timeout: 30_000,
      },
    );

    await openList(adminPage, "/admin/bugs");
    await expect(await statusOf(row(adminPage, titles.pass))).toHaveAttribute(
      "aria-label",
      /: Resolved$/,
      {
        timeout: 30_000,
      },
    );
    const dialog = await openHistory(adminPage, titles.pass);
    await expect(
      dialog
        .locator(".bf-bd-timeline li")
        .filter({ hasText: qaName })
        .filter({ hasText: "passed the QA retest" }),
    ).toHaveCount(1);
    await adminPage.keyboard.press("Escape");
  });

  test("QA fails the retest on a second bug → Reopened, back with the developer", async () => {
    await openList(qaPage, qaPath);
    const r = row(qaPage, titles.fail);
    const menu = await openStatusMenu(qaPage, r);
    await menu.getByRole("menuitem", { name: /Fail retest/ }).click();
    await r.getByRole("button", { name: "Still reproducible on retest." }).click();
    await r.getByRole("button", { name: "Save", exact: true }).click();
    await expect(await statusOf(r)).toHaveAttribute("aria-label", /: Reopened$/, {
      timeout: 30_000,
    });

    await openList(adminPage, "/admin/bugs");
    const ar = row(adminPage, titles.fail);
    await expect(await statusOf(ar)).toHaveAttribute("aria-label", /: Reopened$/, {
      timeout: 30_000,
    });
    await expect(ar.getByRole("button", { name: /^Assignee of / })).toHaveAttribute(
      "aria-label",
      new RegExp(esc(devName)),
    );
    const dialog = await openHistory(adminPage, titles.fail);
    const failed = dialog
      .locator(".bf-bd-timeline li")
      .filter({ hasText: qaName })
      .filter({ hasText: "failed the QA retest" });
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText("Still reproducible on retest.");
    await adminPage.keyboard.press("Escape");

    // The developer can pick it up again from their portal.
    await openList(devPage, devPath);
    const dr = row(devPage, titles.fail);
    await expect(await statusOf(dr)).toHaveAttribute("aria-label", /: Reopened$/, {
      timeout: 30_000,
    });
    const dmenu = await openStatusMenu(devPage, dr);
    await expect(dmenu.getByRole("menuitem", { name: /^In progress/ })).toHaveCount(1);
    await closeMenu(devPage);
  });

  test("a QA co-assignee cannot pass or fail the retest", async () => {
    await openList(qaPage, qaPath);
    const r = row(qaPage, titles.co);
    await expect(await statusOf(r)).toHaveAttribute("aria-label", /: Ready for QA retest$/, {
      timeout: 30_000,
    });
    const menu = await openStatusMenu(qaPage, r);
    await expect(menu.getByRole("menuitem", { name: /Pass retest/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /Fail retest/ })).toHaveCount(0);
    await closeMenu(qaPage);
    // Admin still sees it waiting for QA.
    await openList(adminPage, "/admin/bugs");
    await expect(await statusOf(row(adminPage, titles.co))).toHaveAttribute(
      "aria-label",
      /: Ready for QA retest$/,
      {
        timeout: 30_000,
      },
    );
  });

  test("QA reports a bug with a past due date (overdue badge), then clears the date", async () => {
    await openList(qaPage, qaPath);
    await raiseBug(qaPage, titles.qaReport, { due: PAST_DUE });
    await openList(qaPage, qaPath);
    const r = row(qaPage, titles.qaReport);
    await expect(r.locator(".bf-due-badge")).toHaveText(/Overdue \d+d/, { timeout: 30_000 });
    await expect(r.locator(".bf-due-badge")).toHaveAttribute("title", `Due ${PAST_DUE}`);

    // Admin sees the QA-reported bug, reporter and the overdue badge.
    await openList(adminPage, "/admin/bugs");
    const ar = row(adminPage, titles.qaReport);
    await expect(ar).toContainText(qaName, { timeout: 30_000 });
    await expect(ar.locator(".bf-due-badge")).toHaveText(/Overdue \d+d/);
    let dialog = await openHistory(adminPage, titles.qaReport);
    await expect(
      dialog
        .locator(".bf-bd-timeline li")
        .filter({ hasText: qaName })
        .filter({ hasText: /reported/i }),
    ).toHaveCount(1);
    await adminPage.keyboard.press("Escape");

    // QA clears the due date by editing their own report.
    await openList(qaPage, qaPath);
    const code = await codeOf(row(qaPage, titles.qaReport));
    await row(qaPage, titles.qaReport)
      .getByRole("button", { name: `Edit ${code}`, exact: true })
      .click();
    const edit = qaPage.getByRole("dialog", { name: "Bug details" });
    const due = edit.locator('input[name="dueOn"]');
    await expect(due).toHaveValue(PAST_DUE, { timeout: 20_000 });
    await due.fill("");
    await edit.getByRole("button", { name: "Save changes" }).click();
    // The form closes only after the save succeeds (the button reads "Saving changes…" meanwhile).
    await expect(edit.locator('input[name="dueOn"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(edit.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await qaPage.keyboard.press("Escape");
    await openList(qaPage, qaPath);
    await expect(row(qaPage, titles.qaReport)).toBeVisible({ timeout: 30_000 });
    await expect(row(qaPage, titles.qaReport).locator(".bf-due-badge")).toHaveCount(0);

    await openList(adminPage, "/admin/bugs");
    await expect(row(adminPage, titles.qaReport)).toBeVisible({ timeout: 30_000 });
    await expect(row(adminPage, titles.qaReport).locator(".bf-due-badge")).toHaveCount(0);
    dialog = await openHistory(adminPage, titles.qaReport);
    await expect(
      dialog
        .locator(".bf-bd-timeline li")
        .filter({ hasText: qaName })
        .filter({ hasText: /details edited/i }),
    ).toHaveCount(1);
    await adminPage.keyboard.press("Escape");
  });

  test("QA sets a due date again by editing, then the overdue badge shows in Admin", async () => {
    await openList(qaPage, qaPath);
    const code = await codeOf(row(qaPage, titles.qaReport));
    await row(qaPage, titles.qaReport)
      .getByRole("button", { name: `Edit ${code}`, exact: true })
      .click();
    const edit = qaPage.getByRole("dialog", { name: "Bug details" });
    const due = edit.locator('input[name="dueOn"]');
    await expect(due).toHaveValue("", { timeout: 20_000 });
    await due.fill(PAST_DUE);
    await edit.getByRole("button", { name: "Save changes" }).click();
    // The form closes only after the save succeeds (the button reads "Saving changes…" meanwhile).
    await expect(edit.locator('input[name="dueOn"]')).toHaveCount(0, { timeout: 30_000 });
    await expect(edit.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await qaPage.keyboard.press("Escape");
    await openList(adminPage, "/admin/bugs");
    await expect(row(adminPage, titles.qaReport).locator(".bf-due-badge")).toHaveText(
      /Overdue \d+d/,
      {
        timeout: 30_000,
      },
    );
  });

  test("cleanup: Admin trashes the E2E bugs and deletes both members; their portals close", async () => {
    await cleanup(adminPage, base);
    await openList(adminPage, "/admin/bugs");
    await adminPage.waitForTimeout(1500);
    await expect(adminPage.locator("tr").filter({ hasText: base })).toHaveCount(0);
    // Codes here are BF-…, so also check that neither portal shows any of this run's names or bug titles.
    for (const [p, path] of [
      [qaPage, qaPath],
      [devPage, devPath],
    ] as const) {
      await expectPortalClosed(p, path);
      await expect(p.locator("body")).not.toContainText(base);
      await expect(p.getByRole("textbox", { name: "Search bugs" })).toHaveCount(0);
    }
  });
});
