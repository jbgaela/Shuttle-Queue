import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("the queue entry workflow keeps the sign-in action available without creating a match", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Badminton Queueing System" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await expect(page.getByText("Courts at a glance.")).toHaveCount(0);
});
