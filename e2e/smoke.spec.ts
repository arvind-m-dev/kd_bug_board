import { test, expect, type Page } from "@playwright/test";

/** Signed-out surface: safe pages render, private pages redirect, nothing leaks. */
test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: /sign in/i }).or(page.getByText(/sign in/i).first()),
  ).toBeVisible();
  await expect(page.locator("input[type=password]")).toBeVisible();
  await page.screenshot({ path: "e2e/shots/login.png", fullPage: false });
});

test("admin pages redirect to login when signed out", async ({ page }) => {
  for (const path of ["/admin", "/admin/bugs", "/admin/sprints", "/admin/board"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?redirect=/);
  }
});

test("the user guide is public and lists every role's steps", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("heading", { name: /user guide/i })).toBeVisible();
  for (const h of [
    /raise a bug/i,
    /validate and assign/i,
    /verify/i,
    /due dates & sprints/i,
    /the board/i,
  ])
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  await page.screenshot({ path: "e2e/shots/guide.png", fullPage: true });
});

test("a bad portal link shows no bug data", async ({ page }) => {
  await page.goto("/member/not-a-real-token");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toContainText(/BUG-\d/);
  await page.screenshot({ path: "e2e/shots/bad-portal.png" });
});

/**
 * Signed-in sweep: signs in with the real Admin credentials from .env.local (loaded by the config; never written
 * into this file). Self-skips when they are not configured.
 */
async function adminSignIn(page: Page): Promise<boolean> {
  const email = process.env["BUGFLOW_ADMIN_EMAIL"];
  const password = process.env["BUGFLOW_ADMIN_PASSWORD"];
  if (!email || !password) return false;
  await page.goto("/login");
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
  return true;
}

test("admin overview, sprints and board render (signed in)", async ({ page }) => {
  test.skip(!(await adminSignIn(page)), "admin credentials not configured");
  await expect(page.getByRole("heading", { name: /needs your attention/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({ path: "e2e/shots/overview.png", fullPage: true });

  await page.goto("/admin/sprints");
  // Wait for the lazy view itself (its button), not just the page title, so the screenshot shows real content.
  await expect(page.getByRole("button", { name: /new sprint/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/shots/sprints.png", fullPage: true });

  await page.goto("/admin/board");
  for (const col of ["To do", "Assigned", "In progress", "Retest", "Done"])
    await expect(page.locator(".bf-board-col-head").filter({ hasText: col }).first()).toBeVisible({
      timeout: 15_000,
    });
  await page.screenshot({ path: "e2e/shots/board.png", fullPage: true });

  await page.goto("/admin/backlog");
  await expect(page.getByRole("button", { name: /new item/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/shots/backlog.png", fullPage: true });

  await page.goto("/admin/bugs?cal=1");
  await expect(page.getByRole("button", { name: /calendar/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({ path: "e2e/shots/bugs-calendar.png", fullPage: true });
});
