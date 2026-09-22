import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockGuidedApi } from "./guided-fixtures";

test.use({ serviceWorkers: "block" });
const token = "10000000-0000-4000-8000-000000000001";
const linkId = "20000000-0000-4000-8000-000000000001";
const published = "2026-09-22T07:42:18.000Z";
const link = {
  id: linkId,
  queueMasterId: "owner",
  issuedAt: published,
  revokedAt: null,
  publication: {
    id: "publication",
    sessionStartedAt: published,
    sessionEndedAt: null,
    finalizedAt: null,
  },
};

async function publicFixture(
  page: Page,
  outcome = "GRANTED",
  permission = "prompt",
  options: {
    secureContext?: boolean;
    policyAllowed?: boolean;
    openingFailure?: boolean;
    openingStatus?: number;
    openingCode?: string;
    openingMessage?: string;
    online?: boolean;
    fallbackOutcome?: string;
    userAgent?: string;
  } = {},
) {
  await page.addInitScript(
    ({
      initial,
      permissionState,
      secureContext,
      policyAllowed,
      online,
      fallbackOutcome,
      userAgent,
    }) => {
      const permissionListeners = new Set<() => void>();
      const permission = {
        state: permissionState,
        addEventListener: (_type: string, listener: () => void) =>
          permissionListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          permissionListeners.delete(listener),
      };
      Object.assign(window, {
        locationTestOutcome: initial,
        locationTestFallbackOutcome: fallbackOutcome,
        locationTestRequests: 0,
        locationTestOptions: [] as PositionOptions[],
        setLocationPermission: (next: string) => {
          permission.state = next;
          permissionListeners.forEach((listener) => listener());
        },
      });
      Object.defineProperty(window, "isSecureContext", {
        configurable: true,
        value: secureContext,
      });
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: online,
      });
      if (userAgent) {
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          value: userAgent,
        });
      }
      Object.defineProperty(document, "permissionsPolicy", {
        configurable: true,
        value: { allowsFeature: () => policyAllowed },
      });
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: async () => {
            if (permissionState === "unsupported")
              throw new TypeError("Unsupported permission");
            return permission;
          },
        },
      });
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (
            success: PositionCallback,
            failure: PositionErrorCallback,
            positionOptions?: PositionOptions,
          ) => {
            const state = window as unknown as {
              locationTestOutcome: string;
              locationTestFallbackOutcome?: string;
              locationTestRequests: number;
              locationTestOptions: PositionOptions[];
            };
            state.locationTestRequests += 1;
            state.locationTestOptions.push(positionOptions ?? {});
            const result =
              state.locationTestRequests > 1 &&
              state.locationTestFallbackOutcome
                ? state.locationTestFallbackOutcome
                : state.locationTestOutcome;
            if (result === "GRANTED")
              success({
                coords: { latitude: 14.6, longitude: 121, accuracy: 12 },
              } as GeolocationPosition);
            else
              failure({
                code: result === "DENIED" ? 1 : result === "TIMEOUT" ? 3 : 2,
              } as GeolocationPositionError);
          },
        },
      });
    },
    {
      initial: outcome,
      permissionState: permission,
      secureContext: options.secureContext ?? true,
      policyAllowed: options.policyAllowed ?? true,
      online: options.online ?? true,
      fallbackOutcome: options.fallbackOutcome,
      userAgent: options.userAgent,
    },
  );
  const openings = new Set<string>();
  const openingKeys: string[] = [];
  const outcomes: string[] = [];
  let reads = 0;
  let failWrite = false;
  let remainingOpeningFailures = options.openingFailure ? Infinity : 0;
  await page.route("**/api/v2/public/rankings/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const key = route.request().headers()["x-ranking-visit-key"] ?? "";
    if (path.endsWith("/visits")) {
      openingKeys.push(key);
      if (remainingOpeningFailures > 0) {
        remainingOpeningFailures -= 1;
        await route.fulfill({
          status: options.openingStatus ?? 503,
          json: {
            error: {
              code: options.openingCode ?? "EDGE_CONFIGURATION_ERROR",
              message:
                options.openingMessage ??
                "Unable to record this visit. Please try again.",
            },
            requestId: "edge-test-request",
          },
        });
        return;
      }
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      openings.add(key);
      await route.fulfill({
        json: {
          data: { visitId: key, status: "PENDING", accessExpiresAt: null },
        },
      });
      return;
    }
    if (path.endsWith("/visits/location")) {
      if (failWrite) {
        await route.fulfill({
          status: 503,
          json: {
            error: {
              code: "TRACKING_UNAVAILABLE",
              message: "Unable to save location. Please try again.",
            },
          },
        });
        return;
      }
      const body = route.request().postDataJSON() as { status: string };
      outcomes.push(body.status);
      await route.fulfill({
        json: {
          data: {
            visitId: key,
            status: body.status,
            accessExpiresAt:
              body.status === "GRANTED"
                ? new Date(Date.now() + 12 * 3600_000).toISOString()
                : null,
          },
        },
      });
      return;
    }
    reads += 1;
    await route.fulfill({
      json: {
        data: {
          state: "LIVE",
          rankings: [],
          historyAvailable: true,
          lastUpdatedAt: published,
          sessionStartedAt: published,
        },
      },
    });
  });
  return {
    openings,
    openingKeys,
    outcomes,
    reads: () => reads,
    failWrites: () => {
      failWrite = true;
    },
    recoverOpenings: () => {
      remainingOpeningFailures = 0;
    },
  };
}

