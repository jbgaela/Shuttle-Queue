import { expect, type Page, type Route } from "@playwright/test";

export const VIEWPORTS = [
  { name: "phone-320", width: 320, height: 568 },
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-375", width: 375, height: 812 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-412", width: 412, height: 915 },
  { name: "phone-landscape-568", width: 568, height: 320 },
  { name: "phone-landscape-844", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "tablet-wide", width: 1024, height: 1366 },
  { name: "laptop-720", width: 1280, height: 720 },
  { name: "laptop-768", width: 1366, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "desktop-large", width: 1920, height: 1080 },
] as const;

export const REPRESENTATIVE_VIEWPORTS = [VIEWPORTS[0], VIEWPORTS[7], VIEWPORTS[12]];

const now = "2026-08-10T08:00:00.000Z";
const sessionId = "session-ui";

const playerNames = [
  "Alex Rivera",
  "Bao Santos",
  "Carmen Lim",
  "Diego Cruz",
  "Emi Tan",
  "Farah Khan",
  "Gio Reyes",
  "Hana Lee",
  "Alexandria-This-Is-A-Very-Long-Player-Name",
  "Inez Wu",
  "Jules Garcia",
  "Kai Patel",
];

const players = playerNames.map((displayName, index) => ({
  id: `player-${index + 1}`,
  displayName,
  gender: index % 2 === 0 ? "MALE" as const : "FEMALE" as const,
  skillLevel: ["BEGINNER", "INTERMEDIATE", "UPPER_INTERMEDIATE", "ADVANCED"][index % 4]!,
  skillWeight: (index % 4) + 2,
  status: "ACTIVE",
}));

const sessionPlayers = players.map((player, index) => ({
  id: `session-player-${index + 1}`,
  sessionId,
  playerId: player.id,
  displayName: player.displayName,
  gender: player.gender,
  skillLevel: player.skillLevel,
  skillWeight: player.skillWeight,
  status: index < 4 ? "PLAYING" as const : index < 8 ? "QUEUED" as const : "WAITING" as const,
  queueEnteredAt: index >= 8 ? "2026-08-10T07:30:00.000Z" : null,
  lastMatchEndedAt: index < 4 ? null : "2026-08-10T07:00:00.000Z",
  matchesPlayed: index < 4 ? 1 : 0,
  wins: index === 0 || index === 1 ? 1 : 0,
  losses: index === 2 || index === 3 ? 1 : 0,
  pointsFor: index < 4 ? 21 : 0,
  pointsAgainst: index < 4 ? 18 : 0,
  amountDueMinor: 500,
  manualPriority: 0,
  latePenaltyState: index === 8 ? "PENDING" as const : null,
  latePenaltyAppliedAt: index === 8 ? now : null,
  currentMatchId: index < 4 ? "match-live" : index < 8 ? "match-queued" : null,
  checkedInAt: "2026-08-10T07:15:00.000Z",
  checkedOutAt: null,
  restStartedAt: null,
  version: 1,
}));

const matchParticipants = (matchId: string, ids: string[]) => ids.map((queuePlayerId, index) => ({
  id: `${matchId}-participant-${index + 1}`,
  matchId,
  queuePlayerId,
  team: index < ids.length / 2 ? "A" as const : "B" as const,
  teamSlot: index % (ids.length / 2) + 1,
  priorQueueEnteredAt: "2026-08-10T07:00:00.000Z",
}));

