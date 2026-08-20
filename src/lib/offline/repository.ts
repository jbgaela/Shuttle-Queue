import type { CloudSnapshotV2, DomainMatch, DomainPlayer, DomainQueuePlayer, MatchHistory, MatchPlayer, ScoreSettings, SyncMetadata } from "./domain-compat";
import { applyPlayerDeletion, historyDurationSeconds, normalizeText, suggestMatch, validateScores } from "./domain-compat";
import type { Court, FeeSummary, HistoryMatch, HistoryResponse, Match, Payment, Player, PlayerHistoryResponse, QueueState, QueuePlayer, Ranking, Suggestion, WorkspaceSummary } from "../api";
import { request } from "../api";
import { hasPlayerNameConflict } from "../player-names";
import { appendAudit, clearAccountData, completeSnapshotUpload, firstProfile, getDeviceId, getMeta, hasSnapshot, markSyncAttention, offlineDb, prepareSnapshotUpload, readSnapshot, replaceSnapshot, saveProfile, storageEstimate, updateLocalSnapshot } from "./db";
import { singleFlightByKey } from "./sync-flight";
import type { SyncPreview } from "./sync-plan";
import { datePartsForInstant, instantForLocalDateTime } from "../timezone";


const id = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const uploadFlights = new Map<string, Promise<{ state: "uploaded"; cloudRevision: number }>>();
const now = () => new Date().toISOString();
const PLAYER_NAME_CONFLICT_MESSAGE = "A player with this name has already been created or is already in the current queue.";
const skillWeights: Record<string, number> = { NEWBIE: 1, BEGINNER: 2, INTERMEDIATE: 3, UPPER_INTERMEDIATE: 4, ADVANCED: 5 };
const parseBody = (init?: RequestInit) => { try { return init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}; } catch { return {}; } };
const parts = (path: string) => path.split("?")[0]!.split("/").filter(Boolean);
const params = (path: string) => new URLSearchParams(path.split("?")[1] ?? "");
const clone = <T,>(value: T): T => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
const page = <T,>(items: T[], path: string) => { const current = Math.max(1, Number(params(path).get("page") ?? 1)); const size = Math.max(1, Math.min(100, Number(params(path).get("pageSize") ?? 15))); const total = items.length; return { items: items.slice((current - 1) * size, current * size), pagination: { page: current, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) } }; };
const scoreFor = (match: DomainMatch) => match.scoreRevisions.find((revision) => revision.id === match.currentRevisionId) ?? [...match.scoreRevisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
const findQueuePlayer = (snapshot: CloudSnapshotV2, value: string) => snapshot.queuePlayers.find((player) => player.id === value);
const findCourt = (snapshot: CloudSnapshotV2, value?: string) => snapshot.courts.find((court) => court.id === value);
function reconcileOfflinePlayers(snapshot: CloudSnapshotV2, queuePlayerIds: string[], releaseAt = now()) {
  const ids = [...new Set(queuePlayerIds)];
  for (const queuePlayerId of ids) {
    const player = findQueuePlayer(snapshot, queuePlayerId);
    if (!player) continue;
    const active = snapshot.matches.filter((match) => match.status === "IN_PROGRESS" && match.participants.some((participant) => participant.queuePlayerId === queuePlayerId));
    if (active.length > 1) throw new Error("A player cannot be in more than one active match.");
    const queued = snapshot.matches.filter((match) => match.status === "QUEUED" && match.participants.some((participant) => participant.queuePlayerId === queuePlayerId)).sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)) || a.id.localeCompare(b.id));
    const nextStatus = active.length ? "PLAYING" : queued.length ? "QUEUED" : "WAITING";
    player.status = nextStatus;
    player.currentMatchId = active[0]?.id ?? queued[0]?.id ?? null;
    player.queueEnteredAt = nextStatus === "WAITING" ? releaseAt : player.queueEnteredAt ?? null;
    player.version += 1;
  }
}
const captureCourtSnapshot = (match: DomainMatch, court: CloudSnapshotV2["courts"][number]) => { match.courtIdSnapshot = court.id; match.courtNameSnapshot = court.name; match.suggestionExplanation = { ...(typeof match.suggestionExplanation === "object" && match.suggestionExplanation ? match.suggestionExplanation as Record<string, unknown> : {}), __courtSnapshot: { id: court.id, name: court.name } }; };
const preserveCourtSnapshot = (match: DomainMatch, court: CloudSnapshotV2["courts"][number]) => { captureCourtSnapshot(match, court); match.courtId = null; };
const settings = (snapshot: CloudSnapshotV2): ScoreSettings => ({ pointsToWin: snapshot.settings?.pointsToWin ?? 21, winBy: snapshot.settings?.winBy ?? 2, scoreCap: snapshot.settings?.scoreCap ?? null, bestOf: (snapshot.settings?.bestOf ?? 1) as 1 | 3 });
const minimumRestMinutes = (snapshot: CloudSnapshotV2) => snapshot.settings?.minimumRestMinutes ?? 0;
const restEligibleAt = (player: DomainQueuePlayer, snapshot: CloudSnapshotV2, reference = Date.now()) => {
  const ended = player.lastMatchEndedAt ? Date.parse(player.lastMatchEndedAt) : NaN;
  return !Number.isFinite(ended) || minimumRestMinutes(snapshot) <= 0 ? new Date(reference).toISOString() : new Date(ended + minimumRestMinutes(snapshot) * 60_000).toISOString();
};
const playerView = (player: DomainQueuePlayer, snapshot?: CloudSnapshotV2): QueuePlayer => ({ id: player.id, playerId: player.playerId, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel, skillWeight: player.skillWeight, status: player.status, matchesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, pointsFor: player.pointsFor, pointsAgainst: player.pointsAgainst, amountDueMinor: player.amountDueMinor ?? 0, manualPriority: player.manualPriority ?? 0, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, restEligibleAt: snapshot ? restEligibleAt(player, snapshot) : null, checkedInAt: player.checkedInAt ?? null, checkedOutAt: player.checkedOutAt ?? null, currentMatchId: player.currentMatchId ?? null, latePenaltyState: player.latePenaltyState ?? null, latePenaltyAppliedAt: player.latePenaltyAppliedAt ?? null, version: player.version });
const workspaceView = (snapshot: CloudSnapshotV2): WorkspaceSummary => ({ id: "workspace", name: "Current queue", sessionDate: snapshot.workspace.startedAt, startedAt: snapshot.workspace.startedAt, endedAt: snapshot.workspace.endedAt ?? null, status: snapshot.workspace.endedAt ? "ENDED" : "ACTIVE", lateArrivalCutoffAt: snapshot.workspace.lateArrivalCutoffAt ?? null, version: snapshot.workspace.version, playerCount: snapshot.queuePlayers.length, courtCount: snapshot.courts.length, scoring: settings(snapshot), feeConfig: snapshot.feeConfig as any });
const courtView = (court: CloudSnapshotV2["courts"][number]): Court => ({ id: court.id, name: court.name, status: court.status, displayOrder: court.displayOrder, currentMatchId: court.currentMatchId ?? null, version: court.version });
const matchView = (snapshot: CloudSnapshotV2, match: DomainMatch): Match => ({ id: match.id, status: match.status, source: match.source, courtId: match.courtId ?? null, matchmakingMode: match.matchmakingMode ?? null, algorithmVersion: match.algorithmVersion ?? null, suggestionKey: match.suggestionKey ?? null, suggestionExplanation: match.suggestionExplanation ?? null, queuedAt: match.queuedAt, startedAt: match.startedAt ?? null, completedAt: match.completedAt ?? null, winnerTeam: match.winnerTeam ?? null, cancellationReason: match.cancellationReason ?? null, version: match.version, scoring: { pointsToWin: match.pointsToWin, winBy: match.winBy, scoreCap: match.scoreCap, bestOf: match.bestOf }, participants: match.participants.map((participant) => ({ id: participant.id, queuePlayerId: participant.queuePlayerId, displayName: findQueuePlayer(snapshot, participant.queuePlayerId)?.displayName, playerStatus: findQueuePlayer(snapshot, participant.queuePlayerId)?.status, lastMatchEndedAt: findQueuePlayer(snapshot, participant.queuePlayerId)?.lastMatchEndedAt ?? null, team: participant.team, teamSlot: participant.teamSlot })) } as Match);
const feeSummary = (snapshot: CloudSnapshotV2): FeeSummary => {
  const payments = snapshot.payments;
  const players = snapshot.queuePlayers.map((player) => {
    const rows = payments.filter((payment) => payment.queuePlayerId === player.id);
    const collected = rows.filter((payment) => payment.kind === "COLLECTION").reduce((sum, payment) => sum + payment.amountMinor, 0);
    const waived = rows.filter((payment) => payment.kind === "WAIVER").reduce((sum, payment) => sum + payment.amountMinor, 0);
    const methods = { CASH: 0, EWALLET: 0, OTHER: 0 } as Record<string, number>;
    rows.filter((payment) => payment.kind === "COLLECTION" && payment.method).forEach((payment) => { methods[payment.method!] = (methods[payment.method!] ?? 0) + payment.amountMinor; });
    const outstanding = Math.max(0, (player.amountDueMinor ?? 0) - collected - waived);
    return { queuePlayerId: player.id, displayName: player.displayName, dueMinor: player.amountDueMinor ?? 0, collectedMinor: collected, waivedMinor: waived, outstandingMinor: outstanding, status: waived >= (player.amountDueMinor ?? 0) ? "WAIVED" : outstanding === 0 ? "PAID" : collected > 0 ? "PARTIAL" : "UNPAID", collectionByMethodMinor: methods };
  });
  return { config: snapshot.feeConfig as any, expectedMinor: players.reduce((sum, player) => sum + player.dueMinor, 0), collectedMinor: players.reduce((sum, player) => sum + player.collectedMinor, 0), outstandingMinor: players.reduce((sum, player) => sum + player.outstandingMinor, 0), paymentCount: payments.length, players } as FeeSummary;
};
const historyMatches = (snapshot: CloudSnapshotV2, search = "") => snapshot.matches.filter((match) => match.status === "COMPLETED").filter((match) => !search || match.participants.some((participant) => (findQueuePlayer(snapshot, participant.queuePlayerId)?.displayName ?? "").toLowerCase().includes(search.toLowerCase()))).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
const historyView = (snapshot: CloudSnapshotV2, match: DomainMatch): HistoryMatch => { const revision = scoreFor(match); const court = findCourt(snapshot, match.courtId ?? undefined); const courtHistory = match.courtIdSnapshot && match.courtNameSnapshot ? { id: match.courtIdSnapshot, name: match.courtNameSnapshot } : court ? { id: court.id, name: court.name } : null; return { id: match.id, source: match.source, matchmakingMode: match.matchmakingMode ?? null, format: match.participants.length === 4 ? "DOUBLES" : "SINGLES", court: courtHistory, startedAt: match.startedAt ?? null, completedAt: match.completedAt ?? null, durationSeconds: historyDurationSeconds(match.startedAt, match.completedAt), winnerTeam: match.winnerTeam ?? null, score: revision ? { revisionNumber: revision.revisionNumber, winnerTeam: revision.winnerTeam, games: revision.games } : null, participants: match.participants.map((participant) => { const player = findQueuePlayer(snapshot, participant.queuePlayerId); return { queuePlayerId: participant.queuePlayerId, playerId: player?.playerId, displayName: player?.displayName ?? "Unknown", gender: player?.gender ?? "", skillLevel: player?.skillLevel ?? "", team: participant.team, teamSlot: participant.teamSlot }; }) } as HistoryMatch; };
const queueState = (snapshot: CloudSnapshotV2): QueueState => { const values = snapshot.queuePlayers.map((player) => playerView(player, snapshot)); return { serverTime: now(), minimumRestMinutes: minimumRestMinutes(snapshot), lateArrivalCutoffAt: snapshot.workspace.lateArrivalCutoffAt ?? null, inactive: values.filter((player) => ["INACTIVE", "CHECKED_OUT"].includes(player.status)), waiting: values.filter((player) => player.status === "WAITING"), queued: values.filter((player) => player.status === "QUEUED"), playing: values.filter((player) => player.status === "PLAYING"), resting: values.filter((player) => player.status === "RESTING") }; };