test("existing site permission automatically opens rankings once per opening", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "granted");
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  expect(state.outcomes).toEqual(["GRANTED"]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { locationTestRequests: number })
          .locationTestRequests,
    ),
  ).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  expect(state.openings.size).toBe(2);
  expect(state.outcomes).toEqual(["GRANTED", "GRANTED"]);
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect.poll(() => state.outcomes.length).toBe(3);
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  expect(state.openings.size).toBe(3);
});

test("permission changes to granted while the page is open automatically retries location", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "denied");
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("button", { name: "Check location access" }),
  ).toBeVisible();
  expect(state.reads()).toBe(0);
  await page.evaluate(() =>
    (
      window as unknown as { setLocationPermission: (state: string) => void }
    ).setLocationPermission("granted"),
  );
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  expect(state.outcomes).toEqual(["GRANTED"]);
});

test("blocked Permissions Policy explains why the browser cannot provide location", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "prompt", {
    policyAllowed: false,
  });
  await page.goto(`/rankings/shared/${token}`);
  await expect(page.getByText("does not allow location access")).toBeVisible();
  await page.getByRole("button", { name: "Check location access" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "does not allow location access",
  );
  expect(state.reads()).toBe(0);
  expect(state.outcomes).toEqual(["UNAVAILABLE"]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { locationTestRequests: number })
          .locationTestRequests,
    ),
  ).toBe(0);
});

test("insecure contexts explain why the browser cannot provide location", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "prompt", {
    secureContext: false,
  });
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByText("requires a secure HTTPS connection"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check location access" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "requires a secure HTTPS connection",
  );
  expect(state.reads()).toBe(0);
  expect(state.outcomes).toEqual(["UNAVAILABLE"]);
});

test("a failed visit opening never requests browser location", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "prompt", {
    openingFailure: true,
  });
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("heading", { name: "Unable to open rankings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Location required" }),
  ).toHaveCount(0);
  await expect(page.getByText("Reference: edge-test-request")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { locationTestRequests: number })
          .locationTestRequests,
    ),
  ).toBe(0);
  expect(state.reads()).toBe(0);
});

for (const openingFailure of [
  {
    status: 403,
    code: "PUBLIC_RANKINGS_DISABLED",
    message: "Public rankings are disabled.",
  },
  {
    status: 429,
    code: "RATE_LIMITED",
    message: "Too many requests. Please try again.",
  },
  {
    status: 503,
    code: "PUBLIC_REQUEST_TIMEOUT",
    message: "The request took too long. Please try again.",
  },
]) {
  test(`opening ${openingFailure.status} ${openingFailure.code} is actionable and never requests location`, async ({
    page,
  }) => {
    const state = await publicFixture(page, "GRANTED", "prompt", {
      openingFailure: true,
      openingStatus: openingFailure.status,
      openingCode: openingFailure.code,
      openingMessage: openingFailure.message,
    });
    await page.goto(`/rankings/shared/${token}`);
    await expect(
      page.getByRole("heading", { name: "Unable to open rankings" }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      openingFailure.message,
    );
    await expect(
      page.getByRole("button", { name: "Retry connection" }),
    ).toBeVisible();
    expect(state.reads()).toBe(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { locationTestRequests: number })
            .locationTestRequests,
      ),
    ).toBe(0);
  });
}

