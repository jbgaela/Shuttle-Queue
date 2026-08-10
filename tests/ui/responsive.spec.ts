import { test, expect } from "@playwright/test";
import { assertResponsiveLayout, mockCloudApi, openAuthenticatedApp, openTab, tabs, VIEWPORTS } from "./fixtures";

test.describe("responsive application surfaces", () => {
  test("all primary tabs stay usable across the supported viewport matrix", async ({ page }) => {
    await openAuthenticatedApp(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const tab of tabs) {
        await openTab(page, tab.label, tab.heading);
        await assertResponsiveLayout(page);
      }
    }
  });

  test("login form remains usable at the smallest viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await mockCloudApi(page);
    await page.route("**/api/v2/auth/me", async (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Not signed in" } }) }));
    await page.route("**/api/v2/auth/login", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { user: { id: "account-ui", username: "synthetic.queue", role: "QUEUE_MASTER" }, csrfToken: "synthetic-csrf-token" } }) }));
    await page.goto("/");
    await page.getByRole("heading", { name: "Run the current queue." }).waitFor();
    await assertResponsiveLayout(page);
    await page.getByLabel("Username").fill("synthetic.queue");
    await page.getByLabel("Password").fill("synthetic-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Courts at a glance." })).toBeVisible();
  });
});