async function mutate<T>(accountId: string, action: string, update: (snapshot: CloudSnapshotV2) => T | Promise<T>) {
  const allowedAfterEnd = new Set(["WORKSPACE_RESET", "WORKSPACE_ENDED", "PAYMENT_CREATED", "PLAYER_CREATED", "PLAYER_UPDATED", "PLAYERS_DELETED"]);
  const result = await updateLocalSnapshot(accountId, (snapshot) => {
    if (snapshot.workspace.endedAt && !allowedAfterEnd.has(action)) throw new Error("This queue session has ended. Start a fresh queue before continuing operations.");
    return update(snapshot);
  });
  if (action !== "WORKSPACE_RESET") await appendAudit(accountId, { action, entityType: "ACCOUNT", entityId: accountId, reason: "Recorded offline" });
  return result;
}
async function addPlayers(accountId: string, body: Record<string, unknown>) { return mutate(accountId, "PLAYERS_ADDED", (snapshot) => { const ids = [...new Set((Array.isArray(body.playerIds) ? body.playerIds : []).map(String))]; const result: DomainQueuePlayer[] = []; for (const playerId of ids) { const player = snapshot.players.find((item) => item.id === playerId && item.status === "ACTIVE"); if (!player || snapshot.queuePlayers.some((item) => item.playerId === playerId)) throw new Error("Every selected player must be active and not already in the current queue."); const created: DomainQueuePlayer = { id: id(), playerId, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel as DomainQueuePlayer["skillLevel"], skillWeight: player.skillWeight, status: "INACTIVE", matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, amountDueMinor: 0, manualPriority: 0, priorityReason: null, latePenaltyState: null, latePenaltyAppliedAt: null, queueEnteredAt: null, lastMatchEndedAt: null, currentMatchId: null, checkedInAt: null, checkedOutAt: null, restStartedAt: null, version: 1 }; snapshot.queuePlayers.push(created); result.push(created); } return result.map((player) => playerView(player, snapshot)); }); }
async function transition(accountId: string, queuePlayerId: string, status: DomainQueuePlayer["status"], action: string) { return mutate(accountId, action, (snapshot) => { const player = findQueuePlayer(snapshot, queuePlayerId); if (!player) throw new Error("Queue player not found."); if (action === "LATE_PENALTY_WAIVED") { player.latePenaltyState = "WAIVED"; player.version += 1; return playerView(player); } const changedAt = now(); if (action === "QUEUE_PLAYER_CHECK_IN") { const late = Boolean(snapshot.workspace.lateArrivalCutoffAt && Date.parse(changedAt) > Date.parse(snapshot.workspace.lateArrivalCutoffAt) && !player.latePenaltyState); player.status = "WAITING"; player.checkedInAt = player.checkedInAt ?? changedAt; player.checkedOutAt = null; player.queueEnteredAt = changedAt; if (late) { player.latePenaltyState = "PENDING"; player.latePenaltyAppliedAt = changedAt; } } else { player.status = status; player.checkedInAt = player.checkedInAt ?? (status === "WAITING" ? changedAt : null); player.checkedOutAt = status === "CHECKED_OUT" ? changedAt : status === "WAITING" ? null : player.checkedOutAt ?? null; player.restStartedAt = status === "RESTING" ? changedAt : null; player.queueEnteredAt = status === "WAITING" ? changedAt : null; } player.version += 1; return playerView(player); }); }
async function bulkQueueAction(accountId: string, body: Record<string, unknown>) {
  return mutate(accountId, "QUEUE_PLAYERS_BULK_ACTION", (snapshot) => {
    const ids = Array.isArray(body.playerIds) ? body.playerIds.map(String) : [];
    const action = String(body.action ?? "");
    if (!ids.length || ids.length > 100) throw new Error("Select between one and 100 players.");
    if (new Set(ids).size !== ids.length) throw new Error("Each player can only be selected once.");
    const players = ids.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId));
    if (players.some((player) => !player)) throw new Error("One or more selected players could not be found.");
    const allowed = action === "CHECK_IN" ? ["INACTIVE", "CHECKED_OUT"] : action === "REST" ? ["WAITING"] : action === "CHECK_OUT" ? ["WAITING", "RESTING"] : [];
    if (!allowed.length) throw new Error("The requested queue action is invalid.");
    const invalid = players.filter((player): player is undefined | DomainQueuePlayer => !player || !allowed.includes(player.status)).filter((player): player is DomainQueuePlayer => Boolean(player));
    if (invalid.length) throw new Error("One or more selected players are no longer eligible for this action.");
    const changedAt = now();
    for (const player of players as DomainQueuePlayer[]) {
      if (action === "CHECK_IN") {
        const late = Boolean(snapshot.workspace.lateArrivalCutoffAt && Date.parse(changedAt) > Date.parse(snapshot.workspace.lateArrivalCutoffAt) && !player.latePenaltyState);
        player.status = "WAITING";
        player.checkedInAt = player.checkedInAt ?? changedAt;
        player.checkedOutAt = null;
        player.queueEnteredAt = changedAt;
        if (late) { player.latePenaltyState = "PENDING"; player.latePenaltyAppliedAt = changedAt; }
      } else if (action === "REST") {
        player.status = "RESTING";
        player.restStartedAt = changedAt;
      } else {
        player.status = "CHECKED_OUT";
        player.checkedOutAt = changedAt;
        player.queueEnteredAt = null;
      }
      player.version += 1;
    }
    return players.map((player) => playerView(player!));
  });
}
async function makeSuggestion(accountId: string, body: Record<string, unknown>) {
  const snapshot = await readSnapshot(accountId);
  if (!snapshot) throw new Error("Download this account before working offline.");
  const input: MatchPlayer[] = snapshot.queuePlayers.filter((player) => player.status === "WAITING").map((player) => ({ id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: player.skillWeight, skillLevel: player.skillLevel, status: player.status, gamesPlayed: player.matchesPlayed, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null }));
  const mode = String(body.mode) as never;
  const strengthGap = mode === "BALANCED" && [1, 2, 3].includes(Number(body.strengthGap)) ? Number(body.strengthGap) as 1 | 2 | 3 : mode === "BALANCED" ? 1 : undefined;
  const excludedKeys = Array.isArray(body.excludeKeys) ? body.excludeKeys.map(String) : [];
  const history: MatchHistory = { partners: new Map(), opponents: new Map(), quartets: new Map(), recentPartners: new Map(), recentOpponents: new Map(), recentQuartets: new Map() };
  const completed = snapshot.matches.filter((match) => match.status === "COMPLETED").sort((a, b) => String(b.completedAt ?? "").localeCompare(String(a.completedAt ?? "")));
  const recentByPlayer = new Map<string, number>();
  const increment = (map: Map<string, Map<string, number>>, a: string, b: string) => { const row = map.get(a) ?? new Map<string, number>(); row.set(b, (row.get(b) ?? 0) + 1); map.set(a, row); };
  const incrementQuartet = (map: Map<string, number>, ids: string[]) => { const key = [...ids].sort().join("|"); map.set(key, (map.get(key) ?? 0) + 1); };
  for (const match of completed) {
    const participants = match.participants;
    const ids = participants.map((participant) => participant.queuePlayerId);
    incrementQuartet(history.quartets, ids);
    const recent = participants.some((participant) => (recentByPlayer.get(participant.queuePlayerId) ?? 0) < 3);
    if (recent) incrementQuartet(history.recentQuartets!, ids);
    for (const participant of participants) {
      const teammates = participants.filter((other) => other.team === participant.team && other.queuePlayerId !== participant.queuePlayerId);
      const opponents = participants.filter((other) => other.team !== participant.team);
      for (const teammate of teammates) { increment(history.partners, participant.queuePlayerId, teammate.queuePlayerId); if ((recentByPlayer.get(participant.queuePlayerId) ?? 0) < 3) increment(history.recentPartners!, participant.queuePlayerId, teammate.queuePlayerId); }
      for (const opponent of opponents) { increment(history.opponents, participant.queuePlayerId, opponent.queuePlayerId); if ((recentByPlayer.get(participant.queuePlayerId) ?? 0) < 3) increment(history.recentOpponents!, participant.queuePlayerId, opponent.queuePlayerId); }
    }
    for (const participant of participants) recentByPlayer.set(participant.queuePlayerId, (recentByPlayer.get(participant.queuePlayerId) ?? 0) + 1);
  }
  const options = mode === "BALANCED" ? { strengthGap: strengthGap as 1 | 2 | 3, minimumRestMinutes: minimumRestMinutes(snapshot), now: new Date() } : { minimumRestMinutes: minimumRestMinutes(snapshot), now: new Date() };
  let suggestion = suggestMatch(input, mode, history, excludedKeys, options);
  let cycleRestarted = false;
  if (!suggestion && excludedKeys.length) {
    suggestion = suggestMatch(input, mode, history, [], options);
    cycleRestarted = Boolean(suggestion);
  }
  if (!suggestion) {
    const waiting = snapshot.queuePlayers.filter((player) => player.status === "WAITING");
    const ready = waiting.filter((player) => Date.parse(restEligibleAt(player, snapshot)) <= Date.now());
    const nextEligibleAt = waiting.map((player) => restEligibleAt(player, snapshot)).filter((value) => Date.parse(value) > Date.now()).sort()[0] ?? null;
    const restBlocked = waiting.length >= 4 && ready.length < 4 && minimumRestMinutes(snapshot) > 0;
    const message = restBlocked ? "Some players are still completing their required rest period." : mode === "BALANCED" ? `No balanced lineup is available with player and team strength gaps of ${strengthGap} or less. Wait for more eligible players or use Manual mode.` : "No eligible group satisfies this mode.";
    return { suggestion: null, cycleRestarted: false, noMatch: { code: restBlocked ? "REST_REQUIRED" : "NO_VALID_GROUP", message, nextEligibleAt } };
  }
  const convert = (player: MatchPlayer) => playerView(findQueuePlayer(snapshot, player.id)!, snapshot);
  const result: Suggestion = { token: `local:${id()}`, expiresAt: Date.now() + 300000, key: suggestion.key, difference: suggestion.difference, teamATotal: suggestion.teamATotal, teamBTotal: suggestion.teamBTotal, lateArrivalCutoffAt: snapshot.workspace.lateArrivalCutoffAt ?? null, teamA: suggestion.teamA.map(convert), teamB: suggestion.teamB.map(convert), explanation: suggestion.explanation as Suggestion["explanation"] };
  return { suggestion: result, cycleRestarted };
}
async function createMatchLegacy(accountId: string, body: Record<string, unknown>) { return mutate(accountId, "MATCH_CREATED", (snapshot) => { const teamA = Array.isArray(body.teamA) ? body.teamA.map(String) : []; const teamB = Array.isArray(body.teamB) ? body.teamB.map(String) : []; if (![1, 2].includes(teamA.length) || teamA.length !== teamB.length || new Set([...teamA, ...teamB]).size !== teamA.length + teamB.length) throw new Error("Choose one player per team for singles or two per team for doubles."); const court = body.courtId ? findCourt(snapshot, String(body.courtId)) : undefined; if (body.courtId && (!court || court.status !== "AVAILABLE" || court.currentMatchId)) throw new Error("The selected court is not available."); const match: DomainMatch = { id: id(), courtId: court?.id ?? null, courtIdSnapshot: court?.id ?? null, courtNameSnapshot: court?.name ?? null, status: court ? "IN_PROGRESS" : "QUEUED", source: body.suggestionToken ? "AUTOMATIC" : "MANUAL", matchmakingMode: null, algorithmVersion: body.suggestionToken ? "v2-rotation" : null, suggestionKey: typeof body.suggestionToken === "string" ? body.suggestionToken : null, suggestionExplanation: null, pointsToWin: settings(snapshot).pointsToWin, winBy: settings(snapshot).winBy, scoreCap: settings(snapshot).scoreCap, bestOf: settings(snapshot).bestOf, queuedAt: now(), startedAt: court ? now() : null, completedAt: null, cancelledAt: null, cancellationReason: null, winnerTeam: null, currentRevisionId: null, version: 1, participants: [...teamA.map((queuePlayerId, index) => ({ id: id(), matchId: "", queuePlayerId, team: "A" as const, teamSlot: index + 1, priorQueueEnteredAt: findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null })), ...teamB.map((queuePlayerId, index) => ({ id: id(), matchId: "", queuePlayerId, team: "B" as const, teamSlot: index + 1, priorQueueEnteredAt: findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null }))], scoreRevisions: [] }; match.participants.forEach((participant) => { participant.matchId = match.id; const player = findQueuePlayer(snapshot, participant.queuePlayerId); if (player) { player.status = court ? "PLAYING" : "QUEUED"; player.currentMatchId = match.id; player.queueEnteredAt = null; player.version += 1; } }); if (court) { court.status = "OCCUPIED"; court.currentMatchId = match.id; court.version += 1; } snapshot.matches.push(match); snapshot.workspace.matchmakingRevision += 1; snapshot.workspace.version += 1; return matchView(snapshot, match); }); }
async function finishMatchLegacy(accountId: string, matchId: string, games: Array<{ teamAScore: number; teamBScore: number }>) { return mutate(accountId, "MATCH_COMPLETED", (snapshot) => { const match = snapshot.matches.find((item) => item.id === matchId); if (!match || match.status !== "IN_PROGRESS") throw new Error("Only playing matches can be completed."); const validated = validateScores(games, { pointsToWin: match.pointsToWin, winBy: match.winBy, scoreCap: match.scoreCap, bestOf: match.bestOf }); const aWins = validated.filter((game) => game.winnerTeam === "A").length; const winnerTeam: "A" | "B" = aWins > validated.length / 2 ? "A" : "B"; const revisionId = id(); const completedAt = now(); match.status = "COMPLETED"; match.completedAt = completedAt; match.winnerTeam = winnerTeam; match.currentRevisionId = revisionId; match.scoreRevisions.push({ id: revisionId, matchId, revisionNumber: 1, winnerTeam, reason: null, supersedesRevisionId: null, createdAt: now(), games: validated.map((game, index) => ({ id: id(), scoreRevisionId: revisionId, gameNumber: index + 1, teamAScore: game.teamAScore, teamBScore: game.teamBScore, winnerTeam: game.winnerTeam })) }); const court = findCourt(snapshot, match.courtId ?? undefined); if (court?.currentMatchId === match.id) { court.currentMatchId = null; court.status = court.status === "CLOSED" ? "CLOSED" : "AVAILABLE"; court.version += 1; } match.participants.forEach((participant) => { const player = findQueuePlayer(snapshot, participant.queuePlayerId); if (!player) return; const won = participant.team === winnerTeam; player.status = "WAITING"; player.currentMatchId = null; player.queueEnteredAt = now(); player.matchesPlayed += 1; player.wins += won ? 1 : 0; player.losses += won ? 0 : 1; player.lastMatchEndedAt = completedAt; player.version += 1; }); return matchView(snapshot, match); }); }

