export type Gender = "MALE" | "FEMALE";
export type SkillLevel = "NEWBIE" | "BEGINNER" | "UPPER_BEGINNER" | "INTERMEDIATE" | "UPPER_INTERMEDIATE" | "ADVANCED";
export type QueuePlayerStatus = "INACTIVE" | "WAITING" | "QUEUED" | "PLAYING" | "RESTING" | "CHECKED_OUT";
export type LatePenaltyState = "PENDING" | "SERVED" | "WAIVED";
export type CourtStatus = "AVAILABLE" | "OCCUPIED" | "PAUSED" | "CLOSED";
export type MatchStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type MatchSource = "MANUAL" | "AUTOMATIC" | "MANUAL_ADJUSTED";
export type MatchmakingMode = "OPEN" | "SAME_SKILL" | "BALANCED" | "SAME_GENDER" | "MIXED_DOUBLES" | "UNDEFEATED_CHALLENGE";
export type TeamSide = "A" | "B";

export type ScoreInput = { teamAScore: number; teamBScore: number };
export type ScoreSettings = { pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: 1 | 3 };
export type ValidatedScore = ScoreInput & { winnerTeam: TeamSide };

export type DomainPlayer = {
  id: string;
  displayName: string;
  gender: Gender;
  skillLevel: SkillLevel;
  skillWeight: number;
  status: string;
};

export type DomainQueuePlayer = {
  id: string;
  playerId: string;
  displayName: string;
  gender: Gender;
  skillLevel: SkillLevel;
  skillWeight: number;
  status: QueuePlayerStatus;
  queueEnteredAt?: string | null;
  lastMatchEndedAt?: string | null;
  matchesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  amountDueMinor?: number;
  manualPriority?: number;
  priorityReason?: string | null;
  latePenaltyState?: LatePenaltyState | null;
  latePenaltyAppliedAt?: string | null;
  currentMatchId?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  restStartedAt?: string | null;
  version: number;
};

export type MatchParticipant = { id: string; matchId: string; queuePlayerId: string; team: TeamSide; teamSlot: number; priorQueueEnteredAt?: string | null; displayName?: string };
export type MatchGame = { id: string; scoreRevisionId: string; gameNumber: number; teamAScore: number; teamBScore: number; winnerTeam: TeamSide };
export type MatchScoreRevision = { id: string; matchId: string; revisionNumber: number; winnerTeam: TeamSide; reason?: string | null; supersedesRevisionId?: string | null; createdAt?: string; games: MatchGame[] };
export type DomainMatch = { id: string; courtId?: string | null; courtIdSnapshot?: string | null; courtNameSnapshot?: string | null; status: MatchStatus; source: MatchSource; matchmakingMode?: MatchmakingMode | null; algorithmVersion?: string | null; suggestionKey?: string | null; suggestionExplanation?: unknown; pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: 1 | 3; queuedAt: string; startedAt?: string | null; completedAt?: string | null; cancelledAt?: string | null; cancellationReason?: string | null; winnerTeam?: TeamSide | null; currentRevisionId?: string | null; version: number; participants: MatchParticipant[]; scoreRevisions: MatchScoreRevision[] };

export type DomainCourt = { id: string; name: string; normalizedName: string; displayOrder: number; status: CourtStatus; currentMatchId?: string | null; closedAt?: string | null; version: number };
export type DomainWorkspace = { startedAt: string; endedAt?: string | null; lateArrivalCutoffAt?: string | null; matchmakingAlgorithm: string; matchmakingRevision: number; version: number };
export type DomainSettings = { id: string; pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: 1 | 3; minimumRestMinutes: number; lateArrivalGraceMinutes?: number; defaultFeeMode: string; defaultFixedFeeMinor?: number | null; currencyCode: string; timeZone: string; defaultLateArrivalCutoffTime?: string | null; version: number };
export type DomainFeeConfig = { id: string; mode: string; currencyCode: string; fixedAmountPerPlayerMinor?: number | null; expectedQueueCostMinor?: number | null; participationRule: string; frozenAt?: string | null; version: number };
export type DomainPayment = { id: string; queuePlayerId: string; kind: string; method?: string | null; amountMinor: number; reference?: string | null; note?: string | null; reversalOfPaymentId?: string | null; recordedById: string; occurredAt: string; createdAt: string };
export type DomainAudit = { id: string; action: string; entityType: string; entityId: string; reason?: string | null; beforeJson?: unknown; afterJson?: unknown; requestId: string; createdAt: string };

