import type { CloudSnapshotV2, DomainMatch, DomainPlayer, DomainQueuePlayer, MatchHistory, MatchPlayer, MatchmakingMode, ScoreSettings, SyncMetadata, DomainSynergyTeam, GuidedAvailabilitySummary, GuidedLineupPlayer } from "./domain-compat";
import { allocateFinalFeeAmounts, applyPlayerDeletion, historyDurationSeconds, isProhibitedGeneratedGenderMatch, isProhibitedGeneratedNewbieMatch, evaluateGuidedAvailability, buildGuidedExplanation, loneFemalePolicy, lowSkillLoneFemaleAdvisory, normalizeText, removeSessionPlayer, skillWeight, suggestMatch, undefeatedChallengePlayers, validateBalancedLineup, validateGuidedLineup, validateMatchmakingConstraints, validateMixedDoublesLineup, validateSynergyLineup, MATCHMAKING_ALGORITHM, UNDEFEATED_CHALLENGE_MINIMUM_MATCHES, UNDEFEATED_CHALLENGE_RANK_LIMIT, validateScores, prizeRankingRows, PRIZE_RANKING_METHOD } from "./domain-compat";
import type { Court, FeeSummary, HistoryMatch, HistoryResponse, Match, Payment, Player, PlayerHistoryResponse, QueueState, QueuePlayer, Ranking, RankingPayload, Suggestion, WorkspaceSummary, SynergyTeam } from "../api";
import { ApiError, request } from "../api";
import { hasPlayerNameConflict } from "../player-names";
import { playerHistoryStats } from "../player-history-stats";
import { appendAudit, clearAccountData, completeSnapshotUpload, firstProfile, getDeviceId, getMeta, hasSnapshot, markSyncAttention, offlineDb, prepareSnapshotUpload, readSnapshot, replaceSnapshot, saveProfile, storageEstimate, updateLocalSnapshot, type LocalAuditEvent } from "./db";
import { singleFlightByKey } from "./sync-flight";
import type { SyncPreview } from "./sync-plan";
import { datePartsForInstant, inclusiveMinuteInstantForLocalDateTime } from "../timezone";
import { decodeLocalSuggestion, persistedSuggestionKey, VALID_MATCHMAKING_MODES } from "./suggestion-token";


