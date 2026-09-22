import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockGuidedApi } from "./guided-fixtures";

test.use({ serviceWorkers: "block" });
const token = "10000000-0000-4000-8000-000000000001";
const linkId = "20000000-0000-4000-8000-000000000001";
const published = "2026-09-22T07:42:18.000Z";
const link = { id: linkId, queueMasterId: "owner", issuedAt: published, revokedAt: null, publication: { id: "publication", sessionStartedAt: published, sessionEndedAt: null, finalizedAt: null } };

async function publicFixture(page: Page, outcome = "GRANTED") {
  await page.addInitScript((initial) => {
    Object.assign(window, { locationTestOutcome: initial });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
      const result = (window as unknown as { locationTestOutcome: string }).locationTestOutcome;
      if (result === "GRANTED") success({ coords: { latitude: 14.6, longitude: 121, accuracy: 12 } } as GeolocationPosition);
      else failure({ code: result === "DENIED" ? 1 : result === "TIMEOUT" ? 3 : 2 } as GeolocationPositionError);
    } } });
  }, outcome);
  const openings = new Set<string>();
  const outcomes: string[] = [];
  let reads = 0;
  let failWrite = false;
  await page.route("**/api/v2/public/rankings/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const key = route.request().headers()["x-ranking-visit-key"] ?? "";
    if (path.endsWith("/visits")) {
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      openings.add(key);
      await route.fulfill({ json: { data: { visitId: key, status: "PENDING", accessExpiresAt: null } } }); return;
    }
    if (path.endsWith("/visits/location")) {
      if (failWrite) { await route.fulfill({ status: 503, json: { error: { code: "TRACKING_UNAVAILABLE", message: "Unable to save location. Please try again." } } }); return; }
      const body = route.request().postDataJSON() as { status: string };
      outcomes.push(body.status);
      await route.fulfill({ json: { data: { visitId: key, status: body.status, accessExpiresAt: body.status === "GRANTED" ? new Date(Date.now() + 12 * 3600_000).toISOString() : null } } }); return;
    }
    reads += 1;
    await route.fulfill({ json: { data: { state: "LIVE", rankings: [], historyAvailable: true, lastUpdatedAt: published, sessionStartedAt: published } } });
  });
  return { openings, outcomes, reads: () => reads, failWrites: () => { failWrite = true; } };
}

