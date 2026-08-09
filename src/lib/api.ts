export type ApiEnvelope<T> = { data: T; requestId?: string; meta?: unknown };
const baseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
let csrfTokenCache: string | null = null;
let csrfRefreshPromise: Promise<string | null> | null = null;

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

async function refreshCsrfToken() {
  if (typeof window === "undefined") return null;
  if (csrfRefreshPromise) return csrfRefreshPromise;
  const refresh = (async () => {
    const authResponse = await fetch(`${baseUrl}/auth/me`, { credentials: "include", cache: "no-store" });
    const authPayload = await authResponse.json().catch(() => ({}));
    const freshToken = authPayload?.data?.csrfToken;
    if (!authResponse.ok || !freshToken) return null;
    saveCsrfToken(freshToken);
    return freshToken;
  })();
  csrfRefreshPromise = refresh;
  try { return await refresh; } finally { if (csrfRefreshPromise === refresh) csrfRefreshPromise = null; }
}

export async function request<T>(path: string, init?: RequestInit, allowCsrfResync = true): Promise<T> {
  if (typeof window !== "undefined" && !path.startsWith("/auth/") && !path.startsWith("/sync/")) {
    const local = await import("./offline/repository");
    if (await local.hasLocalSnapshot()) return local.handleRequest("current", path, init) as Promise<T>;
  }
  const csrfToken = readCsrfToken();
  const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}), ...(csrfToken ? { "x-csrf-token": csrfToken } : {}) } });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403 && payload?.error?.code === "CSRF_INVALID" && allowCsrfResync && typeof window !== "undefined") {
    const freshToken = await refreshCsrfToken();
    if (freshToken) {
      return request(path, init, false);
    }
  }
  if (!response.ok) throw new Error(payload?.error?.message ?? "The request could not be completed.");
  if (payload?.data?.csrfToken) saveCsrfToken(payload.data.csrfToken);
  return (payload as ApiEnvelope<T>).data;
}

