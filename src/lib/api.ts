export type ApiEnvelope<T> = { data: T; requestId?: string; meta?: unknown };
const baseUrl = "/api/v2";
let csrfTokenCache: string | null = null;
let csrfRefreshPromise: Promise<string | null> | null = null;
let publicSharingActive = typeof window !== "undefined" && (() => { try { return window.localStorage.getItem("bq-public-sharing-active") === "1"; } catch { return false; } })();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const authRequiredListeners = new Set<() => void>();

export function onAuthRequired(listener: () => void) {
  authRequiredListeners.add(listener);
  return () => { authRequiredListeners.delete(listener); };
}

function notifyAuthRequired(path: string) {
  if (path === "/auth/login" || path === "/auth/logout") return;
  for (const listener of authRequiredListeners) {
    try { listener(); } catch { /* an auth boundary must not break the failed request */ }
  }
}

export function setPublicSharingActive(value: boolean) {
  publicSharingActive = value;
  if (typeof window !== "undefined") { try { window.localStorage.setItem("bq-public-sharing-active", value ? "1" : "0"); } catch { /* storage may be unavailable */ } }
}

async function syncBeforePublicSessionFinalization() {
  if (!publicSharingActive) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Connect to the internet and sync before ending or resetting a shared queue.");
  const local = await import("./offline/repository");
  await local.syncAccount(await local.currentAccountId(), "manual");
}

function readCsrfToken() {
  if (csrfTokenCache) return csrfTokenCache;
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem("bq-csrf-token"); } catch { return null; }
}

function saveCsrfToken(value: string) {
  csrfTokenCache = value;
  if (typeof window !== "undefined") {
    try { window.sessionStorage.setItem("bq-csrf-token", value); } catch { /* private browsing may deny storage access */ }
  }
}

// The operational components still use a few historical field names internally while
// the wire contract is queue-scoped. This adapter keeps the server payload session-free.
function hydrateQueueFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => hydrateQueueFields(item)) as T;
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) result[key] = hydrateQueueFields(item);
  if (typeof source.queuePlayerId === "string" && source.type !== "LOW_SKILL_LONE_FEMALE") result.sessionPlayerId = source.queuePlayerId;
  if (typeof source.queuePlayerCount === "number") result.sessionCount = source.queuePlayerCount;
  if (typeof source.expectedQueueCostMinor === "number") result.expectedSessionCostMinor = source.expectedQueueCostMinor;
  return result as T;
}

async function refreshCsrfToken() {
  if (typeof window === "undefined") return null;
  if (csrfRefreshPromise) return csrfRefreshPromise;
  const refresh = (async () => {
    const authResponse = await fetch(`${baseUrl}/auth/me`, { credentials: "include", cache: "no-store" });
    const authPayload = await authResponse.json().catch(() => ({}));
    const freshToken = authPayload?.data?.csrfToken;
    if (authResponse.status === 401 && authPayload?.error?.code === "AUTH_REQUIRED") notifyAuthRequired("/auth/me");
    if (!authResponse.ok || !freshToken) return null;
    saveCsrfToken(freshToken);
    return freshToken;
  })();
  csrfRefreshPromise = refresh;
  try { return await refresh; } finally { if (csrfRefreshPromise === refresh) csrfRefreshPromise = null; }
}

async function requestOnline<T>(path: string, init?: RequestInit, allowCsrfResync = true): Promise<T> {
  const csrfToken = readCsrfToken();
  const requestInit: RequestInit = { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}), ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) } };
  if (path === "/auth/me" && !requestInit.cache) requestInit.cache = "no-store";
  const response = await fetch(`${baseUrl}${path}`, requestInit);
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403 && payload?.error?.code === "CSRF_INVALID" && allowCsrfResync && typeof window !== "undefined") {
    const freshToken = await refreshCsrfToken();
    if (freshToken) {
      return requestOnline(path, init, false);
    }
  }
  if (!response.ok) {
    const errorPayload = payload?.error;
    const apiError = new ApiError(
      response.status,
      typeof errorPayload?.code === "string" ? errorPayload.code : "HTTP_ERROR",
      typeof errorPayload?.message === "string" ? errorPayload.message : "The request could not be completed.",
      errorPayload?.details,
      typeof payload?.requestId === "string" ? payload.requestId : undefined,
    );
    if (apiError.status === 401 && apiError.code === "AUTH_REQUIRED") notifyAuthRequired(path);
    throw apiError;
  }
  if (payload?.data?.csrfToken) saveCsrfToken(payload.data.csrfToken);
  const data = (payload as ApiEnvelope<T>).data;
  return (path.startsWith("/sync/") ? data : hydrateQueueFields(data));
}

