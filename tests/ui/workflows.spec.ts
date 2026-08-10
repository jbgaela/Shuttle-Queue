import { test, expect } from "@playwright/test";
import { mockCloudApi, openAuthenticatedApp, openTab, superAdminUser } from "./fixtures";

test.describe("core queue workflows", () => {
  test("queue master can operate courts, scoring, matchmaking, players, rankings, fees, settings, offline mode, and sign out", async ({ page, context }) => {
    await openAuthenticatedApp(page);
    let signedOut = false;
    await page.route("**/api/v2/auth/me", async (route) => { if (signedOut) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Not signed in" } }) }); return route.fallback(); });

    await page.getByRole("button", { name: "Manage courts", exact: true }).click();
    await page.getByLabel("New court name").fill("Court 4");
    await page.getByRole("button", { name: "Add court", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Court 4", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Enter final score", exact: true }).click();
    const scoreDialog = page.getByRole("dialog", { name: "Record the score" });
    await scoreDialog.locator("input").nth(0).fill("21");
    await scoreDialog.locator("input").nth(1).fill("18");
    await scoreDialog.getByRole("button", { name: "Confirm final score", exact: true }).click();
    await expect(scoreDialog).toHaveCount(0);
    await expect(page.getByText("Result saved. Court is available again.", { exact: true })).toBeVisible();

    await openTab(page, "Queue", "Make the next match.");
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.getByRole("button", { name: "Add player", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: /Choose Team A player/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Suggested", exact: true }).click();
    await page.getByRole("button", { name: /Suggest lineup|Try another lineup/ }).click();
    await expect(page.getByText("Team A", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Edit lineup", exact: true }).click();
    await page.getByRole("button", { name: /Alex Rivera/ }).click();
    await expect(page.getByRole("dialog", { name: /Team A player 1/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await openTab(page, "Players", "Players and check-in.");
    await page.getByLabel("Display name").fill("Workflow Player");
    await page.getByRole("button", { name: "Create player", exact: true }).click();
    await expect(page.getByText("Player created.", { exact: true })).toBeVisible();

    await openTab(page, "Rankings", "Results that stay useful.");
    await page.getByRole("button", { name: /Alex Rivera/ }).click();
    await expect(page.getByText("Matches", { exact: true })).toBeVisible();

    await openTab(page, "Fees", "Keep fees accounted for.");
    const feePlayer = page.locator("label").filter({ hasText: /^Player/ }).locator("select");
    await feePlayer.selectOption({ index: 1 });
    await page.locator("label").filter({ hasText: /^Amount/ }).last().locator("input").fill("1");
    await page.getByRole("button", { name: "Record collection", exact: true }).click();
    await expect(page.getByText("Payment recorded.", { exact: true })).toBeVisible();

    await openTab(page, "Settings", "Offline workspace");
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(page.getByText(/Pending changes uploaded\.|Local copy is up to date\./)).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText("Offline", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeDisabled();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    signedOut = true;
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Run the current queue." })).toBeVisible();
  });

  test("Super Admin uses Settings for administration and security", async ({ page }) => {
    await openAuthenticatedApp(page, superAdminUser);
    await expect(page.getByRole("heading", { name: "Courts at a glance." })).toBeVisible();
    await expect(page.getByText("Account administration", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Queue workspace", { exact: true })).toHaveCount(0);

    await openTab(page, "Settings", "Offline workspace");
    await expect(page.getByRole("heading", { name: "Shuttle Queue administration", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change password", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Manage access.", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
    await expect(page.locator("p.font-semibold").filter({ hasText: "synthetic.admin" })).toBeVisible();

    await page.getByRole("button", { name: "Change password", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Change password" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("Queue Master Settings does not expose Super Admin controls", async ({ page }) => {
    await openAuthenticatedApp(page);
    await openTab(page, "Settings", "Offline workspace");
    await expect(page.getByRole("heading", { name: "Shuttle Queue administration", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Manage access.", exact: true })).toHaveCount(0);
  });
});
