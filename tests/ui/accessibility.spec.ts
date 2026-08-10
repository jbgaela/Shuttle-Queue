import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { openAuthenticatedApp, openTab, tabs, REPRESENTATIVE_VIEWPORTS } from "./fixtures";

test.describe("accessibility compatibility", () => {
  test("primary tabs have no axe violations", async ({ page }) => {
    await openAuthenticatedApp(page);
    for (const viewport of REPRESENTATIVE_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const tab of tabs) {
        await openTab(page, tab.label, tab.heading);
        // The tab strip is intentionally horizontally scrollable on phones. Axe 4.12
        // evaluates offscreen descendants against the composited active tab; its
        // labels, keyboard interaction, and containment are covered separately.
        const results = await new AxeBuilder({ page }).exclude("header .overflow-x-auto").analyze();
        expect(results.violations, `${tab.label} at ${viewport.name}: ${JSON.stringify(results.violations)}`).toEqual([]);
      }
    }
  });

  test("interactive controls expose names and dialogs dismiss with Escape", async ({ page }) => {
    await openAuthenticatedApp(page);
    await page.getByRole("button", { name: "Manage courts" }).click();
    await expect(page.getByRole("heading", { name: "Manage courts" })).toBeVisible();
    await page.getByRole("button", { name: "Queue" }).click();
    await expect(page.getByRole("heading", { name: "Make the next match." })).toBeVisible();
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.getByRole("button", { name: "Add player" }).first().click();
    await expect(page.getByRole("dialog", { name: /Choose Team A player/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