export async function request<T>(path: string, init?: RequestInit, allowCsrfResync = true): Promise<T> {
  if (typeof window !== "undefined" && !path.startsWith("/auth/") && !path.startsWith("/sync/") && !path.startsWith("/admin/") && !path.startsWith("/workspace/public-rankings")) {
    const local = await import("./offline/repository");
    if (await local.hasLocalSnapshot()) return local.handleRequest(await local.currentAccountId(), path, init) as Promise<T>;
  }
  return requestOnline(path, init, allowCsrfResync);
}

async function publicRequest<T>(token: string, suffix = ""): Promise<T> {
  const response = await fetch(`${baseUrl}/public/rankings/${encodeURIComponent(token)}${suffix}`, { credentials: "omit", cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? "These public rankings are no longer available.");
  return (payload as ApiEnvelope<T>).data;
}

export type SuggestionNoMatchCode = "NO_EXACT_STRENGTH_GAP" | "NO_UNDEFEATED_QUALIFIER" | "REST_REQUIRED" | "NO_MIXED_DOUBLES_COMPOSITION" | "NO_VALID_GROUP";

export const api = {
  me: () => request<{ user: { id: string; username: string; role: AccountRole } }>("/auth/me"),
  settings: () => request<AccountSettings>("/settings"),
  updateSettings: (body: { defaultLateArrivalCutoffTime?: string | null; minimumRestMinutes?: number; lateArrivalGraceMinutes?: number; noShowPenaltyMinor?: number }, version?: number) => request<AccountSettings>("/settings", { method: "PATCH", ...(version === undefined ? {} : { headers: { "if-match": String(version) } }), body: JSON.stringify(body) }),
  login: (username: string, password: string) => request<{ user: { id: string; username: string; role: AccountRole } }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  changePassword: (currentPassword: string, newPassword: string) => request<{ user: { id: string; username: string; role: AccountRole }; csrfToken: string; expiresAt: string }>("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  adminAccounts: () => request<AccountSummary[]>("/admin/accounts"),
  createAccount: (body: { username: string; password: string; role: AccountRole }) => request<AccountSummary>("/admin/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id: string, body: { role?: AccountRole; status?: AccountStatus }, version: number) => request<AccountSummary>(`/admin/accounts/${id}`, { method: "PATCH", headers: { "if-match": String(version) }, body: JSON.stringify(body) }),
  resetAccountPassword: (id: string, password: string, version: number) => request<void>(`/admin/accounts/${id}/reset-password`, { method: "POST", headers: { "if-match": String(version) }, body: JSON.stringify({ password }) }),
  accountDeletionPreview: (id: string) => request<{ account: AccountSummary; deletion: AccountDeletionPreview }>(`/admin/accounts/${id}/deletion-preview`),
  deleteAccount: (id: string, confirmationUsername: string, currentPassword: string, version: number) => request<void>(`/admin/accounts/${id}`, { method: "DELETE", headers: { "if-match": String(version) }, body: JSON.stringify({ confirmationUsername, currentPassword }) }),
  logout: async () => { try { if (typeof navigator !== "undefined" && !navigator.onLine) return; return await request<void>("/auth/logout", { method: "POST" }); } finally { csrfTokenCache = null; if (typeof window !== "undefined") { try { window.sessionStorage.removeItem("bq-csrf-token"); } catch { /* ignore storage cleanup failures */ } } } },
  workspace: async () => { const value = await request<WorkspaceSummary>("/workspace"); return { ...value, id: "workspace", name: "Current queue", sessionDate: value.startedAt, status: value.status ?? "ACTIVE" }; },
  cloudWorkspace: async () => { const value = await requestOnline<WorkspaceSummary>("/workspace"); return { ...value, id: "workspace", name: "Current queue", sessionDate: value.startedAt, status: value.status ?? "ACTIVE" }; },
  endQueue: async (version: number) => { await syncBeforePublicSessionFinalization(); const value = await request<WorkspaceSummary>("/workspace/end", { method: "POST", headers: { "if-match": String(version) }, body: "{}" }); if (publicSharingActive && typeof navigator !== "undefined" && navigator.onLine) { const local = await import("./offline/repository"); void local.syncAccount(await local.currentAccountId(), "background").catch(() => undefined); } return { ...value, id: "workspace", name: "Current queue", sessionDate: value.startedAt, status: value.status ?? "ENDED" }; },
  startFreshQueue: async (version: number) => { await syncBeforePublicSessionFinalization(); const value = await request<WorkspaceSummary>("/workspace/start-fresh", { method: "POST", headers: { "if-match": String(version) }, body: "{}" }); if (publicSharingActive && typeof navigator !== "undefined" && navigator.onLine) { const local = await import("./offline/repository"); void local.syncAccount(await local.currentAccountId(), "background").catch(() => undefined); } return { ...value, id: "workspace", name: "Current queue", sessionDate: value.startedAt, status: value.status ?? "ACTIVE" }; },
  sessions: async () => [await api.workspace()],
  createSession: (_body: { name: string; sessionDate?: string }) => api.workspace(),
  startSession: (_id: string, version: number) => api.workspace(),
  resetSession: (_id: string, version: number) => api.startFreshQueue(version),
  deleteSession: async (_id: string, version: number, _playerDisposition?: "KEEP" | "DELETE_ALL") => { await api.startFreshQueue(version); },
  players: () => request<Player[]>("/players?status=ACTIVE"),
  playerDeletionPreview: (playerIds: string[]) => request<PlayerDeletionPreview>("/players/deletion-preview", { method: "POST", body: JSON.stringify({ playerIds }) }),
  deletePlayers: (playerIds: string[]) => request<PlayerDeletionResult>("/players/delete", { method: "POST", body: JSON.stringify({ playerIds }) }),
  createPlayer: (body: { displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string }) => request<Player>("/players", { method: "POST", body: JSON.stringify(body) }),
  updatePlayer: (player: Player, body: { displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string }) => request<Player>(`/players/${player.id}`, { method: "PATCH", ...(player.version === undefined ? {} : { headers: { "if-match": String(player.version) } }), body: JSON.stringify(body) }),
  addPlayers: (_workspaceId: string, playerIds: string[]) => request<QueuePlayer[]>("/queue/players", { method: "POST", body: JSON.stringify({ playerIds }) }),
  sessionPlayers: (_workspaceId: string) => request<QueuePlayer[]>("/queue/players"),
  createSynergyTeam: (_workspaceId: string, queuePlayerIds: [string, string]) => request<SynergyTeam>("/queue/synergy-teams", { method: "POST", body: JSON.stringify({ queuePlayerIds }) }),
  updateSynergyTeam: (_workspaceId: string, team: SynergyTeam, queuePlayerIds: [string, string]) => request<SynergyTeam>(`/queue/synergy-teams/${team.id}`, { method: "PATCH", headers: { "if-match": String(team.version) }, body: JSON.stringify({ queuePlayerIds }) }),
  deleteSynergyTeam: (_workspaceId: string, team: SynergyTeam) => request<void>(`/queue/synergy-teams/${team.id}`, { method: "DELETE", headers: { "if-match": String(team.version) }, body: "{}" }),
  removeSessionPlayer: (_workspaceId: string, queuePlayerId: string) => request<void>(`/queue/players/${queuePlayerId}`, { method: "DELETE", body: "{}" }),
  queue: (_workspaceId: string) => request<QueueState>("/queue"),
  courts: (_workspaceId: string) => request<Court[]>("/courts"),
  createCourt: (_workspaceId: string, name: string) => request<Court>("/courts", { method: "POST", body: JSON.stringify({ name }) }),
  updateCourt: (_workspaceId: string, court: Court, body: { name?: string; status?: "AVAILABLE" | "CLOSED" }) => request<Court>(`/courts/${court.id}`, { method: "PATCH", ...(court.version === undefined ? {} : { headers: { "if-match": String(court.version) } }), body: JSON.stringify(body) }),
  deleteCourt: (_workspaceId: string, court: Court) => request<CourtDeletionResult>(`/courts/${court.id}`, { method: "DELETE", ...(court.version === undefined ? {} : { headers: { "if-match": String(court.version) } }), body: "{}" }),
  deleteCourts: (_workspaceId: string, statuses: Array<"AVAILABLE" | "CLOSED">) => request<CourtDeletionResult>("/courts/delete", { method: "POST", body: JSON.stringify({ statuses }) }),
  updateLateArrivalPolicy: async (_workspaceId: string, body: { mode: "SET_NOW" | "START_GRACE" | "APPLY_ACCOUNT_DEFAULT" | "DISABLED" | "SET_CUSTOM"; localDateTime?: string; graceMinutes?: number; settingsVersion?: number }, version?: number) => { const value = await request<WorkspaceSummary>("/workspace/late-arrival-policy", { method: "PATCH", ...(version === undefined ? {} : { headers: { "if-match": String(version) } }), body: JSON.stringify(body) }); return { ...value, id: "workspace", name: "Current queue", sessionDate: value.startedAt, status: value.status ?? "ACTIVE" }; },
  checkIn: (_workspaceId: string, queuePlayerId: string) => request<QueuePlayer>(`/queue/players/${queuePlayerId}/check-in`, { method: "POST", body: "{}" }),
  restPlayer: (_workspaceId: string, queuePlayerId: string) => request<QueuePlayer>(`/queue/players/${queuePlayerId}/rest`, { method: "POST", body: "{}" }),
  resumePlayer: (_workspaceId: string, queuePlayerId: string) => request<QueuePlayer>(`/queue/players/${queuePlayerId}/resume`, { method: "POST", body: "{}" }),
  checkOut: (_workspaceId: string, queuePlayerId: string) => request<QueuePlayer>(`/queue/players/${queuePlayerId}/check-out`, { method: "POST", body: "{}" }),
  bulkQueueAction: (_workspaceId: string, playerIds: string[], action: "CHECK_IN" | "REST" | "CHECK_OUT") => request<QueuePlayer[]>("/queue/players/bulk-action", { method: "POST", body: JSON.stringify({ playerIds, action }) }),
  waiveLatePenalty: (_workspaceId: string, queuePlayerId: string, version?: number) => request<QueuePlayer>(`/queue/players/${queuePlayerId}/late-penalty/waive`, { method: "POST", ...(version === undefined ? {} : { headers: { "if-match": String(version) } }), body: "{}" }),
  suggestions: (_workspaceId: string, mode: string, strengthGap?: 1 | 2 | 3, excludeKeys: string[] = []) => request<{ suggestion: Suggestion | null; matchupAdvisory?: MatchupAdvisory | null; cycleRestarted: boolean; noMatch?: { code: SuggestionNoMatchCode; message: string; nextEligibleAt?: string | null; readyMaleCount?: number; readyFemaleCount?: number; waitingMaleCount?: number; waitingFemaleCount?: number } }>("/suggestions", { method: "POST", body: JSON.stringify({ mode, ...(mode === "BALANCED" ? { strengthGap: strengthGap ?? 1 } : {}), excludeKeys }) }),
  createManualMatch: (_workspaceId: string, body: { teamA: string[]; teamB: string[]; courtId?: string }) => request<Match>("/matches", { method: "POST", body: JSON.stringify(body) }),
  queueManualMatch: (_workspaceId: string, teamA: string[], teamB: string[]) => request<Match>("/matches", { method: "POST", body: JSON.stringify({ teamA, teamB }) }),
  startManualMatch: (_workspaceId: string, teamA: string[], teamB: string[], courtId: string, playerPreferenceConfirmed = false) => request<Match>("/matches", { method: "POST", body: JSON.stringify({ teamA, teamB, courtId, ...(playerPreferenceConfirmed ? { playerPreferenceConfirmed: true } : {}) }) }),
  createSuggestedMatch: (_workspaceId: string, body: { teamA: string[]; teamB: string[]; suggestionToken: string; suggestionAdjusted?: boolean; playerPreferenceConfirmed?: boolean; courtId?: string }) => request<Match>("/matches", { method: "POST", body: JSON.stringify(body) }),
  updateMatch: (match: Match, body: { teamA: string[]; teamB: string[]; courtId?: string; swapWithMatchId?: string }) => request<Match>(`/matches/${match.id}`, { method: "PATCH", ...(match.version === undefined ? {} : { headers: { "if-match": String(match.version) } }), body: JSON.stringify(body) }),
  startMatch: (matchId: string, courtId: string, playerPreferenceConfirmed?: boolean) => request<Match>(`/matches/${matchId}/start`, { method: "POST", body: JSON.stringify({ courtId, ...(playerPreferenceConfirmed ? { playerPreferenceConfirmed: true } : {}) }) }),
  startSuggestedMatch: (_workspaceId: string, body: { teamA: string[]; teamB: string[]; courtId: string; suggestionToken: string; playerPreferenceConfirmed?: boolean }) => request<Match>("/matches/start-suggestion", { method: "POST", body: JSON.stringify(body) }),
  completeMatch: (matchId: string, games: { teamAScore: number; teamBScore: number }[]) => request<Match>(`/matches/${matchId}/complete`, { method: "POST", body: JSON.stringify({ games }) }),
  correctMatch: (matchId: string, games: { teamAScore: number; teamBScore: number }[], reason?: string) => request<Match>(`/matches/${matchId}/correct`, { method: "POST", body: JSON.stringify({ games, ...(reason ? { reason } : {}) }) }),
  cancelMatch: (matchId: string) => request<Match>(`/matches/${matchId}/cancel`, { method: "POST", body: "{}" }),
  matches: (_workspaceId: string) => request<Match[]>("/matches"),
  history: (_workspaceId: string, page = 1, pageSize = 15, search = "") => request<HistoryResponse>(`/history?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(search ? { search } : {}) }).toString()}`),
  playerHistory: (_workspaceId: string, queuePlayerId: string, page = 1, pageSize = 15) => request<PlayerHistoryResponse>(`/queue/players/${queuePlayerId}/history?page=${page}&pageSize=${pageSize}`),
  rankings: (_workspaceId: string) => request<RankingPayload>("/rankings"),
  publicRankingPublications: () => request<PublicRankingPublicationResponse>("/workspace/public-rankings"),
  publishPublicRankings: (version: number) => requestOnline<PublicRankingPublication>("/workspace/public-rankings/publish", { method: "POST", headers: { "if-match": `"${version}"` }, body: JSON.stringify({ version }) }),
  revokePublicRankings: (publication: PublicRankingPublication) => requestOnline<PublicRankingPublication>(`/workspace/public-rankings/${publication.id}/revoke`, { method: "POST", headers: { "if-match": `"${publication.version}"` }, body: JSON.stringify({ version: publication.version }) }),
  publicRankings: (token: string) => publicRequest<PublicRankingPayload>(token),
  publicRankingPlayerHistory: (token: string, playerKey: string) => publicRequest<PublicRankingPlayerHistoryPayload>(token, `/players/${encodeURIComponent(playerKey)}/history`),
  fees: (_workspaceId: string) => request<FeeSummary>("/fees"),
  updateFeeConfig: (_workspaceId: string, body: { mode: "FIXED_PER_PLAYER" | "EQUAL_SPLIT"; fixedAmountPerPlayerMinor?: number | null; expectedQueueCostMinor?: number | null; expectedSessionCostMinor?: number | null }) => request<{ config: FeeConfig; summary: FeeSummary }>("/fees/config", { method: "PUT", body: JSON.stringify({ ...body, expectedQueueCostMinor: body.expectedQueueCostMinor ?? body.expectedSessionCostMinor }) }),
  payments: (_workspaceId: string) => request<Payment[]>("/payments"),
  createPayment: (_workspaceId: string, body: { queuePlayerId?: string; sessionPlayerId?: string; kind: "COLLECTION" | "WAIVER"; amountMinor: number; method?: "CASH" | "EWALLET" | "OTHER"; reference?: string; note?: string }) => request<{ payment: Payment; summary: FeeSummary; replayed: boolean }>("/payments", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ ...body, queuePlayerId: body.queuePlayerId ?? body.sessionPlayerId }) }),
  syncStatus: () => request<{ cloudRevision: number; lastSyncedAt?: string | null; lastDeviceId?: string | null; schemaVersion: number }>("/sync/status"),
  syncSnapshot: () => request<{ snapshot: unknown; checksum: string; cloudRevision: number; schemaVersion: number }>("/sync/snapshot"),
  uploadSnapshot: (body: unknown) => request<{ cloudRevision: number; lastSyncedAt?: string | null; alreadyApplied?: boolean }>("/sync/snapshot", { method: "PUT", body: JSON.stringify(body) }),
};