async function createMatchStacked(accountId: string, body: Record<string, unknown>) {
  return mutate(accountId, "MATCH_CREATED", (snapshot) => {
    const teamA = Array.isArray(body.teamA) ? body.teamA.map(String) : [];
    const teamB = Array.isArray(body.teamB) ? body.teamB.map(String) : [];
    const ids = [...teamA, ...teamB];
    if (![1, 2].includes(teamA.length) || teamA.length !== teamB.length || new Set(ids).size !== ids.length) throw new Error("Choose one player per team for singles or two per team for doubles.");
    const manualQueue = !body.suggestionToken && !body.courtId;
    const players = ids.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId));
    if (players.some((player) => !player)) throw new Error("Every selected player must be in the current queue.");
    const allowed = manualQueue ? ["WAITING", "QUEUED", "PLAYING", "RESTING"] : ["WAITING"];
    if (players.some((player) => !player || !allowed.includes(player.status))) throw new Error(manualQueue ? "Only waiting, playing, or queued players can be queued." : "Only waiting players can start this matchup.");
    if (body.courtId || body.suggestionToken) {
      const blocked = (players as DomainQueuePlayer[]).filter((player) => Date.parse(restEligibleAt(player, snapshot)) > Date.now());
      if (blocked.length) throw new Error(`REST_REQUIRED: ${blocked.map((player) => player.displayName).join(", ")} must complete the configured rest period before playing again.`);
    }
    const court = body.courtId ? findCourt(snapshot, String(body.courtId)) : undefined;
    if (body.courtId && (!court || court.status !== "AVAILABLE" || court.currentMatchId)) throw new Error("The selected court is not available.");
    const createdAt = now();
    const adjusted = Boolean(body.suggestionAdjusted);
    const suggestionExplanation = body.suggestionToken ? { mode: "BALANCED", adjusted, algorithmVersion: "v3-rest-strength", strengthGap: body.strengthGap ?? 1 } : null;
    const match: DomainMatch = { id: id(), courtId: court?.id ?? null, courtIdSnapshot: court?.id ?? null, courtNameSnapshot: court?.name ?? null, status: court ? "IN_PROGRESS" : "QUEUED", source: body.suggestionToken ? (adjusted ? "MANUAL_ADJUSTED" : "AUTOMATIC") : "MANUAL", matchmakingMode: body.suggestionToken ? "BALANCED" : null, algorithmVersion: body.suggestionToken ? "v3-rest-strength" : null, suggestionKey: typeof body.suggestionToken === "string" ? body.suggestionToken : null, suggestionExplanation, pointsToWin: settings(snapshot).pointsToWin, winBy: settings(snapshot).winBy, scoreCap: settings(snapshot).scoreCap, bestOf: settings(snapshot).bestOf, queuedAt: createdAt, startedAt: court ? createdAt : null, completedAt: null, cancelledAt: null, cancellationReason: null, winnerTeam: null, currentRevisionId: null, version: 1, participants: [...teamA.map((queuePlayerId, index) => ({ id: id(), matchId: "", queuePlayerId, team: "A" as const, teamSlot: index + 1, priorQueueEnteredAt: findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null })), ...teamB.map((queuePlayerId, index) => ({ id: id(), matchId: "", queuePlayerId, team: "B" as const, teamSlot: index + 1, priorQueueEnteredAt: findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null }))], scoreRevisions: [] };
    match.participants.forEach((participant) => { participant.matchId = match.id; });
    snapshot.matches.push(match);
    if (court) { court.status = "OCCUPIED"; court.currentMatchId = match.id; court.version += 1; }
    reconcileOfflinePlayers(snapshot, ids, createdAt);
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return matchView(snapshot, match);
  });
}

