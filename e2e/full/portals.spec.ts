import { test, expect, type Browser, type Page } from "@playwright/test";
import { tag, adminSignIn, readClipboard, expectPortalClosed } from "./helpers";

/**
 * Member portal lifecycle through the UI: create per role, copy/open, first-visit welcome, replace link,
 * profile edit, deactivate/activate, delete (soft) and garbled tokens. Every record is named `E2E-portals-…`
 * and removed in afterAll (bugs to Trash, members deleted).
 */
const BASE = "http://localhost:4799";
const PREFIX = "E2E-portals-";
const ROLES = [
  { role: "tester", path: "reporter", label: /^Tester/ },
  { role: "developer", path: "developer", label: /^Developer/ },
  { role: "qa", path: "qa", label: /^QA/ },
] as const;

/** Portal path (/type/token) from any copied URL; copies may use VITE_SITE_URL instead of this server. */
const pathOf = (url: string) => new URL(url).pathname;
const usersPage = (name: string) => `/admin/users?q=${encodeURIComponent(name)}`;
const memberRow = (page: Page, name: string) =>
  page.locator("table.bf-member-table tbody tr", { hasText: name });

async function createMember(page: Page, name: string, role: string): Promise<string> {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(name);
  await dialog
    .getByLabel("Email")
    .fill(`${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`);
  await dialog.getByLabel("Collaborator role").selectOption(role);
  const save = dialog.getByRole("button", { name: "Save member & generate portal link" });
  const scope = dialog.locator("details");
  // Several projects: pick the first one in "Advanced access scope" (one project is auto-selected).
  await expect
    .poll(
      async () => (await scope.isHidden()) || (await scope.locator("[role=checkbox]").count()) > 0,
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  if (await scope.isVisible()) {
    await scope.locator("summary").click();
    const box = scope.getByRole("checkbox").first();
    if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
  }
  await expect(save).toBeEnabled({ timeout: 15_000 });
  await save.click();
  const link = dialog.getByLabel("Private portal link");
  await expect(link).toBeVisible({ timeout: 20_000 });
  const url = await link.inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return pathOf(url);
}

async function openProfile(page: Page, name: string) {
  await page.goto(usersPage(name));
  await page.getByRole("button", { name: `Open profile for ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: "Member profile" });
  await expect(dialog.getByLabel("First-visit welcome")).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function saveProfile(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm changes" }).click();
  await expect(page.getByText("Profile and permissions saved")).toBeVisible({ timeout: 15_000 });
}

async function confirmRowAction(
  page: Page,
  name: string,
  action: "Deactivate" | "Activate" | "Delete",
) {
  await page.goto(usersPage(name));
  await page.getByRole("button", { name: `${action} ${name}`, exact: true }).click();
  const alert = page.getByRole("alertdialog");
  await alert
    .getByRole("button", { name: action === "Delete" ? "Delete member" : action, exact: true })
    .click();
  await expect(alert).toBeHidden({ timeout: 15_000 });
}

async function expectPortalOpen(page: Page, path: string, name: string) {
  await page.goto(BASE + path);
  // Plain h1 match: a first-visit welcome modal hides the page from the accessibility tree.
  await expect(page.locator("h1", { hasText: `Hi ${name.split(/\s+/)[0]}` })).toBeVisible({
    timeout: 20_000,
  });
}

async function expectUnavailable(page: Page, path: string) {
  await expectPortalClosed(page, BASE + path);
  await expect(page.getByRole("heading", { name: "Portal unavailable" })).toBeVisible({
    timeout: 20_000,
  });
}

async function memberPage(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE });
  return { ctx, page: await ctx.newPage() };
}

/** Raise a bug from whichever page is showing a bug workspace (Admin or portal) with the given title. */
async function raiseBug(page: Page, title: string) {
  await page.getByRole("button", { name: "Raise a bug" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Raise a bug" });
  await dialog.locator("textarea[name=description]").fill(`${title} description`);
  await dialog.locator("textarea[name=steps]").fill("Open the page\nObserve the issue");
  await dialog.locator("input[name=title]").fill(title);
  const project = dialog.getByLabel("Project");
  if (await project.count()) {
    const values = await project
      .locator("option")
      .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
    await project.selectOption(values[0]!);
  }
  await dialog.getByRole("button", { name: "Submit bug" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

for (const r of ROLES) {
  test(`${r.role}: create, copy/open, welcome, replace link, edit permissions`, async ({
    page,
    browser,
  }) => {
    const name = `${tag("portals")} ${r.role}`;
    await adminSignIn(page);
    const created = await createMember(page, name, r.role);
    expect(created).toMatch(new RegExp(`^/${r.path}/[^/]+$`));

    // Listed with the right role and Active access.
    await page.goto(usersPage(name));
    const row = memberRow(page, name);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator("td[data-label=Access]")).toContainText("Active");
    await expect(row.locator("td[data-label=Role]")).toHaveText(new RegExp(`^${r.role}$`, "i"));

    // Copy gives the same link that was issued.
    await page.getByRole("button", { name: `Copy portal for ${name}` }).click();
    await expect(page.getByText("Private portal link copied")).toBeVisible();
    expect(pathOf(await readClipboard(page))).toBe(created);

    // Open launches the portal in a new tab on this server.
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: `Open portal for ${name}` }).click(),
    ]);
    await popup.waitForURL(`**${created}`, { timeout: 15_000 });
    await popup.close();

    // A first-visit welcome is set from the profile before the member first opens the portal.
    const welcomeText = `Welcome text for ${name}`;
    let dialog = await openProfile(page, name);
    await dialog.getByLabel("First-visit welcome").fill(welcomeText);
    await saveProfile(page, dialog);
    await page.keyboard.press("Escape");

    // Member opens the link in a separate context: right role view and the welcome.
    const m = await memberPage(browser);
    try {
      await expectPortalOpen(m.page, created, name);
      expect(new URL(m.page.url()).pathname).toBe(created);
      await expect(m.page.locator(".bf-portal-role")).toHaveText(r.label);
      const welcome = m.page.getByRole("dialog", { name: `Welcome, ${name}` });
      await expect(welcome).toBeVisible();
      await expect(welcome).toContainText(welcomeText);
      await welcome.getByRole("button", { name: "Continue to my bugs" }).click();
      await expect(welcome).toBeHidden({ timeout: 15_000 });
      await m.page.reload();
      await expect(m.page.locator("h1", { hasText: /^Hi / })).toBeVisible({ timeout: 20_000 });
      await expect(m.page.getByRole("dialog", { name: `Welcome, ${name}` })).toHaveCount(0);
      await expect(m.page.getByRole("button", { name: "Raise a bug" }).first()).toBeVisible();

      // Admin profile records the welcome as viewed.
      dialog = await openProfile(page, name);
      await expect(dialog.getByText("Welcome viewed")).toBeVisible();
      await page.keyboard.press("Escape");

      // Replace the link (arm, then confirm): old link closes, new one works without a second welcome.
      await page.goto(usersPage(name));
      await page.getByRole("button", { name: `Replace portal link for ${name}` }).click();
      await page
        .getByRole("button", { name: `Confirm replacing the portal link for ${name}` })
        .click();
      await expect(page.getByText(`New link for ${name} copied`)).toBeVisible({ timeout: 15_000 });
      const replaced = pathOf(await readClipboard(page));
      expect(replaced).toMatch(new RegExp(`^/${r.path}/[^/]+$`));
      expect(replaced).not.toBe(created);
      await expectUnavailable(m.page, created);
      await expectPortalOpen(m.page, replaced, name);
      await expect(m.page.getByRole("dialog", { name: `Welcome, ${name}` })).toHaveCount(0);
      // Copy now hands out the replacement.
      await page.getByRole("button", { name: `Copy portal for ${name}` }).click();
      expect(pathOf(await readClipboard(page))).toBe(replaced);

      // Admin removes "Report bugs": the portal drops "Raise a bug" after a reload.
      dialog = await openProfile(page, name);
      const report = dialog.getByRole("checkbox", { name: "Report bugs" });
      await expect(report).toBeChecked();
      await report.click();
      await saveProfile(page, dialog);
      await page.keyboard.press("Escape");
      await m.page.reload();
      await expect(m.page.locator("h1", { hasText: /^Hi / })).toBeVisible({ timeout: 20_000 });
      await expect(m.page.getByRole("button", { name: "Raise a bug" })).toHaveCount(0);
      // The change persisted on the profile.
      dialog = await openProfile(page, name);
      await expect(dialog.getByRole("checkbox", { name: "Report bugs" })).not.toBeChecked();
      await page.keyboard.press("Escape");
    } finally {
      await m.ctx.close();
    }
  });
}

test("deactivate closes the portal and hides the assignee; activate and new link work", async ({
  page,
  browser,
}) => {
  const name = `${tag("portals")} deact`;
  const bugTitle = `${tag("portals")} assignee check`;
  await adminSignIn(page);
  const link = await createMember(page, name, "developer");

  // An Admin-raised bug to check the assignee list on.
  await page.goto("/admin/bugs");
  await raiseBug(page, bugTitle);
  const openAssign = async () => {
    await page.goto(`/admin/bugs?q=${encodeURIComponent(bugTitle)}`);
    const row = page.locator("tr", { hasText: bugTitle }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /^Assignee of / }).click();
    const panel = page.locator(".bf-assign-panel");
    await expect(panel).toBeVisible();
    const search = panel.getByLabel("Search people");
    if (await search.count()) await search.fill(name);
    return panel;
  };
  let panel = await openAssign();
  await expect(panel).toContainText(name);
  await page.keyboard.press("Escape");

  const m = await memberPage(browser);
  try {
    await expectPortalOpen(m.page, link, name);

    await confirmRowAction(page, name, "Deactivate");
    await expect(page.getByText(`${name} deactivated`)).toBeVisible();
    await page.reload();
    await expect(memberRow(page, name).locator("td[data-label=Access]")).toContainText(
      "Deactivated",
    );
    await expect(page.getByRole("button", { name: `Copy portal for ${name}` })).toHaveCount(0);
    await expectUnavailable(m.page, link);

    panel = await openAssign();
    await expect(panel).not.toContainText(name);
    await page.keyboard.press("Escape");

    // Activate: the same link works again.
    await confirmRowAction(page, name, "Activate");
    await expect(page.getByText(`${name} activated`)).toBeVisible();
    await expectPortalOpen(m.page, link, name);
    panel = await openAssign();
    await expect(panel).toContainText(name);
    await page.keyboard.press("Escape");

    // Issue a fresh link from the profile: old closes, new works.
    const dialog = await openProfile(page, name);
    await dialog.getByRole("button", { name: "Replace link" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm changes" }).click();
    await expect(page.getByText("Portal link replaced")).toBeVisible({ timeout: 15_000 });
    const shown = await dialog.getByLabel("Private portal link").inputValue();
    await dialog.getByRole("button", { name: "Copy portal" }).click();
    await expect(page.getByText("Private portal link copied")).toBeVisible({ timeout: 15_000 });
    const fresh = pathOf(await readClipboard(page));
    expect(fresh).toBe(pathOf(shown));
    expect(fresh).not.toBe(link);
    await expectUnavailable(m.page, link);
    await expectPortalOpen(m.page, fresh, name);
  } finally {
    await m.ctx.close();
  }
});

test("delete closes the portal, removes the member and keeps their bug's reporter", async ({
  page,
  browser,
}) => {
  const name = `${tag("portals")} gone`;
  const bugTitle = `${tag("portals")} reported by deleted member`;
  await adminSignIn(page);
  const link = await createMember(page, name, "tester");

  const m = await memberPage(browser);
  try {
    await expectPortalOpen(m.page, link, name);
    await raiseBug(m.page, bugTitle);

    await confirmRowAction(page, name, "Delete");
    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    await page.goto(usersPage(name));
    await expect(page.getByText("No members found")).toBeVisible({ timeout: 15_000 });
    await expect(memberRow(page, name)).toHaveCount(0);
    await expectUnavailable(m.page, link);

    // The bug they reported keeps their name as reporter.
    await page.goto(`/admin/bugs?q=${encodeURIComponent(bugTitle)}`);
    const row = page.locator("tr", { hasText: bugTitle }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator("td[data-label=Reporter]")).toContainText(name);
  } finally {
    await m.ctx.close();
  }
});

test("revoke closes the link but keeps the member active; replace issues a working one", async ({
  page,
  browser,
}) => {
  const name = `${tag("portals")} revoked`;
  await adminSignIn(page);
  const link = await createMember(page, name, "developer");

  const m = await memberPage(browser);
  try {
    await expectPortalOpen(m.page, link, name);

    // Cancel keeps the link working.
    await page.goto(usersPage(name));
    await page.getByRole("button", { name: `Revoke portal link for ${name}` }).click();
    let alert = page.getByRole("alertdialog");
    await expect(alert.getByText("Revoke portal link?")).toBeVisible();
    await alert.getByRole("button", { name: "Cancel" }).click();
    await expect(alert).toBeHidden();
    await expectPortalOpen(m.page, link, name);

    // Confirm revokes: the portal closes, the member stays active and is shown as revoked.
    await page.getByRole("button", { name: `Revoke portal link for ${name}` }).click();
    alert = page.getByRole("alertdialog");
    await alert.getByRole("button", { name: "Revoke link", exact: true }).click();
    await expect(alert).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(`Portal link for ${name} revoked`)).toBeVisible();
    await expectUnavailable(m.page, link);
    await page.reload();
    const row = memberRow(page, name);
    await expect(row.locator("td[data-label=Access]")).toContainText("Revoked / expired", {
      timeout: 15_000,
    });
    await expect(row.getByRole("button", { name: `Deactivate ${name}` })).toBeVisible();
    await expect(row.getByRole("button", { name: `Copy portal for ${name}` })).toHaveCount(0);

    // Replace link gives a new, working link; the revoked one stays closed.
    await row
      .getByRole("button", { name: `Replace portal link for ${name}` })
      .first()
      .click();
    await row
      .getByRole("button", { name: `Confirm replacing the portal link for ${name}` })
      .first()
      .click();
    await expect(page.getByText(`New link for ${name} copied`)).toBeVisible({ timeout: 15_000 });
    const fresh = pathOf(await readClipboard(page));
    expect(fresh).not.toBe(link);
    await expectPortalOpen(m.page, fresh, name);
    await expectUnavailable(m.page, link);
  } finally {
    await m.ctx.close();
  }
});

test("links are distinct per member and garbled tokens show nothing", async ({ page, browser }) => {
  const a = `${tag("portals")} alpha`;
  const b = `${tag("portals")} beta`;
  await adminSignIn(page);
  const la = await createMember(page, a, "developer");
  const lb = await createMember(page, b, "developer");
  expect(la).not.toBe(lb);

  const m = await memberPage(browser);
  try {
    await expectPortalOpen(m.page, la, a);
    await expect(m.page.locator("body")).not.toContainText(b);
    await expectPortalOpen(m.page, lb, b);
    await expect(m.page.locator("body")).not.toContainText(a);

    const token = la.split("/")[2]!;
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    for (const bad of [
      `/developer/${flipped}`,
      `/developer/${token.slice(0, -4)}`,
      `/qa/garbled-${Date.now()}`,
      `/reporter/%00%27--`,
      `/member/${"x".repeat(200)}`,
    ]) {
      await expectUnavailable(m.page, bad);
      await expect(m.page.locator("body")).not.toContainText(a);
    }
  } finally {
    await m.ctx.close();
  }
});

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await adminSignIn(page);
    // Bugs first (members' history stays intact either way).
    await page.goto(`/admin/bugs?q=${encodeURIComponent(PREFIX)}`);
    await page.waitForLoadState("networkidle");
    for (let i = 0; i < 20; i++) {
      const row = page.locator("tr", { hasText: PREFIX }).filter({
        has: page.getByRole("button", { name: /^Delete / }),
      });
      if (!(await row.count())) break;
      await row
        .first()
        .getByRole("button", { name: /^Delete / })
        .click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
      await expect(page.getByRole("alertdialog")).toBeHidden({ timeout: 15_000 });
      await page.waitForTimeout(500);
    }
    await page.goto(usersPage(PREFIX));
    await page.waitForLoadState("networkidle");
    for (let i = 0; i < 30; i++) {
      const rows = memberRow(page, PREFIX);
      if (!(await rows.count())) break;
      const label = await rows
        .first()
        .getByRole("button", { name: /^Delete / })
        .getAttribute("aria-label");
      await rows
        .first()
        .getByRole("button", { name: /^Delete / })
        .click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete member" }).click();
      await expect(page.getByRole("alertdialog")).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: label!, exact: true })).toHaveCount(0);
    }
  } finally {
    await ctx.close();
  }
});
