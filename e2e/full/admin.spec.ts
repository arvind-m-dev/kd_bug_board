import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { adminSignIn, readClipboard, tag } from "./helpers";

/**
 * Admin portal, end to end through the UI. Every record created here starts with E2E-admin-… and is cleaned up
 * in afterAll (bug moved to Trash, option removed, AI token revoked). Workspace-wide settings are never saved:
 * the theme is previewed and discarded.
 */
test.describe.configure({ mode: "serial" });

const T = tag("admin");
const OPTION = `${T}-module`;
const OPTION_RENAMED = `${T}-module-renamed`;
const TOKEN_LABEL = `${T}-token`;

let ctx: BrowserContext;
let page: Page;
let code = ""; // e.g. BF-000131
const state = { bugInTrash: false, optionAdded: false, optionName: OPTION, tokenCreated: false };

const ADMIN_ROUTES: Array<[string, RegExp]> = [
  ["/admin", /Admin overview/],
  ["/admin/bugs", /All bugs/],
  ["/admin/assignments", /Assignments/],
  ["/admin/projects", /Projects & modules/],
  ["/admin/users", /Team & access/],
  ["/admin/activity", /Activity & reports/],
  ["/admin/notifications", /Notifications/],
  ["/admin/reports", /Team reports/],
  ["/admin/sprints", /Sprints/],
  ["/admin/board", /Board/],
  ["/admin/backlog", /Backlog/],
  ["/admin/trash", /Trash/],
  ["/admin/settings", /Settings/],
  ["/admin/settings/options", /Options & fields/],
  ["/admin/settings/ai", /AI access/],
  ["/admin/settings/appearance", /Appearance & themes/],
  ["/admin/settings/health", /System health/],
  ["/admin/settings/storage", /Storage & services/],
];

/** Clipboard read with focus first (an unfocused page never resolves readText) and a bounded wait. */
async function clip(p: Page): Promise<string> {
  await p.bringToFront();
  return Promise.race([
    readClipboard(p),
    new Promise<string>((_, rej) =>
      setTimeout(() => rej(new Error("clipboard read timed out")), 10_000),
    ),
  ]);
}

