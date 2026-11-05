import { expect, type Page } from "@playwright/test";

/** Shared helpers for the full (data-writing) suite. Every record a spec creates starts with `E2E-<area>-`. */
export const tag = (area: string) => `E2E-${area}-${Date.now().toString(36)}`;

/** One-click demo Admin sign-in (server runs with BUGFLOW_DEMO_LOGIN=1). */
export async function adminSignIn(page: Page): Promise<void> {
  await page.goto("/login");
  const demo = page.getByRole("button", { name: /login without credentials/i });
  await demo.waitFor({ state: "visible", timeout: 15_000 });
  await demo.click();
  await page.waitForURL(/\/admin/, { timeout: 20_000 });
}

/** Read the system clipboard (context grants clipboard-read). */
export async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Assert a portal URL shows no bug data (revoked / replaced / invalid link). */
export async function expectPortalClosed(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toContainText(/BUG-\d/);
}
