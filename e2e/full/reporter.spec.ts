import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { tag, adminSignIn, expectPortalClosed } from "./helpers";

/**
 * Reporter portal + media, end to end through the UI.
 * Admin creates an E2E tester (reporter portal, "view all" unticked so scope is own reports only); the reporter raises
 * a description-only bug and a full bug, edits one (version-checked, no priority/severity change), cannot see an
 * Admin-raised bug, attaches a PNG (stage → Upload → thumbnail → view-only viewer → Trash → restore → delete forever).
 * Everything created is named E2E-reporter-… and removed in afterAll.
 */
test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:4799";
const NAME = tag("reporter");
const EMAIL = `${NAME.toLowerCase()}@example.com`;
const FILE_NAME = `${NAME}-shot`;
// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const DESC_ONLY = `${NAME} quick: the save button does nothing\nSecond line of the description.`;
const DESC_ONLY_TITLE = `${NAME} quick: the save button does nothing`;
const FULL_TITLE = `${NAME} full report`;
const FULL_EDITED = `${NAME} full report (edited)`;
const ADMIN_TITLE = `${NAME} admin-only bug`;

let adminCtx: BrowserContext;
let admin: Page;
let repCtx: BrowserContext;
let rep: Page;
let portalUrl = "";
let projectName = "";
const codes: Record<"quick" | "full" | "admin", string> = { quick: "", full: "", admin: "" };
const idOf = (code: string) => String(Number(code.split("-").pop()));