export const snapshot = {
  schemaVersion: 2 as const,
  queueMasterId: "account-ui",
  settings: {
    id: "settings-ui",
    pointsToWin: 21,
    winBy: 2,
    scoreCap: 30,
    bestOf: 1 as const,
    minimumRestMinutes: 10,
    defaultFeeMode: "FIXED_PER_PLAYER",
    defaultFixedFeeMinor: 500,
    currencyCode: "PHP",
    timeZone: "UTC",
    defaultLateArrivalCutoffTime: null,
    version: 1,
  },
  workspace: {
    startedAt: "2026-08-10T07:00:00.000Z",
    lateArrivalCutoffAt: "2026-08-10T07:45:00.000Z",
    matchmakingAlgorithm: "v2-rotation",
    matchmakingRevision: 3,
    version: 2,
  },
  players,
  sessions: [{
    id: sessionId,
    name: "Saturday Social · Long Session Name That Wraps",
    normalizedName: "saturday social",
    sessionDate: "2026-08-10",
    status: "ACTIVE" as const,
    startedAt: "2026-08-10T07:00:00.000Z",
    endedAt: null,
    cancelledAt: null,
    pointsToWin: 21,
    winBy: 2,
    scoreCap: 30,
    bestOf: 1 as const,
    minimumRestMinutes: 10,
    lateArrivalCutoffAt: "2026-08-10T07:45:00.000Z",
    matchmakingAlgorithm: "v2-rotation",
    matchmakingRevision: 3,
    version: 2,
  }],
  queuePlayers: sessionPlayers,
  sessionPlayers,
  courts: [
    { id: "court-1", sessionId, name: "Court 1", normalizedName: "court 1", displayOrder: 0, status: "OCCUPIED" as const, currentMatchId: "match-live", closedAt: null, version: 1 },
    { id: "court-2", sessionId, name: "Court 2", normalizedName: "court 2", displayOrder: 1, status: "AVAILABLE" as const, currentMatchId: null, closedAt: null, version: 1 },
    { id: "court-3", sessionId, name: "Court 3", normalizedName: "court 3", displayOrder: 2, status: "CLOSED" as const, currentMatchId: null, closedAt: now, version: 1 },
  ],
  matches: [
    {
      id: "match-live",
      sessionId,
      courtId: "court-1",
      status: "IN_PROGRESS" as const,
      source: "AUTOMATIC" as const,
      matchmakingMode: "BALANCED" as const,
      algorithmVersion: "v2-rotation",
      suggestionKey: null,
      suggestionExplanation: null,
      queuedAt: "2026-08-10T07:20:00.000Z",
      startedAt: "2026-08-10T07:35:00.000Z",
      completedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      winnerTeam: null,
      currentRevisionId: null,
      version: 1,
      pointsToWin: 21,
      winBy: 2,
      scoreCap: 30,
      bestOf: 1 as const,
      participants: matchParticipants("match-live", sessionPlayers.slice(0, 4).map((player) => player.id)),
      scoreRevisions: [],
    },
    {
      id: "match-queued",
      sessionId,
      courtId: null,
      status: "QUEUED" as const,
      source: "MANUAL" as const,
      matchmakingMode: null,
      algorithmVersion: null,
      suggestionKey: null,
      suggestionExplanation: null,
      queuedAt: "2026-08-10T07:40:00.000Z",
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      winnerTeam: null,
      currentRevisionId: null,
      version: 1,
      pointsToWin: 21,
      winBy: 2,
      scoreCap: 30,
      bestOf: 1 as const,
      participants: matchParticipants("match-queued", sessionPlayers.slice(4, 8).map((player) => player.id)),
      scoreRevisions: [],
    },
    {
      id: "match-completed",
      sessionId,
      courtId: "court-1",
      status: "COMPLETED" as const,
      source: "MANUAL" as const,
      matchmakingMode: null,
      algorithmVersion: null,
      suggestionKey: null,
      suggestionExplanation: null,
      queuedAt: "2026-08-10T06:00:00.000Z",
      startedAt: "2026-08-10T06:05:00.000Z",
      completedAt: "2026-08-10T06:40:00.000Z",
      cancelledAt: null,
      cancellationReason: null,
      winnerTeam: "A" as const,
      currentRevisionId: "revision-completed",
      version: 1,
      pointsToWin: 21,
      winBy: 2,
      scoreCap: 30,
      bestOf: 1 as const,
      participants: matchParticipants("match-completed", sessionPlayers.slice(0, 4).map((player) => player.id)),
      scoreRevisions: [{
        id: "revision-completed",
        matchId: "match-completed",
        revisionNumber: 1,
        winnerTeam: "A" as const,
        reason: null,
        supersedesRevisionId: null,
        createdAt: "2026-08-10T06:40:00.000Z",
        games: [{ id: "game-completed", scoreRevisionId: "revision-completed", gameNumber: 1, teamAScore: 21, teamBScore: 18, winnerTeam: "A" as const }],
      }],
    },
  ],
  feeConfig: { id: "fee-ui", mode: "FIXED_PER_PLAYER", currencyCode: "PHP", fixedAmountPerPlayerMinor: 500, expectedQueueCostMinor: 0, participationRule: "CHECKED_IN", frozenAt: null, version: 1 },
  feeConfigs: [{ id: "fee-ui", sessionId, mode: "FIXED_PER_PLAYER", currencyCode: "PHP", fixedAmountPerPlayerMinor: 500, expectedSessionCostMinor: null, participationRule: "CHECKED_IN", frozenAt: null, version: 1 }],
  payments: [{ id: "payment-ui", queuePlayerId: "session-player-9", kind: "COLLECTION", method: "EWALLET", amountMinor: 500, reference: "synthetic-ui", note: null, reversalOfPaymentId: null, recordedById: "account-ui", occurredAt: "2026-08-10T07:50:00.000Z", createdAt: "2026-08-10T07:50:00.000Z" }],
  audits: [],
  careerStats: [],
};

type FixtureUser = { id: string; username: string; role: "SUPER_ADMIN" | "QUEUE_MASTER" };
const user: FixtureUser = { id: "account-ui", username: "synthetic.queue", role: "QUEUE_MASTER" };
export const superAdminUser: FixtureUser = { id: "account-admin-ui", username: "synthetic.admin", role: "SUPER_ADMIN" };
const adminAccounts = [
  { id: superAdminUser.id, username: superAdminUser.username, role: "SUPER_ADMIN" as const, status: "ACTIVE" as const, createdAt: now, updatedAt: now, lastLoginAt: now, passwordChangedAt: now, version: 1, playerCount: 12, queuePlayerCount: 12, sessionCount: 1, courtCount: 3, matchCount: 3 },
  { id: user.id, username: user.username, role: "QUEUE_MASTER" as const, status: "ACTIVE" as const, createdAt: now, updatedAt: now, lastLoginAt: now, passwordChangedAt: now, version: 1, playerCount: 12, queuePlayerCount: 12, sessionCount: 1, courtCount: 3, matchCount: 3 },
];

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data }) });
}