export type AccountRole = "SUPER_ADMIN" | "QUEUE_MASTER";
export type AccountStatus = "ACTIVE" | "DISABLED";
export type AccountSettings = { id: string; pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: number; minimumRestMinutes: number; lateArrivalGraceMinutes: number; defaultFeeMode: string; defaultFixedFeeMinor?: number | null; noShowPenaltyMinor: number; currencyCode: string; timeZone: string; defaultLateArrivalCutoffTime?: string | null; version: number };
export type AccountSummary = { id: string; username: string; role: AccountRole; status: AccountStatus; createdAt: string; updatedAt: string; lastLoginAt?: string | null; passwordChangedAt: string; version: number; playerCount: number; queuePlayerCount: number; sessionCount: number; courtCount?: number; matchCount?: number };
export type AccountDeletionPreview = { accountId: string; playerCount: number; queuePlayerCount: number; sessionCount: number; courtCount: number; matchCount: number; participantCount: number; scoreRevisionCount: number; gameCount: number; paymentCount: number; feeConfigCount: number; auditCount: number; authSessionCount: number; idempotencyRecordCount: number };
export type WorkspaceSummary = { id: string; name: string; sessionDate: string; startedAt: string; status: string; endedAt?: string | null; lateArrivalCutoffAt?: string | null; reclassifiedPlayerCount?: number; version: number; playerCount?: number; courtCount?: number; scoring: { pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: number }; feeConfig?: FeeConfig | null };
export type SessionSummary = WorkspaceSummary;
export type Player = { id: string; displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string; skillWeight: number; status: string; version?: number };
export type PlayerDeletionBusyPlayer = { playerId: string; queuePlayerId: string; displayName: string; status: string };
export type PlayerDeletionPreview = { playerIds: string[]; playerNames: string[]; busyPlayers: PlayerDeletionBusyPlayer[]; affectedMatchIds: string[]; affectedPaymentIds: string[]; otherParticipantPlayerIds: string[]; otherParticipantQueuePlayerIds?: string[] };
export type PlayerDeletionResult = { deletedPlayerIds: string[]; affectedMatchCount: number; affectedPaymentCount: number; otherParticipantPlayerIds: string[] };
export type QueuePlayer = { id: string; playerId?: string; displayName: string; gender: string; skillLevel: string; skillWeight: number; effectiveSkillLevel?: string; effectiveSkillWeight?: number; synergyTeamId?: string | null; synergyPartnerName?: string | null; status: string; matchesPlayed: number; wins: number; losses: number; pointsFor?: number; pointsAgainst?: number; amountDueMinor?: number; manualPriority?: number; queueEnteredAt?: string | null; lastMatchEndedAt?: string | null; restEligibleAt?: string | null; checkedInAt?: string | null; checkedOutAt?: string | null; currentMatchId?: string | null; latePenaltyState: "PENDING" | "SERVED" | "WAIVED" | null; latePenaltyAppliedAt?: string | null; version?: number };
export type SessionPlayer = QueuePlayer;
export type SynergyTeam = { id: string; queuePlayerIds: [string, string]; effectiveSkillLevel: string; effectiveSkillWeight: number; version: number; createdAt?: string; updatedAt?: string };
export type UndefeatedChallengePlayer = { queuePlayerId: string; displayName: string; rank: number; matchesPlayed: number; wins: number; losses: number; status: string; ready: boolean; restEligibleAt?: string | null };
export type QueueState = { inactive: SessionPlayer[]; waiting: SessionPlayer[]; queued: SessionPlayer[]; playing: SessionPlayer[]; resting: SessionPlayer[]; serverTime: string; minimumRestMinutes?: number; lateArrivalCutoffAt?: string | null; synergyTeams?: SynergyTeam[]; undefeatedChallenge?: { minimumMatches: number; rankLimit: number; players: UndefeatedChallengePlayer[] } };
export type Court = { id: string; name: string; status: "AVAILABLE" | "OCCUPIED" | "PAUSED" | "CLOSED"; displayOrder: number; currentMatchId?: string | null; version?: number };
export type CourtDeletionResult = { deletedCourtIds: string[]; deletedCount: number; preservedHistoryMatchCount: number };
export type MatchupAdvisory = { type: "LOW_SKILL_LONE_FEMALE"; queuePlayerId: string; displayName: string; skillLevel: "NEWBIE" | "BEGINNER" | "UPPER_BEGINNER" };
export type Suggestion = { token: string; expiresAt: number; key: string; strengthGap?: 1 | 2 | 3; difference: number; teamATotal: number; teamBTotal: number; lateArrivalCutoffAt?: string | null; matchupAdvisory?: MatchupAdvisory | null; teamA: SessionPlayer[]; teamB: SessionPlayer[]; explanation: { challenge?: { selectedPlayerIds?: string[]; opposingPlayerIds?: string[]; qualifyingPlayers?: Array<{ id: string; displayName: string; rank: number; gamesPlayed: number; wins: number; losses: number }>; rotatedPair?: boolean; fallbackIncludedThird?: boolean; difficultyPolicy?: string }; searchStats?: { eligibleCount?: number; evaluatedCount?: number; bounded?: boolean }; repeatPenalties?: Record<string, number>; rest?: { minimumRestMinutes?: number; eligibleAt?: string }; lateArrival?: { minimumPending?: number; selectedPending?: number; preferenceApplied?: boolean }; skillDiversity?: { groupSpread?: number; partnerMix?: number }; fairness?: { minimumGames?: number; minimumGamesCount?: number; manualOverride?: boolean; previouslySkippedCount?: number; supportMinimumGames?: number; supportPending?: number }; partnerRotation?: { recentRepeats?: number; allTimeRepeats?: number; preservedTeamBalance?: boolean }; algorithmVersion?: string; cycleRestarted?: boolean } };
export type UndefeatedChallengeNotification = { type: "UNDEFEATED_CHALLENGE_ELIGIBLE"; queuePlayerId: string; displayName: string; rank: number; matchesPlayed: number; wins: number; losses: number };
export type Match = { id: string; status: string; source?: string; courtId?: string | null; matchmakingMode?: string | null; algorithmVersion?: string | null; suggestionKey?: string | null; suggestionExplanation?: unknown; matchupAdvisory?: MatchupAdvisory | null; notifications?: UndefeatedChallengeNotification[]; startedAt?: string | null; completedAt?: string | null; queuedAt?: string; winnerTeam?: string | null; cancellationReason?: string | null; version?: number; scoring?: { pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: number }; participants: { id?: string; queuePlayerId?: string; displayName?: string; gender?: string; skillLevel?: string; playerStatus?: string; lastMatchEndedAt?: string | null; team: string; teamSlot?: number }[] };
export type HistoryParticipant = { queuePlayerId: string; sessionPlayerId: string; playerId?: string; displayName: string; gender: string; skillLevel: string; team: "A" | "B"; teamSlot: number };
export type HistoryGame = { gameNumber: number; teamAScore: number; teamBScore: number; winnerTeam: "A" | "B" };
export type HistoryMatch = { id: string; source: string; matchmakingMode?: string | null; format: "SINGLES" | "DOUBLES"; court: { id: string; name: string } | null; startedAt?: string | null; completedAt?: string | null; durationSeconds: number | null; winnerTeam: "A" | "B" | null; score: { revisionNumber: number; winnerTeam: "A" | "B"; games: HistoryGame[] } | null; participants: HistoryParticipant[] };
export type HistoryPagination = { page: number; pageSize: number; total: number; totalPages: number };
export type HistoryResponse = { items: HistoryMatch[]; pagination: HistoryPagination };
export type FrequentPlayer = { count: number; displayName: string; queuePlayerId: string; sessionPlayerId: string };
export type PlayerHistoryStats = { matchesPlayed: number; wins: number; losses: number; winRateBasisPoints: number; pointsFor: number; pointsAgainst: number; pointDifferential: number; averageDurationSeconds: number | null; mostPlayedPartner: FrequentPlayer | null; mostPlayedOpponent: FrequentPlayer | null };
export type PlayerHistoryResponse = { player: { queuePlayerId: string; sessionPlayerId: string; playerId: string; displayName: string; gender: string; skillLevel: string }; stats: PlayerHistoryStats; items: HistoryMatch[]; pagination: HistoryPagination };
export type CareerRanking = { rank: number; player: string; playerId: string; matchesPlayed: number; wins: number; losses: number; winRateBasisPoints: number; pointsFor: number; pointsAgainst: number; pointDifferential: number };
export type RankingMethod = { version: string; minimumMatches: number; prizePlaces: number; score: string; tiebreaks: readonly string[] };
export type Ranking = { rank: number | null; queuePlayerId: string; sessionPlayerId: string; player: string; playerId: string; gender: string; skillLevel: string; matchesPlayed: number; wins: number; losses: number; winRateBasisPoints: number; pointsFor: number; pointsAgainst: number; pointDifferential: number; eligible?: boolean; gamesNeeded?: number; rankingScoreBasisPoints?: number | null; pointPercentageBasisPoints?: number | null; isPrizePosition?: boolean; seededDrawUsed?: boolean };
export type RankingPayload = { rankingMethod: RankingMethod; rankings: Ranking[] };
export type PublicRankingRow = { rank: number | null; playerKey?: string; player: string; matchesPlayed: number; wins: number; losses: number; winRateBasisPoints: number; pointsFor: number; pointsAgainst: number; pointDifferential: number; eligible?: boolean; gamesNeeded?: number; rankingScoreBasisPoints?: number | null; pointPercentageBasisPoints?: number | null; isPrizePosition?: boolean; seededDrawUsed?: boolean };
export type PublicRankingPayload = { sessionStartedAt: string; firstMatchStartedAt: string | null; sessionEndedAt?: string | null; state: "LIVE" | "FINAL"; serverTime: string; lastUpdatedAt: string; historyAvailable: boolean; rankingMethod?: RankingMethod; rankings: PublicRankingRow[] };
export type PublicRankingMatch = { matchKey: string; startedAt?: string | null; completedAt: string | null; result: "WIN" | "LOSS"; winnerTeam: "A" | "B" | null; teamA: string[]; teamB: string[]; games: Array<{ gameNumber: number; teamAScore: number; teamBScore: number; winnerTeam: "A" | "B" }> };
export type PublicRankingPlayerHistoryStats = { averageDurationSeconds: number | null; mostPlayedPartner: { displayName: string; count: number } | null; mostPlayedOpponent: { displayName: string; count: number } | null };
export type PublicRankingPlayerHistoryPayload = { player: { playerKey: string; player: string }; stats: PublicRankingPlayerHistoryStats; matches: PublicRankingMatch[] };
export type PublicRankingPublication = { id: string; sessionStartedAt: string; sessionEndedAt?: string | null; state: "LIVE" | "FINAL" | "REVOKED"; publishedAt: string; finalizedAt?: string | null; revokedAt?: string | null; version: number; token?: string };
export type PublicRankingPublicationResponse = { current: PublicRankingPublication | null; archives: PublicRankingPublication[] };
export type FeeConfig = { id: string; mode: "FIXED_PER_PLAYER" | "EQUAL_SPLIT"; currencyCode: string; fixedAmountPerPlayerMinor?: number | null; expectedQueueCostMinor?: number | null; expectedSessionCostMinor?: number | null; noShowPenaltyMinor: number; participationRule: string; frozenAt?: string | null; version: number };
export type PaymentMethod = "CASH" | "EWALLET" | "OTHER";
export type FeePlayer = { queuePlayerId: string; sessionPlayerId: string; displayName: string; dueMinor: number; collectedMinor: number; waivedMinor: number; outstandingMinor: number; creditMinor: number; isNoShow: boolean; status: "WAIVED" | "PAID" | "PARTIAL" | "UNPAID" | "CREDIT"; collectionByMethodMinor: Record<PaymentMethod, number> };
export type FeeSummary = { config: FeeConfig | null; expectedMinor: number; collectedMinor: number; outstandingMinor: number; creditMinor: number; noShowCount: number; paymentCount: number; players: FeePlayer[] };
export type Payment = { id: string; queuePlayerId: string; sessionPlayerId: string; kind: "COLLECTION" | "REFUND" | "WAIVER" | "WAIVER_REVERSAL"; method?: "CASH" | "EWALLET" | "OTHER" | null; amountMinor: number; reference?: string | null; note?: string | null; occurredAt: string; createdAt: string };
