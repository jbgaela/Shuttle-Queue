import { expect, test, type Route } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const account = { id: "account-1", username: "queue-master", role: "QUEUE_MASTER" as const };

async function seedRetainedProfile(page: import("@playwright/test").Page) {
  await page.evaluate(async (profile) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("shuttle-queue-offline", 3);
      open.onupgradeneeded = () => {
        const db = open.result;
        const stores = {
          profiles: { keyPath: "accountId", indexes: [["updatedAt", "updatedAt"]] },
          meta: { keyPath: "accountId", indexes: [["dirty", "dirty"], ["baseCloudRevision", "baseCloudRevision"]] },
          snapshots: { keyPath: "accountId", indexes: [["updatedAt", "updatedAt"]] },
          audits: { keyPath: "id", indexes: [["accountId", "accountId"], ["createdAt", "createdAt"]] },
        } as const;
        for (const [name, definition] of Object.entries(stores)) {
          const store = db.objectStoreNames.contains(name)
            ? open.transaction?.objectStore(name)
            : db.createObjectStore(name, { keyPath: definition.keyPath });
          for (const [indexName, keyPath] of definition.indexes) {
            if (store && !store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath);
          }
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction(["profiles", "meta", "snapshots", "audits"], "readwrite");
        transaction.objectStore("profiles").put({ accountId: profile.id, username: profile.username, role: profile.role, updatedAt: new Date().toISOString() });
        transaction.objectStore("snapshots").put({ accountId: profile.id, snapshot: { schemaVersion: 2 }, updatedAt: new Date().toISOString() });
        transaction.objectStore("meta").put({ accountId: profile.id, deviceId: "device-1", localRevision: 0, lastUploadedRevision: 0, baseCloudRevision: 0, dirty: false });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, account);
}

async function rejectAuth(route: Route) {
  const path = new URL(route.request().url()).pathname.replace("/api/v2", "");
  if (path === "/auth/me") {
    await route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED", message: "Authentication is required." } } });
    return;
  }
  await route.fulfill({ status: 404, json: { error: { message: "Unexpected test request" } } });
}

test("does not unlock the dashboard from a retained profile after an online 401", async ({ page }) => {
  await page.route("**/api/v2/**", rejectAuth);
  await page.goto("/");
  await seedRetainedProfile(page);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Badminton Queueing System" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Courts at a glance." })).toHaveCount(0);
});

test("does not enter the dashboard until a fresh login session is verified", async ({ page }) => {
  await page.route("**/api/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v2", "");
    if (path === "/auth/me") {
      await route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED", message: "Authentication is required." } } });
      return;
    }
    if (path === "/auth/login") {
      await route.fulfill({ json: { data: { user: account, csrfToken: "test-token" } } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: "Unexpected test request" } } });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("The server could not verify this login session. Check your connection and try again.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Courts at a glance." })).toHaveCount(0);
});
