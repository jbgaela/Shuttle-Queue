import { expect, test } from "@playwright/test";
import { mockGuidedApi } from "./guided-fixtures";

test.use({ serviceWorkers: "block" });

test("the queue entry workflow keeps the sign-in action available without creating a match", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Badminton Queueing System" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await expect(page.getByText("Courts at a glance.")).toHaveCount(0);
});

test("the Guided banner requests a suggestion without creating a match", async ({ page }) => {
  await page.route("**/api/v2/**", mockGuidedApi);
  const createdRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/matches")) createdRequests.push(request.url());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Queue" }).click();
  const banner = page.getByRole("region", { name: "Guided matchup available" });
  await expect(banner).toBeVisible();

  await banner.getByRole("button", { name: "Generate Guided lineup" }).click();
  await expect(page.getByRole("combobox", { name: "Match mode" })).toHaveValue("GUIDED");
  await expect(page.getByRole("button", { name: "Start match" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue matchup" })).toBeVisible();
  expect(createdRequests).toEqual([]);
});