export type CloudSnapshotV2 = {
  schemaVersion: 2 | 3;
  queueMasterId: string;
  settings: DomainSettings | null;
  workspace: DomainWorkspace;
  players: DomainPlayer[];
  queuePlayers: DomainQueuePlayer[];
  courts: DomainCourt[];
  matches: DomainMatch[];
  feeConfig: DomainFeeConfig | null;
  payments: DomainPayment[];
  audits: DomainAudit[];
};

export type { CloudSnapshotV3, SyncClock, SyncMetadata, SyncRecordMetadata } from "./sync.js";
export { emptySyncMetadata, mergeSyncMetadata, mergeSyncSnapshots, seedSyncMetadata, stampSnapshotChanges } from "./sync.js";

export type PlayerDeletionBusyPlayer = {
  playerId: string;
  queuePlayerId: string;
  displayName: string;
  status: QueuePlayerStatus;
};

export type PlayerDeletionImpact = {
  playerIds: string[];
  playerNames: string[];
  busyPlayers: PlayerDeletionBusyPlayer[];
  affectedMatchIds: string[];
  affectedPaymentIds: string[];
  otherParticipantPlayerIds: string[];
  otherParticipantQueuePlayerIds: string[];
};

const snapshotClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const allocateEqualSplit = (total: number, ids: string[]) => {
  const base = ids.length ? Math.floor(total / ids.length) : 0;
  const remainder = ids.length ? total - (base * ids.length) : 0;
  return new Map(ids.map((idValue, index) => [idValue, base + (index < remainder ? 1 : 0)]));
};

export function previewPlayerDeletion(snapshot: CloudSnapshotV2, playerIds: string[]): PlayerDeletionImpact {
  const uniqueIds = [...new Set(playerIds)];
  const selectedPlayers = snapshot.players.filter((player) => uniqueIds.includes(player.id));
  if (selectedPlayers.length !== uniqueIds.length) throw new Error("One or more players were not found.");
  const selectedQueuePlayers = snapshot.queuePlayers.filter((player) => uniqueIds.includes(player.playerId));
  const selectedQueuePlayerIds = new Set(selectedQueuePlayers.map((player) => player.id));
  const affectedMatches = snapshot.matches.filter((match) => match.participants.some((participant) => selectedQueuePlayerIds.has(participant.queuePlayerId)));
  const affectedMatchIds = affectedMatches.map((match) => match.id);
  const otherParticipantQueuePlayerIds = [...new Set(affectedMatches.flatMap((match) => match.participants.map((participant) => participant.queuePlayerId)).filter((idValue) => !selectedQueuePlayerIds.has(idValue)))];
  const otherParticipantPlayerIds = [...new Set(snapshot.queuePlayers.filter((player) => otherParticipantQueuePlayerIds.includes(player.id)).map((player) => player.playerId))];
  return {
    playerIds: uniqueIds,
    playerNames: selectedPlayers.map((player) => player.displayName),
    busyPlayers: selectedQueuePlayers.filter((player) => player.status === "QUEUED" || player.status === "PLAYING").map((player) => ({
      playerId: player.playerId,
      queuePlayerId: player.id,
      displayName: player.displayName,
      status: player.status,
    })),
    affectedMatchIds,
    affectedPaymentIds: snapshot.payments.filter((payment) => selectedQueuePlayerIds.has(payment.queuePlayerId)).map((payment) => payment.id),
    otherParticipantPlayerIds,
    otherParticipantQueuePlayerIds,
  };
}