test("offline opening is identified as a connection problem", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "prompt", {
    online: false,
  });
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("heading", { name: "Connection required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry connection when online" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Location required" }),
  ).toHaveCount(0);
  expect(state.reads()).toBe(0);
});

test("retrying a failed opening reuses its visit key and waits for an explicit permission action", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "prompt", {
    openingFailure: true,
  });
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("heading", { name: "Unable to open rankings" }),
  ).toBeVisible();
  state.recoverOpenings();
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("button", { name: "Share location and continue" }),
  ).toBeVisible();
  expect(state.openingKeys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(state.openingKeys).size).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { locationTestRequests: number })
          .locationTestRequests,
    ),
  ).toBe(0);
  expect(state.reads()).toBe(0);
});

test("existing granted permission continues automatically after an opening retry", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "granted", {
    openingFailure: true,
  });
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("heading", { name: "Unable to open rankings" }),
  ).toBeVisible();
  state.recoverOpenings();
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  expect(state.openingKeys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(state.openingKeys).size).toBe(1);
  expect(state.outcomes).toEqual(["GRANTED"]);
});

for (const permission of ["prompt", "denied", "unsupported"]) {
  test(`${permission} permission does not automatically request location`, async ({
    page,
  }) => {
    const state = await publicFixture(page, "GRANTED", permission);
    await page.goto(`/rankings/shared/${token}`);
    const buttonName =
      permission === "denied"
        ? "Check location access"
        : "Share location and continue";
    await expect(page.getByRole("button", { name: buttonName })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { locationTestRequests: number })
            .locationTestRequests,
      ),
    ).toBe(0);
    expect(state.reads()).toBe(0);
    await page.getByRole("button", { name: buttonName }).click();
    await expect(
      page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
    ).toBeVisible();
  });
}