export async function mockCloudApi(page: Page, fixtureUser: FixtureUser = user) {
  await page.route("**/api/v2/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/v2/, "");
    if (path === "/auth/me") return json(route, { user: fixtureUser, csrfToken: "synthetic-csrf-token" });
    if (path === "/auth/logout") return json(route, null);
    if (path === "/sync/status") return json(route, { cloudRevision: 1, lastSyncedAt: now, lastDeviceId: "synthetic-device", schemaVersion: 2 });
    if (path === "/sync/snapshot") return json(route, { snapshot, checksum: "synthetic-checksum", cloudRevision: 1, schemaVersion: 2 });
    if (path === "/auth/login") return json(route, { user: fixtureUser, csrfToken: "synthetic-csrf-token" });
    if (path === "/admin/accounts") return fixtureUser.role === "SUPER_ADMIN" ? json(route, adminAccounts) : json(route, { message: "Super Admin access required." }, 403);
    return json(route, { message: "Synthetic fixture does not implement this online endpoint." }, 404);
  });
}

export async function openAuthenticatedApp(page: Page, fixtureUser: FixtureUser = user) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(`console: ${message.text()}`); });
  page.on("requestfailed", (request) => pageErrors.push(`${request.method()} ${request.url()} failed: ${request.failure()?.errorText ?? "unknown"}`));
  await mockCloudApi(page, fixtureUser);
  await page.goto("/");
  try {
    await expect(page.getByRole("heading", { name: "Courts at a glance." })).toBeVisible();
  } catch (error) {
    const offlineDiagnostics = await page.evaluate(async () => {
      const request = indexedDB.open("shuttle-queue-offline");
      return await new Promise<unknown>((resolve) => {
        request.onerror = () => resolve({ error: request.error?.message ?? "IndexedDB open failed" });
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["profiles", "meta", "snapshots"], "readonly");
          const stores = ["profiles", "meta", "snapshots"] as const;
          Promise.all(stores.map((name) => new Promise<[string, unknown]>((done) => {
            const getAll = transaction.objectStore(name).getAll();
            getAll.onsuccess = () => done([name, getAll.result]);
            getAll.onerror = () => done([name, { error: getAll.error?.message }]);
          }))).then((entries) => resolve(Object.fromEntries(entries)));
          transaction.onerror = () => resolve({ error: transaction.error?.message ?? "IndexedDB read failed" });
        };
      });
    }).catch((reason) => ({ error: String(reason) }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nBody: ${await page.locator("body").innerText()}\nBrowser diagnostics: ${pageErrors.join(" | ")}\nOffline diagnostics: ${JSON.stringify(offlineDiagnostics)}`);
  }
}

export const tabs = [
  { label: "Live", heading: "Courts at a glance." },
  { label: "Queue", heading: "Make the next match." },
  { label: "Players", heading: "Players and check-in." },
  { label: "History", heading: "The queue log." },
  { label: "Rankings", heading: "Results that stay useful." },
  { label: "Fees", heading: "Keep fees accounted for." },
  { label: "Settings", heading: "Offline workspace" },
] as const;

export async function openTab(page: Page, label: string, heading: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  try {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nTab: ${label}\nBody: ${(await page.locator("body").innerText()).slice(0, 1200)}`);
  }
}

export async function assertResponsiveLayout(page: Page) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewportWidth;
    const interactive = [...document.querySelectorAll<HTMLElement>("button, a, input, select, textarea")];
    const outside = interactive.filter((element) => {
      const box = element.getBoundingClientRect();
      let ancestor = element.parentElement;
      let intentionallyScrollable = false;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (["auto", "scroll"].includes(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 1) {
          intentionallyScrollable = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      return box.width > 0 && box.height > 0 && !intentionallyScrollable && (box.left < -1 || box.right > viewportWidth + 1);
    });
    const clipped = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,p,button,label")].filter((element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth + 1 && style.overflow !== "hidden" && style.textOverflow !== "ellipsis";
    });
    const wide = [...document.querySelectorAll<HTMLElement>("body *")].map((element) => ({ element, box: element.getBoundingClientRect() })).filter(({ box }) => box.width > viewportWidth + 1 || box.right > viewportWidth + 1).sort((a, b) => b.box.right - a.box.right).slice(0, 12).map(({ element, box }) => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 80), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    return { viewportWidth, overflow, outside: outside.map((element) => element.outerHTML.slice(0, 160)), clipped: clipped.map((element) => element.textContent?.trim().slice(0, 80)), wide };
  });
  expect(metrics.overflow, `page scrolls horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.outside, `interactive elements leave the viewport: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.clipped, `text is clipped without intentional truncation: ${JSON.stringify(metrics)}`).toEqual([]);
}

export async function disableMotion(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }" });
}
