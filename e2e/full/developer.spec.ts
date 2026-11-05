import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { tag, adminSignIn } from "./helpers";

/**
 * Developer portal end to end: Admin creates an E2E developer (no "view all"), reports two bugs and assigns one;
 * the developer (separate context, link only) works the bug through the developer workflow, cannot change
 * priority/severity, cannot see the unassigned bug, can report a bug, and sees Board/Sprint. Admin sees every step.
 */
test.describe.configure({ mode: "serial" });

const T = tag("developer");
const devName = `${T} Dev`;
const devEmail = `${T.toLowerCase()}@example.com`;
const titleA = `${T} assigned bug`;
const titleB = `${T} out-of-scope bug`;
const titleC = `${T} dev-reported bug`;

let adminCtx: BrowserContext;
let admin: Page;
let devCtx: BrowserContext;
let dev: Page;
let portalUrl = "";
let projectName = "";
const codes: Record<string, string> = {};

async function newCtx(browser: Browser) {
  return browser.newContext({
    baseURL: "http://localhost:4799",
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

/** Admin bugs list filtered to one title; returns its row. */
async function adminRow(title: string): Promise<Locator> {
  await admin.goto("/admin/bugs");
  const search = admin.getByLabel("Search bugs");
  await search.waitFor({ timeout: 20_000 });
  await search.fill(title);
  const row = admin
    .locator("tr")
    .filter({ has: admin.getByRole("button", { name: title, exact: true }) });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  return row;
}

async function portalRow(title: string): Promise<Locator> {
  const row = dev
    .locator("tr")
    .filter({ has: dev.getByRole("button", { name: title, exact: true }) });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  return row;
}

async function adminReport(title: string) {
  await admin.goto("/admin/bugs");
  await admin.getByRole("button", { name: "Raise a bug" }).click();
  const dlg = admin.getByRole("dialog", { name: "Raise a bug" });
  await dlg
    .locator("textarea[name=description]")
    .fill(`${title} description: the button does nothing.`);
  await dlg
    .locator("textarea[name=steps]")
    .fill("Open the page\nClick the button\nNothing happens");
  await dlg.locator("input[name=title]").fill(title);
  const projectSelect = dlg.locator("select[name=projectId]");
  if (await projectSelect.count()) {
    if (!projectName)
      projectName = (await projectSelect.locator("option").nth(1).innerText()).trim();
    await projectSelect.selectOption({ label: projectName });
  }
  await dlg.getByRole("button", { name: "Submit bug" }).click();
  await expect(admin.getByRole("dialog", { name: "Raise a bug" })).toBeHidden({ timeout: 20_000 });
  await admin.keyboard.press("Escape");
  const row = await adminRow(title);
  codes[title] = (await row.locator(".bf-cell-id button").innerText()).trim();
  expect(codes[title]).toMatch(/^[A-Z][A-Z0-9]*-\d+/);
}

/** Developer moves bug A to a status through the row's status menu (optionally with a quick note). */
async function devMove(to: RegExp, label: string, quickNote?: string) {
  const row = await portalRow(titleA);
  await row.getByRole("button", { name: /^Status of / }).click();
  await dev.getByRole("menuitem", { name: to }).click();
  if (quickNote) {
    const form = row.locator("form.bf-inline-note");
    await expect(form).toBeVisible();
    await form.getByRole("button", { name: quickNote }).click();
    await form.getByRole("button", { name: "Save", exact: true }).click();
  }
  await expect(row.getByRole("button", { name: /^Status of / })).toHaveAccessibleName(
    new RegExp(`: ${label}$`),
    { timeout: 15_000 },
  );
}

async function expectAdminStatus(label: string) {
  const row = await adminRow(titleA);
  await expect(row.getByRole("button", { name: /^Status of / })).toHaveAccessibleName(
    new RegExp(`: ${label}$`),
    { timeout: 15_000 },
  );
}

test.beforeAll(async ({ browser }) => {
  adminCtx = await newCtx(browser);
  admin = await adminCtx.newPage();
  await adminSignIn(admin);
});

test.afterAll(async ({ browser }) => {
  // Cleanup: Trash every E2E bug this spec created, then delete the E2E member.
  const ctx = adminCtx ?? (await newCtx(browser));
  const page = admin ?? (await ctx.newPage());
  if (!admin) await adminSignIn(page);
  admin = page;
  for (const title of [titleA, titleB, titleC]) {
    try {
      await admin.goto("/admin/bugs");
      const search = admin.getByLabel("Search bugs");
      await search.waitFor({ timeout: 20_000 });
      await search.fill(title);
      const row = admin
        .locator("tr")
        .filter({ has: admin.getByRole("button", { name: title, exact: true }) });
      if (
        !(await row.count().then(
          (n) => n > 0,
          () => false,
        ))
      ) {
        await row
          .first()
          .waitFor({ timeout: 5_000 })
          .catch(() => undefined);
      }
      if (!(await row.count())) continue;
      await row.getByRole("button", { name: /^Delete / }).click();
      await admin.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
      await expect(admin.getByRole("alertdialog")).toBeHidden({ timeout: 15_000 });
    } catch (e) {
      console.warn(`cleanup: could not trash ${title}: ${String(e)}`);
    }
  }
  try {
    await admin.goto("/admin/users");
    const search = admin.getByLabel("Search users");
    await search.waitFor({ timeout: 20_000 });
    await search.fill(T);
    const del = admin.getByRole("button", { name: `Delete ${devName}` });
    if (
      await del.waitFor({ timeout: 10_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await del.click();
      await admin.getByRole("alertdialog").getByRole("button", { name: "Delete member" }).click();
      await expect(admin.getByRole("alertdialog")).toBeHidden({ timeout: 15_000 });
    }
  } catch (e) {
    console.warn(`cleanup: could not delete ${devName}: ${String(e)}`);
  }
  await devCtx?.close();
  await ctx.close();
});

test("setup: Admin reports two bugs and creates an E2E developer", async () => {
  await adminReport(titleA);
  await adminReport(titleB);

  await admin.goto("/admin/users");
  await admin.getByRole("button", { name: "Add member" }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.getByPlaceholder("Person’s name").fill(devName);
  await dlg.getByPlaceholder("name@company.com").fill(devEmail);
  await dlg
    .locator("label", { hasText: "Collaborator role" })
    .locator("select")
    .selectOption("developer");
  // Scope the developer to their own bugs: no read-only "view all".
  const viewAll = dlg
    .locator("label.bf-permission", { hasText: "View all project bugs" })
    .getByRole("checkbox");
  await expect(viewAll).toBeChecked();
  await viewAll.click();
  await expect(viewAll).not.toBeChecked();
  const scope = dlg.locator("details", { hasText: "Advanced access scope" });
  if (await scope.isVisible()) {
    await scope.locator("summary").click();
    expect(projectName, "project chosen when reporting").not.toBe("");
    await scope
      .locator("label.bf-permission", { hasText: projectName })
      .getByRole("checkbox")
      .click();
  }
  await dlg.getByRole("button", { name: "Save member & generate portal link" }).click();
  const link = dlg.locator("label", { hasText: "Private portal link" }).locator("input");
  await expect(link).toBeVisible({ timeout: 20_000 });
  portalUrl = await link.inputValue();
  expect(portalUrl).toMatch(/\/developer\/[a-f0-9]{64}/);
  await admin.keyboard.press("Escape");
});

test("Admin assigns bug A to the developer (validate & assign)", async () => {
  const row = await adminRow(titleA);
  await row.getByRole("button", { name: /^Assignee of / }).click();
  const panel = admin.locator(".bf-assign-panel");
  await panel.locator("label.bf-assign-person", { hasText: devName }).click();
  await panel
    .getByRole("button", { name: /^(Validate & assign|Give access & assign|Assign)$/ })
    .click();
  await expect(row.getByRole("button", { name: /^Assignee of / })).toHaveAccessibleName(
    new RegExp(devName),
    { timeout: 15_000 },
  );
  await expect(row.getByRole("button", { name: /^Status of / })).toHaveAccessibleName(
    /: Assigned$/,
  );
});

test("developer portal (no admin cookie) shows only the assigned bug", async ({ browser }) => {
  devCtx = await newCtx(browser);
  dev = await devCtx.newPage();
  await dev.goto(portalUrl);
  await expect(dev.getByRole("heading", { name: /^Hi / })).toBeVisible({ timeout: 20_000 });
  await expect(dev.getByText(/Developer/).first()).toBeVisible();
  await portalRow(titleA);
  // Out of scope: unassigned bug B is not listed (developer has no "view all").
  await expect(dev.getByRole("button", { name: titleB, exact: true })).toHaveCount(0);
  await expect(dev.locator("body")).not.toContainText(titleB);
  // No admin surface leaks into the portal.
  const r = await devCtx.request.get("/admin/bugs", { maxRedirects: 0 });
  expect([301, 302, 303, 307, 308]).toContain(r.status());
});

test("developer cannot change priority or severity", async () => {
  const row = await portalRow(titleA);
  await expect(row.locator(".bf-rating-trigger")).toHaveCount(0);
  await expect(row.locator(".bf-rating")).toBeVisible();
  // The edit form (developer is assignee) shows priority and severity disabled.
  await row.getByRole("button", { name: `Edit ${codes[titleA]}` }).click();
  const dlg = dev.getByRole("dialog");
  await expect(dlg.locator('[aria-label="Priority"]').first()).toBeDisabled({ timeout: 15_000 });
  await expect(dlg.locator('[aria-label="Severity"]').first()).toBeDisabled();
  await dev.keyboard.press("Escape");
  await expect(dev.getByRole("dialog")).toBeHidden();
});

test("developer works the bug: start → ask info → resume → send to retest", async () => {
  await devMove(/^In progress/, "In progress");
  await expectAdminStatus("In progress");

  await devMove(/^Needs information/, "Needs information", "Which browser and device?");
  await expectAdminStatus("Needs information");

  await devMove(/^In progress/, "In progress");
  await expectAdminStatus("In progress");

  await devMove(/^Ready for QA retest/, "Ready for QA retest", "Fix deployed to staging.");
  await expectAdminStatus("Ready for QA retest");

  // Developer can't pass their own retest: status menu is locked.
  const row = await portalRow(titleA);
  await row.getByRole("button", { name: /^Status of / }).click();
  await expect(dev.getByText(/Waiting for QA — only QA or Admin/)).toBeVisible();
  await expect(dev.getByRole("menuitem", { name: /Pass retest|Resolved/ })).toHaveCount(0);
  await dev.keyboard.press("Escape");
});

test("Admin bug history records each transition with the developer as actor", async () => {
  const row = await adminRow(titleA);
  await row.getByRole("button", { name: titleA, exact: true }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.getByRole("button", { name: /Bug history/ }).click();
  const items = dlg.locator(".bf-bd-timeline li").filter({ hasText: devName });
  const expected = [
    /Assigned\s*→\s*In progress/,
    /In progress\s*→\s*Needs information/,
    /Needs information\s*→\s*In progress/,
    /In progress\s*→\s*Ready for QA retest/,
  ];
  for (const re of expected) await expect(items.filter({ hasText: re }).first()).toBeVisible();
  await expect(items.filter({ hasText: "Which browser and device?" }).first()).toBeVisible();
  await expect(items.filter({ hasText: "Fix deployed to staging." }).first()).toBeVisible();
  await admin.keyboard.press("Escape");
});

test("Admin notifications show the developer's transitions", async () => {
  await admin.goto("/admin/notifications");
  await expect(admin.getByText(`${titleA} · by ${devName}`).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("developer can report a bug from the portal", async () => {
  await dev.reload();
  await dev.getByRole("button", { name: "Raise a bug" }).click();
  const dlg = dev.getByRole("dialog", { name: "Raise a bug" });
  await dlg.locator("textarea[name=description]").fill(`${titleC} description`);
  await dlg.locator("textarea[name=steps]").fill("Open\nObserve");
  await dlg.locator("input[name=title]").fill(titleC);
  const sel = dlg.locator("select[name=projectId]");
  if (await sel.count()) await sel.selectOption({ index: 1 });
  await dlg.getByRole("button", { name: "Submit bug" }).click();
  await expect(dev.getByRole("dialog", { name: "Raise a bug" })).toBeHidden({ timeout: 20_000 });
  await dev.keyboard.press("Escape");
  await portalRow(titleC);
  const row = await adminRow(titleC);
  await expect(row.locator('[data-label="Reporter"]')).toContainText(devName);
});

test("portal Board and Sprint tabs render", async () => {
  await dev.getByRole("button", { name: "Board", exact: true }).click();
  await expect(dev.locator(".bf-board-col-head").first()).toBeVisible({ timeout: 20_000 });
  await expect(dev.locator("body")).not.toContainText(titleB);
  await dev.getByRole("button", { name: "Sprint", exact: true }).click();
  await expect(
    dev
      .getByText("No open sprint for your projects right now.")
      .or(dev.locator(".bf-main h2").first()),
  ).toBeVisible({ timeout: 20_000 });
  await expect(dev.locator("body")).not.toContainText(titleB);
});