const id = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const uploadFlights = new Map<string, Promise<{ state: "uploaded"; cloudRevision: number }>>();
const now = () => new Date().toISOString();
const PLAYER_NAME_CONFLICT_MESSAGE = "A player with this name has already been created or is already in the current queue.";
const preferenceConfirmationError = (advisory: NonNullable<ReturnType<typeof lowSkillLoneFemaleAdvisory>>) => new ApiError(409, "PLAYER_PREFERENCE_CONFIRMATION_REQUIRED", "Confirm that the affected player accepts this matchup before starting.", advisory);
const DEFAULT_LATE_ARRIVAL_GRACE_MINUTES = 10;
const skillWeights: Record<string, number> = { NEWBIE: 1, BEGINNER: 2, UPPER_BEGINNER: 3, INTERMEDIATE: 4, UPPER_INTERMEDIATE: 5, ADVANCED: 6 };
const encodeLocalSuggestion = (value: Record<string, unknown>) => `local:${btoa(JSON.stringify(value))}`;
const parseBody = (init?: RequestInit) => { try { return init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}; } catch { return {}; } };
const parts = (path: string) => path.split("?")[0]!.split("/").filter(Boolean);
const params = (path: string) => new URLSearchParams(path.split("?")[1] ?? "");
const clone = <T,>(value: T): T => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
const page = <T,>(items: T[], path: string) => { const current = Math.max(1, Number(params(path).get("page") ?? 1)); const size = Math.max(1, Math.min(100, Number(params(path).get("pageSize") ?? 15))); const total = items.length; return { items: items.slice((current - 1) * size, current * size), pagination: { page: current, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) } }; };
const scoreFor = (match: DomainMatch) => match.scoreRevisions.find((revision) => revision.id === match.currentRevisionId) ?? [...match.scoreRevisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
const findQueuePlayer = (snapshot: CloudSnapshotV2, value: string) => snapshot.queuePlayers.find((player) => player.id === value);
const findCourt = (snapshot: CloudSnapshotV2, value?: string) => snapshot.courts.find((court) => court.id === value);
const guidedPlayerInput = (player: Pick<MatchPlayer, "id" | "skillLevel">): GuidedLineupPlayer => ({ id: player.id, skillLevel: player.skillLevel });
function validateGuidedMutation(teamA: MatchPlayer[], teamB: MatchPlayer[], synergyError?: string | null) {
  const compositionError = validateGuidedLineup(teamA.map(guidedPlayerInput), teamB.map(guidedPlayerInput));
  if (compositionError) throw new Error(`GUIDED_COMPOSITION: ${compositionError}`);
  if (synergyError) throw new Error(`SYNERGY_TEAM_LINEUP: ${synergyError}`);
  if (isProhibitedGeneratedGenderMatch(teamA, teamB)) throw new Error("GENERATED_GENDER_RULE: Generated matchups cannot place two female players against two male players.");
}
function validateOfflineModeGuarantee(mode: string, teamA: MatchPlayer[], teamB: MatchPlayer[], strengthGap = 1) {
  const result = validateMatchmakingConstraints(mode as MatchmakingMode, teamA, teamB, strengthGap);
  return result.valid ? null : result.message;
}
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
function serveOfflineLatePenalties(snapshot: CloudSnapshotV2, queuePlayerIds: string[]) {
  const ids = new Set(queuePlayerIds);
  for (const player of snapshot.queuePlayers) if (ids.has(player.id) && player.latePenaltyState === "PENDING") { player.latePenaltyState = "SERVED"; player.version += 1; }
}
const captureCourtSnapshot = (match: DomainMatch, court: CloudSnapshotV2["courts"][number]) => { match.courtIdSnapshot = court.id; match.courtNameSnapshot = court.name; match.suggestionExplanation = { ...(typeof match.suggestionExplanation === "object" && match.suggestionExplanation ? match.suggestionExplanation as Record<string, unknown> : {}), __courtSnapshot: { id: court.id, name: court.name } }; };
const preserveCourtSnapshot = (match: DomainMatch, court: CloudSnapshotV2["courts"][number]) => { captureCourtSnapshot(match, court); match.courtId = null; };
const settings = (snapshot: CloudSnapshotV2): ScoreSettings => ({ pointsToWin: snapshot.settings?.pointsToWin ?? 21, winBy: snapshot.settings?.winBy ?? 2, scoreCap: snapshot.settings?.scoreCap ?? null, bestOf: (snapshot.settings?.bestOf ?? 1) as 1 | 3 });
const minimumRestMinutes = (snapshot: CloudSnapshotV2) => snapshot.settings?.minimumRestMinutes ?? 0;
const lateArrivalGraceMinutes = (snapshot: CloudSnapshotV2) => snapshot.settings?.lateArrivalGraceMinutes ?? DEFAULT_LATE_ARRIVAL_GRACE_MINUTES;
const restEligibleAt = (player: DomainQueuePlayer, snapshot: CloudSnapshotV2, reference = Date.now()) => {
  const ended = player.lastMatchEndedAt ? Date.parse(player.lastMatchEndedAt) : NaN;
  return !Number.isFinite(ended) || minimumRestMinutes(snapshot) <= 0 ? new Date(reference).toISOString() : new Date(ended + minimumRestMinutes(snapshot) * 60_000).toISOString();
};
const synergyTeams = (snapshot: CloudSnapshotV2) => (snapshot.synergyTeams ?? []).filter((team) => team.queuePlayerIds.length === 2 && team.queuePlayerIds[0] !== team.queuePlayerIds[1]);
const synergyTeamFor = (snapshot: CloudSnapshotV2, queuePlayerId: string) => synergyTeams(snapshot).find((team) => team.queuePlayerIds.includes(queuePlayerId));
const effectiveFor = (player: DomainQueuePlayer, snapshot?: CloudSnapshotV2) => {
  if (!snapshot) return { weight: player.skillWeight, level: player.skillLevel, teamId: undefined as string | undefined };
  const team = synergyTeamFor(snapshot, player.id);
  if (!team) return { weight: player.skillWeight, level: player.skillLevel, teamId: undefined as string | undefined };
  const partner = findQueuePlayer(snapshot, team.queuePlayerIds.find((id) => id !== player.id) ?? "");
  const weight = Math.max(player.skillWeight, partner?.skillWeight ?? player.skillWeight);
  const level = (Object.entries(skillWeights).find(([, value]) => value === weight)?.[0] ?? player.skillLevel) as DomainQueuePlayer["skillLevel"];
  return { weight, level, teamId: team.id };
};
const playerView = (player: DomainQueuePlayer, snapshot?: CloudSnapshotV2): QueuePlayer => { const effective = effectiveFor(player, snapshot); const partnerId = effective.teamId ? synergyTeamFor(snapshot!, player.id)?.queuePlayerIds.find((id) => id !== player.id) : undefined; return { id: player.id, playerId: player.playerId, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel, skillWeight: player.skillWeight, effectiveSkillLevel: effective.level, effectiveSkillWeight: effective.weight, synergyTeamId: effective.teamId ?? null, synergyPartnerName: partnerId ? findQueuePlayer(snapshot!, partnerId)?.displayName ?? null : null, status: player.status, matchesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, pointsFor: player.pointsFor, pointsAgainst: player.pointsAgainst, amountDueMinor: player.amountDueMinor ?? 0, manualPriority: player.manualPriority ?? 0, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, restEligibleAt: snapshot ? restEligibleAt(player, snapshot) : null, checkedInAt: player.checkedInAt ?? null, checkedOutAt: player.checkedOutAt ?? null, currentMatchId: player.currentMatchId ?? null, latePenaltyState: player.latePenaltyState ?? null, latePenaltyAppliedAt: player.latePenaltyAppliedAt ?? null, version: player.version }; };
const challengeInput = (player: DomainQueuePlayer): MatchPlayer => ({ id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, status: player.status, gamesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null });
const challengeNotifications = (before: DomainQueuePlayer[], after: DomainQueuePlayer[]) => { const previous = new Set(undefeatedChallengePlayers(before.map(challengeInput)).map(({ player }) => player.id)); return undefeatedChallengePlayers(after.map(challengeInput)).filter(({ player }) => !previous.has(player.id)).map(({ player, rank }) => ({ type: "UNDEFEATED_CHALLENGE_ELIGIBLE" as const, queuePlayerId: player.id, displayName: player.displayName, rank, matchesPlayed: player.gamesPlayed, wins: player.wins ?? 0, losses: player.losses ?? 0 })); };
const validateOfflineUndefeatedChallengeStart = (match: DomainMatch, players: DomainQueuePlayer[]) => {
  if (match.source !== "AUTOMATIC" || match.matchmakingMode !== "UNDEFEATED_CHALLENGE") return;
  const explanation = match.suggestionExplanation && typeof match.suggestionExplanation === "object" ? match.suggestionExplanation as Record<string, unknown> : null;
  const challenge = explanation?.challenge && typeof explanation.challenge === "object" ? explanation.challenge as Record<string, unknown> : null;
  const selectedIds = Array.isArray(challenge?.selectedPlayerIds) ? challenge.selectedPlayerIds.filter((value): value is string => typeof value === "string") : [];
  if (!selectedIds.length) return;
  const qualified = new Set(undefeatedChallengePlayers(players.map(challengeInput)).map(({ player }) => player.id));
  if (!selectedIds.every((idValue) => qualified.has(idValue))) throw new Error("UNDEFEATED_CHALLENGE_CONSTRAINT: One or more undefeated players no longer qualify for this challenge. Continue as Manual Adjusted or generate a new challenge.");
};
const workspaceView = (snapshot: CloudSnapshotV2): WorkspaceSummary => ({ id: "workspace", name: "Current queue", sessionDate: snapshot.workspace.startedAt, startedAt: snapshot.workspace.startedAt, endedAt: snapshot.workspace.endedAt ?? null, status: snapshot.workspace.endedAt ? "ENDED" : "ACTIVE", lateArrivalCutoffAt: snapshot.workspace.lateArrivalCutoffAt ?? null, version: snapshot.workspace.version, playerCount: snapshot.queuePlayers.length, courtCount: snapshot.courts.length, scoring: settings(snapshot), feeConfig: snapshot.feeConfig as any });
const courtView = (court: CloudSnapshotV2["courts"][number]): Court => ({ id: court.id, name: court.name, status: court.status, displayOrder: court.displayOrder, currentMatchId: court.currentMatchId ?? null, version: court.version });
const matchView = (snapshot: CloudSnapshotV2, match: DomainMatch): Match => {
  const advisoryPlayers = match.participants.map((participant) => {
    const player = findQueuePlayer(snapshot, participant.queuePlayerId);
    return { participant, player };
  });
  const advisory = lowSkillLoneFemaleAdvisory(
    advisoryPlayers.filter(({ participant }) => participant.team === "A").map(({ participant, player }) => ({ id: participant.queuePlayerId, displayName: player?.displayName ?? "Player", gender: player?.gender ?? "", skillLevel: player?.skillLevel ?? "" } as MatchPlayer)),
    advisoryPlayers.filter(({ participant }) => participant.team === "B").map(({ participant, player }) => ({ id: participant.queuePlayerId, displayName: player?.displayName ?? "Player", gender: player?.gender ?? "", skillLevel: player?.skillLevel ?? "" } as MatchPlayer)),
  );
  return {
    id: match.id,
    status: match.status,
    source: match.source,
    courtId: match.courtId ?? null,
    matchmakingMode: match.matchmakingMode ?? null,
    algorithmVersion: match.algorithmVersion ?? null,
    suggestionKey: match.suggestionKey ?? null,
    suggestionExplanation: match.suggestionExplanation ?? null,
    matchupAdvisory: advisory,
    queuedAt: match.queuedAt,
    startedAt: match.startedAt ?? null,
    completedAt: match.completedAt ?? null,
    winnerTeam: match.winnerTeam ?? null,
    cancellationReason: match.cancellationReason ?? null,
    version: match.version,
    scoring: { pointsToWin: match.pointsToWin, winBy: match.winBy, scoreCap: match.scoreCap, bestOf: match.bestOf },
    participants: match.participants.map((participant) => {
      const player = findQueuePlayer(snapshot, participant.queuePlayerId);
      return {
        id: participant.id,
        queuePlayerId: participant.queuePlayerId,
        displayName: player?.displayName,
        gender: player?.gender,
        skillLevel: player?.skillLevel,
        playerStatus: player?.status,
        lastMatchEndedAt: player?.lastMatchEndedAt ?? null,
        team: participant.team,
        teamSlot: participant.teamSlot,
      };
    }),
  } as Match;
};
const feeSummary = (snapshot: CloudSnapshotV2): FeeSummary => {
  const payments = snapshot.payments;
  const players = snapshot.queuePlayers.map((player) => {
    const rows = payments.filter((payment) => payment.queuePlayerId === player.id);
    const collected = rows.filter((payment) => payment.kind === "COLLECTION").reduce((sum, payment) => sum + payment.amountMinor, 0);
    const waived = rows.filter((payment) => payment.kind === "WAIVER").reduce((sum, payment) => sum + payment.amountMinor, 0);
    const methods = { CASH: 0, EWALLET: 0, OTHER: 0 } as Record<string, number>;
    rows.filter((payment) => payment.kind === "COLLECTION" && payment.method).forEach((payment) => { methods[payment.method!] = (methods[payment.method!] ?? 0) + payment.amountMinor; });
    const due = player.amountDueMinor ?? 0;
    const outstanding = Math.max(0, due - collected - waived);
    const credit = Math.max(0, collected - Math.max(0, due - waived));
    const isNoShow = Boolean(snapshot.workspace.endedAt && player.matchesPlayed === 0);
    const status = credit > 0 ? "CREDIT" : outstanding === 0 && waived > 0 ? "WAIVED" : outstanding === 0 ? "PAID" : collected > 0 ? "PARTIAL" : "UNPAID";
    return { queuePlayerId: player.id, sessionPlayerId: player.id, displayName: player.displayName, dueMinor: due, collectedMinor: collected, waivedMinor: waived, outstandingMinor: outstanding, creditMinor: credit, isNoShow, status, collectionByMethodMinor: methods };
  });
  return { config: snapshot.feeConfig as any, expectedMinor: players.reduce((sum, player) => sum + player.dueMinor, 0), collectedMinor: players.reduce((sum, player) => sum + player.collectedMinor, 0), outstandingMinor: players.reduce((sum, player) => sum + player.outstandingMinor, 0), creditMinor: players.reduce((sum, player) => sum + player.creditMinor, 0), noShowCount: players.filter((player) => player.isNoShow).length, paymentCount: payments.length, players } as FeeSummary;
};
const historyMatches = (snapshot: CloudSnapshotV2, search = "") => snapshot.matches.filter((match) => match.status === "COMPLETED").filter((match) => !search || match.participants.some((participant) => (findQueuePlayer(snapshot, participant.queuePlayerId)?.displayName ?? "").toLowerCase().includes(search.toLowerCase()))).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
const historyView = (snapshot: CloudSnapshotV2, match: DomainMatch): HistoryMatch => { const revision = scoreFor(match); const court = findCourt(snapshot, match.courtId ?? undefined); const courtHistory = match.courtIdSnapshot && match.courtNameSnapshot ? { id: match.courtIdSnapshot, name: match.courtNameSnapshot } : court ? { id: court.id, name: court.name } : null; return { id: match.id, source: match.source, matchmakingMode: match.matchmakingMode ?? null, matchmakingLabel: match.matchmakingMode === "BALANCED" ? `Handicap +${[1, 2, 3].includes(Number((match.suggestionExplanation as { strengthGap?: number } | null)?.strengthGap ?? 1)) ? Number((match.suggestionExplanation as { strengthGap?: number } | null)?.strengthGap ?? 1) : 1}` : match.matchmakingMode === "GUIDED" ? "Guided" : match.matchmakingMode === "UNDEFEATED_CHALLENGE" ? "Undefeated challenge" : match.matchmakingMode === "SAME_SKILL" ? "Same skill" : match.matchmakingMode === "MIXED_DOUBLES" ? "Mixed doubles" : match.matchmakingMode === "SAME_GENDER" ? "Same gender" : match.matchmakingMode === "OPEN" ? "Open" : match.source === "MANUAL_ADJUSTED" ? "Manual Adjusted" : "Manual", format: match.participants.length === 4 ? "DOUBLES" : "SINGLES", court: courtHistory, startedAt: match.startedAt ?? null, completedAt: match.completedAt ?? null, durationSeconds: historyDurationSeconds(match.startedAt, match.completedAt), winnerTeam: match.winnerTeam ?? null, score: revision ? { revisionNumber: revision.revisionNumber, winnerTeam: revision.winnerTeam, games: revision.games } : null, participants: match.participants.map((participant) => { const player = findQueuePlayer(snapshot, participant.queuePlayerId); return { queuePlayerId: participant.queuePlayerId, sessionPlayerId: participant.queuePlayerId, playerId: player?.playerId, displayName: player?.displayName ?? "Unknown", gender: player?.gender ?? "", skillLevel: player?.skillLevel ?? "", team: participant.team, teamSlot: participant.teamSlot }; }) } as HistoryMatch; };
const guidedAvailabilityOffline = (snapshot: CloudSnapshotV2, serverTime: string): GuidedAvailabilitySummary => {
  const input: MatchPlayer[] = snapshot.queuePlayers.map((player) => {
    const effective = effectiveFor(player, snapshot);
    return { id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, status: player.status, gamesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null, synergyTeamId: effective.teamId ?? null, effectiveSkillWeight: effective.weight, effectiveSkillLevel: effective.level };
  });
  return evaluateGuidedAvailability(input, { minimumRestMinutes: minimumRestMinutes(snapshot), now: serverTime, synergyTeams: synergyTeams(snapshot) });
};

const queueState = (snapshot: CloudSnapshotV2): QueueState => { const serverTime = now(); const values = snapshot.queuePlayers.map((player) => playerView(player, snapshot)); const ranked = undefeatedChallengePlayers(snapshot.queuePlayers.map((player) => ({ id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: effectiveFor(player, snapshot).weight, skillLevel: effectiveFor(player, snapshot).level, status: player.status, gamesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null }))); return { serverTime, guided: guidedAvailabilityOffline(snapshot, serverTime), minimumRestMinutes: minimumRestMinutes(snapshot), lateArrivalCutoffAt: snapshot.workspace.lateArrivalCutoffAt ?? null, synergyTeams: synergyTeams(snapshot).map((team) => { const first = findQueuePlayer(snapshot, team.queuePlayerIds[0]); const second = findQueuePlayer(snapshot, team.queuePlayerIds[1]); const weight = Math.max(first?.skillWeight ?? 0, second?.skillWeight ?? 0); return { id: team.id, queuePlayerIds: team.queuePlayerIds as [string, string], effectiveSkillWeight: weight, effectiveSkillLevel: (Object.entries(skillWeights).find(([, value]) => value === weight)?.[0] ?? first?.skillLevel ?? second?.skillLevel ?? "BEGINNER"), version: team.version, createdAt: team.createdAt }; }), undefeatedChallenge: { minimumMatches: UNDEFEATED_CHALLENGE_MINIMUM_MATCHES, rankLimit: UNDEFEATED_CHALLENGE_RANK_LIMIT, players: ranked.map(({ player, rank }) => ({ queuePlayerId: player.id, displayName: player.displayName, rank, matchesPlayed: player.gamesPlayed, wins: player.wins ?? 0, losses: player.losses ?? 0, status: player.status, ready: player.status === "WAITING" && Date.parse(restEligibleAt(findQueuePlayer(snapshot, player.id)!, snapshot)) <= Date.now(), restEligibleAt: restEligibleAt(findQueuePlayer(snapshot, player.id)!, snapshot) })) }, inactive: values.filter((player) => ["INACTIVE", "CHECKED_OUT"].includes(player.status)), waiting: values.filter((player) => player.status === "WAITING"), queued: values.filter((player) => player.status === "QUEUED"), playing: values.filter((player) => player.status === "PLAYING"), resting: values.filter((player) => player.status === "RESTING") }; };
const normalizeChallengeStatus = (state: QueueState): QueueState => state.undefeatedChallenge ? { ...state, undefeatedChallenge: { ...state.undefeatedChallenge, minimumMatches: UNDEFEATED_CHALLENGE_MINIMUM_MATCHES, rankLimit: UNDEFEATED_CHALLENGE_RANK_LIMIT } } : state;

async function mutate<T>(accountId: string, action: string, update: (snapshot: CloudSnapshotV2) => T | Promise<T>, auditOverride?: Omit<LocalAuditEvent, "id" | "accountId" | "createdAt"> | (() => Omit<LocalAuditEvent, "id" | "accountId" | "createdAt">)) {
  const allowedAfterEnd = new Set(["WORKSPACE_RESET", "WORKSPACE_ENDED", "PAYMENT_CREATED", "PLAYER_CREATED", "PLAYER_UPDATED", "PLAYERS_DELETED", "SETTINGS_UPDATED"]);
  const result = await updateLocalSnapshot(accountId, (snapshot) => {
    if (snapshot.workspace.endedAt && !allowedAfterEnd.has(action)) throw new Error("This queue session has ended. Start a fresh queue before continuing operations.");
    return update(snapshot);
  });
  if (action === "WORKSPACE_RESET") await updateLocalSnapshot(accountId, (snapshot) => { snapshot.synergyTeams = []; return undefined; });
  if (action !== "WORKSPACE_RESET") await appendAudit(accountId, typeof auditOverride === "function" ? auditOverride() : auditOverride ?? { action, entityType: "ACCOUNT", entityId: accountId, reason: "Recorded offline" });
  return result;
}
async function addPlayers(accountId: string, body: Record<string, unknown>) { return mutate(accountId, "PLAYERS_ADDED", (snapshot) => { const ids = [...new Set((Array.isArray(body.playerIds) ? body.playerIds : []).map(String))]; const result: DomainQueuePlayer[] = []; for (const playerId of ids) { const player = snapshot.players.find((item) => item.id === playerId && item.status === "ACTIVE"); if (!player || snapshot.queuePlayers.some((item) => item.playerId === playerId)) throw new Error("Every selected player must be active and not already in the current queue."); const created: DomainQueuePlayer = { id: id(), playerId, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel as DomainQueuePlayer["skillLevel"], skillWeight: player.skillWeight, status: "INACTIVE", matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, amountDueMinor: 0, manualPriority: 0, priorityReason: null, latePenaltyState: null, latePenaltyAppliedAt: null, queueEnteredAt: null, lastMatchEndedAt: null, currentMatchId: null, checkedInAt: null, checkedOutAt: null, restStartedAt: null, version: 1 }; snapshot.queuePlayers.push(created); result.push(created); } return result.map((player) => playerView(player, snapshot)); }); }
async function transition(accountId: string, queuePlayerId: string, status: DomainQueuePlayer["status"], action: string) { return mutate(accountId, action, (snapshot) => { const player = findQueuePlayer(snapshot, queuePlayerId); if (!player) throw new Error("Queue player not found."); if (action === "LATE_PENALTY_WAIVED") { player.latePenaltyState = "WAIVED"; player.version += 1; snapshot.workspace.matchmakingRevision += 1; snapshot.workspace.version += 1; return playerView(player); } const changedAt = now(); if (action === "QUEUE_PLAYER_CHECK_IN") { const late = Boolean(!player.checkedInAt && snapshot.workspace.lateArrivalCutoffAt && Date.parse(changedAt) > Date.parse(snapshot.workspace.lateArrivalCutoffAt) && !player.latePenaltyState); player.status = "WAITING"; player.checkedInAt = player.checkedInAt ?? changedAt; player.checkedOutAt = null; player.queueEnteredAt = changedAt; if (late) { player.latePenaltyState = "PENDING"; player.latePenaltyAppliedAt = changedAt; } } else { player.status = status; player.checkedInAt = player.checkedInAt ?? (status === "WAITING" ? changedAt : null); player.checkedOutAt = status === "CHECKED_OUT" ? changedAt : status === "WAITING" ? null : player.checkedOutAt ?? null; player.restStartedAt = status === "RESTING" ? changedAt : null; player.queueEnteredAt = status === "WAITING" ? changedAt : null; } player.version += 1; snapshot.workspace.matchmakingRevision += 1; snapshot.workspace.version += 1; return playerView(player); }); }
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
        const late = Boolean(!player.checkedInAt && snapshot.workspace.lateArrivalCutoffAt && Date.parse(changedAt) > Date.parse(snapshot.workspace.lateArrivalCutoffAt) && !player.latePenaltyState);
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
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return players.map((player) => playerView(player!));
  });
}
const synergyTeamViewOffline = (snapshot: CloudSnapshotV2, team: DomainSynergyTeam): SynergyTeam => { const first = findQueuePlayer(snapshot, team.queuePlayerIds[0]); const second = findQueuePlayer(snapshot, team.queuePlayerIds[1]); const weight = Math.max(first?.skillWeight ?? 0, second?.skillWeight ?? 0); return { id: team.id, queuePlayerIds: team.queuePlayerIds, effectiveSkillWeight: weight, effectiveSkillLevel: Object.entries(skillWeights).find(([, value]) => value === weight)?.[0] ?? first?.skillLevel ?? "BEGINNER", version: team.version, createdAt: team.createdAt }; };
async function mutateSynergyTeam(accountId: string, method: string, teamId: string | undefined, body: Record<string, unknown>) {
  return mutate(accountId, method === "POST" ? "SYNERGY_TEAM_CREATED" : method === "PATCH" ? "SYNERGY_TEAM_UPDATED" : "SYNERGY_TEAM_DISSOLVED", (snapshot) => {
    const ids = Array.isArray(body.queuePlayerIds) ? body.queuePlayerIds.map(String) : [];
    if (method !== "DELETE" && (ids.length !== 2 || ids[0] === ids[1])) throw new Error("Choose exactly two distinct queue players.");
    const teams = (snapshot.synergyTeams ?? []) as DomainSynergyTeam[];
    const current = teamId ? teams.find((team) => team.id === teamId) : undefined;
    if (method !== "POST" && !current) throw new Error("Synergy Team not found.");
    if (method !== "POST" && Number((body as { version?: unknown }).version ?? current?.version) !== current?.version) throw new Error("The Synergy Team changed on another device.");
    const selected = method === "DELETE" ? current!.queuePlayerIds : ids;
    const players = selected.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId));
    const previousPlayers = current ? current.queuePlayerIds.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId)) : [];
    if (previousPlayers.some((player) => ["QUEUED", "PLAYING"].includes(player?.status ?? ""))) throw new Error("Synergy Teams can only be changed while both players are free.");
    if (players.some((player) => !player)) throw new Error("Both Synergy Team members must belong to this session.");
    if (players.some((player) => ["QUEUED", "PLAYING"].includes(player!.status))) throw new Error("Synergy Teams can only be changed while both players are free.");
    if (method !== "DELETE" && teams.some((team) => team.id !== current?.id && team.queuePlayerIds.some((queuePlayerId) => selected.includes(queuePlayerId)))) throw new Error("Each queue player can belong to only one Synergy Team.");
    if (method === "DELETE") snapshot.synergyTeams = teams.filter((team) => team.id !== current!.id);
    else if (method === "PATCH") { current!.queuePlayerIds = selected as [string, string]; current!.version += 1; }
    else { if (!snapshot.synergyTeams) snapshot.synergyTeams = []; snapshot.synergyTeams.push({ id: id(), queuePlayerIds: selected as [string, string], createdAt: now(), version: 1 }); }
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    const result = method === "DELETE" ? undefined : (method === "PATCH" ? current : snapshot.synergyTeams?.[snapshot.synergyTeams.length - 1]);
    return result ? synergyTeamViewOffline(snapshot, result as DomainSynergyTeam) : undefined;
  });
}
async function makeSuggestionGeneric(accountId: string, body: Record<string, unknown>) {
  const snapshot = await readSnapshot(accountId);
  if (!snapshot) throw new Error("Download this account before working offline.");
  const input: MatchPlayer[] = snapshot.queuePlayers.map((player) => ({ id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, status: player.status, gamesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null }));
  const rawMode = String(body.mode);
  if (!(VALID_MATCHMAKING_MODES as readonly string[]).includes(rawMode)) throw new Error("Unsupported matchmaking mode.");
  const mode = rawMode as (typeof VALID_MATCHMAKING_MODES)[number];
  if (mode !== "BALANCED" && body.strengthGap !== undefined) throw new Error("Invalid matchmaking request.");
  if (mode === "BALANCED" && body.strengthGap !== undefined && (typeof body.strengthGap !== "number" || !Number.isInteger(body.strengthGap) || ![1, 2, 3].includes(body.strengthGap))) throw new Error("Invalid matchmaking request.");
  const strengthGap = mode === "BALANCED" ? (body.strengthGap === undefined ? 1 : body.strengthGap as 1 | 2 | 3) : undefined;
  if (body.excludeKeys !== undefined && (!Array.isArray(body.excludeKeys) || body.excludeKeys.some((key) => typeof key !== "string"))) throw new Error("Invalid matchmaking request.");
  const excludedKeys = body.excludeKeys === undefined ? [] : body.excludeKeys as string[];
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
  const options = mode === "BALANCED" ? { strengthGap: strengthGap as 1 | 2 | 3, minimumRestMinutes: minimumRestMinutes(snapshot), now: new Date(), synergyTeams: synergyTeams(snapshot) as any } : { minimumRestMinutes: minimumRestMinutes(snapshot), now: new Date(), synergyTeams: synergyTeams(snapshot) as any };
  let suggestion = suggestMatch(input, mode, history, excludedKeys, options);
  let cycleRestarted = false;
  if (!suggestion && excludedKeys.length && mode !== "UNDEFEATED_CHALLENGE") {
    suggestion = suggestMatch(input, mode, history, [], options);
    cycleRestarted = Boolean(suggestion);
  }
  if (!suggestion) {
    const waiting = snapshot.queuePlayers.filter((player) => player.status === "WAITING");
    const ready = waiting.filter((player) => Date.parse(restEligibleAt(player, snapshot)) <= Date.now());
    const waitingMaleCount = waiting.filter((player) => player.gender === "MALE").length;
    const waitingFemaleCount = waiting.filter((player) => player.gender === "FEMALE").length;
    const readyMaleCount = ready.filter((player) => player.gender === "MALE").length;
    const readyFemaleCount = ready.filter((player) => player.gender === "FEMALE").length;
    const compositionPool = snapshot.queuePlayers.filter((player) => player.status === "WAITING" || player.status === "RESTING");
    const compositionMaleCount = compositionPool.filter((player) => player.gender === "MALE").length;
    const compositionFemaleCount = compositionPool.filter((player) => player.gender === "FEMALE").length;
    const mixedCompositionBlocked = mode === "MIXED_DOUBLES" && (compositionMaleCount < 2 || compositionFemaleCount < 2);
    const nextEligibleAt = waiting.map((player) => restEligibleAt(player, snapshot)).filter((value) => Date.parse(value) > Date.now()).sort()[0] ?? null;
    const restBlocked = !mixedCompositionBlocked && ((mode === "MIXED_DOUBLES" && (readyMaleCount < 2 || readyFemaleCount < 2)) || (mode !== "MIXED_DOUBLES" && waiting.length >= 4 && ready.length < 4)) && minimumRestMinutes(snapshot) > 0;
    const challengeRanked = undefeatedChallengePlayers(input);
    const challengeReady = challengeRanked.filter(({ player }) => player.status === "WAITING" && Date.parse(restEligibleAt(findQueuePlayer(snapshot, player.id)!, snapshot)) <= Date.now());
    const challengeNoMatch = mode === "UNDEFEATED_CHALLENGE";
    const challengeRestBlocked = challengeNoMatch && restBlocked;
    const balancedNoMatch = mode === "BALANCED" && !restBlocked;
    const noChallengeAlternate = challengeNoMatch && excludedKeys.length > 0;
    const message = challengeNoMatch ? (challengeRanked.length === 0 ? `No top-three player has reached ${UNDEFEATED_CHALLENGE_MINIMUM_MATCHES} wins without a loss yet.` : challengeReady.length === 0 ? "Qualified players are not ready for an Undefeated Challenge match." : challengeRestBlocked ? "Some waiting players are still completing their required rest period." : noChallengeAlternate ? "No other valid Undefeated Challenge lineup keeps the undefeated player at a disadvantage." : "No valid Undefeated Challenge lineup is available under the challenge rules.") : mixedCompositionBlocked ? "Mixed doubles requires exactly two ready male and two ready female players." : restBlocked ? "Some players are still completing their required rest period." : balancedNoMatch ? `No exact Handicap +${strengthGap} strength lineup is available. Choose a tighter mode and generate again.` : "No eligible group satisfies this mode.";
     return { suggestion: null, matchupAdvisory: null, cycleRestarted: false, noMatch: { code: challengeNoMatch ? (challengeRanked.length === 0 ? "NO_UNDEFEATED_QUALIFIER" : challengeReady.length === 0 || challengeRestBlocked ? "REST_REQUIRED" : "NO_VALID_GROUP") : mixedCompositionBlocked ? "NO_MIXED_DOUBLES_COMPOSITION" : restBlocked ? "REST_REQUIRED" : balancedNoMatch ? "NO_EXACT_STRENGTH_GAP" : "NO_VALID_GROUP", message, nextEligibleAt, readyMaleCount, readyFemaleCount, waitingMaleCount, waitingFemaleCount } };
  }
  const convert = (player: MatchPlayer) => playerView(findQueuePlayer(snapshot, player.id)!, snapshot);
  const expiresAt = Date.now() + 300000;
  const localTokenPayload = { algorithmVersion: MATCHMAKING_ALGORITHM, revision: snapshot.workspace.matchmakingRevision, mode, ...(strengthGap === undefined ? {} : { strengthGap }), key: suggestion.key, teamA: suggestion.teamA.map((player) => player.id), teamB: suggestion.teamB.map((player) => player.id), expiresAt };
  const result: Suggestion = { token: encodeLocalSuggestion(localTokenPayload), expiresAt, key: suggestion.key, difference: suggestion.difference, teamATotal: suggestion.teamATotal, teamBTotal: suggestion.teamBTotal, lateArrivalCutoffAt: snapshot.workspace.lateArrivalCutoffAt ?? null, matchupAdvisory: lowSkillLoneFemaleAdvisory(suggestion.teamA, suggestion.teamB), teamA: suggestion.teamA.map(convert), teamB: suggestion.teamB.map(convert), explanation: suggestion.explanation as Suggestion["explanation"] };
   return { suggestion: result, matchupAdvisory: result.matchupAdvisory ?? null, cycleRestarted };
}

