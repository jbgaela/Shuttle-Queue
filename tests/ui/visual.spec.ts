import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.skip(({ browserName }) => browserName !== "chromium", "Visual workflow is intentionally Chromium-only.");

test("the entry screen remains usable at phone, tablet, and desktop widths", async ({ page }) => {
  await page.route("**/api/v2/auth/me", async (route) => {
    await route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED", message: "Sign in required" } } });
  });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Badminton Queueing System" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page).toHaveScreenshot(`entry-${viewport.width}x${viewport.height}.png`, { animations: "disabled", caret: "hide" });
  }
});
