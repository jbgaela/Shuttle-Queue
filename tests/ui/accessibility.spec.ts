import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockGuidedApi } from "./guided-fixtures";

test.use({ serviceWorkers: "block" });

test("the signed-out entry screen exposes a labelled, keyboard-accessible sign-in form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Badminton Queueing System" })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});

test("the signed-in Guided queue exposes counts, banner semantics, and keyboard focus", async ({ page }) => {
  await page.route("**/api/v2/**", mockGuidedApi);
  await page.goto("/");
  await page.getByRole("button", { name: "Queue" }).click();
  await expect(page.getByRole("heading", { name: "Build the next matchup." })).toBeVisible();
  const banner = page.getByRole("region", { name: "Guided matchup available" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("2 ready Newbie/Beginner learners");
  const mode = page.getByRole("combobox", { name: "Match mode" });
  await mode.selectOption("GUIDED");
  await expect(mode).toHaveAttribute("aria-describedby", "guided-mode-help");
  await expect(page.locator("#guided-mode-help")).toContainText("Ready: 2 learners / 2 guides");
  await banner.getByRole("button", { name: "Generate Guided lineup" }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/matchmaker-heading|guided-(suggestion|no-match)-result/);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});