export const api = {
  me: () => request<{ user: { id: string; username: string; role: string } }>("/auth/me"),
  login: (username: string, password: string) => request<{ user: { id: string; username: string; role: string } }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: async () => { try { await refreshCsrfToken(); return await request<void>("/auth/logout", { method: "POST" }); } finally { csrfTokenCache = null; if (typeof window !== "undefined") { try { window.sessionStorage.removeItem("bq-csrf-token"); } catch { /* ignore storage cleanup failures */ } } } },
  sessions: () => request<SessionSummary[]>("/sessions"),
  createSession: (body: { name: string; sessionDate?: string }) => request<SessionSummary>("/sessions", { method: "POST", body: JSON.stringify(body) }),
  startSession: (id: string, version: number) => request<SessionSummary>(`/sessions/${id}/start`, { method: "POST", headers: { "if-match": String(version) }, body: "{}" }),
  resetSession: (id: string, version: number) => request<SessionSummary>(`/sessions/${id}/reset`, { method: "POST", headers: { "if-match": String(version) }, body: "{}" }),
  deleteSession: (id: string, version: number, playerDisposition: "KEEP" | "DELETE_ALL" = "KEEP") => request<void>(`/sessions/${id}`, { method: "DELETE", headers: { "if-match": String(version) }, body: JSON.stringify({ playerDisposition }) }),
  players: () => request<Player[]>("/players?status=ACTIVE"),
  playerDeletionPreview: (playerIds: string[]) => request<PlayerDeletionPreview>("/players/deletion-preview", { method: "POST", body: JSON.stringify({ playerIds }) }),
  deletePlayers: (playerIds: string[]) => request<PlayerDeletionResult>("/players/delete", { method: "POST", body: JSON.stringify({ playerIds }) }),
  createPlayer: (body: { displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string }) => request<Player>("/players", { method: "POST", body: JSON.stringify(body) }),
  addPlayers: (sessionId: string, playerIds: string[]) => request<SessionPlayer[]>(`/sessions/${sessionId}/players`, { method: "POST", body: JSON.stringify({ playerIds }) }),
  sessionPlayers: (sessionId: string) => request<SessionPlayer[]>(`/sessions/${sessionId}/players`),
  queue: (sessionId: string) => request<QueueState>(`/sessions/${sessionId}/queue`),
  courts: (sessionId: string) => request<Court[]>(`/sessions/${sessionId}/courts`),
  createCourt: (sessionId: string, name: string) => request<Court>(`/sessions/${sessionId}/courts`, { method: "POST", body: JSON.stringify({ name }) }),
  updateCourt: (sessionId: string, courtId: string, body: { name?: string; status?: "AVAILABLE" | "CLOSED" }) => request<Court>(`/sessions/${sessionId}/courts/${courtId}`, { method: "PATCH", body: JSON.stringify(body) }),
  checkIn: (sessionId: string, sessionPlayerId: string) => request<SessionPlayer>(`/sessions/${sessionId}/players/${sessionPlayerId}/check-in`, { method: "POST", body: "{}" }),
  restPlayer: (sessionId: string, sessionPlayerId: string) => request<SessionPlayer>(`/sessions/${sessionId}/players/${sessionPlayerId}/rest`, { method: "POST", body: "{}" }),
  resumePlayer: (sessionId: string, sessionPlayerId: string) => request<SessionPlayer>(`/sessions/${sessionId}/players/${sessionPlayerId}/resume`, { method: "POST", body: "{}" }),
  checkOut: (sessionId: string, sessionPlayerId: string) => request<SessionPlayer>(`/sessions/${sessionId}/players/${sessionPlayerId}/check-out`, { method: "POST", body: "{}" }),
  suggestions: (sessionId: string, mode: string, excludeKeys: string[] = []) => request<{ suggestion: Suggestion | null; cycleRestarted: boolean; noMatch?: { code: string; message: string } }>(`/sessions/${sessionId}/suggestions`, { method: "POST", body: JSON.stringify({ mode, excludeKeys }) }),
  createManualMatch: (sessionId: string, body: { teamA: string[]; teamB: string[]; courtId?: string }) => request<Match>(`/sessions/${sessionId}/matches`, { method: "POST", body: JSON.stringify(body) }),
  queueManualMatch: (sessionId: string, teamA: string[], teamB: string[]) => request<Match>(`/sessions/${sessionId}/matches`, { method: "POST", body: JSON.stringify({ teamA, teamB }) }),
  startManualMatch: (sessionId: string, teamA: string[], teamB: string[], courtId: string) => request<Match>(`/sessions/${sessionId}/matches`, { method: "POST", body: JSON.stringify({ teamA, teamB, courtId }) }),
  createSuggestedMatch: (sessionId: string, body: { teamA: string[]; teamB: string[]; suggestionToken: string; courtId?: string }) => request<Match>(`/sessions/${sessionId}/matches`, { method: "POST", body: JSON.stringify(body) }),
  startMatch: (matchId: string, courtId: string) => request<Match>(`/matches/${matchId}/start`, { method: "POST", body: JSON.stringify({ courtId }) }),
  startSuggestedMatch: (sessionId: string, body: { teamA: string[]; teamB: string[]; courtId: string; suggestionToken: string }) => request<Match>(`/sessions/${sessionId}/matches/start-suggestion`, { method: "POST", body: JSON.stringify(body) }),
  completeMatch: (matchId: string, games: { teamAScore: number; teamBScore: number }[]) => request<Match>(`/matches/${matchId}/complete`, { method: "POST", body: JSON.stringify({ games }) }),
  cancelMatch: (matchId: string) => request<Match>(`/matches/${matchId}/cancel`, { method: "POST", body: "{}" }),
  matches: (sessionId: string) => request<Match[]>(`/sessions/${sessionId}/matches`),
  history: (sessionId: string, page = 1, pageSize = 15, search = "") => request<HistoryResponse>(`/sessions/${sessionId}/history?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(search ? { search } : {}) }).toString()}`),
  playerHistory: (sessionId: string, sessionPlayerId: string, page = 1, pageSize = 15) => request<PlayerHistoryResponse>(`/sessions/${sessionId}/players/${sessionPlayerId}/history?page=${page}&pageSize=${pageSize}`),
  rankings: (sessionId: string) => request<Ranking[]>(`/sessions/${sessionId}/rankings`),
  careerRankings: () => request<CareerRanking[]>("/rankings/career"),
  fees: (sessionId: string) => request<FeeSummary>(`/sessions/${sessionId}/fees`),
  updateFeeConfig: (sessionId: string, body: { mode: "FIXED_PER_PLAYER" | "EQUAL_SPLIT"; fixedAmountPerPlayerMinor?: number | null; expectedSessionCostMinor?: number | null }) => request<{ config: FeeConfig; summary: FeeSummary }>(`/sessions/${sessionId}/fees/config`, { method: "PUT", body: JSON.stringify(body) }),
  payments: (sessionId: string) => request<Payment[]>(`/sessions/${sessionId}/payments`),
  createPayment: (sessionId: string, body: { sessionPlayerId: string; kind: "COLLECTION" | "WAIVER"; amountMinor: number; method?: "CASH" | "EWALLET" | "OTHER"; reference?: string; note?: string }) => request<{ payment: Payment; summary: FeeSummary; replayed: boolean }>(`/sessions/${sessionId}/payments`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) }),
  syncStatus: () => request<{ cloudRevision: number; lastSyncedAt?: string | null; lastDeviceId?: string | null; schemaVersion: number }>("/sync/status"),
  syncSnapshot: () => request<{ snapshot: unknown; checksum: string; cloudRevision: number; schemaVersion: number }>("/sync/snapshot"),
  uploadSnapshot: (body: unknown) => request<{ cloudRevision: number; lastSyncedAt?: string | null; alreadyApplied?: boolean }>("/sync/snapshot", { method: "PUT", body: JSON.stringify(body) }),
};