test("existing permission with unavailable device location allows manual retry", async ({
  page,
}) => {
  const state = await publicFixture(page, "UNAVAILABLE", "granted");
  await page.goto(`/rankings/shared/${token}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "could not provide a location",
  );
  expect(state.reads()).toBe(0);
  expect(state.outcomes).toEqual(["UNAVAILABLE"]);
  await page.evaluate(() =>
    Object.assign(window, { locationTestOutcome: "GRANTED" }),
  );
  await page.getByRole("button", { name: "Retry location" }).click();
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  expect(state.openings.size).toBe(1);
});

test("existing permission cannot bypass failed location persistence", async ({
  page,
}) => {
  const state = await publicFixture(page, "GRANTED", "granted");
  state.failWrites();
  await page.goto(`/rankings/shared/${token}`);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Unable to save location. Please try again.",
  );
  expect(state.reads()).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { locationTestRequests: number })
          .locationTestRequests,
    ),
  ).toBe(1);
});

test("rankings wait for saved location; refreshes reuse a visit and reload creates another", async ({
  page,
}) => {
  const state = await publicFixture(page);
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("heading", { name: "Location required" }),
  ).toBeVisible();
  expect(state.reads()).toBe(0);
  await page
    .getByRole("button", { name: "Share location and continue" })
    .click();
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  await expect.poll(state.reads, { timeout: 12000 }).toBeGreaterThanOrEqual(2);
  expect(state.openings.size).toBe(1);
  expect(state.outcomes).toEqual(["GRANTED"]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Location required" }),
  ).toBeVisible();
  expect(state.openings.size).toBe(2);
});

test("Messenger timeout retries with a network location before blocking access", async ({
  page,
}) => {
  const state = await publicFixture(page, "TIMEOUT", "prompt", {
    fallbackOutcome: "GRANTED",
    userAgent: "Mozilla/5.0 [FBAN/MessengerForiOS;FBAV/500.0.0.0.0]",
  });
  await page.goto(`/rankings/shared/${token}`);
  await page
    .getByRole("button", { name: "Share location and continue" })
    .click();
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  expect(state.outcomes).toEqual(["GRANTED"]);
  const locationState = await page.evaluate(() => ({
    requests: (
      window as unknown as { locationTestRequests: number }
    ).locationTestRequests,
    options: (
      window as unknown as { locationTestOptions: PositionOptions[] }
    ).locationTestOptions,
  }));
  expect(locationState.requests).toBe(2);
  expect(locationState.options).toEqual([
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
  ]);
});

test("Messenger explains how to recover when both location attempts time out", async ({
  page,
}) => {
  const state = await publicFixture(page, "TIMEOUT", "prompt", {
    fallbackOutcome: "TIMEOUT",
    userAgent: "Mozilla/5.0 [FBAN/MessengerForiOS;FBAV/500.0.0.0.0]",
  });
  await page.goto(`/rankings/shared/${token}`);
  await page
    .getByRole("button", { name: "Share location and continue" })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Messenger's in-app browser could not provide your location",
  );
  expect(state.outcomes).toEqual(["TIMEOUT"]);
  expect(state.reads()).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { locationTestRequests: number })
          .locationTestRequests,
    ),
  ).toBe(2);
});

test("Messenger denial directs the visitor to Open in browser", async ({
  page,
}) => {
  const state = await publicFixture(page, "DENIED", "prompt", {
    userAgent: "Mozilla/5.0 [FBAN/MessengerForiOS;FBAV/500.0.0.0.0]",
  });
  await page.goto(`/rankings/shared/${token}`);
  await page
    .getByRole("button", { name: "Share location and continue" })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    'select "Open in browser," then allow location in Chrome or Safari',
  );
  expect(state.outcomes).toEqual(["DENIED"]);
  expect(state.reads()).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { locationTestRequests: number })
          .locationTestRequests,
    ),
  ).toBe(1);
});

for (const outcome of ["DENIED", "TIMEOUT", "UNAVAILABLE"]) {
  test(`${outcome.toLowerCase()} location is recorded and rankings stay hidden`, async ({
    page,
  }) => {
    const state = await publicFixture(page, outcome);
    await page.goto(`/rankings/shared/${token}`);
    await page
      .getByRole("button", { name: "Share location and continue" })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    expect(state.outcomes).toEqual([outcome]);
    expect(state.reads()).toBe(0);
    await page.evaluate(() =>
      Object.assign(window, { locationTestOutcome: "GRANTED" }),
    );
    await page.getByRole("button", { name: "Retry location" }).click();
    await expect(
      page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
    ).toBeVisible();
    expect(state.openings.size).toBe(1);
  });
}

test("a failed location write never unlocks the rankings", async ({ page }) => {
  const state = await publicFixture(page);
  state.failWrites();
  await page.goto(`/rankings/shared/${token}`);
  await page
    .getByRole("button", { name: "Share location and continue" })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Unable to save location. Please try again.",
  );
  expect(state.reads()).toBe(0);
});

test("revoked links do not ask for location", async ({ page }) => {
  await page.route("**/api/v2/public/rankings/**", (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "Unavailable" } },
    }),
  );
  await page.goto(`/rankings/shared/${token}`);
  await expect(
    page.getByRole("heading", { name: "Rankings unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share location and continue" }),
  ).toHaveCount(0);
});

test("back-forward restoration hides old content and creates a new opening", async ({
  page,
}) => {
  const state = await publicFixture(page);
  await page.goto(`/rankings/shared/${token}`);
  await page
    .getByRole("button", { name: "Share location and continue" })
    .click();
  await expect(
    page.getByRole("heading", { name: "LineDrive Afternoon Queue" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect(
    page.getByRole("heading", { name: "Location required" }),
  ).toBeVisible();
  expect(state.openings.size).toBe(2);
});

test("tracking shows Manila time, filters and paginates with accessible mobile layout", async ({
  page,
}) => {
  const requests: URL[] = [];
  await page.route("**/api/v2/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/me")) {
      await route.fulfill({
        json: {
          data: {
            user: { id: "owner", username: "Owner", role: "QUEUE_MASTER" },
          },
        },
      });
      return;
    }
    requests.push(url);
    await route.fulfill({
      json: {
        data: {
          link,
          items: [
            {
              id: "visit",
              openedAt: published,
              ipAddress: "2001:db8::1",
              device: "mobile",
              browser: "Safari 17",
              operatingSystem: "iOS 17",
              city: "Manila",
              region: "Metro Manila",
              country: "Philippines",
              latitude: 14.6,
              longitude: 121,
              accuracy: 12,
              locationStatus: "GRANTED",
            },
          ],
          nextCursor: url.searchParams.has("cursor") ? null : "next-page",
        },
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/rankings/tracking/${linkId}`);
  await expect(
    page.getByRole("cell", { name: "09/22/2026", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "03:42:18 PM", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "2001:db8::1", exact: true }),
  ).toBeAttached();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("cursor")).toBe("next-page");
  await page
    .getByRole("combobox", { name: "Location status" })
    .selectOption("DENIED");
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("status"))
    .toBe("DENIED");
  expect(requests.at(-1)?.searchParams.get("cursor")).toBe(null);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: `${process.env.TEMP ?? "."}/ranking-tracking-mobile.png`,
    fullPage: true,
  });
});