test("rankings wait for saved location; refreshes reuse a visit and reload creates another", async ({ page }) => {
  const state = await publicFixture(page);
  await page.goto(`/rankings/shared/${token}`);
  await expect(page.getByRole("heading", { name: "Location required" })).toBeVisible();
  expect(state.reads()).toBe(0);
  await page.getByRole("button", { name: "Share location and continue" }).click();
  await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
  await expect.poll(state.reads, { timeout: 12000 }).toBeGreaterThanOrEqual(2);
  expect(state.openings.size).toBe(1);
  expect(state.outcomes).toEqual(["GRANTED"]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Location required" })).toBeVisible();
  expect(state.openings.size).toBe(2);
});

for (const outcome of ["DENIED", "TIMEOUT", "UNAVAILABLE"]) {
  test(`${outcome.toLowerCase()} location is recorded and rankings stay hidden`, async ({ page }) => {
    const state = await publicFixture(page, outcome);
    await page.goto(`/rankings/shared/${token}`);
    await page.getByRole("button", { name: "Share location and continue" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    expect(state.outcomes).toEqual([outcome]); expect(state.reads()).toBe(0);
    await page.evaluate(() => Object.assign(window, { locationTestOutcome: "GRANTED" }));
    await page.getByRole("button", { name: "Retry location" }).click();
    await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
    expect(state.openings.size).toBe(1);
  });
}

test("a failed location write never unlocks the rankings", async ({ page }) => {
  const state = await publicFixture(page); state.failWrites();
  await page.goto(`/rankings/shared/${token}`);
  await page.getByRole("button", { name: "Share location and continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Unable to save location. Please try again.");
  expect(state.reads()).toBe(0);
});

test("revoked links do not ask for location", async ({ page }) => {
  await page.route("**/api/v2/public/rankings/**", (route) => route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Unavailable" } } }));
  await page.goto(`/rankings/shared/${token}`);
  await expect(page.getByRole("heading", { name: "Rankings unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share location and continue" })).toHaveCount(0);
});

test("back-forward restoration hides old content and creates a new opening", async ({ page }) => {
  const state = await publicFixture(page);
  await page.goto(`/rankings/shared/${token}`);
  await page.getByRole("button", { name: "Share location and continue" }).click();
  await expect(page.getByRole("heading", { name: "LineDrive Afternoon Queue" })).toBeVisible();
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
  await expect(page.getByRole("heading", { name: "Location required" })).toBeVisible();
  expect(state.openings.size).toBe(2);
});

test("tracking shows Manila time, filters and paginates with accessible mobile layout", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/v2/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me")) { await route.fulfill({ json: { data: { user: { id: "owner", username: "Owner", role: "QUEUE_MASTER" } } } }); return; }
    requests.push(url);
    await route.fulfill({ json: { data: { link, items: [{ id: "visit", openedAt: published, ipAddress: "2001:db8::1", device: "mobile", browser: "Safari 17", operatingSystem: "iOS 17", city: "Manila", region: "Metro Manila", country: "Philippines", latitude: 14.6, longitude: 121, accuracy: 12, locationStatus: "GRANTED" }], nextCursor: url.searchParams.has("cursor") ? null : "next-page" } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/rankings/tracking/${linkId}`);
  await expect(page.getByRole("cell", { name: "09/22/2026", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "03:42:18 PM", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2001:db8::1", exact: true })).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("cursor")).toBe("next-page");
  await page.getByRole("combobox", { name: "Location status" }).selectOption("DENIED");
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await expect.poll(() => requests.at(-1)?.searchParams.get("status")).toBe("DENIED");
  expect(requests.at(-1)?.searchParams.get("cursor")).toBe(null);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: `${process.env.TEMP ?? "."}/ranking-tracking-mobile.png`, fullPage: true });
});

test("tracking requires authentication and clears details on a session failure", async ({ page }) => {
  let authenticated = true;
  await page.route("**/api/v2/**", async (route) => {
    if (!authenticated) { await route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED", message: "Authentication is required." } } }); return; }
    if (route.request().url().endsWith("/auth/me")) { await route.fulfill({ json: { data: { user: { id: "owner", role: "QUEUE_MASTER" } } } }); return; }
    await route.fulfill({ json: { data: { link, items: [], nextCursor: null } } });
  });
  await page.goto(`/rankings/tracking/${linkId}`);
  await expect(page.getByRole("heading", { name: "Shared link visits" })).toBeVisible();
  authenticated = false;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "Tracking access required" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("rankings expose Track beside Revoke and keep revoked link history reachable", async ({ page }) => {
  await page.route("**/api/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/workspace/public-rankings")) {
      await route.fulfill({ json: { data: { current: { id: "publication", trackingLinkId: linkId, token, state: "LIVE", sessionStartedAt: published, publishedAt: published, version: 1 }, archives: [] } } }); return;
    }
    if (path.endsWith("/tracking-links")) { await route.fulfill({ json: { data: { items: [{ ...link, id: "revoked-link", revokedAt: published }], nextCursor: null } } }); return; }
    if (path.endsWith("/visits")) { await route.fulfill({ json: { data: { link, items: [], nextCursor: null } } }); return; }
    await mockGuidedApi(route);
  });
  await page.goto("/?tab=rankings");
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toBeVisible();
  const track = page.locator(`a[href="/rankings/tracking/${linkId}"]`);
  await expect(track).toHaveText("Track");
  await expect(page.locator('a[href="/rankings/tracking/revoked-link"]')).toBeVisible();
  await track.click();
  await expect(page.getByRole("heading", { name: "Shared link visits" })).toBeVisible();
});

test("Super Admin can navigate from an account to its issued links", async ({ page }) => {
  await page.route("**/api/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) { await route.fulfill({ json: { data: { user: { id: "admin", username: "Admin", role: "SUPER_ADMIN" } } } }); return; }
    if (path.endsWith("/admin/accounts")) { await route.fulfill({ json: { data: [{ id: "owner", username: "Owner", role: "QUEUE_MASTER", status: "ACTIVE", version: 1, createdAt: published, updatedAt: published, passwordChangedAt: published, playerCount: 0, queuePlayerCount: 0, sessionCount: 1 }] } }); return; }
    if (path.endsWith("/admin/accounts/owner/public-ranking-links")) { await route.fulfill({ json: { data: { items: [link], nextCursor: null } } }); return; }
    await mockGuidedApi(route);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "View shared links" }).click();
  await expect(page).toHaveURL(/rankings\/tracking\?accountId=owner/);
  await expect(page.getByRole("link", { name: "Track", exact: true })).toHaveAttribute("href", `/rankings/tracking/${linkId}`);
});