export type SessionSummary = { id: string; name: string; sessionDate: string; status: string; startedAt?: string | null; endedAt?: string | null; version: number; playerCount?: number; courtCount?: number; scoring: { pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: number } };
export type Player = { id: string; displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string; skillWeight: number; status: string; version?: number };
export type PlayerDeletionBusyPlayer = { playerId: string; sessionPlayerId: string; displayName: string; sessionId: string; status: string };
export type PlayerDeletionPreview = { playerIds: string[]; playerNames: string[]; busyPlayers: PlayerDeletionBusyPlayer[]; affectedSessionIds: string[]; affectedSessions?: { id: string; name: string; status: string }[]; affectedMatchIds: string[]; affectedPaymentIds: string[]; otherParticipantPlayerIds: string[]; otherParticipantSessionPlayerIds: string[]; affectedMatchCount?: number; affectedPaymentCount?: number };
export type PlayerDeletionResult = { deletedPlayerIds: string[]; affectedSessionIds: string[]; affectedMatchCount: number; affectedPaymentCount: number; otherParticipantPlayerIds: string[] };
export type SessionPlayer = { id: string; playerId?: string; displayName: string; gender: string; skillLevel: string; skillWeight: number; status: string; matchesPlayed: number; wins: number; losses: number; pointsFor?: number; pointsAgainst?: number; amountDueMinor?: number; manualPriority?: number; queueEnteredAt?: string; currentMatchId?: string | null };
export type QueueState = { inactive: SessionPlayer[]; waiting: SessionPlayer[]; queued: SessionPlayer[]; playing: SessionPlayer[]; resting: SessionPlayer[]; serverTime: string };
export type Court = { id: string; name: string; status: "AVAILABLE" | "OCCUPIED" | "PAUSED" | "CLOSED"; displayOrder: number; currentMatchId?: string | null };
export type Suggestion = { token: string; expiresAt: number; key: string; difference: number; teamATotal: number; teamBTotal: number; teamA: SessionPlayer[]; teamB: SessionPlayer[]; explanation: { repeatPenalties?: Record<string, number>; skillDiversity?: { groupSpread?: number; partnerMix?: number }; fairness?: { minimumGames?: number; minimumGamesCount?: number; manualOverride?: boolean }; partnerRotation?: { recentRepeats?: number; allTimeRepeats?: number; preservedTeamBalance?: boolean }; algorithmVersion?: string; cycleRestarted?: boolean } };
export type Match = { id: string; sessionId: string; status: string; courtId?: string | null; startedAt?: string | null; completedAt?: string | null; queuedAt?: string; winnerTeam?: string | null; cancellationReason?: string | null; participants: { id?: string; sessionPlayerId?: string; displayName?: string; team: string; teamSlot?: number }[] };
export type HistoryParticipant = { sessionPlayerId: string; playerId?: string; displayName: string; gender: string; skillLevel: string; team: "A" | "B"; teamSlot: number };
export type HistoryGame = { gameNumber: number; teamAScore: number; teamBScore: number; winnerTeam: "A" | "B" };
export type HistoryMatch = { id: string; sessionId: string; source: string; matchmakingMode?: string | null; format: "SINGLES" | "DOUBLES"; court: { id: string; name: string } | null; startedAt?: string | null; completedAt?: string | null; durationSeconds: number | null; winnerTeam: "A" | "B" | null; score: { revisionNumber: number; winnerTeam: "A" | "B"; games: HistoryGame[] } | null; participants: HistoryParticipant[] };
export type HistoryPagination = { page: number; pageSize: number; total: number; totalPages: number };
export type HistoryResponse = { items: HistoryMatch[]; pagination: HistoryPagination };
export type FrequentPlayer = { count: number; displayName: string; sessionPlayerId: string };
export type PlayerHistoryStats = { matchesPlayed: number; wins: number; losses: number; winRateBasisPoints: number; pointsFor: number; pointsAgainst: number; pointDifferential: number; averageDurationSeconds: number | null; mostPlayedPartner: FrequentPlayer | null; mostPlayedOpponent: FrequentPlayer | null };
export type PlayerHistoryResponse = { player: { sessionPlayerId: string; playerId: string; displayName: string; gender: string; skillLevel: string }; stats: PlayerHistoryStats; items: HistoryMatch[]; pagination: HistoryPagination };
export type CareerRanking = { rank: number; player: string; playerId: string; matchesPlayed: number; wins: number; losses: number; winRateBasisPoints: number; pointsFor: number; pointsAgainst: number; pointDifferential: number };
export type Ranking = { rank: number; sessionPlayerId: string; player: string; playerId: string; gender: string; skillLevel: string; matchesPlayed: number; wins: number; losses: number; winRateBasisPoints: number; pointsFor: number; pointsAgainst: number; pointDifferential: number };
export type FeeConfig = { id: string; sessionId: string; mode: "FIXED_PER_PLAYER" | "EQUAL_SPLIT"; currencyCode: string; fixedAmountPerPlayerMinor?: number | null; expectedSessionCostMinor?: number | null; participationRule: string; frozenAt?: string | null; version: number };
export type PaymentMethod = "CASH" | "EWALLET" | "OTHER";
export type FeePlayer = { sessionPlayerId: string; displayName: string; dueMinor: number; collectedMinor: number; waivedMinor: number; outstandingMinor: number; status: "WAIVED" | "PAID" | "PARTIAL" | "UNPAID"; collectionByMethodMinor: Record<PaymentMethod, number> };
export type FeeSummary = { config: FeeConfig | null; expectedMinor: number; collectedMinor: number; outstandingMinor: number; paymentCount: number; players: FeePlayer[] };
export type Payment = { id: string; sessionId: string; sessionPlayerId: string; kind: "COLLECTION" | "REFUND" | "WAIVER" | "WAIVER_REVERSAL"; method?: "CASH" | "EWALLET" | "OTHER" | null; amountMinor: number; reference?: string | null; note?: string | null; occurredAt: string; createdAt: string };