async function makeSuggestion(accountId: string, body: Record<string, unknown>) {
  const result = await makeSuggestionGeneric(accountId, body) as { suggestion: Suggestion | null; matchupAdvisory?: unknown; cycleRestarted: boolean; noMatch?: Record<string, unknown> };
  if (String(body.mode) !== "GUIDED" || result.suggestion) {
    return result;
  }
  const snapshot = await readSnapshot(accountId);
  if (!snapshot) return result;
  const guided = guidedAvailabilityOffline(snapshot, now());
  const code = guided.reason ?? "NO_VALID_GROUP";
  const message = code === "NO_GUIDED_COMPOSITION"
    ? `Guided requires two waiting Newbie/Beginner learners and two waiting Intermediate guides (${guided.readyLearnerCount}/${guided.waitingLearnerCount} learners ready, ${guided.readyGuideCount}/${guided.waitingGuideCount} guides ready).`
    : code === "REST_REQUIRED"
      ? `Guided has enough learners and guides, but some are still resting (${guided.readyLearnerCount}/${guided.waitingLearnerCount} learners ready, ${guided.readyGuideCount}/${guided.waitingGuideCount} guides ready).`
      : "No valid Guided partition satisfies the gender or Synergy Team constraints.";
  return { ...result, noMatch: { ...(result.noMatch ?? {}), code, message, nextEligibleAt: guided.nextEligibleAt, waitingLearnerCount: guided.waitingLearnerCount, waitingGuideCount: guided.waitingGuideCount, readyLearnerCount: guided.readyLearnerCount, readyGuideCount: guided.readyGuideCount } };
}

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
    const toMatchPlayer = (player: DomainQueuePlayer): MatchPlayer => { const effective = effectiveFor(player, snapshot); return { id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: player.skillWeight, skillLevel: player.skillLevel, effectiveSkillWeight: effective.weight, effectiveSkillLevel: effective.level, synergyTeamId: effective.teamId ?? null, status: player.status, gamesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null }; };
    const suggestionPayload = typeof body.suggestionToken === "string" ? decodeLocalSuggestion(body.suggestionToken) : null;
    const overrideToManual = body.overrideToManual === true;
    if (overrideToManual && (!suggestionPayload || body.suggestionAdjusted !== true)) throw new Error("Manual conversion requires an edited suggestion.");
     if (suggestionPayload && (suggestionPayload.algorithmVersion !== MATCHMAKING_ALGORITHM || Number(suggestionPayload.revision) !== snapshot.workspace.matchmakingRevision || Number(suggestionPayload.expiresAt) < Date.now())) throw new Error("SUGGESTION_STALE: Generate a new suggestion.");
     if (suggestionPayload && !body.suggestionAdjusted && (JSON.stringify(suggestionPayload.teamA) !== JSON.stringify(teamA) || JSON.stringify(suggestionPayload.teamB) !== JSON.stringify(teamB))) throw new Error("SUGGESTION_STALE: Generate a new suggestion.");
    const teamAPlayers = teamA.map((queuePlayerId) => toMatchPlayer(findQueuePlayer(snapshot, queuePlayerId)!));
    const teamBPlayers = teamB.map((queuePlayerId) => toMatchPlayer(findQueuePlayer(snapshot, queuePlayerId)!));
    const challengeQualifiedIds = suggestionPayload?.mode === "UNDEFEATED_CHALLENGE"
      ? new Set(undefeatedChallengePlayers(snapshot.queuePlayers.map(challengeInput)).map(({ player }) => player.id))
      : new Set<string>();
    const challengeSelectedPlayerIds = ids.filter((queuePlayerId) => challengeQualifiedIds.has(queuePlayerId));
    const synergyError = validateSynergyLineup(teamAPlayers, teamBPlayers, (snapshot.synergyTeams ?? []) as any);
    if (suggestionPayload?.mode === "GUIDED" && !overrideToManual) validateGuidedMutation(teamAPlayers, teamBPlayers, synergyError);
     else if (synergyError) throw new Error(`SYNERGY_TEAM_LINEUP: ${synergyError}`);
     let generatedLoneFemalePolicy: ReturnType<typeof loneFemalePolicy> | null = null;
     let generatedMatchupAdvisory: ReturnType<typeof lowSkillLoneFemaleAdvisory> = lowSkillLoneFemaleAdvisory(teamA.map((queuePlayerId) => toMatchPlayer(findQueuePlayer(snapshot, queuePlayerId)!)), teamB.map((queuePlayerId) => toMatchPlayer(findQueuePlayer(snapshot, queuePlayerId)!)));
    if (suggestionPayload && !overrideToManual) {
       generatedLoneFemalePolicy = loneFemalePolicy(teamAPlayers, teamBPlayers, suggestionPayload.mode === "MIXED_DOUBLES");
       generatedMatchupAdvisory = lowSkillLoneFemaleAdvisory(teamAPlayers, teamBPlayers);
      if (suggestionPayload.mode === "MIXED_DOUBLES") {
        const mixedError = validateMixedDoublesLineup(teamAPlayers, teamBPlayers);
        if (mixedError) throw new Error(`MIXED_DOUBLES_COMPOSITION: ${mixedError}`);
      }
      if (isProhibitedGeneratedGenderMatch(teamAPlayers, teamBPlayers)) throw new Error("GENERATED_GENDER_RULE: Generated matchups cannot place two female players against two male players.");
      if (suggestionPayload.mode === "BALANCED") {
        const balanceError = validateBalancedLineup(teamAPlayers, teamBPlayers, Number(suggestionPayload.strengthGap ?? 1));
        if (balanceError) throw new Error(`BALANCE_CONSTRAINT_VIOLATION: ${balanceError}`);
      }
      if (suggestionPayload.mode !== "GUIDED" && suggestionPayload.mode !== "UNDEFEATED_CHALLENGE") {
        const guaranteeError = validateOfflineModeGuarantee(suggestionPayload.mode, teamAPlayers, teamBPlayers, Number(suggestionPayload.strengthGap ?? 1));
        if (guaranteeError) {
          const code = suggestionPayload.mode === "MIXED_DOUBLES" ? "MIXED_DOUBLES_COMPOSITION" : suggestionPayload.mode === "BALANCED" ? "BALANCE_CONSTRAINT_VIOLATION" : "MODE_CONSTRAINT_VIOLATION";
          throw new Error(`${code}: ${guaranteeError}`);
        }
      }
      if (suggestionPayload.mode === "UNDEFEATED_CHALLENGE" && body.suggestionAdjusted === true) throw new Error("UNDEFEATED_CHALLENGE_CONSTRAINT: Edited Undefeated Challenge lineups must continue as Manual Adjusted.");
    }
    if (suggestionPayload && !overrideToManual && suggestionPayload.mode !== "GUIDED" && isProhibitedGeneratedNewbieMatch(teamAPlayers, teamBPlayers)) {
      throw new Error(`MODE_CONSTRAINT_VIOLATION: Generated matchups cannot pair a Newbie with an incompatible partner.`);
    }
    if (body.courtId || body.suggestionToken) {
      const blocked = (players as DomainQueuePlayer[]).filter((player) => Date.parse(restEligibleAt(player, snapshot)) > Date.now());
      if (blocked.length) throw new Error(`REST_REQUIRED: ${blocked.map((player) => player.displayName).join(", ")} must complete the configured rest period before playing again.`);
    }
    const court = body.courtId ? findCourt(snapshot, String(body.courtId)) : undefined;
    if (body.courtId && (!court || court.status !== "AVAILABLE" || court.currentMatchId)) throw new Error("The selected court is not available.");
    const createdAt = now();
    const adjusted = Boolean(body.suggestionAdjusted);
    const challengeAdjusted = suggestionPayload?.mode === "UNDEFEATED_CHALLENGE" && adjusted;
    const suggestionMode = overrideToManual || challengeAdjusted ? null : suggestionPayload?.mode as DomainMatch["matchmakingMode"] ?? null;
    const suggestionAlgorithm = body.suggestionToken && !overrideToManual && !challengeAdjusted ? MATCHMAKING_ALGORITHM : null;
     if (court && generatedMatchupAdvisory && body.playerPreferenceConfirmed !== true) throw preferenceConfirmationError(generatedMatchupAdvisory);
     const suggestionExplanation = suggestionPayload ? { mode: suggestionMode, originalMode: suggestionPayload.mode ?? null, challengeRelabeled: challengeAdjusted, adjusted, generatedOrigin: "SUGGESTION", algorithmVersion: suggestionAlgorithm, strengthGap: suggestionPayload.strengthGap ?? null, generatedGenderRule: "NO_TWO_FEMALE_VS_TWO_MALE", loneFemalePolicy: generatedLoneFemalePolicy, rest: { minimumRestMinutes: minimumRestMinutes(snapshot) } } : generatedMatchupAdvisory ? { matchupAdvisory: generatedMatchupAdvisory } : null;
    if (suggestionPayload?.mode === "UNDEFEATED_CHALLENGE" && suggestionExplanation && typeof suggestionExplanation === "object") Object.assign(suggestionExplanation, { challenge: { selectedPlayerIds: challengeSelectedPlayerIds } });
    if (overrideToManual && suggestionExplanation && typeof suggestionExplanation === "object") Object.assign(suggestionExplanation, { originalAlgorithmVersion: suggestionPayload?.algorithmVersion ?? MATCHMAKING_ALGORITHM, originalSuggestionKey: suggestionPayload?.key ?? null, overrideToManual: true, adjusted: true });
    const match: DomainMatch = { id: id(), courtId: court?.id ?? null, courtIdSnapshot: court?.id ?? null, courtNameSnapshot: court?.name ?? null, status: court ? "IN_PROGRESS" : "QUEUED", source: overrideToManual ? "MANUAL_ADJUSTED" : body.suggestionToken ? (adjusted ? "MANUAL_ADJUSTED" : "AUTOMATIC") : "MANUAL", matchmakingMode: suggestionMode, algorithmVersion: suggestionAlgorithm, suggestionKey: overrideToManual || challengeAdjusted ? null : typeof body.suggestionToken === "string" ? body.suggestionToken : null, suggestionExplanation, pointsToWin: settings(snapshot).pointsToWin, winBy: settings(snapshot).winBy, scoreCap: settings(snapshot).scoreCap, bestOf: settings(snapshot).bestOf, queuedAt: createdAt, startedAt: court ? createdAt : null, completedAt: null, cancelledAt: null, cancellationReason: null, winnerTeam: null, currentRevisionId: null, version: 1, participants: [...teamA.map((queuePlayerId, index) => ({ id: id(), matchId: "", queuePlayerId, team: "A" as const, teamSlot: index + 1, priorQueueEnteredAt: findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null })), ...teamB.map((queuePlayerId, index) => ({ id: id(), matchId: "", queuePlayerId, team: "B" as const, teamSlot: index + 1, priorQueueEnteredAt: findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null }))], scoreRevisions: [] };
    if (suggestionPayload && !challengeAdjusted && !overrideToManual) match.suggestionKey = persistedSuggestionKey(suggestionPayload, typeof body.suggestionToken === "string" ? body.suggestionToken : null);
    if (suggestionPayload?.mode === "GUIDED" && match.suggestionExplanation && typeof match.suggestionExplanation === "object") {
      const guidedPlayers: GuidedLineupPlayer[] = ids.map((queuePlayerId) => { const player = findQueuePlayer(snapshot, queuePlayerId); return { id: queuePlayerId, skillLevel: player!.skillLevel }; });
      match.suggestionExplanation = { ...(match.suggestionExplanation as Record<string, unknown>), guided: buildGuidedExplanation(guidedPlayers) };
    }
    match.participants.forEach((participant) => { participant.matchId = match.id; });
    snapshot.matches.push(match);
    if (court) { court.status = "OCCUPIED"; court.currentMatchId = match.id; court.version += 1; }
    reconcileOfflinePlayers(snapshot, ids, createdAt);
    if (court) serveOfflineLatePenalties(snapshot, ids);
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return matchView(snapshot, match);
  });
}