function rebuildSnapshotStats(snapshot: CloudSnapshotV2) {
  for (const player of snapshot.queuePlayers) {
    player.matchesPlayed = 0;
    player.wins = 0;
    player.losses = 0;
    player.pointsFor = 0;
    player.pointsAgainst = 0;
    player.lastMatchEndedAt = null;
  }
  const byId = new Map(snapshot.queuePlayers.map((player) => [player.id, player]));
  for (const match of snapshot.matches.filter((item) => item.status === "COMPLETED")) {
    const revision = match.scoreRevisions.find((item) => item.id === match.currentRevisionId) ?? [...match.scoreRevisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
    if (!revision) continue;
    const points = revision.games.reduce((sum, game) => ({ a: sum.a + game.teamAScore, b: sum.b + game.teamBScore }), { a: 0, b: 0 });
    for (const participant of match.participants) {
      const player = byId.get(participant.queuePlayerId);
      if (!player) continue;
      const won = participant.team === revision.winnerTeam;
      player.matchesPlayed += 1;
      player.wins += won ? 1 : 0;
      player.losses += won ? 0 : 1;
      player.pointsFor += participant.team === "A" ? points.a : points.b;
      player.pointsAgainst += participant.team === "A" ? points.b : points.a;
      player.lastMatchEndedAt = match.completedAt ?? player.lastMatchEndedAt ?? null;
    }
  }
}

export function applyPlayerDeletion(snapshot: CloudSnapshotV2, playerIds: string[]) {
  const impact = previewPlayerDeletion(snapshot, playerIds);
  if (impact.busyPlayers.length) throw new Error("Busy players cannot be deleted while queued or playing.");
  const next = snapshotClone(snapshot);
  const selectedIds = new Set(impact.playerIds);
  const selectedQueuePlayerIds = new Set(next.queuePlayers.filter((player) => selectedIds.has(player.playerId)).map((player) => player.id));
  next.matches = next.matches.filter((match) => !match.participants.some((participant) => selectedQueuePlayerIds.has(participant.queuePlayerId)));
  const removedPaymentIds = new Set(next.payments.filter((payment) => selectedQueuePlayerIds.has(payment.queuePlayerId)).map((payment) => payment.id));
  next.payments = next.payments.filter((payment) => !removedPaymentIds.has(payment.id) && !(payment.reversalOfPaymentId && removedPaymentIds.has(payment.reversalOfPaymentId)));
  next.queuePlayers = next.queuePlayers.filter((player) => !selectedIds.has(player.playerId));
  next.players = next.players.filter((player) => !selectedIds.has(player.id));
  next.workspace.matchmakingRevision += 1;
  next.workspace.version += 1;
  if (next.feeConfig?.mode === "EQUAL_SPLIT") {
    const roster = next.queuePlayers.slice().sort((a, b) => a.id.localeCompare(b.id));
    const allocations = allocateEqualSplit(next.feeConfig.expectedQueueCostMinor ?? 0, roster.map((player) => player.id));
    for (const player of roster) player.amountDueMinor = allocations.get(player.id) ?? 0;
  }
  rebuildSnapshotStats(next);
  return { snapshot: next, impact };
}

export type MatchPlayer = { id: string; displayName: string; gender: Gender; skillWeight: number; skillLevel: SkillLevel; status: QueuePlayerStatus; gamesPlayed: number; wins?: number; losses?: number; queueEnteredAt: string | null; lastMatchEndedAt: string | null; manualPriority: number; latePenaltyState?: LatePenaltyState | null };
export type MatchHistory = { partners: Map<string, Map<string, number>>; opponents: Map<string, Map<string, number>>; quartets: Map<string, number>; encounters?: Map<string, Map<string, number>>; recentPartners?: Map<string, Map<string, number>>; recentOpponents?: Map<string, Map<string, number>>; recentEncounters?: Map<string, Map<string, number>>; recentQuartets?: Map<string, number> };
export type Suggestion = { mode: MatchmakingMode; teamA: MatchPlayer[]; teamB: MatchPlayer[]; teamATotal: number; teamBTotal: number; difference: number; key: string; explanation: Record<string, unknown> };
export type MatchmakingOptions = { strengthGap?: 1 | 2 | 3; minimumRestMinutes?: number; now?: string | Date };
const DEFAULT_BALANCED_STRENGTH_GAP = 1;
export const MATCHMAKING_ALGORITHM = "v5-undefeated-challenge";

export const skillWeights: Record<SkillLevel, number> = {
  NEWBIE: 1,
  BEGINNER: 2,
  UPPER_BEGINNER: 3,
  INTERMEDIATE: 4,
  UPPER_INTERMEDIATE: 5,
  ADVANCED: 6,
};

export const skillWeight = (level: SkillLevel) => skillWeights[level];

export const isProhibitedGeneratedGenderMatch = (teamA: MatchPlayer[], teamB: MatchPlayer[]) =>
  teamA.length === 2 && teamB.length === 2
  && ((teamA.every((player) => player.gender === "FEMALE") && teamB.every((player) => player.gender === "MALE"))
    || (teamA.every((player) => player.gender === "MALE") && teamB.every((player) => player.gender === "FEMALE")));

export const validateBalancedLineup = (teamA: MatchPlayer[], teamB: MatchPlayer[], strengthGap: number) => {
  const group = [...teamA, ...teamB];
  if (![1, 2].includes(teamA.length) || teamA.length !== teamB.length || new Set(group.map((player) => player.id)).size !== group.length) return "Choose unique players with equal team sizes for singles or doubles.";
  const spread = Math.max(...group.map((player) => player.skillWeight)) - Math.min(...group.map((player) => player.skillWeight));
  if (spread > strengthGap) return `Handicap matchups require a player strength spread of at most ${strengthGap}.`;
  const teamDifference = Math.abs(teamA.reduce((sum, player) => sum + player.skillWeight, 0) - teamB.reduce((sum, player) => sum + player.skillWeight, 0));
  if (teamDifference !== strengthGap) return `Handicap matchups require team strength totals to differ by exactly ${strengthGap}.`;
  return null;
};

export function normalizeName(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function validateScores(games: ScoreInput[], settings: ScoreSettings): ValidatedScore[] {
  if (!Array.isArray(games) || games.length === 0 || games.length > settings.bestOf) throw new Error("The number of games does not match the configured scoring rules.");
  const requiredWins = Math.floor(settings.bestOf / 2) + 1;
  let aWins = 0;
  let bWins = 0;
  const validated: ValidatedScore[] = [];
  for (const game of games) {
    if (!Number.isInteger(game.teamAScore) || !Number.isInteger(game.teamBScore) || game.teamAScore < 0 || game.teamBScore < 0) throw new Error("Scores must be non-negative integers.");
    if (game.teamAScore === game.teamBScore) throw new Error("A game cannot end in a tie.");
    const high = Math.max(game.teamAScore, game.teamBScore);
    const low = Math.min(game.teamAScore, game.teamBScore);
    const maximum = settings.scoreCap ?? settings.pointsToWin;
    if (high > maximum || low > maximum) throw new Error(`Scores cannot exceed ${maximum}.`);
    const reachesCap = high === maximum;
    if (!(reachesCap ? low < high : high >= settings.pointsToWin && high - low >= settings.winBy)) throw new Error("The submitted score does not satisfy the configured rules.");
    const winnerTeam = game.teamAScore > game.teamBScore ? "A" : "B";
    validated.push({ ...game, winnerTeam });
    if (winnerTeam === "A") aWins += 1; else bWins += 1;
    if (aWins >= requiredWins || bWins >= requiredWins) break;
  }
  if (aWins < requiredWins && bWins < requiredWins) throw new Error("The match series is not complete.");
  if (validated.length !== games.length) throw new Error("No games may be submitted after the match is already won.");
  return validated;
}

const symmetricCount = (map: Map<string, Map<string, number>> | undefined, a: string, b: string) => Math.max(map?.get(a)?.get(b) ?? 0, map?.get(b)?.get(a) ?? 0);
const pairCount = (history: MatchHistory, a: string, b: string, recent: boolean) => {
  const direct = recent ? history.recentEncounters : history.encounters;
  const directCount = symmetricCount(direct, a, b);
  if (directCount > 0) return directCount;
  return Math.max(symmetricCount(recent ? history.recentPartners : history.partners, a, b), symmetricCount(recent ? history.recentOpponents : history.opponents, a, b));
};
const partnerCount = (history: MatchHistory, a: string, b: string, recent: boolean) => symmetricCount(recent ? history.recentPartners : history.partners, a, b);
const quartetKey = (players: MatchPlayer[]) => players.map((player) => player.id).sort().join(":");
const forEachCombination = <T,>(items: T[], size: number, callback: (selected: T[]) => void) => { const walk = (start: number, selected: T[]) => { if (selected.length === size) { callback([...selected]); return; } for (let index = start; index <= items.length - (size - selected.length); index += 1) { selected.push(items[index]!); walk(index + 1, selected); selected.pop(); } }; walk(0, []); };
const partitions = <T,>(players: T[]) => { const [a, b, c, d] = players; return [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]] as [T[], T[]][]; };
const compare = (a: (number[] | number | string)[], b: (number[] | number | string)[]) => { for (let i = 0; i < a.length; i += 1) { const left = a[i]; const right = b[i]; if (Array.isArray(left) && Array.isArray(right)) { for (let j = 0; j < Math.max(left.length, right.length); j += 1) { const result = (left[j] ?? 0) - (right[j] ?? 0); if (result) return result; } } else if (typeof left === "string" && typeof right === "string") { const result = left.localeCompare(right); if (result) return result; } else if (typeof left === "number" && typeof right === "number" && left !== right) return left - right; } return 0; };
const restReadyAt = (lastMatchEndedAt: string | null, minimumRestMinutes: number, now: number) => { if (!lastMatchEndedAt || minimumRestMinutes <= 0) return now; return new Date(lastMatchEndedAt).getTime() + minimumRestMinutes * 60_000; };

const winsFor = (player: MatchPlayer) => player.wins ?? 0;
const lossesFor = (player: MatchPlayer) => player.losses ?? 0;
const gamesFor = (player: MatchPlayer) => player.gamesPlayed ?? 0;

export function leaderboardOrder(players: MatchPlayer[]) {
  return [...players].sort((a, b) => winsFor(b) - winsFor(a) || gamesFor(b) - gamesFor(a) || normalizeName(a.displayName).localeCompare(normalizeName(b.displayName)) || a.id.localeCompare(b.id));
}

export function undefeatedChallengePlayers(players: MatchPlayer[], minimumMatches = 4, rankLimit = 3) {
  return leaderboardOrder(players).slice(0, rankLimit).flatMap((player, index) => winsFor(player) === gamesFor(player) && lossesFor(player) === 0 && gamesFor(player) >= minimumMatches ? [{ player, rank: index + 1 }] : []);
}

const challengePairKey = (players: MatchPlayer[]) => players.map((player) => player.id).sort().join(",");
const challengeGroupKey = (teamA: MatchPlayer[], teamB: MatchPlayer[]) => teamA.map((player) => player.id).sort().join(",") + "|" + teamB.map((player) => player.id).sort().join(",");
const combinationValues = (players: MatchPlayer[], size: number) => {
  const values: MatchPlayer[][] = [];
  forEachCombination(players, size, (selected) => values.push(selected));
  return values;
};

function suggestUndefeatedChallenge(players: MatchPlayer[], history: MatchHistory, excludedKeys: string[], options: MatchmakingOptions): Suggestion | null {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const minimumRestMinutes = Math.max(0, options.minimumRestMinutes ?? 0);
  const eligible = players.filter((player) => player.status === "WAITING" && player.queueEnteredAt && restReadyAt(player.lastMatchEndedAt, minimumRestMinutes, now) <= now);
  const ranked = undefeatedChallengePlayers(players);
  const rankedIds = new Set(ranked.map(({ player }) => player.id));
  const readyQualifiers = ranked.filter(({ player }) => eligible.some((candidate) => candidate.id === player.id));
  if (!readyQualifiers.length) return null;
  const supports = eligible.filter((player) => !rankedIds.has(player.id));
  const excluded = new Set(excludedKeys);
  const excludedPairs = new Set(excludedKeys.map((key) => key.split("|").flatMap((part) => part.split(",")).filter((id) => rankedIds.has(id)).sort().join(",")).filter(Boolean));
  const useFallback = readyQualifiers.length >= 3 && supports.length < 2;
  const qualifierSets = readyQualifiers.length === 1
    ? [[readyQualifiers[0]!.player]]
    : useFallback
      ? combinationValues(readyQualifiers.map(({ player }) => player), 3)
      : combinationValues(readyQualifiers.map(({ player }) => player), 2);
  const supportSize = qualifierSets[0]?.length === 1 ? 3 : useFallback ? 1 : 2;
  if (supports.length < supportSize) return null;
  const supportGroups = combinationValues(supports, supportSize);
  const minimumSupportGames = supportGroups.reduce((minimum, group) => Math.min(minimum, ...group.map(gamesFor)), Number.POSITIVE_INFINITY);
  const fairSupportExists = supportGroups.some((group) => Math.max(...group.map(gamesFor)) <= minimumSupportGames + 1);
  let best: { key: (number[] | number | string)[]; suggestion: Suggestion } | null = null;

  for (const qualifierSet of qualifierSets) {
    const pairKey = challengePairKey(qualifierSet);
    const pairWasExcluded = excludedPairs.has(pairKey);
    const pairHistory = qualifierSet.length > 1 ? Math.max(...qualifierSet.flatMap((player, index) => qualifierSet.slice(index + 1).map((other) => pairCount(history, player.id, other.id, true)))) : 0;
    for (const supportGroup of supportGroups) {
      const group = [...qualifierSet, ...supportGroup];
      const supportGames = supportGroup.map(gamesFor).sort((a, b) => a - b);
      if (fairSupportExists && Math.max(...supportGames) > minimumSupportGames + 1) continue;
      const supportPending = supportGroup.filter((player) => player.latePenaltyState === "PENDING").length;
      const supportPriority = [...supportGroup].map((player) => -(player.manualPriority ?? 0)).sort((a, b) => a - b);
      const supportQueueAge = Math.max(...supportGroup.map((player) => new Date(player.queueEnteredAt!).getTime()));
      const recentPairs = group.flatMap((player, index) => group.slice(index + 1).map((other) => pairCount(history, player.id, other.id, true)));
      const allPairs = group.flatMap((player, index) => group.slice(index + 1).map((other) => pairCount(history, player.id, other.id, false)));
      for (const [teamA, teamB] of partitions([...group].sort((a, b) => a.id.localeCompare(b.id)))) {
        if (isProhibitedGeneratedGenderMatch(teamA, teamB)) continue;
        const teamAQualifiers = teamA.filter((player) => qualifierSet.some((candidate) => candidate.id === player.id));
        const teamBQualifiers = teamB.filter((player) => qualifierSet.some((candidate) => candidate.id === player.id));
        if (qualifierSet.length > 1 && (!teamAQualifiers.length || !teamBQualifiers.length)) continue;
        const teamATotal = teamA.reduce((sum, player) => sum + player.skillWeight, 0);
        const teamBTotal = teamB.reduce((sum, player) => sum + player.skillWeight, 0);
        const teamDifference = Math.abs(teamATotal - teamBTotal);
        const qualifierTeam = teamAQualifiers.length ? teamA : teamB;
        const opponentTeam = teamAQualifiers.length ? teamB : teamA;
        const challengeAdvantage = opponentTeam.reduce((sum, player) => sum + player.skillWeight, 0) - qualifierTeam.reduce((sum, player) => sum + player.skillWeight, 0);
        const qualifierPartner = qualifierSet.length === 1 ? qualifierTeam.find((player) => !qualifierSet.some((candidate) => candidate.id === player.id)) : undefined;
        const pairRotation = qualifierSet.length > 1 && !pairWasExcluded ? 0 : 1;
        const key: (number[] | number | string)[] = [pairRotation, pairHistory, supportPriority, supportGames, supportQueueAge, supportPending, recentPairs.filter(Boolean).length, recentPairs.reduce((sum, value) => sum + value, 0), allPairs.filter(Boolean).length, allPairs.reduce((sum, value) => sum + value, 0), qualifierSet.length === 1 ? -challengeAdvantage : teamDifference, qualifierPartner?.skillWeight ?? 0, teamA.map((player) => player.id).sort().join(","), teamB.map((player) => player.id).sort().join(",")];
        const keyString = challengeGroupKey(teamA, teamB);
        if (excluded.has(keyString)) continue;
        const suggestion: Suggestion = { mode: "UNDEFEATED_CHALLENGE", teamA, teamB, teamATotal, teamBTotal, difference: teamDifference, key: keyString, explanation: { algorithmVersion: MATCHMAKING_ALGORITHM, mode: "UNDEFEATED_CHALLENGE", rest: { minimumRestMinutes, eligibleAt: new Date(now).toISOString() }, challenge: { minimumMatches: 4, rankLimit: 3, qualifyingPlayers: ranked.map(({ player, rank }) => ({ id: player.id, displayName: player.displayName, rank, gamesPlayed: gamesFor(player), wins: winsFor(player), losses: lossesFor(player) })), selectedPlayerIds: qualifierSet.map((player) => player.id), opposingPlayerIds: qualifierSet.length > 1 ? qualifierSet.map((player) => player.id) : [], pairKey, rotatedPair: pairRotation === 1, fallbackIncludedThird: useFallback, difficultyPolicy: qualifierSet.length === 1 ? "WEAKER_TEAM_FAIR_QUEUE" : "QUALIFIED_PLAYERS_OPPOSED" }, teamSkillTotals: { teamA: teamATotal, teamB: teamBTotal, difference: teamDifference }, repeatPenalties: { recentPairCount: recentPairs.filter(Boolean).length, recentPairTotal: recentPairs.reduce((sum, value) => sum + value, 0), allTimePairCount: allPairs.filter(Boolean).length, allTimePairTotal: allPairs.reduce((sum, value) => sum + value, 0) }, fairness: { supportMinimumGames: minimumSupportGames, supportPending } } };
        if (!best || compare(key, best.key) < 0) best = { key, suggestion };
      }
    }
  }
  return best?.suggestion ?? null;
}

export function suggestMatch(players: MatchPlayer[], mode: MatchmakingMode, history: MatchHistory, excludedKeys: string[] = [], options: MatchmakingOptions = {}): Suggestion | null {
  if (mode === "UNDEFEATED_CHALLENGE") return suggestUndefeatedChallenge(players, history, excludedKeys, options);
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const minimumRestMinutes = Math.max(0, options.minimumRestMinutes ?? 0);
  const strengthGap = mode === "BALANCED" ? options.strengthGap ?? DEFAULT_BALANCED_STRENGTH_GAP : undefined;
  const eligible = players.filter((player) => player.status === "WAITING" && player.queueEnteredAt && restReadyAt(player.lastMatchEndedAt, minimumRestMinutes, now) <= now);
  if (eligible.length < 4) return null;
  const excluded = new Set(excludedKeys);
  const previousSuggestionPlayerIds = new Set(
    excludedKeys.length > 0 && !eligible.some((player) => player.latePenaltyState === "PENDING")
      ? excludedKeys[excludedKeys.length - 1]!.split(/[|,]/).filter(Boolean)
      : [],
  );
  const previouslySkippedPlayerIds = new Set(previousSuggestionPlayerIds.size > 0 ? eligible.filter((player) => !previousSuggestionPlayerIds.has(player.id)).map((player) => player.id) : []);
  const validGroup = (group: MatchPlayer[]) => { const genders = new Set(group.map((player) => player.gender)); if (mode === "SAME_GENDER" && genders.size !== 1) return false; if (mode === "MIXED_DOUBLES" && (genders.size !== 2 || group.filter((player) => player.gender === "MALE").length !== 2)) return false; if (mode === "SAME_SKILL" && new Set(group.map((player) => player.skillWeight)).size !== 1) return false; return mode !== "BALANCED" || Math.max(...group.map((player) => player.skillWeight)) - Math.min(...group.map((player) => player.skillWeight)) <= strengthGap!; };
  let candidateMinimumGames = Number.POSITIVE_INFINITY;
  forEachCombination(eligible, 4, (group) => { if (!validGroup(group)) return; candidateMinimumGames = Math.min(candidateMinimumGames, ...group.map((player) => player.gamesPlayed)); });
  if (!Number.isFinite(candidateMinimumGames)) return null;
  let fairExists = false;
  forEachCombination(eligible, 4, (group) => { if (validGroup(group) && Math.max(...group.map((player) => player.gamesPlayed)) <= candidateMinimumGames + 1) fairExists = true; });
  const hasManualOverride = (() => { let found = false; forEachCombination(eligible, 4, (group) => { if (validGroup(group) && (!fairExists || Math.max(...group.map((player) => player.gamesPlayed)) <= candidateMinimumGames + 1) && group.some((player) => (player.manualPriority ?? 0) > 0)) found = true; }); return found; })();
  let minimumPending = Number.POSITIVE_INFINITY;
  forEachCombination(eligible, 4, (group) => { if (validGroup(group) && (!fairExists || Math.max(...group.map((player) => player.gamesPlayed)) <= candidateMinimumGames + 1)) minimumPending = Math.min(minimumPending, group.filter((player) => player.latePenaltyState === "PENDING").length); });
  let best: { key: (number[] | number | string)[]; suggestion: Suggestion } | null = null;
  forEachCombination(eligible, 4, (group) => {
    if (!validGroup(group) || (!hasManualOverride && fairExists && Math.max(...group.map((player) => player.gamesPlayed)) > candidateMinimumGames + 1)) return;
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const skillSpread = Math.max(...group.map((player) => player.skillWeight)) - Math.min(...group.map((player) => player.skillWeight));
    const recentPairValues = group.flatMap((player, i) => group.slice(i + 1).map((other) => pairCount(history, player.id, other.id, true)));
    const allPairValues = group.flatMap((player, i) => group.slice(i + 1).map((other) => pairCount(history, player.id, other.id, false)));
    const recentQuartetRepeats = history.recentQuartets?.get(quartetKey(group)) ?? 0;
    const allQuartetRepeats = history.quartets.get(quartetKey(group)) ?? 0;
    for (const [teamA, teamB] of partitions(sorted)) {
      if (mode === "MIXED_DOUBLES" && (new Set(teamA.map((player) => player.gender)).size !== 2 || new Set(teamB.map((player) => player.gender)).size !== 2)) continue;
      if (isProhibitedGeneratedGenderMatch(teamA, teamB)) continue;
      const teamATotal = teamA.reduce((sum, player) => sum + player.skillWeight, 0);
      const teamBTotal = teamB.reduce((sum, player) => sum + player.skillWeight, 0);
      if (mode === "BALANCED" && Math.abs(teamATotal - teamBTotal) !== strengthGap!) continue;
      const keyString = `${teamA.map((player) => player.id).sort().join(",")}|${teamB.map((player) => player.id).sort().join(",")}`;
      if (excluded.has(keyString)) continue;
      const recentPartners = partnerCount(history, teamA[0]!.id, teamA[1]!.id, true) + partnerCount(history, teamB[0]!.id, teamB[1]!.id, true);
      const allPartners = partnerCount(history, teamA[0]!.id, teamA[1]!.id, false) + partnerCount(history, teamB[0]!.id, teamB[1]!.id, false);
      const partnerMix = Math.abs(teamA[0]!.skillWeight - teamA[1]!.skillWeight) + Math.abs(teamB[0]!.skillWeight - teamB[1]!.skillWeight);
      const lowestGames = group.filter((player) => player.gamesPlayed === candidateMinimumGames).length;
      const previouslySkippedCount = group.filter((player) => previouslySkippedPlayerIds.has(player.id)).length;
      const pendingCount = group.filter((player) => player.latePenaltyState === "PENDING").length;
      const key: (number[] | number | string)[] = mode === "BALANCED"
        ? [[...group].map((player) => -(player.manualPriority ?? 0)).sort((a, b) => a - b), -lowestGames, Math.max(...group.map((player) => player.gamesPlayed)) - candidateMinimumGames, pendingCount, -previouslySkippedCount, group.map((player) => player.gamesPlayed).sort((a, b) => a - b), sorted.map((player) => player.queueEnteredAt ? new Date(player.queueEnteredAt).getTime() : Number.MAX_SAFE_INTEGER).sort((a, b) => a - b), Math.abs(teamATotal - teamBTotal), recentPairValues.filter(Boolean).length, recentPairValues.reduce((sum, value) => sum + value, 0), recentQuartetRepeats, allPairValues.filter(Boolean).length, allPairValues.reduce((sum, value) => sum + value, 0), allQuartetRepeats, recentPartners, allPartners, -partnerMix, sorted.map((player) => player.id).join(","), keyString]
        : [[...group].map((player) => -(player.manualPriority ?? 0)).sort((a, b) => a - b), -lowestGames, Math.max(...group.map((player) => player.gamesPlayed)) - candidateMinimumGames, pendingCount, recentPairValues.filter(Boolean).length, recentPairValues.reduce((sum, value) => sum + value, 0), recentQuartetRepeats, allPairValues.filter(Boolean).length, allPairValues.reduce((sum, value) => sum + value, 0), allQuartetRepeats, -previouslySkippedCount, mode === "SAME_SKILL" ? skillSpread : 0, group.map((player) => player.gamesPlayed).sort((a, b) => a - b), sorted.map((player) => player.queueEnteredAt ? new Date(player.queueEnteredAt).getTime() : Number.MAX_SAFE_INTEGER).sort((a, b) => a - b), recentPartners, allPartners, 0, Math.abs(teamATotal - teamBTotal), sorted.map((player) => player.id).join(","), keyString];
      const suggestion = {
        mode,
        teamA,
        teamB,
        teamATotal,
        teamBTotal,
        difference: Math.abs(teamATotal - teamBTotal),
        key: keyString,
        explanation: {
          algorithmVersion: MATCHMAKING_ALGORITHM,
          mode,
          strengthGap: strengthGap ?? null,
          rest: { minimumRestMinutes, eligibleAt: new Date(now).toISOString() },
          teamSkillTotals: { teamA: teamATotal, teamB: teamBTotal, difference: Math.abs(teamATotal - teamBTotal) },
          skillDiversity: { groupSpread: skillSpread, partnerMix },
          repeatPenalties: {
            recentPairCount: recentPairValues.filter(Boolean).length,
            recentPairTotal: recentPairValues.reduce((sum, value) => sum + value, 0),
            recentQuartetRepeats,
            allTimePairCount: allPairValues.filter(Boolean).length,
            allTimePairTotal: allPairValues.reduce((sum, value) => sum + value, 0),
            allQuartetRepeats,
            recentPartnerRepeats: recentPartners,
            allTimePartnerRepeats: allPartners,
          },
          partnerRotation: { recentRepeats: recentPartners, allTimeRepeats: allPartners, preservedTeamBalance: true },
          lateArrival: { minimumPending, selectedPending: group.filter((player) => player.latePenaltyState === "PENDING").length, preferenceApplied: minimumPending > 0 || group.some((player) => player.latePenaltyState === "PENDING") },
          fairness: { minimumGames: candidateMinimumGames, minimumGamesCount: lowestGames, manualOverride: hasManualOverride, previouslySkippedCount },
        },
      };
      if (!best || compare(key, best.key) < 0) best = { key, suggestion };
    }
  });
  const selected = best as { suggestion: Suggestion } | null;
  return selected?.suggestion ?? null;
}

export function queueBuckets(players: DomainQueuePlayer[], now = Date.now()) {
  const sorted = [...players].sort((a, b) => (a.queueEnteredAt ?? "").localeCompare(b.queueEnteredAt ?? "") || a.displayName.localeCompare(b.displayName));
  const buckets = { inactive: [] as DomainQueuePlayer[], waiting: [] as DomainQueuePlayer[], queued: [] as DomainQueuePlayer[], playing: [] as DomainQueuePlayer[], resting: [] as DomainQueuePlayer[] };
  for (const player of sorted) { if (player.status === "WAITING") buckets.waiting.push(player); else if (player.status === "QUEUED") buckets.queued.push(player); else if (player.status === "PLAYING") buckets.playing.push(player); else if (player.status === "RESTING") buckets.resting.push(player); else buckets.inactive.push(player); }
  return { ...buckets, serverTime: new Date(now).toISOString() };
}

export function historyDurationSeconds(startedAt?: string | null, completedAt?: string | null) {
  if (!startedAt || !completedAt) return null;
  return Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}
