import { test, expect } from "@playwright/test";
import { disableMotion, openAuthenticatedApp, openTab, tabs, REPRESENTATIVE_VIEWPORTS } from "./fixtures";

test.describe("visual regression coverage", () => {
  test("representative application surfaces remain stable", async ({ page }, testInfo) => {
    await openAuthenticatedApp(page);
    await disableMotion(page);
    for (const viewport of REPRESENTATIVE_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const tab of tabs) {
        await openTab(page, tab.label, tab.heading);
        await expect(page).toHaveScreenshot(`${testInfo.project.name}-${viewport.name}-${tab.label.toLowerCase()}.png`, {
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          mask: [page.getByTestId("live-duration")],
          maxDiffPixels: 120,
        });
      }
    }
  });
});
