export type Gender = "MALE" | "FEMALE";
export type SkillLevel = "NEWBIE" | "BEGINNER" | "INTERMEDIATE" | "UPPER_INTERMEDIATE" | "ADVANCED";
export type SessionPlayerStatus = "INACTIVE" | "WAITING" | "QUEUED" | "PLAYING" | "RESTING" | "CHECKED_OUT";
export type SessionStatus = "DRAFT" | "ACTIVE" | "ENDED" | "CANCELLED";
export type CourtStatus = "AVAILABLE" | "OCCUPIED" | "PAUSED" | "CLOSED";
export type MatchStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type MatchSource = "MANUAL" | "AUTOMATIC" | "MANUAL_ADJUSTED";
export type MatchmakingMode = "OPEN" | "SAME_SKILL" | "BALANCED" | "SAME_GENDER" | "MIXED_DOUBLES";
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

export type DomainSessionPlayer = {
  id: string;
  sessionId?: string | null;
  playerId: string;
  displayName: string;
  gender: Gender;
  skillLevel: SkillLevel;
  skillWeight: number;
  status: SessionPlayerStatus;
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
  currentMatchId?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  restStartedAt?: string | null;
  version: number;
};

export type MatchParticipant = { id: string; matchId: string; sessionPlayerId: string; team: TeamSide; teamSlot: number; priorQueueEnteredAt?: string | null; displayName?: string };
export type MatchGame = { id: string; scoreRevisionId: string; gameNumber: number; teamAScore: number; teamBScore: number; winnerTeam: TeamSide };
export type MatchScoreRevision = { id: string; matchId: string; revisionNumber: number; winnerTeam: TeamSide; reason?: string | null; supersedesRevisionId?: string | null; createdAt?: string; games: MatchGame[] };
export type DomainMatch = { id: string; sessionId: string; courtId?: string | null; status: MatchStatus; source: MatchSource; matchmakingMode?: MatchmakingMode | null; algorithmVersion?: string | null; suggestionKey?: string | null; suggestionExplanation?: unknown; queuedAt: string; startedAt?: string | null; completedAt?: string | null; cancelledAt?: string | null; cancellationReason?: string | null; winnerTeam?: TeamSide | null; currentRevisionId?: string | null; version: number; participants: MatchParticipant[]; scoreRevisions: MatchScoreRevision[] };

export type DomainCourt = { id: string; sessionId: string; name: string; normalizedName: string; displayOrder: number; status: CourtStatus; currentMatchId?: string | null; closedAt?: string | null; version: number };
export type DomainSession = { id: string; name: string; normalizedName: string; sessionDate: string; status: SessionStatus; startedAt?: string | null; endedAt?: string | null; cancelledAt?: string | null; pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: 1 | 3; minimumRestMinutes: number; matchmakingAlgorithm: string; matchmakingRevision: number; version: number };
export type DomainSettings = { id: string; pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: 1 | 3; minimumRestMinutes: number; defaultFeeMode: string; defaultFixedFeeMinor?: number | null; currencyCode: string; timeZone: string; version: number };
export type DomainFeeConfig = { id: string; sessionId: string; mode: string; currencyCode: string; fixedAmountPerPlayerMinor?: number | null; expectedSessionCostMinor?: number | null; participationRule: string; frozenAt?: string | null; version: number };
export type DomainPayment = { id: string; sessionId: string; sessionPlayerId: string; kind: string; method?: string | null; amountMinor: number; reference?: string | null; note?: string | null; reversalOfPaymentId?: string | null; recordedById: string; occurredAt: string; createdAt: string };
export type DomainAudit = { id: string; sessionId?: string | null; action: string; entityType: string; entityId: string; reason?: string | null; beforeJson?: unknown; afterJson?: unknown; requestId: string; createdAt: string };

export type CloudSnapshotV1 = {
  schemaVersion: 1;
  queueMasterId: string;
  settings: DomainSettings | null;
  players: DomainPlayer[];
  sessions: DomainSession[];
  sessionPlayers: Array<DomainSessionPlayer & { sessionId?: string }>;
  courts: DomainCourt[];
  matches: DomainMatch[];
  feeConfigs: DomainFeeConfig[];
  payments: DomainPayment[];
  audits: DomainAudit[];
  careerStats: Array<Record<string, unknown>>;
};

export type PlayerDeletionBusyPlayer = {
  playerId: string;
  sessionPlayerId: string;
  displayName: string;
  sessionId: string;
  status: SessionPlayerStatus;
};