async function finishMatchStacked(accountId: string, matchId: string, games: Array<{ teamAScore: number; teamBScore: number }>) {
  return mutate(accountId, "MATCH_COMPLETED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    if (!match || match.status !== "IN_PROGRESS") throw new Error("Only playing matches can be completed.");
    const validated = validateScores(games, { pointsToWin: match.pointsToWin, winBy: match.winBy, scoreCap: match.scoreCap, bestOf: match.bestOf });
    const aWins = validated.filter((game) => game.winnerTeam === "A").length;
    const winnerTeam: "A" | "B" = aWins > validated.length / 2 ? "A" : "B";
    const revisionId = id();
    const completedAt = now();
    match.status = "COMPLETED";
    match.version += 1;
    match.completedAt = completedAt;
    match.winnerTeam = winnerTeam;
    match.currentRevisionId = revisionId;
    match.scoreRevisions.push({ id: revisionId, matchId, revisionNumber: 1, winnerTeam, reason: null, supersedesRevisionId: null, createdAt: now(), games: validated.map((game, index) => ({ id: id(), scoreRevisionId: revisionId, gameNumber: index + 1, teamAScore: game.teamAScore, teamBScore: game.teamBScore, winnerTeam: game.winnerTeam })) });
    const court = findCourt(snapshot, match.courtId ?? undefined);
    if (court?.currentMatchId === match.id) { court.currentMatchId = null; court.status = court.status === "CLOSED" ? "CLOSED" : "AVAILABLE"; court.version += 1; }
    for (const participant of match.participants) {
      const player = findQueuePlayer(snapshot, participant.queuePlayerId);
      if (!player) continue;
      const won = participant.team === winnerTeam;
      player.matchesPlayed += 1;
      player.wins += won ? 1 : 0;
      player.losses += won ? 0 : 1;
      player.lastMatchEndedAt = completedAt;
    }
    reconcileOfflinePlayers(snapshot, match.participants.map((participant) => participant.queuePlayerId), completedAt);
    return matchView(snapshot, match);
  });
}