async function newCtx(browser: Browser) {
  return browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

/** The open "Bug details" dialog. */
const details = (page: Page) => page.getByRole("dialog", { name: "Bug details" });

async function raiseBug(
  page: Page,
  f: { description: string; steps: string; title?: string; expected?: string; actual?: string },
): Promise<string> {
  await page.getByRole("button", { name: "Raise a bug" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Raise a bug" });
  await expect(dlg).toBeVisible();
  await dlg.locator("textarea[name=description]").fill(f.description);
  await dlg.locator("textarea[name=steps]").fill(f.steps);
  if (f.title) await dlg.locator("input[name=title]").fill(f.title);
  if (f.expected) await dlg.locator("textarea[name=expected]").fill(f.expected);
  if (f.actual) await dlg.locator("textarea[name=actual]").fill(f.actual);
  const project = dlg.locator("select[name=projectId]");
  if (await project.count()) await project.selectOption({ label: projectName });
  await dlg.getByRole("button", { name: /^Submit bug/ }).click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });
  const d = details(page);
  await expect(d).toBeVisible({ timeout: 15_000 });
  const code = (await d.locator(".bf-bd-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z]+-\d+$/);
  return code;
}

async function closeDialog(page: Page) {
  // Escape can land while a confirm or toast still holds focus; retry until no dialog is left.
  const open = page.locator("[role=dialog][data-state=open], [role=alertdialog][data-state=open]");
  await expect(async () => {
    if (await open.count()) await page.keyboard.press("Escape");
    await expect(open).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

test.beforeAll(async ({ browser }) => {
  adminCtx = await newCtx(browser);
  admin = await adminCtx.newPage();
  await adminSignIn(admin);
});

test.afterAll(async ({ browser }) => {
  // Fresh admin page so a failed test's open dialog cannot block clean-up.
  const ctx = adminCtx ?? (await newCtx(browser));
  const page = await ctx.newPage();
  try {
    if (!adminCtx) await adminSignIn(page);
    for (const code of Object.values(codes).filter(Boolean)) {
      try {
        const d = details(page);
        await expect(async () => {
          await page.goto(`/admin/bugs?bug=${idOf(code)}`);
          await expect(d.locator(".bf-bd-code")).toHaveText(code, { timeout: 20_000 });
        }).toPass({ timeout: 60_000 });
        await expect(d.locator("h2.bf-detail-title")).toContainText(NAME);
        await d.getByRole("button", { name: "Delete" }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
        await expect(page.getByRole("alertdialog")).toBeHidden({ timeout: 15_000 });
      } catch (e) {
        console.warn(`cleanup: could not trash ${code}: ${String(e)}`);
      }
    }
    try {
      await page.goto("/admin/users");
      await page.getByRole("textbox", { name: "Search users" }).fill(NAME);
      const del = page.getByRole("button", { name: `Delete ${NAME}` });
      await del.click({ timeout: 15_000 });
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete member" }).click();
      await expect(page.getByRole("alertdialog")).toBeHidden({ timeout: 15_000 });
      if (portalUrl) {
        const anon = await newCtx(browser);
        await expectPortalClosed(await anon.newPage(), portalUrl);
        await anon.close();
      }
    } catch (e) {
      console.warn(`cleanup: could not delete member ${NAME}: ${String(e)}`);
    }
  } finally {
    await repCtx?.close();
    await ctx.close();
  }
});

test("Admin creates an E2E reporter and gets a private portal link", async () => {
  await admin.goto("/admin/users");
  await admin.getByRole("button", { name: "Add member" }).click();
  const dlg = admin.getByRole("dialog", { name: "Create a portal" });
  await expect(dlg).toBeVisible();
  await dlg.getByPlaceholder("Person’s name").fill(NAME);
  await dlg.getByPlaceholder("name@company.com").fill(EMAIL);
  await expect(dlg.locator("select.bf-select").first()).toHaveValue("tester");
  // More than one project: pick exactly one so the reporter's scope is known.
  const det = dlg.locator("details");
  const projectBoxes = det.locator("label.bf-permission");
  // Wait for projects: the section hides itself when there is exactly one (auto-selected).
  await expect
    .poll(
      async () => (await det.getAttribute("hidden")) !== null || (await projectBoxes.count()) > 1,
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  if ((await det.getAttribute("hidden")) === null) {
    await dlg.getByText("Advanced access scope").click();
    const first = dlg
      .locator("fieldset:has(legend:text('Project access')) label.bf-permission")
      .first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    projectName = (await first.innerText()).trim();
    await first.getByRole("checkbox").click();
  }
  // Own reports only: untick "view all" so scope is provable.
  const viewAll = dlg.getByRole("checkbox", { name: "View all project bugs (read only)" });
  await expect(viewAll).toBeChecked();
  await viewAll.click();
  await expect(viewAll).not.toBeChecked();
  await dlg.getByRole("button", { name: "Save member & generate portal link" }).click();
  const link = dlg.getByRole("textbox", { name: "Private portal link" });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.inputValue();
  const path = new URL(href).pathname;
  expect(path).toMatch(/^\/reporter\/[^/]+$/);
  portalUrl = BASE + path;
  await closeDialog(admin);
});

test("reporter portal opens in an isolated context and shows only the reporter's identity", async ({
  browser,
}) => {
  repCtx = await newCtx(browser);
  rep = await repCtx.newPage();
  await rep.goto(portalUrl);
  await expect(rep.getByRole("heading", { name: `Hi ${NAME}` })).toBeVisible({ timeout: 20_000 });
  // No Admin session in this context.
  await rep.goto("/admin/bugs");
  await expect(rep).toHaveURL(/\/login\?redirect=/);
  await rep.goto(portalUrl);
  await expect(rep.getByRole("heading", { name: `Hi ${NAME}` })).toBeVisible({ timeout: 20_000 });
  if (!projectName) {
    await rep.getByRole("button", { name: /My projects/ }).click();
    projectName = (
      await rep
        .locator("section[aria-label='My projects and access'] strong.text-foreground")
        .innerText()
    ).trim();
    await rep.getByRole("button", { name: "My bugs" }).click();
  }
  expect(projectName).not.toBe("");
});

test("description-only report derives title and actual result; contextual fields stay empty", async () => {
  codes.quick = await raiseBug(rep, { description: DESC_ONLY, steps: "Open settings\nPress Save" });
  const d = details(rep);
  await expect(d.locator("h2.bf-detail-title")).toHaveText(DESC_ONLY_TITLE);
  const actual = d.locator("section.bf-rc-card", {
    has: rep.getByRole("heading", { name: "Actual result" }),
  });
  await expect(actual).toContainText(DESC_ONLY_TITLE);
  await expect(actual).toContainText("Second line of the description.");
  const expected = d.locator("section.bf-rc-card", {
    has: rep.getByRole("heading", { name: "Expected result" }),
  });
  await expect(expected).toContainText("Not specified");
  const meta = d.locator("dl.bf-bd-meta");
  await expect(meta.locator("div", { hasText: "Environment" }).locator("dd")).toHaveText(
    "Not specified",
  );
  await expect(meta.locator("div", { hasText: "Browser / device" }).locator("dd")).toHaveText(
    "Not specified",
  );
  await expect(meta.locator("div", { hasText: "Reported by" }).locator("dd")).toContainText(NAME);
  await closeDialog(rep);
});

test("full report keeps steps, expected and actual as written", async () => {
  codes.full = await raiseBug(rep, {
    description: `${NAME} full: totals are wrong on the invoice page`,
    steps: "Open an invoice\nAdd two lines\nLook at the total",
    title: FULL_TITLE,
    expected: "Total equals the sum of the lines",
    actual: "Total shows only the first line",
  });
  const d = details(rep);
  await expect(d.locator("h2.bf-detail-title")).toHaveText(FULL_TITLE);
  const steps = d.locator("section.bf-rc-card", {
    has: rep.getByRole("heading", { name: "Steps to replicate" }),
  });
  await expect(steps.locator("li")).toHaveText([
    /Open an invoice/,
    /Add two lines/,
    /Look at the total/,
  ]);
  await expect(
    d.locator("section.bf-rc-card", { has: rep.getByRole("heading", { name: "Expected result" }) }),
  ).toContainText("Total equals the sum of the lines");
  await expect(
    d.locator("section.bf-rc-card", { has: rep.getByRole("heading", { name: "Actual result" }) }),
  ).toContainText("Total shows only the first line");
  await closeDialog(rep);
});

test("'My reports' (bugs I raised) lists both reports", async () => {
  await rep.reload();
  const mine = rep.getByRole("tab", { name: /My reports/ });
  await expect(mine).toBeVisible({ timeout: 20_000 });
  await expect(mine).toContainText("Bugs I raised");
  await expect(mine.locator("strong")).toHaveText("2");
  await mine.click();
  await expect(mine).toHaveAttribute("aria-selected", "true");
  const table = rep.locator("table");
  await expect(table.getByRole("button", { name: DESC_ONLY_TITLE })).toBeVisible({
    timeout: 15_000,
  });
  await expect(table.getByRole("button", { name: FULL_TITLE })).toBeVisible();
  await expect(table.getByRole("button", { name: `Copy bug ID ${codes.quick}` })).toBeVisible();
  await expect(table.getByRole("button", { name: `Copy bug ID ${codes.full}` })).toBeVisible();
});

test("reporter cannot see a bug outside their scope (Admin-raised, same project)", async () => {
  await admin.goto("/admin/bugs");
  codes.admin = await raiseBug(admin, {
    description: `${ADMIN_TITLE} description`,
    steps: "Step one",
    title: ADMIN_TITLE,
  });
  await closeDialog(admin);
  await rep.goto(portalUrl);
  await expect(rep.getByRole("heading", { name: `Hi ${NAME}` })).toBeVisible({ timeout: 20_000 });
  await expect(rep.locator("table").getByRole("button", { name: FULL_TITLE })).toBeVisible({
    timeout: 15_000,
  });
  await expect(rep.locator("body")).not.toContainText(ADMIN_TITLE);
  await expect(rep.locator("body")).not.toContainText(codes.admin);
  // Deep link to the bug: the detail read is refused, nothing of the report shows.
  await rep.goto(`${portalUrl}?bug=${idOf(codes.admin)}`);
  await expect(details(rep).getByText("This bug is not available in your portal.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(rep.locator("body")).not.toContainText(ADMIN_TITLE);
  await expect(rep.locator("body")).not.toContainText(`${ADMIN_TITLE} description`);
  await closeDialog(rep);
  await rep.goto(portalUrl);
});

test("reporter edits own report; priority and severity are locked", async () => {
  await expect(rep.getByRole("button", { name: `Edit ${codes.full}` })).toBeVisible({
    timeout: 20_000,
  });
  await rep.getByRole("button", { name: `Edit ${codes.full}` }).click();
  const d = details(rep);
  await expect(d.getByText(`Edit ${codes.full}`)).toBeVisible({ timeout: 15_000 });
  await expect(d.getByRole("combobox", { name: "Priority" })).toBeDisabled();
  await expect(d.getByRole("combobox", { name: "Severity" })).toBeDisabled();
  await d.locator("input[name=title]").fill(FULL_EDITED);
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect(rep.getByText(`Bug updated · ${codes.full}`)).toBeVisible({ timeout: 15_000 });
  await expect(d.locator("h2.bf-detail-title")).toHaveText(FULL_EDITED, { timeout: 15_000 });
  await closeDialog(rep);
  // Persisted: survives a reload.
  await rep.reload();
  await expect(rep.locator("table").getByRole("button", { name: FULL_EDITED })).toBeVisible({
    timeout: 20_000,
  });
});

test("a stale edit is refused (version check)", async () => {
  // Tab A opens the edit form; tab B saves a change first; tab A's save must be refused.
  const a = rep;
  const b = await repCtx.newPage();
  for (const p of [a, b]) {
    await p.goto(`${portalUrl}?bug=${idOf(codes.quick)}`);
    await expect(details(p).locator(".bf-bd-code")).toHaveText(codes.quick, { timeout: 20_000 });
    await details(p).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(details(p).getByText(`Edit ${codes.quick}`)).toBeVisible();
  }
  await details(b).locator("textarea[name=expected]").fill("Saved from tab B");
  await details(b).getByRole("button", { name: "Save changes" }).click();
  await expect(b.getByText(`Bug updated · ${codes.quick}`)).toBeVisible({ timeout: 15_000 });
  await b.close();
  await details(a).locator("textarea[name=expected]").fill("Saved from stale tab A");
  await details(a).getByRole("button", { name: "Save changes" }).click();
  await expect(details(a).getByText(/changed since you opened it|Refresh/i)).toBeVisible({
    timeout: 15_000,
  });
  await closeDialog(a);
  await a.goto(`${portalUrl}?bug=${idOf(codes.quick)}`);
  const exp = details(a).locator("section.bf-rc-card", {
    has: a.getByRole("heading", { name: "Expected result" }),
  });
  await expect(exp).toContainText("Saved from tab B", { timeout: 20_000 });
  await closeDialog(a);
});

test("Admin sees the reports with the reporter as actor", async () => {
  await admin.goto(`/admin/bugs?bug=${idOf(codes.full)}`);
  const d = details(admin);
  await expect(d.locator(".bf-bd-code")).toHaveText(codes.full, { timeout: 20_000 });
  await expect(d.locator("h2.bf-detail-title")).toHaveText(FULL_EDITED);
  await expect(
    d.locator("dl.bf-bd-meta div", { hasText: "Reported by" }).locator("dd"),
  ).toContainText(NAME);
  await d.getByRole("button", { name: /Bug history/ }).click();
  const timeline = d.locator("ol.bf-bd-timeline");
  await expect(timeline.locator("li")).not.toHaveCount(0);
  // Every change (report + edit) on this bug was made by the reporter.
  await expect(timeline.locator("li strong").first()).toHaveText(NAME);
  await expect(timeline.locator("li", { hasText: NAME })).toHaveCount(
    await timeline.locator("li").count(),
  );
  await closeDialog(admin);
  await admin.goto("/admin/bugs");
  await admin.getByRole("textbox", { name: "Search bugs" }).fill(NAME);
  const row = admin.locator("tr[data-bug-row]", { hasText: DESC_ONLY_TITLE });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator("td[data-label=Reporter]")).toContainText(NAME);
});

test("media: stage a PNG, Upload, thumbnail, view-only viewer, Trash, restore, delete forever", async () => {
  test.setTimeout(150_000);
  await rep.goto(`${portalUrl}?bug=${idOf(codes.full)}`);
  const d = details(rep);
  await expect(d.locator(".bf-bd-code")).toHaveText(codes.full, { timeout: 20_000 });
  const att = d.locator("section.bf-rc-card", {
    has: rep.getByRole("heading", { name: /Attachments/ }),
  });
  await expect(att).toBeVisible();
  test.skip(
    await att.getByText("Media uploads unavailable").isVisible(),
    "media storage is not connected on this server",
  );
  // Environment, not app: the bucket's CORS rule lists the real app addresses but not this test server
  // (localhost:4799), and workspace storage settings must not be changed. Answer the browser's CORS checks for the
  // bucket here; the request itself still goes to the real bucket unchanged.
  test.info().annotations.push({
    type: "env",
    description:
      "bucket CORS does not list localhost:4799; CORS headers are added by page.route for bucket calls",
  });
  await repCtx.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const req = route.request();
    const origin = req.headers()["origin"];
    if (!origin) return route.continue();
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,PUT,POST,HEAD,DELETE",
      "access-control-allow-headers": req.headers()["access-control-request-headers"] ?? "*",
      "access-control-expose-headers": "ETag",
      "access-control-max-age": "600",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
  await att.locator("input[type=file]").setInputFiles({
    name: "e2e-shot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  // Staged, not uploaded yet.
  const nameBox = att.getByRole("textbox", { name: "Name for e2e-shot.png" });
  await expect(nameBox).toBeVisible({ timeout: 20_000 });
  const upload = att.getByRole("button", { name: /^Upload 1 file$/ });
  await expect(upload).toBeVisible({ timeout: 20_000 });
  await expect(att.getByRole("button", { name: `Open ${FILE_NAME}` })).toHaveCount(0);
  await nameBox.fill(FILE_NAME);
  await upload.click();
  // Thumbnail appears on the bug.
  const thumb = att.getByRole("button", { name: `Open ${FILE_NAME}` });
  await expect(thumb).toBeVisible({ timeout: 60_000 });
  await expect(thumb.locator("img")).toBeVisible();
  await expect
    .poll(
      async () =>
        thumb.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
      {
        timeout: 20_000,
      },
    )
    .toBe(true);
  // View-only viewer.
  await thumb.click();
  const viewer = rep.getByRole("dialog", { name: FILE_NAME });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".bf-lightbox-stage img")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Mark up|Rename|Remove|Delete/ })).toHaveCount(0);
  await rep.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(d).toBeVisible();
  // Remove → Trash.
  const tile = att.locator("figure.bf-media-tile", { hasText: FILE_NAME });
  await tile.getByRole("button", { name: "Remove" }).click();
  const confirm = rep.getByRole("alertdialog", { name: `Remove ${FILE_NAME}?` });
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  await expect(confirm).toBeHidden({ timeout: 15_000 });
  await expect(att.getByRole("button", { name: `Open ${FILE_NAME}` })).toHaveCount(0, {
    timeout: 15_000,
  });
  await closeDialog(rep);
  // My media → Removed files → Restore.
  await rep.getByRole("button", { name: "My media" }).click();
  const removedRow = rep.locator(".bf-trash-row", { hasText: FILE_NAME });
  await expect(removedRow).toBeVisible({ timeout: 20_000 });
  await expect(removedRow).toContainText(codes.full);
  await removedRow.getByRole("button", { name: "Restore" }).click();
  await expect(rep.getByText(`${FILE_NAME} restored`)).toBeVisible({ timeout: 15_000 });
  const libTile = rep.locator(".bf-library figure.bf-media-tile", { hasText: FILE_NAME });
  await expect(libTile).toBeVisible({ timeout: 15_000 });
  await expect(removedRow).toHaveCount(0);
  // Back on the bug after a reload.
  await rep.goto(`${portalUrl}?bug=${idOf(codes.full)}`);
  await expect(details(rep).getByRole("button", { name: `Open ${FILE_NAME}` })).toBeVisible({
    timeout: 20_000,
  });
  await closeDialog(rep);
  // Delete from My media, then Delete forever.
  await rep.getByRole("button", { name: "My media" }).click();
  await rep.getByRole("button", { name: `Move ${FILE_NAME} to Trash` }).click();
  await rep
    .getByRole("alertdialog", { name: `Move ${FILE_NAME} to Trash?` })
    .getByRole("button", { name: "Move to Trash" })
    .click();
  await expect(removedRow).toBeVisible({ timeout: 20_000 });
  await removedRow.getByRole("button", { name: "Delete forever" }).click();
  await rep
    .getByRole("alertdialog", { name: `Delete ${FILE_NAME} forever?` })
    .getByRole("button", { name: "Delete forever" })
    .click();
  await expect(removedRow).toHaveCount(0, { timeout: 20_000 });
  await expect(libTile).toHaveCount(0);
  await rep.reload();
  await expect(rep.getByRole("heading", { name: `Hi ${NAME}` })).toBeVisible({ timeout: 20_000 });
  await expect(rep.locator("body")).not.toContainText(FILE_NAME, { timeout: 15_000 });
});