async function finishMatchStacked(accountId: string, matchId: string, games: Array<{ teamAScore: number; teamBScore: number }>) {
  return mutate(accountId, "MATCH_COMPLETED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    if (!match || match.status !== "IN_PROGRESS") throw new Error("Only playing matches can be completed.");
    const beforeChallengePlayers = snapshot.queuePlayers.map((player) => ({ ...player }));
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
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return { ...matchView(snapshot, match), notifications: challengeNotifications(beforeChallengePlayers, snapshot.queuePlayers) };
  });
}

async function correctMatchStacked(accountId: string, matchId: string, games: Array<{ teamAScore: number; teamBScore: number }>, reason?: string) {
  return mutate(accountId, "MATCH_SCORE_CORRECTED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    if (!match || match.status !== "COMPLETED") throw new Error("Only completed matches can be corrected.");
    const validated = validateScores(games, { pointsToWin: match.pointsToWin, winBy: match.winBy, scoreCap: match.scoreCap, bestOf: match.bestOf });
    const beforeChallengePlayers = snapshot.queuePlayers.map((player) => ({ ...player }));
    const winnerTeam: "A" | "B" = validated.filter((game) => game.winnerTeam === "A").length > validated.length / 2 ? "A" : "B";
    const revisionId = id();
    const supersedesRevisionId = match.currentRevisionId ?? null;
    const previousRevision = [...match.scoreRevisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
    match.winnerTeam = winnerTeam;
    match.currentRevisionId = revisionId;
    match.version += 1;
    match.scoreRevisions.push({ id: revisionId, matchId, revisionNumber: (previousRevision?.revisionNumber ?? 0) + 1, winnerTeam, reason: reason ?? "Score correction", supersedesRevisionId, createdAt: now(), games: validated.map((game, index) => ({ id: id(), scoreRevisionId: revisionId, gameNumber: index + 1, teamAScore: game.teamAScore, teamBScore: game.teamBScore, winnerTeam: game.winnerTeam })) });
    for (const player of snapshot.queuePlayers) { player.matchesPlayed = 0; player.wins = 0; player.losses = 0; player.pointsFor = 0; player.pointsAgainst = 0; }
    for (const completed of snapshot.matches.filter((item) => item.status === "COMPLETED")) {
      const revision = scoreFor(completed);
      if (!revision) continue;
      const points = revision.games.reduce((sum, game) => ({ a: sum.a + game.teamAScore, b: sum.b + game.teamBScore }), { a: 0, b: 0 });
      for (const participant of completed.participants) {
        const player = findQueuePlayer(snapshot, participant.queuePlayerId);
        if (!player) continue;
        const won = participant.team === revision.winnerTeam;
        player.matchesPlayed += 1;
        player.wins += won ? 1 : 0;
        player.losses += won ? 0 : 1;
        player.pointsFor += participant.team === "A" ? points.a : points.b;
        player.pointsAgainst += participant.team === "A" ? points.b : points.a;
      }
    }
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return { ...matchView(snapshot, match), notifications: challengeNotifications(beforeChallengePlayers, snapshot.queuePlayers) };
  });
}