async function startMatchStacked(accountId: string, matchId: string, courtId: string) {
  return mutate(accountId, "MATCH_STARTED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    const court = findCourt(snapshot, courtId);
    if (!match || match.status !== "QUEUED" || !court || court.status !== "AVAILABLE" || court.currentMatchId) throw new Error("The selected court is not available.");
    const ids = match.participants.map((participant) => participant.queuePlayerId);
    if (snapshot.matches.some((item) => item.status === "IN_PROGRESS" && item.participants.some((participant) => ids.includes(participant.queuePlayerId)))) throw new Error("This matchup is waiting for a player to finish their current match.");
    const players = ids.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId));
    if (players.some((player) => !player || !["WAITING", "QUEUED"].includes(player.status))) throw new Error("This matchup is not ready to start.");
    const blocked = (players as DomainQueuePlayer[]).filter((player) => Date.parse(restEligibleAt(player, snapshot)) > Date.now());
    if (blocked.length) throw new Error(`REST_REQUIRED: ${blocked.map((player) => player.displayName).join(", ")} must complete the configured rest period before playing again.`);
    const startedAt = now();
    match.status = "IN_PROGRESS";
    match.version += 1;
    match.courtId = court.id;
    match.courtIdSnapshot = court.id;
    match.courtNameSnapshot = court.name;
    match.startedAt = startedAt;
    court.status = "OCCUPIED";
    court.currentMatchId = match.id;
    court.version += 1;
    reconcileOfflinePlayers(snapshot, ids, startedAt);
    return matchView(snapshot, match);
  });
}

async function cancelMatchStacked(accountId: string, matchId: string) {
  return mutate(accountId, "MATCH_DISCARDED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    if (!match || !["QUEUED", "IN_PROGRESS"].includes(match.status)) throw new Error("Match not found.");
    const cancelledAt = now();
    const court = findCourt(snapshot, match.courtId ?? undefined);
    if (court?.currentMatchId === match.id) { court.currentMatchId = null; court.status = court.status === "CLOSED" ? "CLOSED" : "AVAILABLE"; court.version += 1; }
    match.status = "CANCELLED";
    match.version += 1;
    match.cancelledAt = cancelledAt;
    match.cancellationReason = "DISCARDED";
    reconcileOfflinePlayers(snapshot, match.participants.map((participant) => participant.queuePlayerId), cancelledAt);
    return matchView(snapshot, match);
  });
}
async function updateMatchStacked(accountId: string, matchId: string, body: Record<string, unknown>) {
  return mutate(accountId, "MATCH_UPDATED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    const teamA = Array.isArray(body.teamA) ? body.teamA.map(String) : [];
    const teamB = Array.isArray(body.teamB) ? body.teamB.map(String) : [];
    const ids = [...teamA, ...teamB];
    if (!match || match.status !== "QUEUED") throw new Error("Only queued matches can be edited.");
    if (![1, 2].includes(teamA.length) || teamA.length !== teamB.length || new Set(ids).size !== ids.length) throw new Error("Choose one player per team for singles or two per team for doubles.");
    const players = ids.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId));
    if (players.some((player) => !player || !["WAITING", "QUEUED", "PLAYING"].includes(player.status))) throw new Error("Only waiting, queued, or playing players can be assigned.");
    const prior = new Map(match.participants.map((participant) => [participant.queuePlayerId, participant.priorQueueEnteredAt ?? null]));
    const oldIds = match.participants.map((participant) => participant.queuePlayerId);
    match.participants = [...teamA.map((queuePlayerId, index) => ({ id: id(), matchId, queuePlayerId, team: "A" as const, teamSlot: index + 1, priorQueueEnteredAt: prior.get(queuePlayerId) ?? findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null })), ...teamB.map((queuePlayerId, index) => ({ id: id(), matchId, queuePlayerId, team: "B" as const, teamSlot: index + 1, priorQueueEnteredAt: prior.get(queuePlayerId) ?? findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null }))];
    match.source = "MANUAL_ADJUSTED";
    match.matchmakingMode = null;
    match.algorithmVersion = null;
    match.suggestionKey = null;
    match.suggestionExplanation = null;
    match.version += 1;
    reconcileOfflinePlayers(snapshot, [...oldIds, ...ids]);
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return matchView(snapshot, match);
  });
}

const allocateEqualSplitOffline = (players: DomainQueuePlayer[], totalMinor: number) => {
  const ordered = [...players].sort((a, b) => a.id.localeCompare(b.id));
  const base = ordered.length ? Math.floor(totalMinor / ordered.length) : 0;
  let remainder = ordered.length ? totalMinor - base * ordered.length : 0;
  return new Map(ordered.map((player) => [player.id, base + (remainder-- > 0 ? 1 : 0)]));
};
const applyFeeAllocationsOffline = (snapshot: CloudSnapshotV2) => {
  const players = snapshot.queuePlayers.filter((player) => Boolean(player.checkedInAt));
  const config = snapshot.feeConfig;
  const allocations = config?.mode === "EQUAL_SPLIT"
    ? allocateEqualSplitOffline(players, config.expectedQueueCostMinor ?? 0)
    : new Map(players.map((player) => [player.id, config?.fixedAmountPerPlayerMinor ?? 0]));
  for (const player of players) {
    player.amountDueMinor = allocations.get(player.id) ?? 0;
    player.version += 1;
  }
};