test("tracking requires authentication and clears details on a session failure", async ({
  page,
}) => {
  let authenticated = true;
  await page.route("**/api/v2/**", async (route) => {
    if (!authenticated) {
      await route.fulfill({
        status: 401,
        json: {
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication is required.",
          },
        },
      });
      return;
    }
    if (route.request().url().endsWith("/auth/me")) {
      await route.fulfill({
        json: { data: { user: { id: "owner", role: "QUEUE_MASTER" } } },
      });
      return;
    }
    await route.fulfill({
      json: { data: { link, items: [], nextCursor: null } },
    });
  });
  await page.goto(`/rankings/tracking/${linkId}`);
  await expect(
    page.getByRole("heading", { name: "Shared link visits" }),
  ).toBeVisible();
  authenticated = false;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    page.getByRole("heading", { name: "Tracking access required" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("rankings expose Track beside Revoke and keep revoked link history reachable", async ({
  page,
}) => {
  await page.route("**/api/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/workspace/public-rankings")) {
      await route.fulfill({
        json: {
          data: {
            current: {
              id: "publication",
              trackingLinkId: linkId,
              token,
              state: "LIVE",
              sessionStartedAt: published,
              publishedAt: published,
              version: 1,
            },
            archives: [],
          },
        },
      });
      return;
    }
    if (path.endsWith("/tracking-links")) {
      await route.fulfill({
        json: {
          data: {
            items: [{ ...link, id: "revoked-link", revokedAt: published }],
            nextCursor: null,
          },
        },
      });
      return;
    }
    if (path.endsWith("/visits")) {
      await route.fulfill({
        json: { data: { link, items: [], nextCursor: null } },
      });
      return;
    }
    await mockGuidedApi(route);
  });
  await page.goto("/?tab=rankings");
  await expect(
    page.getByRole("button", { name: "Revoke", exact: true }),
  ).toBeVisible();
  const track = page.locator(`a[href="/rankings/tracking/${linkId}"]`);
  await expect(track).toHaveText("Track");
  await expect(
    page.locator('a[href="/rankings/tracking/revoked-link"]'),
  ).toBeVisible();
  await track.click();
  await expect(
    page.getByRole("heading", { name: "Shared link visits" }),
  ).toBeVisible();
});

test("Super Admin can navigate from an account to its issued links", async ({
  page,
}) => {
  await page.route("**/api/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({
        json: {
          data: {
            user: { id: "admin", username: "Admin", role: "SUPER_ADMIN" },
          },
        },
      });
      return;
    }
    if (path.endsWith("/admin/accounts")) {
      await route.fulfill({
        json: {
          data: [
            {
              id: "owner",
              username: "Owner",
              role: "QUEUE_MASTER",
              status: "ACTIVE",
              version: 1,
              createdAt: published,
              updatedAt: published,
              passwordChangedAt: published,
              playerCount: 0,
              queuePlayerCount: 0,
              sessionCount: 1,
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/admin/accounts/owner/public-ranking-links")) {
      await route.fulfill({
        json: { data: { items: [link], nextCursor: null } },
      });
      return;
    }
    await mockGuidedApi(route);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "View shared links" }).click();
  await expect(page).toHaveURL(/rankings\/tracking\?accountId=owner/);
  await expect(
    page.getByRole("link", { name: "Track", exact: true }),
  ).toHaveAttribute("href", `/rankings/tracking/${linkId}`);
});
