import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v2/auth/me", (route) => route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED", message: "Sign in required" } } }));
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test(`login layout and long errors remain usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/v2/auth/login", (route) => route.fulfill({ status: 400, json: { error: { message: "Your sign-in could not be completed. Please check your username and password and try again. Contact your queue administrator if you still need assistance." } } }));
    await page.goto("/");
    const hero = page.getByRole("region", { name: "Badminton Queueing System" });
    const card = page.getByRole("region", { name: "Sign in to continue" });
    const heroBox = await hero.boundingBox();
    const cardBox = await card.boundingBox();
    expect(heroBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    if (viewport.width >= 1024) expect(heroBox!.x + heroBox!.width).toBeLessThan(cardBox!.x);
    else expect(heroBox!.y + heroBox!.height).toBeLessThan(cardBox!.y);
    await page.getByLabel("Username").fill("queue-master");
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("Your sign-in could not be completed.");
    const footer = page.getByRole("contentinfo");
    await footer.scrollIntoViewIfNeeded();
    expect((await footer.boundingBox())!.y).toBeGreaterThanOrEqual((await card.boundingBox())!.y + (await card.boundingBox())!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(footer).toHaveText("Created by @jbgaela & @jendii");
  });
}

test("password visibility preserves input and pending submission prevents duplicates", async ({ page }) => {
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let submissions = 0;
  await page.route("**/api/v2/auth/login", async (route) => {
    submissions += 1;
    await pending;
    await route.fulfill({ status: 400, json: { error: { message: "Invalid credentials." } } });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill("queue-master");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("test-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("test-password");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("test-password");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await password.press("Enter");
  expect(submissions).toBe(1);
  release();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid credentials.");
  await expect(submit).toBeEnabled();
});