async function endQueue(accountId: string) {
  return mutate(accountId, "WORKSPACE_ENDED", (snapshot) => {
    if (snapshot.matches.some((match) => match.status === "IN_PROGRESS")) throw new Error("Finish the playing match before ending this session.");
    const endedAt = now();
    const affected = snapshot.matches.filter((match) => match.status === "QUEUED");
    const affectedIds = affected.flatMap((match) => match.participants.map((participant) => participant.queuePlayerId));
    for (const match of affected) { match.status = "CANCELLED"; match.cancelledAt = endedAt; match.cancellationReason = "Session ended"; match.version += 1; }
    reconcileOfflinePlayers(snapshot, affectedIds, endedAt);
    const checkedIn = snapshot.queuePlayers.filter((player) => Boolean(player.checkedInAt));
    for (const player of checkedIn) { player.status = "CHECKED_OUT"; player.checkedOutAt = player.checkedOutAt ?? endedAt; player.queueEnteredAt = null; player.currentMatchId = null; player.version += 1; }
    const config = snapshot.feeConfig;
    applyFeeAllocationsOffline(snapshot);
    if (config) config.frozenAt = endedAt;
    snapshot.workspace.endedAt = endedAt;
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return workspaceView(snapshot);
  });
}

async function freshQueue(accountId: string) { return mutate(accountId, "WORKSPACE_RESET", (snapshot) => { snapshot.queuePlayers = []; snapshot.courts = []; snapshot.matches = []; snapshot.payments = []; snapshot.audits = []; snapshot.workspace.startedAt = now(); snapshot.workspace.endedAt = null; snapshot.workspace.lateArrivalCutoffAt = null; snapshot.workspace.matchmakingRevision += 1; snapshot.workspace.version += 1; if (snapshot.settings) snapshot.feeConfig = { id: snapshot.feeConfig?.id ?? id(), mode: snapshot.settings.defaultFeeMode, currencyCode: snapshot.settings.currencyCode, fixedAmountPerPlayerMinor: snapshot.settings.defaultFixedFeeMinor ?? null, expectedQueueCostMinor: 0, participationRule: snapshot.feeConfig?.participationRule ?? "ALL_ACTIVE", frozenAt: null, version: (snapshot.feeConfig?.version ?? 0) + 1 }; return workspaceView(snapshot); }); }

function historyResponse(snapshot: CloudSnapshotV2, path: string): HistoryResponse { const search = params(path).get("search") ?? ""; return page(historyMatches(snapshot, search).map((match) => historyView(snapshot, match)), path) as HistoryResponse; }
function playerHistory(snapshot: CloudSnapshotV2, queuePlayerId: string, path: string): PlayerHistoryResponse { const player = findQueuePlayer(snapshot, queuePlayerId); if (!player) throw new Error("Queue player not found."); const matches = historyMatches(snapshot).filter((match) => match.participants.some((participant) => participant.queuePlayerId === queuePlayerId)); const rows = matches.map((match) => historyView(snapshot, match)); let wins = 0; let pointsFor = 0; let pointsAgainst = 0; for (const match of matches) { const participant = match.participants.find((item) => item.queuePlayerId === queuePlayerId); const revision = scoreFor(match); if (!participant || !revision) continue; const a = revision.games.reduce((sum, game) => sum + game.teamAScore, 0); const b = revision.games.reduce((sum, game) => sum + game.teamBScore, 0); pointsFor += participant.team === "A" ? a : b; pointsAgainst += participant.team === "A" ? b : a; wins += Number(participant.team === revision.winnerTeam); } return { player: { queuePlayerId, playerId: player.playerId, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel }, stats: { matchesPlayed: matches.length, wins, losses: matches.length - wins, winRateBasisPoints: matches.length ? Math.floor(wins * 10000 / matches.length) : 0, pointsFor, pointsAgainst, pointDifferential: pointsFor - pointsAgainst, averageDurationSeconds: null, mostPlayedPartner: null, mostPlayedOpponent: null }, ...page(rows, path) } as PlayerHistoryResponse; }
function rankings(snapshot: CloudSnapshotV2): Ranking[] { return [...snapshot.queuePlayers].sort((a, b) => b.wins - a.wins || b.matchesPlayed - a.matchesPlayed || a.displayName.localeCompare(b.displayName)).map((player, index) => ({ rank: index + 1, queuePlayerId: player.id, player: player.displayName, playerId: player.playerId, gender: player.gender, skillLevel: player.skillLevel, matchesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, winRateBasisPoints: player.matchesPlayed ? Math.floor(player.wins * 10000 / player.matchesPlayed) : 0, pointsFor: player.pointsFor, pointsAgainst: player.pointsAgainst, pointDifferential: player.pointsFor - player.pointsAgainst } as Ranking)); }