async function startMatchStacked(accountId: string, matchId: string, courtId: string, playerPreferenceConfirmed = false) {
  return mutate(accountId, "MATCH_STARTED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    const court = findCourt(snapshot, courtId);
    if (!match || match.status !== "QUEUED" || !court || court.status !== "AVAILABLE" || court.currentMatchId) throw new Error("The selected court is not available.");
    const ids = match.participants.map((participant) => participant.queuePlayerId);
    if (snapshot.matches.some((item) => item.status === "IN_PROGRESS" && item.participants.some((participant) => ids.includes(participant.queuePlayerId)))) throw new Error("This matchup is waiting for a player to finish their current match.");
    const players = ids.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId));
    if (players.some((player) => !player || !["WAITING", "QUEUED"].includes(player.status))) throw new Error("This matchup is not ready to start.");
     const startPlayers = players as DomainQueuePlayer[];
     const startTeamAIds = match.participants.filter((participant) => participant.team === "A").sort((a, b) => a.teamSlot - b.teamSlot).map((participant) => participant.queuePlayerId);
     const startTeamBIds = match.participants.filter((participant) => participant.team === "B").sort((a, b) => a.teamSlot - b.teamSlot).map((participant) => participant.queuePlayerId);
     const startTeamA = startTeamAIds.map((queuePlayerId) => startPlayers.find((player) => player.id === queuePlayerId)).filter((player): player is DomainQueuePlayer => Boolean(player)).map((player) => ({ id: player.id, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel } as MatchPlayer));
     const startTeamB = startTeamBIds.map((queuePlayerId) => startPlayers.find((player) => player.id === queuePlayerId)).filter((player): player is DomainQueuePlayer => Boolean(player)).map((player) => ({ id: player.id, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel } as MatchPlayer));
      const startExplanation = match.suggestionExplanation && typeof match.suggestionExplanation === "object" ? match.suggestionExplanation as Record<string, unknown> : null;
    validateOfflineUndefeatedChallengeStart(match, snapshot.queuePlayers);
    const startById = new Map(startPlayers.map((player) => [player.id, player]));
    const startToMatchPlayer = (queuePlayerId: string): MatchPlayer => { const player = startById.get(queuePlayerId); if (!player) throw new Error("This matchup is not ready to start."); return { id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, status: player.status, gamesPlayed: player.matchesPlayed, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0 }; };
    const startSynergyError = validateSynergyLineup(match.participants.filter((participant) => participant.team === "A").map((participant) => startToMatchPlayer(participant.queuePlayerId)), match.participants.filter((participant) => participant.team === "B").map((participant) => startToMatchPlayer(participant.queuePlayerId)), (snapshot.synergyTeams ?? []) as any);
    if (match.matchmakingMode === "GUIDED") validateGuidedMutation(startTeamA, startTeamB, startSynergyError);
    else if (startSynergyError) throw new Error(`SYNERGY_TEAM_LINEUP: ${startSynergyError}`);
    const startAdvisory = lowSkillLoneFemaleAdvisory(startTeamA, startTeamB);
    if (startAdvisory && !playerPreferenceConfirmed) throw preferenceConfirmationError(startAdvisory);
    if (startExplanation || startAdvisory) match.suggestionExplanation = { ...(startExplanation ?? {}), matchupAdvisory: startAdvisory };
    if (match.matchmakingMode === "BALANCED" || match.matchmakingMode === "MIXED_DOUBLES" || match.matchmakingMode === "GUIDED" || match.matchmakingMode === "SAME_SKILL" || match.matchmakingMode === "SAME_GENDER" || match.matchmakingMode === "OPEN" || match.matchmakingMode === "UNDEFEATED_CHALLENGE") {
      const byId = new Map((players as DomainQueuePlayer[]).map((player) => [player.id, player]));
      const toMatchPlayer = (queuePlayerId: string): MatchPlayer => { const player = byId.get(queuePlayerId); if (!player) throw new Error("This matchup is not ready to start."); const effective = effectiveFor(player, snapshot); return { id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, effectiveSkillWeight: effective.weight, effectiveSkillLevel: effective.level, synergyTeamId: effective.teamId ?? null, status: player.status, gamesPlayed: player.matchesPlayed, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null }; };
      const teamA = match.participants.filter((participant) => participant.team === "A").sort((a, b) => a.teamSlot - b.teamSlot).map((participant) => toMatchPlayer(participant.queuePlayerId));
      const teamB = match.participants.filter((participant) => participant.team === "B").sort((a, b) => a.teamSlot - b.teamSlot).map((participant) => toMatchPlayer(participant.queuePlayerId));
      if (match.matchmakingMode === "MIXED_DOUBLES") {
        const mixedError = validateMixedDoublesLineup(teamA, teamB);
        if (mixedError) throw new Error(`MIXED_DOUBLES_COMPOSITION: ${mixedError}`);
      } else if (match.matchmakingMode === "GUIDED") {
        const guidedError = validateGuidedLineup(teamA.map(guidedPlayerInput), teamB.map(guidedPlayerInput));
        if (guidedError) throw new Error(`GUIDED_COMPOSITION: ${guidedError}`);
        if (isProhibitedGeneratedGenderMatch(teamA, teamB)) throw new Error("GENERATED_GENDER_RULE: Generated matchups cannot place two female players against two male players.");
      } else if (match.matchmakingMode !== "UNDEFEATED_CHALLENGE") {
        const guaranteeError = validateOfflineModeGuarantee(match.matchmakingMode, teamA, teamB, Number((match.suggestionExplanation as { strengthGap?: number } | null)?.strengthGap ?? 1));
        if (guaranteeError) {
          const code = match.matchmakingMode === "BALANCED" ? "BALANCE_CONSTRAINT_VIOLATION" : "MODE_CONSTRAINT_VIOLATION";
          throw new Error(`${code}: ${guaranteeError}`);
        }
      } else if (match.source === "AUTOMATIC") {
        if (isProhibitedGeneratedGenderMatch(teamA, teamB)) throw new Error("GENERATED_GENDER_RULE: Generated matchups cannot place two female players against two male players.");
        if (isProhibitedGeneratedNewbieMatch(teamA, teamB)) throw new Error("MODE_CONSTRAINT_VIOLATION: Generated matchups cannot pair a Newbie with an incompatible partner.");
      }
    }
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
    serveOfflineLatePenalties(snapshot, ids);
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
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
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    return matchView(snapshot, match);
  });
}
async function updateMatchStacked(accountId: string, matchId: string, body: Record<string, unknown>) {
  return mutate(accountId, "MATCH_UPDATED", (snapshot) => {
    const match = snapshot.matches.find((item) => item.id === matchId);
    const teamA = Array.isArray(body.teamA) ? body.teamA.map(String) : [];
    const teamB = Array.isArray(body.teamB) ? body.teamB.map(String) : [];
    const ids = [...teamA, ...teamB];
    const live = match?.status === "IN_PROGRESS";
    if (!match || !["QUEUED", "IN_PROGRESS"].includes(match.status)) throw new Error("Only queued or playing matches can be edited.");
    if (!live && body.courtId !== undefined) throw new Error("COURT_TRANSFER_NOT_LIVE: A court can only be changed while a match is playing.");
    if (body.swapWithMatchId !== undefined && body.courtId === undefined) throw new Error("A target court is required for a court swap.");
    if (body.swapWithMatchId !== undefined && body.courtId !== undefined && String(body.courtId) === match?.courtId) throw new Error("Choose a different target court for a court swap.");
    if (![1, 2].includes(teamA.length) || teamA.length !== teamB.length || new Set(ids).size !== ids.length) throw new Error("Choose one player per team for singles or two per team for doubles.");
    const oldIds = match.participants.map((participant) => participant.queuePlayerId);
    const originalTeamA = match.participants.filter((participant) => participant.team === "A").sort((a, b) => a.teamSlot - b.teamSlot).map((participant) => participant.queuePlayerId);
    const originalTeamB = match.participants.filter((participant) => participant.team === "B").sort((a, b) => a.teamSlot - b.teamSlot).map((participant) => participant.queuePlayerId);
    const originalIds = new Set(oldIds);
    const overrideToManual = body.overrideToManual === true;
    if (overrideToManual && match.source === "MANUAL") throw new Error("Manual conversion requires a suggested or generated matchup.");
    if (overrideToManual && JSON.stringify(originalTeamA) === JSON.stringify(teamA) && JSON.stringify(originalTeamB) === JSON.stringify(teamB)) throw new Error("Manual conversion requires an edited lineup.");
    const players = ids.map((queuePlayerId) => findQueuePlayer(snapshot, queuePlayerId));
    if (players.some((player) => !player || (live ? originalIds.has(player.id) ? player.status !== "PLAYING" : player.status !== "WAITING" : !["WAITING", "QUEUED", "PLAYING"].includes(player.status)))) throw new Error(live ? "PLAYER_BUSY: New live-match participants must be waiting and cannot already be queued or playing another match." : "Only waiting, queued, or playing players can be assigned.");
    const selected = players as DomainQueuePlayer[];
    const byId = new Map(selected.map((player) => [player.id, player]));
    const synergyError = validateSynergyLineup(teamA.map((queuePlayerId) => { const player = findQueuePlayer(snapshot, queuePlayerId); if (!player) throw new Error("Every selected player must be in the current queue."); return { id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, status: player.status, gamesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0 }; }), teamB.map((queuePlayerId) => { const player = findQueuePlayer(snapshot, queuePlayerId); if (!player) throw new Error("Every selected player must be in the current queue."); return { id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, status: player.status, gamesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0 }; }), (snapshot.synergyTeams ?? []) as any);
     if (synergyError && match.matchmakingMode !== "GUIDED") throw new Error(`SYNERGY_TEAM_LINEUP: ${synergyError}`);
     const toMatchPlayer = (queuePlayerId: string): MatchPlayer => { const player = byId.get(queuePlayerId); if (!player) throw new Error("Every selected player must be waiting, queued, or playing."); const effective = effectiveFor(player, snapshot); return { id: player.id, displayName: player.displayName, gender: player.gender, skillWeight: skillWeight(player.skillLevel), skillLevel: player.skillLevel, effectiveSkillWeight: effective.weight, effectiveSkillLevel: effective.level, synergyTeamId: effective.teamId ?? null, status: player.status, gamesPlayed: player.matchesPlayed, queueEnteredAt: player.queueEnteredAt ?? null, lastMatchEndedAt: player.lastMatchEndedAt ?? null, manualPriority: player.manualPriority ?? 0, latePenaltyState: player.latePenaltyState ?? null }; };
     if (match.matchmakingMode === "GUIDED" && !overrideToManual) validateGuidedMutation(teamA.map(toMatchPlayer), teamB.map(toMatchPlayer), synergyError);
    const addedPlayers = selected.filter((player) => !originalIds.has(player.id));
    const blocked = live ? addedPlayers.filter((player) => Date.parse(restEligibleAt(player, snapshot)) > Date.now()) : [];
    if (blocked.length) throw new Error(`REST_REQUIRED: ${blocked.map((player) => player.displayName).join(", ")} must complete the configured rest period before playing again.`);
     if (!overrideToManual && match.source === "AUTOMATIC" && match.matchmakingMode !== "GUIDED" && isProhibitedGeneratedGenderMatch(teamA.map(toMatchPlayer), teamB.map(toMatchPlayer))) throw new Error("GENERATED_GENDER_RULE: Generated matchups cannot place two female players against two male players.");
     if (!overrideToManual && match.source === "AUTOMATIC" && match.matchmakingMode !== "GUIDED" && isProhibitedGeneratedNewbieMatch(teamA.map(toMatchPlayer), teamB.map(toMatchPlayer))) throw new Error("MODE_CONSTRAINT_VIOLATION: Generated matchups cannot pair a Newbie with an incompatible partner.");
    if (match.matchmakingMode === "BALANCED" && !overrideToManual) {
      const balanceError = validateBalancedLineup(teamA.map(toMatchPlayer), teamB.map(toMatchPlayer), Number((match.suggestionExplanation as { strengthGap?: number } | null)?.strengthGap ?? 1));
      if (balanceError) throw new Error(`BALANCE_CONSTRAINT_VIOLATION: ${balanceError}`);
    }
    if (!overrideToManual && match.matchmakingMode && match.matchmakingMode !== "GUIDED" && match.matchmakingMode !== "BALANCED") {
      const guaranteeError = validateOfflineModeGuarantee(match.matchmakingMode, teamA.map(toMatchPlayer), teamB.map(toMatchPlayer), Number((match.suggestionExplanation as { strengthGap?: number } | null)?.strengthGap ?? 1));
      if (guaranteeError) {
        const code = match.matchmakingMode === "UNDEFEATED_CHALLENGE" ? "UNDEFEATED_CHALLENGE_CONSTRAINT" : match.matchmakingMode === "MIXED_DOUBLES" ? "MIXED_DOUBLES_COMPOSITION" : "MODE_CONSTRAINT_VIOLATION";
        throw new Error(`${code}: ${guaranteeError}`);
      }
    }
    if (live && body.courtId !== undefined && String(body.courtId) !== match.courtId) {
      const targetCourt = findCourt(snapshot, String(body.courtId));
      const currentCourt = findCourt(snapshot, match.courtId ?? undefined);
      if (!targetCourt) throw new Error("COURT_NOT_AVAILABLE: The selected court is no longer available.");
      if (targetCourt.status === "AVAILABLE" && !targetCourt.currentMatchId) {
        if (body.swapWithMatchId !== undefined) throw new Error("COURT_SWAP_STALE: The selected court is no longer occupied. Refresh the live courts and try again.");
        if (currentCourt?.currentMatchId === match.id) { currentCourt.currentMatchId = null; currentCourt.status = "AVAILABLE"; currentCourt.version += 1; }
        targetCourt.status = "OCCUPIED";
        targetCourt.currentMatchId = match.id;
        targetCourt.version += 1;
      } else {
        if (typeof body.swapWithMatchId !== "string") throw new Error("COURT_SWAP_REQUIRED: The selected court is occupied. Confirm a court swap to continue.");
        const swappedMatch = snapshot.matches.find((item) => item.id === body.swapWithMatchId && item.status === "IN_PROGRESS" && item.courtId === targetCourt.id);
        if (!currentCourt || currentCourt.status !== "OCCUPIED" || currentCourt.currentMatchId !== match.id || targetCourt.status !== "OCCUPIED" || targetCourt.currentMatchId !== body.swapWithMatchId || !swappedMatch || swappedMatch.id === match.id) throw new Error("COURT_SWAP_STALE: The selected court assignments changed. Refresh the live courts and try again.");
        currentCourt.currentMatchId = swappedMatch.id;
        currentCourt.version += 1;
        targetCourt.currentMatchId = match.id;
        targetCourt.version += 1;
        swappedMatch.courtId = currentCourt.id;
        swappedMatch.courtIdSnapshot = currentCourt.id;
        swappedMatch.courtNameSnapshot = currentCourt.name;
        swappedMatch.source = "MANUAL_ADJUSTED";
        swappedMatch.suggestionKey = null;
        swappedMatch.suggestionExplanation = { ...(swappedMatch.suggestionExplanation as Record<string, unknown> | null ?? {}), adjusted: true };
        swappedMatch.version += 1;
      }
      match.courtId = targetCourt.id;
      match.courtIdSnapshot = targetCourt.id;
      match.courtNameSnapshot = targetCourt.name;
    }
     const prior = new Map(match.participants.map((participant) => [participant.queuePlayerId, participant.priorQueueEnteredAt ?? null]));
    match.participants = [...teamA.map((queuePlayerId, index) => ({ id: id(), matchId, queuePlayerId, team: "A" as const, teamSlot: index + 1, priorQueueEnteredAt: prior.get(queuePlayerId) ?? findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null })), ...teamB.map((queuePlayerId, index) => ({ id: id(), matchId, queuePlayerId, team: "B" as const, teamSlot: index + 1, priorQueueEnteredAt: prior.get(queuePlayerId) ?? findQueuePlayer(snapshot, queuePlayerId)?.queueEnteredAt ?? null }))];
     const previousExplanation = match.suggestionExplanation && typeof match.suggestionExplanation === "object" ? match.suggestionExplanation as Record<string, unknown> : null;
     const previousMode = match.matchmakingMode;
     const previousAlgorithm = match.algorithmVersion;
     const previousSuggestionKey = match.suggestionKey;
     const updatedAdvisory = lowSkillLoneFemaleAdvisory(teamA.map(toMatchPlayer), teamB.map(toMatchPlayer));
     const preservedMode = !overrideToManual && match.matchmakingMode && match.matchmakingMode !== "UNDEFEATED_CHALLENGE" ? match.matchmakingMode : null;
     const preservedGuided = preservedMode === "GUIDED";
     const guidedExplanation = preservedGuided ? { guided: buildGuidedExplanation([...teamA, ...teamB].map((queuePlayerId) => { const player = findQueuePlayer(snapshot, queuePlayerId); return { id: queuePlayerId, skillLevel: player!.skillLevel }; })) } : {};
     match.source = "MANUAL_ADJUSTED";
     match.matchmakingMode = preservedMode;
     match.algorithmVersion = preservedMode ? match.algorithmVersion ?? MATCHMAKING_ALGORITHM : null;
     match.suggestionKey = null;
     match.suggestionExplanation = previousExplanation || updatedAdvisory || preservedMode || overrideToManual ? { ...(previousExplanation ?? {}), ...(overrideToManual ? { originalMode: previousMode, originalAlgorithmVersion: previousAlgorithm, originalSuggestionKey: previousSuggestionKey, overrideToManual: true, adjusted: true } : {}), ...(preservedMode ? { algorithmVersion: match.algorithmVersion, adjusted: true } : {}), ...(preservedGuided ? guidedExplanation : {}), matchupAdvisory: updatedAdvisory } : null;
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
  let auditAfter: Record<string, unknown> | undefined;
  return mutate(accountId, "WORKSPACE_ENDED", (snapshot) => {
    if (snapshot.workspace.endedAt) throw new Error("This queue session has already ended.");
    if (snapshot.matches.some((match) => match.status === "IN_PROGRESS")) throw new Error("Finish the playing match before ending this session.");
    const endedAt = now();
    const affected = snapshot.matches.filter((match) => match.status === "QUEUED");
    const affectedIds = affected.flatMap((match) => match.participants.map((participant) => participant.queuePlayerId));
    for (const match of affected) { match.status = "CANCELLED"; match.cancelledAt = endedAt; match.cancellationReason = "Session ended"; match.version += 1; }
    reconcileOfflinePlayers(snapshot, affectedIds, endedAt);
    const checkedIn = snapshot.queuePlayers.filter((player) => Boolean(player.checkedInAt));
    for (const player of checkedIn) { player.status = "CHECKED_OUT"; player.checkedOutAt = player.checkedOutAt ?? endedAt; player.queueEnteredAt = null; player.currentMatchId = null; player.version += 1; }
    const config = snapshot.feeConfig ?? {
      id: id(),
      mode: snapshot.settings?.defaultFeeMode ?? "FIXED_PER_PLAYER",
      currencyCode: snapshot.settings?.currencyCode ?? "PHP",
      fixedAmountPerPlayerMinor: snapshot.settings?.defaultFixedFeeMinor ?? null,
      expectedQueueCostMinor: 0,
      noShowPenaltyMinor: snapshot.settings?.noShowPenaltyMinor ?? 0,
      participationRule: "ALL_ACTIVE",
      frozenAt: null,
      version: 1,
    };
    snapshot.feeConfig = config;
    const allocations = allocateFinalFeeAmounts(config, snapshot.queuePlayers);
    for (const player of snapshot.queuePlayers) { player.amountDueMinor = allocations.get(player.id) ?? 0; player.version += 1; }
    config.frozenAt = endedAt;
    config.version += 1;
    snapshot.workspace.endedAt = endedAt;
    snapshot.workspace.matchmakingRevision += 1;
    snapshot.workspace.version += 1;
    const noShowCount = snapshot.queuePlayers.filter((player) => player.matchesPlayed === 0).length;
    auditAfter = { endedAt, cancelledQueuedMatches: affected.length, checkedInPlayers: checkedIn.length, rosteredPlayers: snapshot.queuePlayers.length, noShowCount, noShowPenaltyMinor: config?.noShowPenaltyMinor ?? 0, noShowChargesMinor: noShowCount * (config?.noShowPenaltyMinor ?? 0) };
    return workspaceView(snapshot);
  }, () => ({ action: "WORKSPACE_ENDED", entityType: "WORKSPACE", entityId: accountId, reason: "Queue Master ended the session", afterJson: auditAfter }));
}

async function freshQueue(accountId: string) { return mutate(accountId, "WORKSPACE_RESET", (snapshot) => { snapshot.queuePlayers = []; snapshot.courts = []; snapshot.matches = []; snapshot.payments = []; snapshot.audits = []; snapshot.workspace.startedAt = now(); snapshot.workspace.endedAt = null; snapshot.workspace.lateArrivalCutoffAt = null; snapshot.workspace.matchmakingRevision += 1; snapshot.workspace.version += 1; if (snapshot.settings) snapshot.feeConfig = { id: snapshot.feeConfig?.id ?? id(), mode: snapshot.settings.defaultFeeMode, currencyCode: snapshot.settings.currencyCode, fixedAmountPerPlayerMinor: snapshot.settings.defaultFixedFeeMinor ?? null, expectedQueueCostMinor: 0, noShowPenaltyMinor: snapshot.settings.noShowPenaltyMinor ?? 0, participationRule: snapshot.feeConfig?.participationRule ?? "ALL_ACTIVE", frozenAt: null, version: (snapshot.feeConfig?.version ?? 0) + 1 }; return workspaceView(snapshot); }); }

function historyResponse(snapshot: CloudSnapshotV2, path: string): HistoryResponse { const search = params(path).get("search") ?? ""; return page(historyMatches(snapshot, search).map((match) => historyView(snapshot, match)), path) as HistoryResponse; }
function playerHistory(snapshot: CloudSnapshotV2, queuePlayerId: string, path: string): PlayerHistoryResponse { const player = findQueuePlayer(snapshot, queuePlayerId); if (!player) throw new Error("Queue player not found."); const matches = historyMatches(snapshot).filter((match) => match.participants.some((participant) => participant.queuePlayerId === queuePlayerId)); const rows = matches.map((match) => historyView(snapshot, match)); const summary = playerHistoryStats(rows, queuePlayerId); let wins = 0; let pointsFor = 0; let pointsAgainst = 0; for (const match of matches) { const participant = match.participants.find((item) => item.queuePlayerId === queuePlayerId); const revision = scoreFor(match); if (!participant || !revision) continue; const a = revision.games.reduce((sum, game) => sum + game.teamAScore, 0); const b = revision.games.reduce((sum, game) => sum + game.teamBScore, 0); pointsFor += participant.team === "A" ? a : b; pointsAgainst += participant.team === "A" ? b : a; wins += Number(participant.team === revision.winnerTeam); } return { player: { queuePlayerId, sessionPlayerId: queuePlayerId, playerId: player.playerId, displayName: player.displayName, gender: player.gender, skillLevel: player.skillLevel }, stats: { matchesPlayed: matches.length, wins, losses: matches.length - wins, winRateBasisPoints: matches.length ? Math.floor(wins * 10000 / matches.length) : 0, pointsFor, pointsAgainst, pointDifferential: pointsFor - pointsAgainst, averageDurationSeconds: summary.averageDurationSeconds, mostPlayedPartner: summary.mostPlayedPartner, mostPlayedOpponent: summary.mostPlayedOpponent }, ...page(rows, path) } as PlayerHistoryResponse; }
function rankings(snapshot: CloudSnapshotV2): Ranking[] { return prizeRankingRows(snapshot.queuePlayers.map((player) => ({ id: player.id, displayName: player.displayName, matchesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, pointsFor: player.pointsFor, pointsAgainst: player.pointsAgainst })), snapshot.workspace.startedAt).map((ranking, index) => { const player = snapshot.queuePlayers.find((candidate) => candidate.id === ranking.id)!; return { rank: ranking.rank, queuePlayerId: player.id, sessionPlayerId: player.id, player: player.displayName, playerId: player.playerId, gender: player.gender, skillLevel: player.skillLevel, matchesPlayed: player.matchesPlayed, wins: player.wins, losses: player.losses, winRateBasisPoints: player.matchesPlayed ? Math.floor(player.wins * 10000 / player.matchesPlayed) : 0, pointsFor: player.pointsFor, pointsAgainst: player.pointsAgainst, pointDifferential: player.pointsFor - player.pointsAgainst, eligible: ranking.eligible, gamesNeeded: ranking.gamesNeeded, rankingScoreBasisPoints: ranking.rankingScoreBasisPoints, pointPercentageBasisPoints: ranking.pointPercentageBasisPoints, isPrizePosition: ranking.isPrizePosition, seededDrawUsed: ranking.seededDrawUsed }; }); }

export async function handleRequest(accountId: string, path: string, init?: RequestInit): Promise<unknown> {
  const snapshot = await readSnapshot(accountId); if (!snapshot) throw new Error("Download this account before working offline.");
  const method = (init?.method ?? "GET").toUpperCase(); const route = parts(path); const body = parseBody(init); const versionHeader = new Headers(init?.headers).get("if-match"); if (versionHeader && Number.isInteger(Number(versionHeader))) body.version = Number(versionHeader);
  if (route[0] === "workspace" && route.length === 1) return method === "GET" ? workspaceView(snapshot) : freshQueue(accountId);
  if (route[0] === "workspace" && route[1] === "start-fresh") return freshQueue(accountId);
  if (route[0] === "workspace" && route[1] === "end") return endQueue(accountId);
  if (route[0] === "workspace" && route[1] === "late-arrival-policy") return mutate(accountId, "LATE_ARRIVAL_POLICY_UPDATED", (value) => {
    const mode = String(body.mode);
    if (value.workspace.endedAt) throw new Error("Ended sessions cannot change arrival rules.");
    if (mode === "START_GRACE" && body.graceMinutes !== undefined) {
      if (!value.settings) throw new Error("Settings are not available offline.");
      const minutes = Number(body.graceMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error("Late-arrival grace must be a whole number from 1 to 60 minutes.");
      if (body.settingsVersion !== undefined && Number(body.settingsVersion) !== value.settings.version) throw new Error("The account settings changed on another device.");
      value.settings.lateArrivalGraceMinutes = minutes;
      value.settings.version += 1;
    }
    const timeZone = value.settings?.timeZone ?? "Asia/Manila";
    let cutoff: string | null = null;
    try {
      cutoff = mode === "DISABLED"
        ? null
        : mode === "SET_NOW"
          ? now()
          : mode === "START_GRACE"
            ? new Date(Date.now() + lateArrivalGraceMinutes(value) * 60_000).toISOString()
            : mode === "SET_CUSTOM"
              ? inclusiveMinuteInstantForLocalDateTime(String(body.localDateTime ?? ""), timeZone)
              : value.settings?.defaultLateArrivalCutoffTime
                ? inclusiveMinuteInstantForLocalDateTime(`${datePartsForInstant(new Date(), timeZone)}T${value.settings.defaultLateArrivalCutoffTime}`, timeZone)
                : null;
    } catch { throw new Error("The cutoff time is invalid for the account timezone."); }
    value.workspace.lateArrivalCutoffAt = cutoff;
    const cutoffMs = cutoff ? Date.parse(cutoff) : null;
    let reclassifiedPlayerCount = 0;
    for (const player of value.queuePlayers) {
      if (player.latePenaltyState !== "PENDING") continue;
      const firstCheckIn = player.checkedInAt ? Date.parse(player.checkedInAt) : player.latePenaltyAppliedAt ? Date.parse(player.latePenaltyAppliedAt) : NaN;
      if (mode === "DISABLED" || (cutoffMs !== null && Number.isFinite(firstCheckIn) && firstCheckIn <= cutoffMs)) { player.latePenaltyState = null; player.latePenaltyAppliedAt = null; player.version += 1; reclassifiedPlayerCount += 1; }
    }
    value.workspace.matchmakingRevision += 1;
    value.workspace.version += 1;
    return { ...workspaceView(value), reclassifiedPlayerCount };
  });
  if (route[0] === "settings" && route.length === 1) {
    if (method === "GET") return snapshot.settings;
    return mutate(accountId, "SETTINGS_UPDATED", (value) => {
      if (!value.settings) throw new Error("Settings are not available offline.");
      const restChanged = body.minimumRestMinutes !== undefined && Number(body.minimumRestMinutes) !== value.settings.minimumRestMinutes;
      if (body.minimumRestMinutes !== undefined) { const minutes = Number(body.minimumRestMinutes); if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) throw new Error("Minimum rest must be a whole number from 0 to 60 minutes."); value.settings.minimumRestMinutes = minutes; }
      if (body.lateArrivalGraceMinutes !== undefined) { const minutes = Number(body.lateArrivalGraceMinutes); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error("Late-arrival grace must be a whole number from 1 to 60 minutes."); value.settings.lateArrivalGraceMinutes = minutes; }
      if (body.noShowPenaltyMinor !== undefined) { const amount = Number(body.noShowPenaltyMinor); if (!Number.isInteger(amount) || amount < 0 || amount > 2_000_000_000) throw new Error("No-show penalty must be a non-negative whole amount in minor currency units."); value.settings.noShowPenaltyMinor = amount; if (!value.workspace.endedAt) { if (value.feeConfig) { value.feeConfig.noShowPenaltyMinor = amount; value.feeConfig.version += 1; } else { value.feeConfig = { id: id(), mode: value.settings.defaultFeeMode, currencyCode: value.settings.currencyCode, fixedAmountPerPlayerMinor: value.settings.defaultFixedFeeMinor ?? null, expectedQueueCostMinor: 0, noShowPenaltyMinor: amount, participationRule: "ALL_ACTIVE", frozenAt: null, version: 1 }; } } }
      value.settings.version += 1;
      if (restChanged) { value.workspace.matchmakingRevision += 1; value.workspace.version += 1; }
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
  if (route[0] === "queue" && route[1] === "synergy-teams") {
    if (method === "POST") return mutateSynergyTeam(accountId, method, undefined, body);
    if (route[2]) return mutateSynergyTeam(accountId, method, route[2], body);
  }
  if (route[0] === "queue" && route[1] === "players" && route.length === 2) return method === "GET" ? snapshot.queuePlayers.map((player) => playerView(player, snapshot)) : addPlayers(accountId, body);
  if (route[0] === "queue" && route[1] === "players" && route[2]) { const queuePlayerId = route[2]!; if (method === "DELETE" && route.length === 3) return mutate(accountId, "SESSION_PLAYER_REMOVED", (value) => { const result = removeSessionPlayer(value, queuePlayerId); Object.assign(value, result.snapshot); return undefined; }); if (route[3] === "history") return playerHistory(snapshot, queuePlayerId, path); if (route[3] === "late-penalty" && route[4] === "waive") return transition(accountId, queuePlayerId, "WAITING", "LATE_PENALTY_WAIVED"); const status = route[3] === "check-in" ? "WAITING" : route[3] === "rest" ? "RESTING" : route[3] === "resume" ? "WAITING" : route[3] === "check-out" ? "CHECKED_OUT" : null; if (status) return transition(accountId, queuePlayerId, status as DomainQueuePlayer["status"], route[3] === "check-in" ? "QUEUE_PLAYER_CHECK_IN" : `QUEUE_PLAYER_${status}`); }
  if (route[0] === "queue" && route[1] === "players" && route[2] === "bulk-action" && method === "POST") return bulkQueueAction(accountId, body);
  if (route[0] === "queue" && route.length === 1) return normalizeChallengeStatus(queueState(snapshot));
  if (route[0] === "courts" && route.length === 1) return method === "GET" ? snapshot.courts.map(courtView) : mutate(accountId, "COURT_CREATED", (value) => { const name = String(body.name ?? "").trim(); if (!name) throw new Error("Court name is required."); if (value.courts.some((item) => item.normalizedName === name.toLowerCase())) throw new Error("The requested value is already in use."); const displayOrder = Math.max(-1, ...value.courts.map((item) => item.displayOrder)) + 1; const court = { id: id(), name, normalizedName: name.toLowerCase(), displayOrder, status: "AVAILABLE" as const, currentMatchId: null, closedAt: null, version: 1 }; value.courts.push(court); return courtView(court); });
  if (route[0] === "courts" && route[1] === "delete" && method === "POST") return mutate(accountId, "COURTS_DELETED", (value) => { const statuses = [...new Set((Array.isArray(body.statuses) ? body.statuses : []).map(String))].filter((status): status is "AVAILABLE" | "CLOSED" => status === "AVAILABLE" || status === "CLOSED"); if (!statuses.length) throw new Error("Choose at least one court status to delete."); const courts = value.courts.filter((court) => statuses.includes(court.status as "AVAILABLE" | "CLOSED") && !court.currentMatchId); const deletedCourtIds = courts.map((court) => court.id); let preservedHistoryMatchCount = 0; for (const court of courts) { const matches = value.matches.filter((match) => match.courtId === court.id); preservedHistoryMatchCount += matches.length; matches.forEach((match) => preserveCourtSnapshot(match, court)); } value.courts = value.courts.filter((court) => !deletedCourtIds.includes(court.id)); return { deletedCourtIds, deletedCount: deletedCourtIds.length, preservedHistoryMatchCount }; });
  if (route[0] === "courts" && route[1]) return mutate(accountId, method === "DELETE" ? "COURT_DELETED" : "COURT_UPDATED", (value) => { const court = findCourt(value, route[1]); if (!court) throw new Error("Court not found."); if (method === "DELETE") { if (court.currentMatchId || court.status === "OCCUPIED") throw new Error("Occupied courts cannot be deleted while a match is playing."); const matches = value.matches.filter((match) => match.courtId === court.id); matches.forEach((match) => preserveCourtSnapshot(match, court)); value.courts = value.courts.filter((item) => item.id !== court.id); return { deletedCourtIds: [court.id], deletedCount: 1, preservedHistoryMatchCount: matches.length }; } if (court.status === "OCCUPIED") throw new Error("Occupied courts cannot be changed while a match is playing."); if (body.name !== undefined) { const name = String(body.name).trim(); if (!name) throw new Error("Court name is required."); if (value.courts.some((item) => item.id !== court.id && item.normalizedName === name.toLowerCase())) throw new Error("The requested value is already in use."); value.matches.filter((match) => match.courtId === court.id && !match.courtNameSnapshot).forEach((match) => captureCourtSnapshot(match, court)); court.name = name; court.normalizedName = name.toLowerCase(); } if (body.status) { court.status = body.status as typeof court.status; court.closedAt = body.status === "CLOSED" ? now() : null; } court.version += 1; return courtView(court); });
  if (route[0] === "suggestions") return makeSuggestion(accountId, body);
  if (route[0] === "matches" && route[1] === "start-suggestion" && method === "POST") return createMatchStacked(accountId, { ...body, suggestionToken: String(body.suggestionToken ?? ""), courtId: String(body.courtId ?? "") });
  if (route[0] === "matches" && route.length === 1) return method === "GET" ? snapshot.matches.filter((match) => ["QUEUED", "IN_PROGRESS"].includes(match.status)).map((match) => matchView(snapshot, match)) : createMatchStacked(accountId, body);
  if (route[0] === "matches" && route[1] && route.length === 2 && method === "PATCH") return updateMatchStacked(accountId, route[1], body);
  if (route[0] === "matches" && route[1] && route[2] === "start") return startMatchStacked(accountId, route[1], String(body.courtId ?? ""), body.playerPreferenceConfirmed === true);
  if (route[0] === "matches" && route[1] && route[2] === "complete") return finishMatchStacked(accountId, route[1], Array.isArray(body.games) ? body.games as Array<{ teamAScore: number; teamBScore: number }> : []);
  if (route[0] === "matches" && route[1] && route[2] === "correct") return correctMatchStacked(accountId, route[1], Array.isArray(body.games) ? body.games as Array<{ teamAScore: number; teamBScore: number }> : [], body.reason ? String(body.reason) : undefined);
  if (route[0] === "matches" && route[1] && route[2] === "cancel") return cancelMatchStacked(accountId, route[1]);
  if (route[0] === "history") return historyResponse(snapshot, path);
  if (route[0] === "rankings") return { rankingMethod: PRIZE_RANKING_METHOD, rankings: rankings(snapshot) } as RankingPayload;
  if (route[0] === "fees" && route[1] === "config") return mutate(accountId, "FEE_CONFIG_UPDATED", (value) => { value.feeConfig = { ...(value.feeConfig ?? { id: id(), participationRule: "ALL_ACTIVE", frozenAt: null, version: 0 }), mode: String(body.mode) as never, currencyCode: value.feeConfig?.currencyCode ?? value.settings?.currencyCode ?? "PHP", fixedAmountPerPlayerMinor: typeof body.fixedAmountPerPlayerMinor === "number" ? body.fixedAmountPerPlayerMinor : null, expectedQueueCostMinor: Number(body.expectedQueueCostMinor ?? body.expectedSessionCostMinor ?? 0), noShowPenaltyMinor: value.feeConfig?.noShowPenaltyMinor ?? value.settings?.noShowPenaltyMinor ?? 0, version: (value.feeConfig?.version ?? 0) + 1 }; applyFeeAllocationsOffline(value); return { config: value.feeConfig, summary: feeSummary(value) }; });
  if (route[0] === "fees") return feeSummary(snapshot);
  if (route[0] === "payments" && route.length === 1) return method === "GET" ? snapshot.payments.map((payment) => ({ ...payment, sessionPlayerId: payment.queuePlayerId })) as unknown as Payment[] : mutate(accountId, "PAYMENT_CREATED", (value) => { const playerId = String(body.queuePlayerId ?? body.sessionPlayerId ?? ""); if (!findQueuePlayer(value, playerId)) throw new Error("Queue player not found."); const payment = { id: id(), queuePlayerId: playerId, kind: String(body.kind), method: body.method ? String(body.method) : null, amountMinor: Number(body.amountMinor), reference: body.reference ? String(body.reference) : null, note: body.note ? String(body.note) : null, reversalOfPaymentId: null, recordedById: accountId, occurredAt: now(), createdAt: now() }; value.payments.push(payment); return { payment: { ...payment, sessionPlayerId: playerId }, summary: feeSummary(value), replayed: false }; });
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