export type PlayerDeletionImpact = {
  playerIds: string[];
  playerNames: string[];
  busyPlayers: PlayerDeletionBusyPlayer[];
  affectedSessionIds: string[];
  affectedMatchIds: string[];
  affectedPaymentIds: string[];
  otherParticipantPlayerIds: string[];
  otherParticipantSessionPlayerIds: string[];
};

const snapshotClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const allocateEqualSplit = (total: number, ids: string[]) => {
  const base = ids.length ? Math.floor(total / ids.length) : 0;
  const remainder = ids.length ? total - (base * ids.length) : 0;
  return new Map(ids.map((idValue, index) => [idValue, base + (index < remainder ? 1 : 0)]));
};

export function previewPlayerDeletion(snapshot: CloudSnapshotV1, playerIds: string[]): PlayerDeletionImpact {
  const uniqueIds = [...new Set(playerIds)];
  const selectedPlayers = snapshot.players.filter((player) => uniqueIds.includes(player.id));
  if (selectedPlayers.length !== uniqueIds.length) throw new Error("One or more players were not found.");
  const selectedSessionPlayers = snapshot.sessionPlayers.filter((player) => uniqueIds.includes(player.playerId));
  const selectedSessionPlayerIds = new Set(selectedSessionPlayers.map((player) => player.id));
  const affectedMatches = snapshot.matches.filter((match) => match.participants.some((participant) => selectedSessionPlayerIds.has(participant.sessionPlayerId)));
  const affectedMatchIds = affectedMatches.map((match) => match.id);
  const affectedSessionIds = [...new Set([
    ...selectedSessionPlayers.map((player) => player.sessionId).filter((value): value is string => Boolean(value)),
    ...affectedMatches.map((match) => match.sessionId),
  ])];
  const otherParticipantSessionPlayerIds = [...new Set(affectedMatches.flatMap((match) => match.participants.map((participant) => participant.sessionPlayerId)).filter((idValue) => !selectedSessionPlayerIds.has(idValue)))];
  const otherParticipantPlayerIds = [...new Set(snapshot.sessionPlayers.filter((player) => otherParticipantSessionPlayerIds.includes(player.id)).map((player) => player.playerId))];
  return {
    playerIds: uniqueIds,
    playerNames: selectedPlayers.map((player) => player.displayName),
    busyPlayers: selectedSessionPlayers.filter((player) => player.status === "QUEUED" || player.status === "PLAYING").map((player) => ({
      playerId: player.playerId,
      sessionPlayerId: player.id,
      displayName: player.displayName,
      sessionId: player.sessionId ?? "",
      status: player.status,
    })),
    affectedSessionIds,
    affectedMatchIds,
    affectedPaymentIds: snapshot.payments.filter((payment) => selectedSessionPlayerIds.has(payment.sessionPlayerId)).map((payment) => payment.id),
    otherParticipantPlayerIds,
    otherParticipantSessionPlayerIds,
  };
}