export async function handleRequest(accountId: string, path: string, init?: RequestInit): Promise<unknown> {
  const snapshot = await readSnapshot(accountId); if (!snapshot) throw new Error("Download this account before working offline.");
  const method = (init?.method ?? "GET").toUpperCase(); const route = parts(path); const body = parseBody(init);
  if (route[0] === "workspace" && route.length === 1) return method === "GET" ? workspaceView(snapshot) : freshQueue(accountId);
  if (route[0] === "workspace" && route[1] === "start-fresh") return freshQueue(accountId);
  if (route[0] === "workspace" && route[1] === "end") return endQueue(accountId);
  if (route[0] === "workspace" && route[1] === "late-arrival-policy") return mutate(accountId, "LATE_ARRIVAL_POLICY_UPDATED", (value) => { const mode = String(body.mode); const timeZone = value.settings?.timeZone ?? "Asia/Manila"; let cutoff: string | null = null; try { cutoff = mode === "DISABLED" ? null : mode === "SET_NOW" ? now() : mode === "SET_CUSTOM" ? instantForLocalDateTime(String(body.localDateTime ?? ""), timeZone) : value.settings?.defaultLateArrivalCutoffTime ? instantForLocalDateTime(`${datePartsForInstant(new Date(), timeZone)}T${value.settings.defaultLateArrivalCutoffTime}`, timeZone) : null; } catch { throw new Error("The cutoff time is invalid for the account timezone."); } value.workspace.lateArrivalCutoffAt = cutoff; const cutoffMs = cutoff ? Date.parse(cutoff) : null; for (const player of value.queuePlayers) { if (player.latePenaltyState !== "PENDING") continue; if (mode === "DISABLED" || (cutoffMs !== null && player.latePenaltyAppliedAt && Date.parse(player.latePenaltyAppliedAt) <= cutoffMs)) { player.latePenaltyState = null; player.latePenaltyAppliedAt = null; player.version += 1; } } value.workspace.version += 1; return workspaceView(value); });
  if (route[0] === "settings" && route.length === 1) {
    if (method === "GET") return snapshot.settings;
    return mutate(accountId, "SETTINGS_UPDATED", (value) => {
      if (!value.settings) throw new Error("Settings are not available offline.");
      if (body.minimumRestMinutes !== undefined) { const minutes = Number(body.minimumRestMinutes); if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) throw new Error("Minimum rest must be a whole number from 0 to 60 minutes."); value.settings.minimumRestMinutes = minutes; }
      value.settings.version += 1;
      return value.settings;
    });
  }
  if (route[0] === "players" && route[1] === "deletion-preview" && method === "POST") { const { previewPlayerDeletion } = await import("@shuttle-queue/domain"); return previewPlayerDeletion(snapshot, Array.isArray(body.playerIds) ? body.playerIds.map(String) : []); }
  if (route[0] === "players" && route[1] === "delete" && method === "POST") return mutate(accountId, "PLAYERS_DELETED", (value) => { const result = applyPlayerDeletion(value, Array.isArray(body.playerIds) ? body.playerIds.map(String) : []); Object.assign(value, result.snapshot); return { deletedPlayerIds: result.impact.playerIds, affectedMatchCount: result.impact.affectedMatchIds.length, affectedPaymentCount: result.impact.affectedPaymentIds.length, otherParticipantPlayerIds: result.impact.otherParticipantPlayerIds }; });
  if (route[0] === "players" && route[1] && method === "PATCH") return mutate(accountId, "PLAYER_UPDATED", (value) => {
    const player = value.players.find((item) => item.id === route[1]);
    if (!player) throw new Error("Player not found.");
    const displayName = body.displayName === undefined ? player.displayName : normalizeText(String(body.displayName));
    const gender = body.gender === undefined ? player.gender : String(body.gender);
    const skillLevel = (body.skillLevel === undefined ? player.skillLevel : String(body.skillLevel)) as DomainPlayer["skillLevel"];
    if (!displayName) throw new Error("Display name is required.");
    if (displayName.length > 80) throw new Error("Display names must be 80 characters or fewer.");
    if (!(gender === "MALE" || gender === "FEMALE")) throw new Error("Gender is invalid.");
    if (!skillWeights[skillLevel]) throw new Error("Skill level is invalid.");
    if (hasPlayerNameConflict(value.players, value.queuePlayers, displayName, player.id)) throw new Error(PLAYER_NAME_CONFLICT_MESSAGE);
    const profileChanged = displayName !== player.displayName || gender !== player.gender || skillLevel !== player.skillLevel;
    player.displayName = displayName;
    player.gender = gender;
    player.skillLevel = skillLevel;
    player.skillWeight = skillWeights[skillLevel]!;
    if (profileChanged) {
      const queuePlayers = value.queuePlayers.filter((item) => item.playerId === player.id);
      for (const queuePlayer of queuePlayers) {
        queuePlayer.displayName = displayName;
        queuePlayer.gender = gender;
        queuePlayer.skillLevel = skillLevel;
        queuePlayer.skillWeight = skillWeights[skillLevel]!;
        queuePlayer.version += 1;
      }
      if (queuePlayers.length) {
        value.workspace.matchmakingRevision += 1;
        value.workspace.version += 1;
      }
    }
    return player as Player;
  });
  if (route[0] === "players" && method === "POST") return mutate(accountId, "PLAYER_CREATED", (value) => { const displayName = normalizeText(String(body.displayName ?? "")); const gender = String(body.gender ?? ""); const skillLevel = String(body.skillLevel ?? "") as DomainPlayer["skillLevel"]; if (!displayName) throw new Error("Display name is required."); if (displayName.length > 80) throw new Error("Display names must be 80 characters or fewer."); if (!(gender === "MALE" || gender === "FEMALE")) throw new Error("Gender is invalid."); if (!skillWeights[skillLevel]) throw new Error("Skill level is invalid."); if (hasPlayerNameConflict(value.players, value.queuePlayers, displayName)) throw new Error(PLAYER_NAME_CONFLICT_MESSAGE); const player: DomainPlayer = { id: id(), displayName, gender, skillLevel, skillWeight: skillWeights[skillLevel]!, status: "ACTIVE" }; value.players.push(player); return player as Player; });
  if (route[0] === "players" && method === "GET") return snapshot.players.filter((player) => player.status === "ACTIVE") as Player[];
  if (route[0] === "queue" && route[1] === "players" && route.length === 2) return method === "GET" ? snapshot.queuePlayers.map((player) => playerView(player, snapshot)) : addPlayers(accountId, body);
  if (route[0] === "queue" && route[1] === "players" && route[2]) { const queuePlayerId = route[2]!; if (route[3] === "history") return playerHistory(snapshot, queuePlayerId, path); if (route[3] === "late-penalty" && route[4] === "waive") return transition(accountId, queuePlayerId, "WAITING", "LATE_PENALTY_WAIVED"); const status = route[3] === "check-in" ? "WAITING" : route[3] === "rest" ? "RESTING" : route[3] === "resume" ? "WAITING" : route[3] === "check-out" ? "CHECKED_OUT" : null; if (status) return transition(accountId, queuePlayerId, status as DomainQueuePlayer["status"], route[3] === "check-in" ? "QUEUE_PLAYER_CHECK_IN" : `QUEUE_PLAYER_${status}`); }
  if (route[0] === "queue" && route[1] === "players" && route[2] === "bulk-action" && method === "POST") return bulkQueueAction(accountId, body);
  if (route[0] === "queue" && route.length === 1) return queueState(snapshot);
  if (route[0] === "courts" && route.length === 1) return method === "GET" ? snapshot.courts.map(courtView) : mutate(accountId, "COURT_CREATED", (value) => { const name = String(body.name ?? "").trim(); if (!name) throw new Error("Court name is required."); if (value.courts.some((item) => item.normalizedName === name.toLowerCase())) throw new Error("The requested value is already in use."); const displayOrder = Math.max(-1, ...value.courts.map((item) => item.displayOrder)) + 1; const court = { id: id(), name, normalizedName: name.toLowerCase(), displayOrder, status: "AVAILABLE" as const, currentMatchId: null, closedAt: null, version: 1 }; value.courts.push(court); return courtView(court); });
  if (route[0] === "courts" && route[1] === "delete" && method === "POST") return mutate(accountId, "COURTS_DELETED", (value) => { const statuses = [...new Set((Array.isArray(body.statuses) ? body.statuses : []).map(String))].filter((status): status is "AVAILABLE" | "CLOSED" => status === "AVAILABLE" || status === "CLOSED"); if (!statuses.length) throw new Error("Choose at least one court status to delete."); const courts = value.courts.filter((court) => statuses.includes(court.status as "AVAILABLE" | "CLOSED") && !court.currentMatchId); const deletedCourtIds = courts.map((court) => court.id); let preservedHistoryMatchCount = 0; for (const court of courts) { const matches = value.matches.filter((match) => match.courtId === court.id); preservedHistoryMatchCount += matches.length; matches.forEach((match) => preserveCourtSnapshot(match, court)); } value.courts = value.courts.filter((court) => !deletedCourtIds.includes(court.id)); return { deletedCourtIds, deletedCount: deletedCourtIds.length, preservedHistoryMatchCount }; });
  if (route[0] === "courts" && route[1]) return mutate(accountId, method === "DELETE" ? "COURT_DELETED" : "COURT_UPDATED", (value) => { const court = findCourt(value, route[1]); if (!court) throw new Error("Court not found."); if (method === "DELETE") { if (court.currentMatchId || court.status === "OCCUPIED") throw new Error("Occupied courts cannot be deleted while a match is playing."); const matches = value.matches.filter((match) => match.courtId === court.id); matches.forEach((match) => preserveCourtSnapshot(match, court)); value.courts = value.courts.filter((item) => item.id !== court.id); return { deletedCourtIds: [court.id], deletedCount: 1, preservedHistoryMatchCount: matches.length }; } if (court.status === "OCCUPIED") throw new Error("Occupied courts cannot be changed while a match is playing."); if (body.name !== undefined) { const name = String(body.name).trim(); if (!name) throw new Error("Court name is required."); if (value.courts.some((item) => item.id !== court.id && item.normalizedName === name.toLowerCase())) throw new Error("The requested value is already in use."); value.matches.filter((match) => match.courtId === court.id && !match.courtNameSnapshot).forEach((match) => captureCourtSnapshot(match, court)); court.name = name; court.normalizedName = name.toLowerCase(); } if (body.status) { court.status = body.status as typeof court.status; court.closedAt = body.status === "CLOSED" ? now() : null; } court.version += 1; return courtView(court); });
  if (route[0] === "suggestions") return makeSuggestion(accountId, body);
  if (route[0] === "matches" && route.length === 1) return method === "GET" ? snapshot.matches.filter((match) => ["QUEUED", "IN_PROGRESS"].includes(match.status)).map((match) => matchView(snapshot, match)) : createMatchStacked(accountId, body);
  if (route[0] === "matches" && route[1] && route.length === 2 && method === "PATCH") return updateMatchStacked(accountId, route[1], body);
  if (route[0] === "matches" && route[1] && route[2] === "start") return startMatchStacked(accountId, route[1], String(body.courtId ?? ""));
  if (route[0] === "matches" && route[1] && route[2] === "complete") return finishMatchStacked(accountId, route[1], Array.isArray(body.games) ? body.games as Array<{ teamAScore: number; teamBScore: number }> : []);
  if (route[0] === "matches" && route[1] && route[2] === "cancel") return cancelMatchStacked(accountId, route[1]);
  if (route[0] === "history") return historyResponse(snapshot, path);
  if (route[0] === "rankings") return rankings(snapshot);
  if (route[0] === "fees" && route[1] === "config") return mutate(accountId, "FEE_CONFIG_UPDATED", (value) => { value.feeConfig = { ...(value.feeConfig ?? { id: id(), participationRule: "ALL_ACTIVE", frozenAt: null, version: 0 }), mode: String(body.mode) as never, currencyCode: value.feeConfig?.currencyCode ?? value.settings?.currencyCode ?? "PHP", fixedAmountPerPlayerMinor: typeof body.fixedAmountPerPlayerMinor === "number" ? body.fixedAmountPerPlayerMinor : null, expectedQueueCostMinor: Number(body.expectedQueueCostMinor ?? body.expectedSessionCostMinor ?? 0), version: (value.feeConfig?.version ?? 0) + 1 }; applyFeeAllocationsOffline(value); return { config: value.feeConfig, summary: feeSummary(value) }; });
  if (route[0] === "fees") return feeSummary(snapshot);
  if (route[0] === "payments" && route.length === 1) return method === "GET" ? snapshot.payments as unknown as Payment[] : mutate(accountId, "PAYMENT_CREATED", (value) => { const playerId = String(body.queuePlayerId ?? body.sessionPlayerId ?? ""); if (!findQueuePlayer(value, playerId)) throw new Error("Queue player not found."); const payment = { id: id(), queuePlayerId: playerId, kind: String(body.kind), method: body.method ? String(body.method) : null, amountMinor: Number(body.amountMinor), reference: body.reference ? String(body.reference) : null, note: body.note ? String(body.note) : null, reversalOfPaymentId: null, recordedById: accountId, occurredAt: now(), createdAt: now() }; value.payments.push(payment); return { payment, summary: feeSummary(value), replayed: false }; });
  throw new Error("This operation is not available offline.");
}