async function newAdminPage(browser: Browser) {
  const c = await browser.newContext({
    baseURL: "http://localhost:4799",
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const p = await c.newPage();
  await adminSignIn(p);
  return { c, p };
}

const bugRow = (p: Page) =>
  p
    .getByRole("row")
    .filter({ hasText: T })
    .filter({ has: p.getByRole("button", { name: /^Expand / }) });

async function openBugsFiltered(p: Page) {
  await p.goto("/admin/bugs");
  await p.getByRole("textbox", { name: "Search bugs" }).fill(T);
  await expect(bugRow(p)).toHaveCount(1, { timeout: 15_000 });
  return bugRow(p);
}

async function detailsDialog(p: Page) {
  const row = await openBugsFiltered(p);
  await row.getByRole("button", { name: new RegExp(`^${T}`) }).click();
  const d = p.getByRole("dialog", { name: "Bug details" });
  await expect(d.getByRole("heading", { level: 2, name: new RegExp(T) })).toBeVisible({
    timeout: 15_000,
  });
  return d;
}

test.beforeAll(async ({ browser }) => {
  ({ c: ctx, p: page } = await newAdminPage(browser));
});

test.afterAll(async () => {
  // Best-effort cleanup of anything this spec created that a failed test left behind.
  try {
    if (code && !state.bugInTrash) {
      const row = await openBugsFiltered(page);
      await row.getByRole("button", { name: `Delete ${code}` }).click();
      await page.getByRole("button", { name: "Move to Trash" }).click();
      await expect(bugRow(page)).toHaveCount(0, { timeout: 15_000 });
    }
  } catch (e) {
    console.warn("cleanup bug failed", e);
  }
  try {
    if (state.optionAdded) {
      await page.goto("/admin/settings/options");
      const remove = page.getByRole("button", { name: `Remove ${state.optionName}`, exact: true });
      await remove.click({ timeout: 15_000 });
      await page.getByRole("button", { name: "Save options" }).click();
      await expect(page.getByText("Dropdown options saved")).toBeVisible();
    }
  } catch (e) {
    console.warn("cleanup option failed", e);
  }
  try {
    if (state.tokenCreated) {
      await page.goto("/admin/settings/ai");
      const li = page.locator("li").filter({ hasText: TOKEN_LABEL });
      await li.getByRole("button", { name: "Revoke" }).click({ timeout: 15_000 });
      await page.getByRole("button", { name: "Revoke token" }).click();
    }
  } catch (e) {
    console.warn("cleanup token failed", e);
  }
  await ctx?.close();
});

test("signed-out /admin/* redirects to login and returns to the same page after sign-in", async ({
  browser,
}) => {
  const c = await browser.newContext({ baseURL: "http://localhost:4799" });
  const p = await c.newPage();
  await p.goto("/admin/sprints");
  await expect(p).toHaveURL(/\/login\?redirect=%2Fadmin%2Fsprints/);
  await expect(p.locator("input[type=password]")).toBeVisible();
  await p.getByRole("button", { name: /login without credentials/i }).click();
  await p.waitForURL(/\/admin\/sprints$/, { timeout: 20_000 });
  await expect(p.getByRole("button", { name: /new sprint/i })).toBeVisible({ timeout: 15_000 });

  // An off-site redirect is dropped.
  const c2 = await browser.newContext({ baseURL: "http://localhost:4799" });
  const p2 = await c2.newPage();
  await p2.goto("/login?redirect=//evil.example.com/x");
  await p2.getByRole("button", { name: /login without credentials/i }).click();
  await p2.waitForURL(/localhost:4799\/admin$/, { timeout: 20_000 });
  await c.close();
  await c2.close();
});

test("sign-out confirmation: cancel keeps you in, confirm signs out, back cannot reach admin", async ({
  browser,
}) => {
  const { c, p } = await newAdminPage(browser);
  await p.goto("/admin/bugs");
  await expect(p.getByRole("heading", { level: 1, name: "All bugs" })).toBeVisible({
    timeout: 15_000,
  });

  await p.getByRole("button", { name: "Sign out" }).click();
  const dlg = p
    .getByRole("alertdialog")
    .or(p.getByRole("dialog"))
    .filter({ hasText: "Sign out of Bug Board?" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toBeHidden();
  await expect(p).toHaveURL(/\/admin\/bugs/);
  await expect(p.getByRole("heading", { level: 1, name: "All bugs" })).toBeVisible();

  await p.getByRole("button", { name: "Sign out" }).click();
  await dlg.getByRole("button", { name: "Sign out" }).click();
  await p.waitForURL(/\/login/, { timeout: 20_000 });
  await expect(p.locator("input[type=password]")).toBeVisible();

  await p.goBack();
  await p.waitForLoadState("networkidle");
  await expect(p).toHaveURL(/\/login/);
  await expect(p.getByRole("heading", { level: 1, name: "All bugs" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: "Raise a bug" })).toHaveCount(0);

  // A fresh load of an admin page is also refused.
  await p.goto("/admin/users");
  await expect(p).toHaveURL(/\/login\?redirect=%2Fadmin%2Fusers/);
  await c.close();
});

test("every admin route renders without error", async () => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  for (const [path, title] of ADMIN_ROUTES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}(\\?.*)?$`));
    await expect(page, path).toHaveTitle(title);
    await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Something went wrong/i), path).toHaveCount(0);
    await expect(page.getByText(/could not be loaded|failed to load/i), path).toHaveCount(0);
  }
  expect(errors, "uncaught page errors").toEqual([]);
});

test("Admin reports a bug with description only; the title is derived", async () => {
  await page.goto("/admin/bugs");
  await page.getByRole("button", { name: "Raise a bug" }).click();
  const d = page.getByRole("dialog", { name: "Raise a bug" });
  await d
    .getByRole("textbox", { name: /Bug description/ })
    .fill(`${T} save button does nothing\nNothing in the console either`);
  await d.getByRole("textbox", { name: /Steps to replicate/ }).fill("Open settings\nClick save");
  // With several projects the form shows a project picker; use the pre-existing demo project.
  const projectSelect = d
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Choose project" }) });
  if (await projectSelect.count()) {
    const labels = await projectSelect.locator("option").allInnerTexts();
    const pick =
      labels.find((l) => /Customer Portal/.test(l)) ??
      labels.find((l) => l && !/Choose project/.test(l))!;
    await projectSelect.selectOption({ label: pick });
  }
  await d.getByRole("button", { name: "Submit bug" }).click();

  const details = page.getByRole("dialog", { name: "Bug details" });
  await expect(
    details.getByRole("heading", { level: 2, name: `${T} save button does nothing` }),
  ).toBeVisible({ timeout: 20_000 });
  const banner = (await details.getByRole("banner").innerText()).match(/[A-Z]+-\d+/);
  expect(banner).not.toBeNull();
  code = banner![0];
  // Actual result is derived from the description; expected stays empty (no invented data).
  await expect(
    details.getByRole("heading", { name: "Actual result" }).locator("xpath=following::p[1]"),
  ).toContainText(`${T} save button does nothing`);
  await expect(
    details.getByRole("heading", { name: "Expected result" }).locator("xpath=following::p[1]"),
  ).toHaveText("Not specified");
  await details.getByRole("button", { name: "Close" }).click();

  const row = await openBugsFiltered(page);
  await expect(row.getByRole("button", { name: `Copy bug ID ${code}` })).toHaveText(code);
  await expect(row.getByRole("button", { name: `Status of ${code}: New` })).toBeVisible();
});

test("Admin edits the bug and the change persists after reload", async () => {
  test.skip(!code, "no bug");
  const row = await openBugsFiltered(page);
  await row.getByRole("button", { name: `Edit ${code}` }).click();
  const d = page.getByRole("dialog").filter({ hasText: `Edit ${code}` });
  await d.getByRole("textbox", { name: /Bug title/ }).fill(`${T} save button ignored (edited)`);
  await d.getByRole("textbox", { name: "Expected result" }).fill("Settings are saved");
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: `Edit ${code}` })).toBeHidden({
    timeout: 15_000,
  });

  await page.reload();
  const details = await detailsDialog(page);
  await expect(
    details.getByRole("heading", { level: 2, name: `${T} save button ignored (edited)` }),
  ).toBeVisible();
  await expect(
    details.getByRole("heading", { name: "Expected result" }).locator("xpath=following::p[1]"),
  ).toHaveText("Settings are saved");
});

test("Admin changes priority, severity, status, assigns, and sees history", async () => {
  test.skip(!code, "no bug");
  let row = await openBugsFiltered(page);
  await row.getByRole("button", { name: new RegExp(`^${code}: priority`) }).click();
  await page.getByRole("menuitem", { name: "P1 Very high" }).click();
  await expect(row.getByRole("button", { name: new RegExp(`^${code}: priority P1`) })).toBeVisible({
    timeout: 15_000,
  });

  await row.getByRole("button", { name: new RegExp(`^${code}: priority`) }).click();
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await expect(
    row.getByRole("button", { name: new RegExp(`^${code}: priority P1 .*severity High`) }),
  ).toBeVisible({ timeout: 15_000 });

  await row.getByRole("button", { name: `Status of ${code}: New` }).click();
  await page.getByRole("menuitem", { name: /^Validate → Ready to assign/ }).click();
  await expect(
    row.getByRole("button", { name: `Status of ${code}: Ready for assignment` }),
  ).toBeVisible({ timeout: 15_000 });

  await row.getByRole("button", { name: new RegExp(`^Assignee of ${code}`) }).click();
  const pop = page.getByRole("dialog").filter({ hasText: `Assign ${code}` });
  await pop.getByRole("radio", { name: /Faisal Ahmed/ }).click();
  await pop.getByRole("button", { name: /^(Assign|Give access & assign)$/ }).click();
  await expect(
    row.getByRole("button", { name: new RegExp(`^Assignee of ${code}: Faisal Ahmed`) }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    row.getByRole("button", { name: new RegExp(`^Status of ${code}: Assigned`) }),
  ).toBeVisible();

  // After reload the row still shows every change.
  await page.reload();
  row = await openBugsFiltered(page);
  await expect(
    row.getByRole("button", { name: new RegExp(`^${code}: priority P1 .*severity High`) }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: new RegExp(`^Assignee of ${code}: Faisal Ahmed`) }),
  ).toBeVisible();

  const details = await detailsDialog(page);
  const history = details.getByRole("button", { name: /^Bug history/ });
  await history.click();
  const historyText = details.locator("section.bf-bd-history");
  await expect(history).toHaveAttribute("aria-expanded", "true");
  await expect(historyText).toContainText(/Assigned to Faisal Ahmed/, { timeout: 15_000 });
  await expect(historyText).toContainText(/priority changed/);
  await expect(historyText).toContainText(/severity changed[\s\S]*Medium\s*→\s*High/);
  await expect(historyText).toContainText(/New\s*→\s*Ready for assignment/);
  await expect(historyText).toContainText(/edited/);
  await details.getByRole("button", { name: "Close" }).click();
});

test("bug row expands with the shared report and Copy bug ID copies the code", async () => {
  test.skip(!code, "no bug");
  const row = await openBugsFiltered(page);
  await row.getByRole("button", { name: `Copy bug ID ${code}` }).click();
  await expect(page.getByText(`${code} copied`)).toBeVisible();
  expect(await clip(page)).toBe(code);

  await row.getByRole("button", { name: `Expand ${code}` }).click();
  const expanded = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "Open details" }) })
    .filter({ hasText: T });
  await expect(expanded.getByRole("heading", { name: "Steps to replicate" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(expanded).toContainText("Click save");
  await expect(expanded).toContainText("Settings are saved");
  await expanded.getByRole("button", { name: "Open details" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Bug details" })
      .getByRole("heading", { level: 2, name: new RegExp(T) }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("dialog", { name: "Bug details" })
    .getByRole("button", { name: "Close" })
    .click();
});

test("sheet export downloads an .xlsx containing the E2E bug", async () => {
  test.skip(!code, "no bug");
  await page.goto("/admin/bugs");
  await page.getByRole("button", { name: "Export sheet" }).click();
  const d = page.getByRole("dialog", { name: "Export bugs as a sheet" });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    d.getByRole("button", { name: "Download .xlsx" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^bugs-all-projects-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const path = await download.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(path!) as unknown as ArrayBuffer);
  const cells: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => cells.push(String(c.text ?? "")))));
  const all = cells.join("\n");
  expect(all).toContain(`${T} save button ignored (edited)`);
  expect(all).toContain(code);
});

test("activity CSV export includes the E2E bug", async () => {
  test.skip(!code, "no bug");
  await page.goto("/admin/activity");
  await page.getByRole("button", { name: "Export report" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const text = readFileSync((await download.path())!, "utf8");
  expect(text).toContain(code);
  expect(text).toContain(T);
});

test("Settings → options: add, rename, then remove an E2E option", async () => {
  await page.goto("/admin/settings/options");
  const input = page.getByRole("textbox", { name: "New Modules / pages" });
  await input.fill(OPTION);
  await page.getByRole("button", { name: "Add Modules / pages" }).click();
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByText("Dropdown options saved")).toBeVisible({ timeout: 15_000 });
  state.optionAdded = true;

  await page.reload();
  await page.getByRole("button", { name: `Edit ${OPTION}`, exact: true }).click();
  await page.getByRole("textbox", { name: `Rename ${OPTION}` }).fill(OPTION_RENAMED);
  await page.getByRole("button", { name: `Confirm rename ${OPTION}` }).click();
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByText("Dropdown options saved").first()).toBeVisible({ timeout: 15_000 });
  state.optionName = OPTION_RENAMED;

  await page.reload();
  await expect(
    page.getByRole("button", { name: `Edit ${OPTION_RENAMED}`, exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: `Edit ${OPTION}`, exact: true })).toHaveCount(0);

  // The option is offered in the bug form.
  await page.goto("/admin/bugs");
  await page.getByRole("button", { name: "Raise a bug" }).click();
  const d = page.getByRole("dialog", { name: "Raise a bug" });
  await d.getByRole("combobox", { name: "module" }).click();
  await expect(page.getByRole("option", { name: OPTION_RENAMED })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.goto("/admin/settings/options");
  await page.getByRole("button", { name: `Remove ${OPTION_RENAMED}`, exact: true }).click();
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByText("Dropdown options saved").first()).toBeVisible({ timeout: 15_000 });
  state.optionAdded = false;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Modules / pages" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: `Edit ${OPTION_RENAMED}`, exact: true }),
  ).toHaveCount(0);
});

test("Appearance: preview a theme then Discard (never saved)", async () => {
  await page.goto("/admin/settings/appearance");
  const colour = page.getByRole("radiogroup", { name: "Colour theme" });
  await expect(colour).toBeVisible({ timeout: 15_000 });
  const before =
    (await colour
      .getByRole("radio", { checked: true })
      .getAttribute("aria-label")
      .catch(() => null)) ?? (await colour.getByRole("radio", { checked: true }).innerText());
  const snapshot = () =>
    page.evaluate(() => ({
      attrs: [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).join(" "),
      primary: getComputedStyle(document.documentElement).getPropertyValue("--primary"),
    }));
  const original = await snapshot();
  const target =
    (await colour.getByRole("radio", { name: "Teal" }).getAttribute("aria-checked")) === "true"
      ? "Rose"
      : "Teal";
  await colour.getByRole("radio", { name: target }).click();
  const bar = page.getByRole("status").filter({ hasText: "Theme changes not saved" });
  await expect(bar).toBeVisible();
  await expect.poll(snapshot).not.toEqual(original);
  await bar.getByRole("button", { name: "Discard" }).click();
  await expect(bar).toBeHidden();
  await expect.poll(snapshot).toEqual(original);
  await expect(colour.getByRole("radio", { checked: true })).toHaveCount(1);
  expect(before).toBeTruthy();
  // Nothing was saved: a reload still shows the original theme.
  await page.reload();
  await expect.poll(snapshot, { timeout: 15_000 }).toEqual(original);
});

test("notification bell opens", async () => {
  await page.goto("/admin");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const pop = page.getByRole("dialog").filter({ hasText: "Notifications" });
  await expect(pop).toBeVisible();
  await expect(pop.getByRole("link", { name: /View all notifications/ })).toBeVisible();
  await pop.getByRole("link", { name: /View all notifications/ }).click();
  await expect(page).toHaveURL(/\/admin\/notifications/);
});

test("Trash: move the E2E bug to Trash, restore it, move it again", async () => {
  test.skip(!code, "no bug");
  let row = await openBugsFiltered(page);
  await row.getByRole("button", { name: `Delete ${code}` }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(bugRow(page)).toHaveCount(0, { timeout: 15_000 });
  state.bugInTrash = true;

  await page.goto("/admin/trash");
  await page.getByRole("tab", { name: /^Bugs/ }).click();
  const items = page
    .locator("div, li, tr")
    .filter({ hasText: `${code} · ${T}` })
    .filter({ has: page.getByRole("button", { name: "Restore" }) });
  const item = items.last(); // innermost container = the Trash row
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText(/restored/).first()).toBeVisible({ timeout: 15_000 });
  await expect(items).toHaveCount(0, { timeout: 15_000 });
  state.bugInTrash = false;

  row = await openBugsFiltered(page);
  await expect(
    row.getByRole("button", { name: new RegExp(`^Assignee of ${code}: Faisal Ahmed`) }),
  ).toBeVisible();
  await row.getByRole("button", { name: `Delete ${code}` }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(bugRow(page)).toHaveCount(0, { timeout: 15_000 });
  state.bugInTrash = true;

  await page.goto("/admin/trash");
  await page.getByRole("tab", { name: /^Bugs/ }).click();
  await expect(item).toBeVisible({ timeout: 15_000 });
});

// Kept last: its layout check is a known app bug and must not stop the serial flows above.
test("Settings → AI access: create an Admin token, see it listed, revoke it", async () => {
  await page.goto("/admin/settings/ai");
  await expect(page.getByRole("combobox", { name: "Panel" })).toHaveText(/Admin panel/);
  await page.getByRole("textbox", { name: "Label (optional)" }).fill(TOKEN_LABEL);
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText(`Your new AI token (${TOKEN_LABEL})`)).toBeVisible({
    timeout: 15_000,
  });
  state.tokenCreated = true;
  // Regression: the new-token card (long one-line MCP config snippets) once grew wider than the content area at 1280px
  // and pushed its Copy buttons off-screen (fixed with minmax(0,1fr) on .bf-token-reveal).
  const copyToken = page.getByRole("button", { name: "Copy Token only" });
  await copyToken.scrollIntoViewIfNeeded();
  const box = await copyToken.boundingBox();
  expect
    .soft(
      box && box.x + box.width <= 1280,
      `"Copy Token only" must be on screen; box=${JSON.stringify(box)}`,
    )
    .toBe(true);
  await copyToken.dispatchEvent("click"); // still exercise the copy itself
  expect(await clip(page)).toMatch(/^bf_ai_/);

  await page.reload();
  const li = page.locator("li").filter({ hasText: TOKEN_LABEL });
  await expect(li).toHaveCount(1, { timeout: 15_000 });
  await li.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByText("Token revoked")).toBeVisible({ timeout: 15_000 });
  state.tokenCreated = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "Create token" })).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("li").filter({ hasText: TOKEN_LABEL }).getByRole("button", { name: "Revoke" }),
  ).toHaveCount(0);
});