function rebuildSnapshotStats(snapshot: CloudSnapshotV1, sessionIds: Set<string>) {
  const sessionPlayers = snapshot.sessionPlayers.filter((player) => player.sessionId && sessionIds.has(player.sessionId));
  for (const player of sessionPlayers) {
    player.matchesPlayed = 0;
    player.wins = 0;
    player.losses = 0;
    player.pointsFor = 0;
    player.pointsAgainst = 0;
    player.lastMatchEndedAt = null;
  }
  const byId = new Map(sessionPlayers.map((player) => [player.id, player]));
  for (const match of snapshot.matches.filter((item) => item.status === "COMPLETED" && item.sessionId && sessionIds.has(item.sessionId))) {
    const revision = match.scoreRevisions.find((item) => item.id === match.currentRevisionId) ?? [...match.scoreRevisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
    if (!revision) continue;
    const points = revision.games.reduce((sum, game) => ({ a: sum.a + game.teamAScore, b: sum.b + game.teamBScore }), { a: 0, b: 0 });
    for (const participant of match.participants) {
      const player = byId.get(participant.sessionPlayerId);
      if (!player) continue;
      const won = participant.team === revision.winnerTeam;
      player.matchesPlayed += 1;
      player.wins += won ? 1 : 0;
      player.losses += won ? 0 : 1;
      player.pointsFor += participant.team === "A" ? points.a : points.b;
      player.pointsAgainst += participant.team === "A" ? points.b : points.a;
      player.lastMatchEndedAt = match.completedAt ?? player.lastMatchEndedAt;
    }
  }
}

export function rebuildSnapshotCareerStats(snapshot: CloudSnapshotV1) {
  const rows = new Map<string, { matchesPlayed: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number }>();
  const playerBySessionPlayerId = new Map(snapshot.sessionPlayers.map((player) => [player.id, player.playerId]));
  for (const match of snapshot.matches.filter((item) => item.status === "COMPLETED")) {
    const revision = match.scoreRevisions.find((item) => item.id === match.currentRevisionId) ?? [...match.scoreRevisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
    if (!revision) continue;
    const points = revision.games.reduce((sum, game) => ({ a: sum.a + game.teamAScore, b: sum.b + game.teamBScore }), { a: 0, b: 0 });
    for (const participant of match.participants) {
      const playerId = playerBySessionPlayerId.get(participant.sessionPlayerId);
      if (!playerId) continue;
      const row = rows.get(playerId) ?? { matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
      const won = participant.team === revision.winnerTeam;
      row.matchesPlayed += 1;
      row.wins += won ? 1 : 0;
      row.losses += won ? 0 : 1;
      row.pointsFor += participant.team === "A" ? points.a : points.b;
      row.pointsAgainst += participant.team === "A" ? points.b : points.a;
      rows.set(playerId, row);
    }
  }
  const prior = new Map(snapshot.careerStats.map((row) => [String(row.playerId ?? ""), row]));
  snapshot.careerStats = [...rows.entries()].map(([playerId, row]) => ({
    ...(prior.get(playerId) ?? {}),
    playerId,
    matchesPlayed: row.matchesPlayed,
    wins: row.wins,
    losses: row.losses,
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    pointDifferential: row.pointsFor - row.pointsAgainst,
    winRateBasisPoints: row.matchesPlayed ? Math.floor((row.wins * 10000) / row.matchesPlayed) : 0,
  }));
}

export function applyPlayerDeletion(snapshot: CloudSnapshotV1, playerIds: string[]) {
  const impact = previewPlayerDeletion(snapshot, playerIds);
  if (impact.busyPlayers.length) throw new Error("Busy players cannot be deleted while queued or playing.");
  const next = snapshotClone(snapshot);
  const selectedIds = new Set(impact.playerIds);
  const selectedSessionPlayerIds = new Set(next.sessionPlayers.filter((player) => selectedIds.has(player.playerId)).map((player) => player.id));
  const affectedSessionIds = new Set(impact.affectedSessionIds);
  next.matches = next.matches.filter((match) => !match.participants.some((participant) => selectedSessionPlayerIds.has(participant.sessionPlayerId)));
  const removedPaymentIds = new Set(next.payments.filter((payment) => selectedSessionPlayerIds.has(payment.sessionPlayerId)).map((payment) => payment.id));
  next.payments = next.payments.filter((payment) => !removedPaymentIds.has(payment.id) && !(payment.reversalOfPaymentId && removedPaymentIds.has(payment.reversalOfPaymentId)));
  next.sessionPlayers = next.sessionPlayers.filter((player) => !selectedIds.has(player.playerId));
  next.players = next.players.filter((player) => !selectedIds.has(player.id));
  for (const session of next.sessions) {
    if (affectedSessionIds.has(session.id)) {
      session.matchmakingRevision += 1;
      session.version += 1;
    }
  }
  for (const config of next.feeConfigs) {
    if (!affectedSessionIds.has(config.sessionId) || config.mode !== "EQUAL_SPLIT") continue;
    const roster = next.sessionPlayers.filter((player) => player.sessionId === config.sessionId).sort((a, b) => a.id.localeCompare(b.id));
    const allocations = allocateEqualSplit(config.expectedSessionCostMinor ?? 0, roster.map((player) => player.id));
    for (const player of roster) player.amountDueMinor = allocations.get(player.id) ?? 0;
  }
  rebuildSnapshotStats(next, affectedSessionIds);
  rebuildSnapshotCareerStats(next);
  return { snapshot: next, impact };
}

export type MatchPlayer = { id: string; displayName: string; gender: Gender; skillWeight: number; skillLevel: SkillLevel; status: SessionPlayerStatus; gamesPlayed: number; queueEnteredAt: string | null; lastMatchEndedAt: string | null; manualPriority: number };
export type MatchHistory = { partners: Map<string, Map<string, number>>; opponents: Map<string, Map<string, number>>; quartets: Map<string, number>; encounters?: Map<string, Map<string, number>>; recentPartners?: Map<string, Map<string, number>>; recentOpponents?: Map<string, Map<string, number>>; recentEncounters?: Map<string, Map<string, number>>; recentQuartets?: Map<string, number> };
export type Suggestion = { mode: MatchmakingMode; teamA: MatchPlayer[]; teamB: MatchPlayer[]; teamATotal: number; teamBTotal: number; difference: number; key: string; explanation: Record<string, unknown> };

export function normalizeName(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function validateScores(games: ScoreInput[], settings: ScoreSettings): ValidatedScore[] {
  if (!Array.isArray(games) || games.length === 0 || games.length > settings.bestOf) throw new Error("The number of games does not match the session scoring rules.");
  const requiredWins = Math.floor(settings.bestOf / 2) + 1;
  let aWins = 0;
  let bWins = 0;
  const validated: ValidatedScore[] = [];
  for (const game of games) {
    if (!Number.isInteger(game.teamAScore) || !Number.isInteger(game.teamBScore) || game.teamAScore < 0 || game.teamBScore < 0) throw new Error("Scores must be non-negative integers.");
    if (game.teamAScore === game.teamBScore) throw new Error("A game cannot end in a tie.");
    const high = Math.max(game.teamAScore, game.teamBScore);
    const low = Math.min(game.teamAScore, game.teamBScore);
    if (settings.scoreCap !== null && (high > settings.scoreCap || low > settings.scoreCap)) throw new Error("Scores cannot exceed the configured cap.");
    const reachesCap = settings.scoreCap !== null && high === settings.scoreCap;
    if (!(reachesCap ? low < high : high >= settings.pointsToWin && high - low >= settings.winBy)) throw new Error("The submitted score does not satisfy the session rules.");
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
  if (recent && history.recentEncounters) return symmetricCount(history.recentEncounters, a, b);
  if (!recent && history.encounters) return symmetricCount(history.encounters, a, b);
  return Math.max(symmetricCount(recent ? history.recentPartners : history.partners, a, b), symmetricCount(recent ? history.recentOpponents : history.opponents, a, b));
};
const partnerCount = (history: MatchHistory, a: string, b: string, recent: boolean) => symmetricCount(recent ? history.recentPartners : history.partners, a, b);
const quartetKey = (players: MatchPlayer[]) => players.map((player) => player.id).sort().join(":");
const combinations = <T,>(items: T[], size: number) => { const result: T[][] = []; const walk = (start: number, selected: T[]) => { if (selected.length === size) { result.push([...selected]); return; } for (let index = start; index <= items.length - (size - selected.length); index += 1) { selected.push(items[index]!); walk(index + 1, selected); selected.pop(); } }; walk(0, []); return result; };
const partitions = <T,>(players: T[]) => { const [a, b, c, d] = players; return [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]] as [T[], T[]][]; };
const compare = (a: (number[] | number | string)[], b: (number[] | number | string)[]) => { for (let i = 0; i < a.length; i += 1) { const left = a[i]; const right = b[i]; if (Array.isArray(left) && Array.isArray(right)) { for (let j = 0; j < Math.max(left.length, right.length); j += 1) { const result = (left[j] ?? 0) - (right[j] ?? 0); if (result) return result; } } else if (typeof left === "string" && typeof right === "string") { const result = left.localeCompare(right); if (result) return result; } else if (typeof left === "number" && typeof right === "number" && left !== right) return left - right; } return 0; };

export function suggestMatch(players: MatchPlayer[], mode: MatchmakingMode, history: MatchHistory, excludedKeys: string[] = []): Suggestion | null {
  const eligible = players.filter((player) => player.status === "WAITING" && player.queueEnteredAt);
  if (eligible.length < 4) return null;
  const excluded = new Set(excludedKeys);
  const minimumGames = Math.min(...eligible.map((player) => player.gamesPlayed));
  const groups = combinations(eligible, 4).filter((group) => { const genders = new Set(group.map((player) => player.gender)); if (mode === "SAME_GENDER" && genders.size !== 1) return false; if (mode === "MIXED_DOUBLES" && (genders.size !== 2 || group.filter((player) => player.gender === "MALE").length !== 2)) return false; if (mode === "SAME_SKILL" && new Set(group.map((player) => player.skillWeight)).size !== 1) return false; return true; });
  const fair = groups.filter((group) => Math.max(...group.map((player) => player.gamesPlayed)) <= minimumGames + 1);
  const candidates = fair.length ? fair : groups;
  let best: { key: (number[] | number | string)[]; suggestion: Suggestion } | null = null;
  for (const group of candidates) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const skillSpread = Math.max(...group.map((player) => player.skillWeight)) - Math.min(...group.map((player) => player.skillWeight));
    const recentPairValues = group.flatMap((player, i) => group.slice(i + 1).map((other) => pairCount(history, player.id, other.id, true)));
    const allPairValues = group.flatMap((player, i) => group.slice(i + 1).map((other) => pairCount(history, player.id, other.id, false)));
    const recentQuartetRepeats = history.recentQuartets?.get(quartetKey(group)) ?? 0;
    const allQuartetRepeats = history.quartets.get(quartetKey(group)) ?? 0;
    for (const [teamA, teamB] of partitions(sorted)) {
      if (mode === "MIXED_DOUBLES" && (new Set(teamA.map((player) => player.gender)).size !== 2 || new Set(teamB.map((player) => player.gender)).size !== 2)) continue;
      const teamATotal = teamA.reduce((sum, player) => sum + player.skillWeight, 0);
      const teamBTotal = teamB.reduce((sum, player) => sum + player.skillWeight, 0);
      const keyString = `${teamA.map((player) => player.id).sort().join(",")}|${teamB.map((player) => player.id).sort().join(",")}`;
      if (excluded.has(keyString)) continue;
      const recentPartners = partnerCount(history, teamA[0]!.id, teamA[1]!.id, true) + partnerCount(history, teamB[0]!.id, teamB[1]!.id, true);
      const allPartners = partnerCount(history, teamA[0]!.id, teamA[1]!.id, false) + partnerCount(history, teamB[0]!.id, teamB[1]!.id, false);
      const partnerMix = Math.abs(teamA[0]!.skillWeight - teamA[1]!.skillWeight) + Math.abs(teamB[0]!.skillWeight - teamB[1]!.skillWeight);
      const lowestGames = group.filter((player) => player.gamesPlayed === minimumGames).length;
      const key: (number[] | number | string)[] = [[...group].map((player) => -(player.manualPriority ?? 0)).sort((a, b) => a - b), -lowestGames, Math.max(...group.map((player) => player.gamesPlayed)) - minimumGames, recentPairValues.filter(Boolean).length, recentPairValues.reduce((sum, value) => sum + value, 0), recentQuartetRepeats, allPairValues.filter(Boolean).length, allPairValues.reduce((sum, value) => sum + value, 0), allQuartetRepeats, mode === "BALANCED" ? -skillSpread : 0, group.map((player) => player.gamesPlayed).sort((a, b) => a - b), sorted.map((player) => player.queueEnteredAt ? new Date(player.queueEnteredAt).getTime() : Number.MAX_SAFE_INTEGER).sort((a, b) => a - b), sorted.map((player) => player.id).join(","), Math.abs(teamATotal - teamBTotal), recentPartners, allPartners, mode === "BALANCED" ? -partnerMix : 0, keyString];
      const suggestion = {
        mode,
        teamA,
        teamB,
        teamATotal,
        teamBTotal,
        difference: Math.abs(teamATotal - teamBTotal),
        key: keyString,
        explanation: {
          algorithmVersion: "v2-rotation",
          mode,
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
          fairness: { minimumGames, minimumGamesCount: lowestGames, manualOverride: false },
        },
      };
      if (!best || compare(key, best.key) < 0) best = { key, suggestion };
    }
  }
  return best?.suggestion ?? null;
}

export function queueBuckets(players: DomainSessionPlayer[], now = Date.now()) {
  const sorted = [...players].sort((a, b) => (a.queueEnteredAt ?? "").localeCompare(b.queueEnteredAt ?? "") || a.displayName.localeCompare(b.displayName));
  const buckets = { inactive: [] as DomainSessionPlayer[], waiting: [] as DomainSessionPlayer[], queued: [] as DomainSessionPlayer[], playing: [] as DomainSessionPlayer[], resting: [] as DomainSessionPlayer[] };
  for (const player of sorted) { if (player.status === "WAITING") buckets.waiting.push(player); else if (player.status === "QUEUED") buckets.queued.push(player); else if (player.status === "PLAYING") buckets.playing.push(player); else if (player.status === "RESTING") buckets.resting.push(player); else buckets.inactive.push(player); }
  return { ...buckets, serverTime: new Date(now).toISOString() };
}

export function historyDurationSeconds(startedAt?: string | null, completedAt?: string | null) {
  if (!startedAt || !completedAt) return null;
  return Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}