export async function hasLocalSnapshot() { return hasSnapshot(); }
export async function retainedProfile() { return firstProfile(); }
export async function currentAccountId() { let preferred: string | null = null; try { preferred = window.localStorage.getItem("shuttle-queue-current-account"); } catch { /* ignore */ } if (preferred && await hasSnapshot(preferred)) return preferred; const row = (await offlineDb.snapshots.toArray())[0]; if (!row) throw new Error("Download this account before working offline."); return row.accountId; }
export type SyncTrigger = "background" | "manual";
export type { SyncPreview } from "./sync-plan";
export type SyncResult =
  | { state: "downloaded" | "clean" | "uploaded"; cloudRevision: number }
  | { state: "confirmation-required" | "manual-required"; preview: never };

type RemoteSnapshot = { snapshot: CloudSnapshotV2; cloudRevision: number; metadata?: SyncMetadata };

async function remoteSnapshot(): Promise<RemoteSnapshot> {
  const remote = await request<RemoteSnapshot>("/sync/snapshot");
  if (remote.snapshot.schemaVersion !== 2 && remote.snapshot.schemaVersion !== 3) throw new Error("This offline snapshot is incompatible. Download the current queue online.");
  return remote;
}

async function uploadLocalSnapshotInternal(accountId: string, expectedCloudRevision: number) {
  const local = await getMeta(accountId);
  if (!local) throw new Error("Local data is missing.");
  const batch = await prepareSnapshotUpload(accountId);
  const uploaded = await request<{ cloudRevision: number; alreadyApplied?: boolean; snapshot?: CloudSnapshotV2; metadata?: SyncMetadata }>("/sync/snapshot", { method: "PUT", body: JSON.stringify({ schemaVersion: 3, deviceId: local.deviceId, operationId: batch.operationId, baseCloudRevision: expectedCloudRevision, force: false, snapshot: batch.snapshot, metadata: batch.metadata, auditEvents: batch.auditEvents }) });
  const completedBatch = { ...batch, ...(uploaded.snapshot ? { snapshot: uploaded.snapshot } : {}), ...(uploaded.metadata ? { metadata: uploaded.metadata } : {}) };
  const completed = await completeSnapshotUpload(accountId, completedBatch, uploaded.cloudRevision);
  if (completed) await markSyncAttention(accountId, null);
  return { state: "uploaded" as const, cloudRevision: uploaded.cloudRevision };
}

async function uploadLocalSnapshot(accountId: string, expectedCloudRevision: number) {
  return singleFlightByKey(uploadFlights, accountId, () => uploadLocalSnapshotInternal(accountId, expectedCloudRevision));
}

export async function syncAccount(accountId: string, trigger: SyncTrigger = "background"): Promise<SyncResult> {
  const local = await getMeta(accountId);
  if (!local || !(await hasSnapshot(accountId))) {
    const remote = await remoteSnapshot();
    await replaceSnapshot(accountId, remote.snapshot, remote.cloudRevision, remote.metadata);
    return { state: "downloaded", cloudRevision: remote.cloudRevision };
  }
  const remote = await remoteSnapshot();
  if (!local.dirty) {
    if (remote.cloudRevision > local.baseCloudRevision) {
      await replaceSnapshot(accountId, remote.snapshot, remote.cloudRevision, remote.metadata);
      return { state: "downloaded", cloudRevision: remote.cloudRevision };
    }
    return { state: "clean", cloudRevision: remote.cloudRevision };
  }
  return uploadLocalSnapshot(accountId, remote.cloudRevision);
}

export async function confirmLocalReplacement(accountId: string, confirmedCloudRevision: number) {
  return uploadLocalSnapshot(accountId, confirmedCloudRevision);
}

export async function downloadFromCloud(accountId: string, discard = false) { const meta = await getMeta(accountId); if (meta?.dirty && !discard) throw new Error("Pending local changes must be synced or discarded first."); const remote = await remoteSnapshot(); await replaceSnapshot(accountId, remote.snapshot, remote.cloudRevision, remote.metadata); return { state: "downloaded" as const, cloudRevision: remote.cloudRevision }; }
export { clearAccountData, getMeta, hasSnapshot, saveProfile, storageEstimate };
