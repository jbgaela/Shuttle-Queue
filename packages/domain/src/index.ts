export type Gender = "MALE" | "FEMALE";
export type SkillLevel = "NEWBIE" | "BEGINNER" | "UPPER_BEGINNER" | "INTERMEDIATE" | "UPPER_INTERMEDIATE" | "ADVANCED";
export type QueuePlayerStatus = "INACTIVE" | "WAITING" | "QUEUED" | "PLAYING" | "RESTING" | "CHECKED_OUT";
export type LatePenaltyState = "PENDING" | "SERVED" | "WAIVED";
export type CourtStatus = "AVAILABLE" | "OCCUPIED" | "PAUSED" | "CLOSED";
export type MatchStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type MatchSource = "MANUAL" | "AUTOMATIC" | "MANUAL_ADJUSTED";
export type MatchmakingMode = "OPEN" | "SAME_SKILL" | "BALANCED" | "SAME_GENDER" | "MIXED_DOUBLES" | "GUIDED" | "UNDEFEATED_CHALLENGE";
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

export type DomainSynergyTeam = {
  id: string;
  queuePlayerIds: [string, string];
  createdAt: string;
  version: number;
};

export type MatchParticipant = { id: string; matchId: string; queuePlayerId: string; team: TeamSide; teamSlot: number; priorQueueEnteredAt?: string | null; displayName?: string };
export type MatchGame = { id: string; scoreRevisionId: string; gameNumber: number; teamAScore: number; teamBScore: number; winnerTeam: TeamSide };
export type MatchScoreRevision = { id: string; matchId: string; revisionNumber: number; winnerTeam: TeamSide; reason?: string | null; supersedesRevisionId?: string | null; createdAt?: string; games: MatchGame[] };
export type DomainMatch = { id: string; courtId?: string | null; courtIdSnapshot?: string | null; courtNameSnapshot?: string | null; status: MatchStatus; source: MatchSource; matchmakingMode?: MatchmakingMode | null; algorithmVersion?: string | null; suggestionKey?: string | null; suggestionExplanation?: unknown; pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: 1 | 3; queuedAt: string; startedAt?: string | null; completedAt?: string | null; cancelledAt?: string | null; cancellationReason?: string | null; winnerTeam?: TeamSide | null; currentRevisionId?: string | null; version: number; participants: MatchParticipant[]; scoreRevisions: MatchScoreRevision[] };

export type DomainCourt = { id: string; name: string; normalizedName: string; displayOrder: number; status: CourtStatus; currentMatchId?: string | null; closedAt?: string | null; version: number };
export type DomainWorkspace = { startedAt: string; endedAt?: string | null; lateArrivalCutoffAt?: string | null; matchmakingAlgorithm: string; matchmakingRevision: number; version: number };
export type DomainSettings = { id: string; pointsToWin: number; winBy: number; scoreCap: number | null; bestOf: 1 | 3; minimumRestMinutes: number; lateArrivalGraceMinutes?: number; defaultFeeMode: string; defaultFixedFeeMinor?: number | null; noShowPenaltyMinor?: number; currencyCode: string; timeZone: string; defaultLateArrivalCutoffTime?: string | null; version: number };
export type DomainFeeConfig = { id: string; mode: string; currencyCode: string; fixedAmountPerPlayerMinor?: number | null; expectedQueueCostMinor?: number | null; noShowPenaltyMinor?: number; participationRule: string; frozenAt?: string | null; version: number };
export type DomainPayment = { id: string; queuePlayerId: string; kind: string; method?: string | null; amountMinor: number; reference?: string | null; note?: string | null; reversalOfPaymentId?: string | null; recordedById: string; occurredAt: string; createdAt: string };
export type DomainAudit = { id: string; action: string; entityType: string; entityId: string; reason?: string | null; beforeJson?: unknown; afterJson?: unknown; requestId: string; createdAt: string };

export type CloudSnapshotV2 = {
  schemaVersion: 2 | 3;
  queueMasterId: string;
  settings: DomainSettings | null;
  workspace: DomainWorkspace;
  players: DomainPlayer[];
  queuePlayers: DomainQueuePlayer[];
  synergyTeams?: DomainSynergyTeam[];
  courts: DomainCourt[];
  matches: DomainMatch[];
  feeConfig: DomainFeeConfig | null;
  payments: DomainPayment[];
  audits: DomainAudit[];
};

export type { CloudSnapshotV3, SyncClock, SyncMetadata, SyncRecordMetadata } from "./sync.js";
export { emptySyncMetadata, mergeSyncMetadata, mergeSyncSnapshots, seedSyncMetadata, stampSnapshotChanges } from "./sync.js";
export { PRIZE_RANKING_METHOD, PRIZE_RANKING_MIN_MATCHES, PRIZE_RANKING_PRIZE_PLACES, PRIZE_RANKING_VERSION, prizeRankingRows, wilsonLowerBound } from "./rankings.js";
export type { PrizeRankingInput, PrizeRankingMethod, PrizeRankingRow } from "./rankings.js";

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

export { allocateFinalFeeAmounts } from "./fees.js";

const SESSION_PLAYER_NOT_REMOVABLE_MESSAGE = "Only inactive or checked-out players without match or payment history can be removed from this session.";

export function removeSessionPlayer(snapshot: CloudSnapshotV2, queuePlayerId: string) {
  if (snapshot.workspace.endedAt) throw new Error("This queue session has ended. Start a fresh queue before continuing operations.");
  const current = snapshot.queuePlayers.find((player) => player.id === queuePlayerId);
  if (!current) throw new Error("Queue player not found.");
  if (current.status !== "INACTIVE" && current.status !== "CHECKED_OUT") throw new Error(SESSION_PLAYER_NOT_REMOVABLE_MESSAGE);
  if (snapshot.matches.some((match) => match.participants.some((participant) => participant.queuePlayerId === queuePlayerId)) || snapshot.payments.some((payment) => payment.queuePlayerId === queuePlayerId)) throw new Error(SESSION_PLAYER_NOT_REMOVABLE_MESSAGE);
  const next = snapshotClone(snapshot);
  next.queuePlayers = next.queuePlayers.filter((player) => player.id !== queuePlayerId);
  next.synergyTeams = (next.synergyTeams ?? []).filter((team) => !team.queuePlayerIds.includes(queuePlayerId));
  next.workspace.matchmakingRevision += 1;
  next.workspace.version += 1;
  if (next.feeConfig?.mode === "EQUAL_SPLIT") {
    const roster = next.queuePlayers.filter((player) => Boolean(player.checkedInAt)).slice().sort((a, b) => a.id.localeCompare(b.id));
    const allocations = allocateEqualSplit(next.feeConfig.expectedQueueCostMinor ?? 0, roster.map((player) => player.id));
    for (const player of roster) { player.amountDueMinor = allocations.get(player.id) ?? 0; player.version += 1; }
  }
  return { snapshot: next, removedPlayerId: queuePlayerId };
}

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
  next.synergyTeams = (next.synergyTeams ?? []).filter((team) => !team.queuePlayerIds.some((idValue) => selectedQueuePlayerIds.has(idValue)));
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

export type MatchPlayer = { id: string; displayName: string; gender: Gender; skillWeight: number; skillLevel: SkillLevel; effectiveSkillWeight?: number; effectiveSkillLevel?: SkillLevel; synergyTeamId?: string | null; status: QueuePlayerStatus; gamesPlayed: number; wins?: number; losses?: number; queueEnteredAt: string | null; lastMatchEndedAt: string | null; manualPriority: number; latePenaltyState?: LatePenaltyState | null };
export type GuidedLineupPlayer = Pick<MatchPlayer, "id" | "skillLevel">;
export type GuidedAvailabilityReason = "NO_GUIDED_COMPOSITION" | "REST_REQUIRED" | "NO_VALID_GROUP";
export type GuidedAvailabilitySummary = { available: boolean; reason: GuidedAvailabilityReason | null; waitingLearnerCount: number; waitingGuideCount: number; readyLearnerCount: number; readyGuideCount: number; nextEligibleAt: string | null };
export type MatchupAdvisory = { type: "LOW_SKILL_LONE_FEMALE"; queuePlayerId: string; displayName: string; skillLevel: "NEWBIE" | "BEGINNER" | "UPPER_BEGINNER" };
export type MatchHistory = { partners: Map<string, Map<string, number>>; opponents: Map<string, Map<string, number>>; quartets: Map<string, number>; encounters?: Map<string, Map<string, number>>; recentPartners?: Map<string, Map<string, number>>; recentOpponents?: Map<string, Map<string, number>>; recentEncounters?: Map<string, Map<string, number>>; recentQuartets?: Map<string, number> };
export type Suggestion = { mode: MatchmakingMode; teamA: MatchPlayer[]; teamB: MatchPlayer[]; teamATotal: number; teamBTotal: number; difference: number; key: string; matchupAdvisory?: MatchupAdvisory | null; explanation: Record<string, unknown> };
export type MatchmakingOptions = { strengthGap?: 1 | 2 | 3; minimumRestMinutes?: number; now?: string | Date; synergyTeams?: Array<Pick<DomainSynergyTeam, "id" | "queuePlayerIds">> };
const DEFAULT_BALANCED_STRENGTH_GAP = 1;
export const MATCHMAKING_ALGORITHM = "v11-guided-matchmaking-optimized-search";

export const skillWeights: Record<SkillLevel, number> = {
  NEWBIE: 1,
  BEGINNER: 2,
  UPPER_BEGINNER: 3,
  INTERMEDIATE: 4,
  UPPER_INTERMEDIATE: 5,
  ADVANCED: 6,
};

export const skillWeight = (level: SkillLevel) => skillWeights[level];

const effectiveWeightFor = (player: MatchPlayer) => player.effectiveSkillWeight ?? player.skillWeight;
const effectiveLevelFor = (player: MatchPlayer) => player.effectiveSkillLevel ?? player.skillLevel;

function applySynergyTeams(players: MatchPlayer[], teams: MatchmakingOptions["synergyTeams"] = []) {
  const byId = new Map(players.map((player) => [player.id, player]));
  const teamByPlayer = new Map<string, { id: string; queuePlayerIds: [string, string] }>();
  for (const team of teams ?? []) {
    if (!team || !Array.isArray(team.queuePlayerIds) || team.queuePlayerIds.length !== 2 || team.queuePlayerIds[0] === team.queuePlayerIds[1]) continue;
    const [firstId, secondId] = team.queuePlayerIds;
    if (!byId.has(firstId) || !byId.has(secondId) || teamByPlayer.has(firstId) || teamByPlayer.has(secondId)) continue;
    const pair = [firstId, secondId] as [string, string];
    teamByPlayer.set(firstId, { id: team.id, queuePlayerIds: pair });
    teamByPlayer.set(secondId, { id: team.id, queuePlayerIds: pair });
  }
  const enriched = players.map((player) => {
    const team = teamByPlayer.get(player.id);
    if (!team) return player;
    const partnerId = team.queuePlayerIds.find((id) => id !== player.id);
    const partner = partnerId ? byId.get(partnerId) : undefined;
    const highWeight = Math.max(player.skillWeight, partner?.skillWeight ?? player.skillWeight);
    const highLevel = (Object.entries(skillWeights).find(([, weight]) => weight === highWeight)?.[0] ?? player.skillLevel) as SkillLevel;
    return { ...player, synergyTeamId: team.id, effectiveSkillWeight: highWeight, effectiveSkillLevel: highLevel };
  });
  const grouped = new Map<string, MatchPlayer[]>();
  for (const player of enriched) if (player.synergyTeamId) grouped.set(player.synergyTeamId, [...(grouped.get(player.synergyTeamId) ?? []), player]);
  for (const members of grouped.values()) {
    const latestQueueTime = members.map((member) => member.queueEnteredAt ? new Date(member.queueEnteredAt).getTime() : Number.MIN_SAFE_INTEGER).reduce((max, value) => Math.max(max, value), Number.MIN_SAFE_INTEGER);
    const highestGames = Math.max(...members.map((member) => member.gamesPlayed));
    for (const member of members) { member.gamesPlayed = highestGames; member.queueEnteredAt = latestQueueTime === Number.MIN_SAFE_INTEGER ? null : new Date(latestQueueTime).toISOString(); }
  }
  return enriched;
}

export function validateSynergyLineup(teamA: MatchPlayer[], teamB: MatchPlayer[], teams: MatchmakingOptions["synergyTeams"] = []) {
  const selected = new Map([...teamA, ...teamB].map((player) => [player.id, teamA.includes(player) ? "A" : "B"]));
  const byId = new Map([...teamA, ...teamB].map((player) => [player.id, player]));
  for (const team of teams ?? []) {
    if (!team || !Array.isArray(team.queuePlayerIds) || team.queuePlayerIds.length !== 2 || team.queuePlayerIds[0] === team.queuePlayerIds[1]) return "Synergy teams must contain exactly two distinct players.";
    const [firstId, secondId] = team.queuePlayerIds;
    const firstSide = selected.get(firstId);
    const secondSide = selected.get(secondId);
    if (firstSide === undefined && secondSide === undefined) continue;
    if (firstSide === undefined || secondSide === undefined) return "A locked Synergy Team must include both players.";
    if (firstSide !== secondSide) return "Synergy Team partners must stay on the same side.";
    if (!byId.has(firstId) || !byId.has(secondId)) return "A Synergy Team member is unavailable.";
    const first = byId.get(firstId)!;
    const second = byId.get(secondId)!;
    const effectiveSkillWeight = Math.max(first.skillWeight, second.skillWeight);
    const effectiveSkillLevel = (Object.entries(skillWeights).find(([, weight]) => weight === effectiveSkillWeight)?.[0] ?? first.skillLevel) as SkillLevel;
    for (const member of [first, second]) {
      member.synergyTeamId = team.id;
      member.effectiveSkillWeight = effectiveSkillWeight;
      member.effectiveSkillLevel = effectiveSkillLevel;
    }
  }
  return null;
}

export const LONE_FEMALE_SKILL_LEVELS: SkillLevel[] = ["INTERMEDIATE", "UPPER_INTERMEDIATE", "ADVANCED"];
export const LOW_SKILL_LONE_FEMALE_LEVELS: MatchupAdvisory["skillLevel"][] = ["NEWBIE", "BEGINNER", "UPPER_BEGINNER"];
export const lowSkillLoneFemaleAdvisory = (teamA: Array<{ id: string; displayName: string; gender: string; skillLevel: string }>, teamB: Array<{ id: string; displayName: string; gender: string; skillLevel: string }>): MatchupAdvisory | null => {
  if (teamA.length !== 2 || teamB.length !== 2) return null;
  const group = [...teamA, ...teamB];
  const female = group.find((player) => player.gender === "FEMALE");
  if (!female || group.filter((player) => player.gender === "FEMALE").length !== 1 || group.filter((player) => player.gender === "MALE").length !== 3) return null;
  if (!LOW_SKILL_LONE_FEMALE_LEVELS.includes(female.skillLevel as MatchupAdvisory["skillLevel"])) return null;
  return { type: "LOW_SKILL_LONE_FEMALE", queuePlayerId: female.id, displayName: female.displayName, skillLevel: female.skillLevel as MatchupAdvisory["skillLevel"] };
};
export const isQualifiedLoneFemaleGroup = (group: MatchPlayer[]) => group.length === 4 && group.filter((player) => player.gender === "FEMALE").length === 1 && group.filter((player) => player.gender === "MALE").length === 3 && group.some((player) => player.gender === "FEMALE" && LONE_FEMALE_SKILL_LEVELS.includes(effectiveLevelFor(player)));
export const loneFemalePolicy = (teamA: MatchPlayer[], teamB: MatchPlayer[], mixedDoublesFallback = false) => {
  const group = [...teamA, ...teamB];
  const qualifyingFemale = isQualifiedLoneFemaleGroup(group) ? group.find((player) => player.gender === "FEMALE") : undefined;
  return { eligibleSkillLevels: [...LONE_FEMALE_SKILL_LEVELS], qualifyingFemaleId: qualifyingFemale?.id ?? null, applied: Boolean(qualifyingFemale), mixedDoublesFallback: Boolean(qualifyingFemale && mixedDoublesFallback) };
};
type MixedLineupPlayer = { id: string; gender: string };
export const isMixedDoublesGroup = (group: MixedLineupPlayer[]) => group.length === 4 && group.filter((player) => player.gender === "MALE").length === 2 && group.filter((player) => player.gender === "FEMALE").length === 2;
export const isStandardMixedDoublesLineup = (teamA: MixedLineupPlayer[], teamB: MixedLineupPlayer[]) => { const group = [...teamA, ...teamB]; return isMixedDoublesGroup(group) && new Set(group.map((player) => player.id)).size === 4 && teamA.length === 2 && teamB.length === 2 && teamA.some((player) => player.gender === "MALE") && teamA.some((player) => player.gender === "FEMALE") && teamB.some((player) => player.gender === "MALE") && teamB.some((player) => player.gender === "FEMALE"); };
export const validateMixedDoublesLineup = (teamA: MixedLineupPlayer[], teamB: MixedLineupPlayer[]) => {
  if (teamA.length !== 2 || teamB.length !== 2) return "Mixed doubles requires two players per team.";
  const group = [...teamA, ...teamB];
  if (new Set(group.map((player) => player.id)).size !== group.length) return "Mixed doubles requires four unique players.";
  if (!isMixedDoublesGroup(group)) return "Mixed doubles requires exactly two male and two female players.";
  if (!isStandardMixedDoublesLineup(teamA, teamB)) return "Mixed doubles requires one male and one female player on each team.";
  return null;
};

export const isProhibitedGeneratedGenderMatch = (teamA: MatchPlayer[], teamB: MatchPlayer[]) =>
  teamA.length === 2 && teamB.length === 2
  && ((teamA.every((player) => player.gender === "FEMALE") && teamB.every((player) => player.gender === "MALE"))
    || (teamA.every((player) => player.gender === "MALE") && teamB.every((player) => player.gender === "FEMALE")));

export type GuidedPlayerRole = "LEARNER" | "GUIDE";
export const GUIDED_LEARNER_SKILL_LEVELS: SkillLevel[] = ["NEWBIE", "BEGINNER"];
export const GUIDED_GUIDE_SKILL_LEVELS: SkillLevel[] = ["INTERMEDIATE"];
export const guidedPlayerRole = (player: Pick<MatchPlayer, "skillLevel">): GuidedPlayerRole | null =>
  GUIDED_LEARNER_SKILL_LEVELS.includes(player.skillLevel) ? "LEARNER" : GUIDED_GUIDE_SKILL_LEVELS.includes(player.skillLevel) ? "GUIDE" : null;
export const buildGuidedExplanation = (players: ReadonlyArray<GuidedLineupPlayer>) => ({
  learnerSkillLevels: [...GUIDED_LEARNER_SKILL_LEVELS],
  guideSkillLevels: [...GUIDED_GUIDE_SKILL_LEVELS],
  learnerIds: players.filter((player) => guidedPlayerRole(player) === "LEARNER").map((player) => player.id),
  guideIds: players.filter((player) => guidedPlayerRole(player) === "GUIDE").map((player) => player.id),
});
export const validateGuidedLineup = (teamA: ReadonlyArray<GuidedLineupPlayer>, teamB: ReadonlyArray<GuidedLineupPlayer>) => {
  if (teamA.length !== 2 || teamB.length !== 2) return "Guided matchups require two players per team.";
  const group = [...teamA, ...teamB];
  if (new Set(group.map((player) => player.id)).size !== group.length) return "Guided matchups require four unique players.";
  if (group.filter((player) => guidedPlayerRole(player) === "LEARNER").length !== 2 || group.filter((player) => guidedPlayerRole(player) === "GUIDE").length !== 2) return "Guided matchups require two Newbie/Beginner learners and two Intermediate guides.";
  if (![teamA, teamB].every((team) => team.some((player) => guidedPlayerRole(player) === "LEARNER") && team.some((player) => guidedPlayerRole(player) === "GUIDE"))) return "Guided matchups require one learner and one Intermediate guide on each team.";
  return null;
};

export const validateBalancedLineup = (teamA: MatchPlayer[], teamB: MatchPlayer[], strengthGap: number) => {
  const group = [...teamA, ...teamB];
  if (![1, 2].includes(teamA.length) || teamA.length !== teamB.length || new Set(group.map((player) => player.id)).size !== group.length) return "Choose unique players with equal team sizes for singles or doubles.";
  const spread = Math.max(...group.map((player) => effectiveWeightFor(player))) - Math.min(...group.map((player) => effectiveWeightFor(player)));
  if (spread > strengthGap) return `Handicap matchups require a player strength spread of at most ${strengthGap}.`;
  const teamDifference = Math.abs(teamA.reduce((sum, player) => sum + effectiveWeightFor(player), 0) - teamB.reduce((sum, player) => sum + effectiveWeightFor(player), 0));
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
const isAllowedNewbiePartner = (player: MatchPlayer) => effectiveLevelFor(player) === "BEGINNER" || effectiveLevelFor(player) === "UPPER_BEGINNER";
export const isProhibitedGeneratedNewbieMatch = (teamA: MatchPlayer[], teamB: MatchPlayer[]) => {
  if (teamA.length !== 2 || teamB.length !== 2) return false;
  return [teamA, teamB].some((team) => team.some((player) => {
    if (player.skillLevel !== "NEWBIE") return false;
    const partner = team.find((candidate) => candidate.id !== player.id);
    if (partner?.synergyTeamId && partner.synergyTeamId === player.synergyTeamId) return false;
    return !partner || !isAllowedNewbiePartner(partner);
  }));
};
const hasNewbieCompatiblePartition = (group: MatchPlayer[]) => partitions(group).some(([teamA, teamB]) => !isProhibitedGeneratedNewbieMatch(teamA, teamB));
const sameSynergyTeam = (first: MatchPlayer, second: MatchPlayer) => Boolean(first.synergyTeamId && first.synergyTeamId === second.synergyTeamId);
const hasCompleteSynergyTeams = (group: MatchPlayer[]) => group.every((player) => !player.synergyTeamId || group.some((candidate) => candidate.id !== player.id && sameSynergyTeam(player, candidate)));
const hasSynergyCompatiblePartition = (group: MatchPlayer[]) => hasCompleteSynergyTeams(group) && partitions(group).some(([teamA, teamB]) => !group.some((player) => {
  const partner = group.find((candidate) => candidate.id !== player.id && sameSynergyTeam(player, candidate));
  return Boolean(partner && ((teamA.includes(player) && teamB.includes(partner)) || (teamB.includes(player) && teamA.includes(partner))));
}));
const compare = (a: (number[] | number | string)[], b: (number[] | number | string)[]) => { for (let i = 0; i < a.length; i += 1) { const left = a[i]; const right = b[i]; if (Array.isArray(left) && Array.isArray(right)) { for (let j = 0; j < Math.max(left.length, right.length); j += 1) { const result = (left[j] ?? 0) - (right[j] ?? 0); if (result) return result; } } else if (typeof left === "string" && typeof right === "string") { const result = left.localeCompare(right); if (result) return result; } else if (typeof left === "number" && typeof right === "number" && left !== right) return left - right; } return 0; };
const restReadyAt = (lastMatchEndedAt: string | null, minimumRestMinutes: number, now: number) => { if (!lastMatchEndedAt || minimumRestMinutes <= 0) return now; return new Date(lastMatchEndedAt).getTime() + minimumRestMinutes * 60_000; };

const MAX_MATCHMAKING_POOL = 40;
const MAX_BOUNDED_GROUPS = 8_000;
const matchmakingPlayerCompare = (a: MatchPlayer, b: MatchPlayer, previouslySkippedPlayerIds: Set<string>) => (b.manualPriority ?? 0) - (a.manualPriority ?? 0) || a.gamesPlayed - b.gamesPlayed || Number(a.latePenaltyState === "PENDING") - Number(b.latePenaltyState === "PENDING") || Number(previouslySkippedPlayerIds.has(b.id)) - Number(previouslySkippedPlayerIds.has(a.id)) || (a.queueEnteredAt ?? "").localeCompare(b.queueEnteredAt ?? "") || a.id.localeCompare(b.id);
const diversePool = (players: MatchPlayer[], limit: number, previouslySkippedPlayerIds: Set<string>, partnerSource = players) => {
  const sorted = [...players].sort((a, b) => matchmakingPlayerCompare(a, b, previouslySkippedPlayerIds));
  const selected: MatchPlayer[] = [];
  const selectedIds = new Set<string>();
  const buckets = new Map<string, MatchPlayer[]>();
  for (const player of sorted) { const key = `${player.gender}:${effectiveLevelFor(player)}`; const bucket = buckets.get(key) ?? []; bucket.push(player); buckets.set(key, bucket); }
  for (const key of [...buckets.keys()].sort()) {
    for (const player of buckets.get(key)!.slice(0, 2)) {
      if (selected.length >= limit) break;
      selected.push(player);
      selectedIds.add(player.id);
    }
    if (selected.length >= limit) break;
  }
  for (const player of sorted) { if (selected.length >= limit) break; if (!selectedIds.has(player.id)) selected.push(player); }
  const selectedById = new Set(selected.map((player) => player.id));
  for (const player of selected.slice()) {
    if (!player.synergyTeamId) continue;
    const partner = partnerSource.find((candidate) => candidate.synergyTeamId === player.synergyTeamId && candidate.id !== player.id);
    if (partner && !selectedById.has(partner.id)) { selected.push(partner); selectedById.add(partner.id); }
  }
  return selected;
};
const boundedEligiblePools = (eligible: MatchPlayer[], mode: MatchmakingMode, previouslySkippedPlayerIds: Set<string>) => {
  if (eligible.length <= MAX_MATCHMAKING_POOL) return [eligible];
  if (mode === "MIXED_DOUBLES") return [[...new Map((["MALE", "FEMALE"] as const).flatMap((gender) => diversePool(eligible.filter((player) => player.gender === gender), 20, previouslySkippedPlayerIds, eligible)).map((player) => [player.id, player] as const)).values()].sort((a, b) => matchmakingPlayerCompare(a, b, previouslySkippedPlayerIds))];
  if (mode === "GUIDED") { const learners = diversePool(eligible.filter((player) => guidedPlayerRole(player) === "LEARNER"), 20, previouslySkippedPlayerIds, eligible); const guides = diversePool(eligible.filter((player) => guidedPlayerRole(player) === "GUIDE"), 20, previouslySkippedPlayerIds, eligible); return [[...new Map([...learners, ...guides].map((player) => [player.id, player] as const)).values()].sort((a, b) => matchmakingPlayerCompare(a, b, previouslySkippedPlayerIds))]; }
  if (mode === "SAME_GENDER") return (["MALE", "FEMALE"] as const).map((gender) => diversePool(eligible.filter((player) => player.gender === gender), MAX_MATCHMAKING_POOL, previouslySkippedPlayerIds));
  if (mode === "SAME_SKILL") return (["NEWBIE", "BEGINNER", "UPPER_BEGINNER", "INTERMEDIATE", "UPPER_INTERMEDIATE", "ADVANCED"] as const).map((skillLevel) => diversePool(eligible.filter((player) => effectiveLevelFor(player) === skillLevel), MAX_MATCHMAKING_POOL, previouslySkippedPlayerIds));
  return [diversePool(eligible, MAX_MATCHMAKING_POOL, previouslySkippedPlayerIds)];
};
type GuidedTeam = [MatchPlayer, MatchPlayer];
type GuidedSearchContext = {
  waitingLearners: MatchPlayer[];
  waitingGuides: MatchPlayer[];
  readyLearners: MatchPlayer[];
  readyGuides: MatchPlayer[];
  freeLearners: MatchPlayer[];
  freeGuides: MatchPlayer[];
  lockedTeams: GuidedTeam[];
  blockedIds: Set<string>;
  summary: GuidedAvailabilitySummary;
  witness: [MatchPlayer[], MatchPlayer[]] | null;
};
const guidedReady = (player: MatchPlayer, minimumRestMinutes: number, now: number) => player.status === "WAITING" && Boolean(player.queueEnteredAt) && restReadyAt(player.lastMatchEndedAt, minimumRestMinutes, now) <= now;
const guidedPartitionIsValid = (teamA: MatchPlayer[], teamB: MatchPlayer[], synergyTeams?: MatchmakingOptions["synergyTeams"]) =>
  !validateGuidedLineup(teamA, teamB)
  && !isProhibitedGeneratedGenderMatch(teamA, teamB)
  && !teamA.some((player) => teamB.some((candidate) => sameSynergyTeam(player, candidate)))
  && !validateSynergyLineup(teamA, teamB, synergyTeams);
const guidedGroupWitness = (group: MatchPlayer[], synergyTeams?: MatchmakingOptions["synergyTeams"]): [MatchPlayer[], MatchPlayer[]] | null => {
  if (group.length !== 4 || group.filter((player) => guidedPlayerRole(player) === "LEARNER").length !== 2 || group.filter((player) => guidedPlayerRole(player) === "GUIDE").length !== 2) return null;
  for (const [teamA, teamB] of partitions(group)) if (guidedPartitionIsValid(teamA, teamB, synergyTeams)) return [teamA, teamB];
  return null;
};
const buildGuidedSearchContext = (players: MatchPlayer[], options: MatchmakingOptions = {}): GuidedSearchContext => {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const minimumRestMinutes = Math.max(0, options.minimumRestMinutes ?? 0);
  const waitingLearners = players.filter((player) => player.status === "WAITING" && Boolean(player.queueEnteredAt) && guidedPlayerRole(player) === "LEARNER");
  const waitingGuides = players.filter((player) => player.status === "WAITING" && Boolean(player.queueEnteredAt) && guidedPlayerRole(player) === "GUIDE");
  const readyLearners = waitingLearners.filter((player) => guidedReady(player, minimumRestMinutes, now));
  const readyGuides = waitingGuides.filter((player) => guidedReady(player, minimumRestMinutes, now));
  const readyIds = new Set([...readyLearners, ...readyGuides].map((player) => player.id));
  const byId = new Map(players.map((player) => [player.id, player]));
  const blockedIds = new Set<string>();
  const lockedTeams: GuidedTeam[] = [];
  const seenTeamIds = new Set<string>();
  const seenPlayerIds = new Set<string>();
  for (const team of options.synergyTeams ?? []) {
    if (!team || !Array.isArray(team.queuePlayerIds) || team.queuePlayerIds.length !== 2 || team.queuePlayerIds[0] === team.queuePlayerIds[1] || seenTeamIds.has(team.id)) continue;
    seenTeamIds.add(team.id);
    const [firstId, secondId] = team.queuePlayerIds;
    if (seenPlayerIds.has(firstId) || seenPlayerIds.has(secondId)) continue;
    seenPlayerIds.add(firstId);
    seenPlayerIds.add(secondId);
    const first = byId.get(firstId);
    const second = byId.get(secondId);
    if (!first && !second) continue;
    if (!first || !second || !readyIds.has(firstId) || !readyIds.has(secondId)) {
      if (first) blockedIds.add(first.id);
      if (second) blockedIds.add(second.id);
      continue;
    }
    const firstRole = guidedPlayerRole(first);
    const secondRole = guidedPlayerRole(second);
    if (!firstRole || !secondRole || firstRole === secondRole) {
      blockedIds.add(first.id);
      blockedIds.add(second.id);
      continue;
    }
    lockedTeams.push(firstRole === "LEARNER" ? [first, second] : [second, first]);
    blockedIds.add(first.id);
    blockedIds.add(second.id);
  }
  const freeLearners = readyLearners.filter((player) => !blockedIds.has(player.id));
  const freeGuides = readyGuides.filter((player) => !blockedIds.has(player.id));
  const nextEligibleTimes = [...waitingLearners, ...waitingGuides]
    .map((player) => restReadyAt(player.lastMatchEndedAt, minimumRestMinutes, now))
    .filter((eligibleAt) => eligibleAt > now)
    .map((eligibleAt) => eligibleAt);
  const waitingCountsSufficient = waitingLearners.length >= 2 && waitingGuides.length >= 2;
  const readyCountsSufficient = readyLearners.length >= 2 && readyGuides.length >= 2;
  const summaryBase = {
    waitingLearnerCount: waitingLearners.length,
    waitingGuideCount: waitingGuides.length,
    readyLearnerCount: readyLearners.length,
    readyGuideCount: readyGuides.length,
    nextEligibleAt: nextEligibleTimes.length ? new Date(Math.min(...nextEligibleTimes)).toISOString() : null,
  };
  const context: GuidedSearchContext = { waitingLearners, waitingGuides, readyLearners, readyGuides, freeLearners, freeGuides, lockedTeams, blockedIds, summary: { available: false, reason: "NO_VALID_GROUP", ...summaryBase }, witness: null };
  const findWitness = (): [MatchPlayer[], MatchPlayer[]] | null => {
    for (let first = 0; first < lockedTeams.length; first += 1) for (let second = first + 1; second < lockedTeams.length; second += 1) {
      const group = [...lockedTeams[first]!, ...lockedTeams[second]!];
      const witness = guidedGroupWitness(group, options.synergyTeams);
      if (witness) return witness;
    }
    const learnerRepresentatives = ["MALE", "FEMALE"].flatMap((gender) => freeLearners.filter((player) => player.gender === gender).slice(0, 2));
    const lockedGuideRepresentatives = ["MALE", "FEMALE"].flatMap((gender) => freeGuides.filter((player) => player.gender === gender).slice(0, 2));
    for (const locked of lockedTeams) {
      for (const learner of learnerRepresentatives) for (const guide of lockedGuideRepresentatives) {
        const witness = guidedGroupWitness([...locked, learner, guide], options.synergyTeams);
        if (witness) return witness;
      }
    }
    const guideRepresentatives = ["MALE", "FEMALE"].flatMap((gender) => freeGuides.filter((player) => player.gender === gender).slice(0, 2));
    for (let learnerIndex = 0; learnerIndex < freeLearners.length - 1; learnerIndex += 1) for (let secondLearnerIndex = learnerIndex + 1; secondLearnerIndex < freeLearners.length; secondLearnerIndex += 1) {
      const learners = [freeLearners[learnerIndex]!, freeLearners[secondLearnerIndex]!];
      for (let guideIndex = 0; guideIndex < guideRepresentatives.length - 1; guideIndex += 1) for (let secondGuideIndex = guideIndex + 1; secondGuideIndex < guideRepresentatives.length; secondGuideIndex += 1) {
        const witness = guidedGroupWitness([...learners, guideRepresentatives[guideIndex]!, guideRepresentatives[secondGuideIndex]!], options.synergyTeams);
        if (witness) return witness;
      }
    }
    return null;
  };
  context.witness = waitingCountsSufficient && readyCountsSufficient ? findWitness() : null;
  context.summary = { ...summaryBase, available: Boolean(context.witness), reason: !waitingCountsSufficient ? "NO_GUIDED_COMPOSITION" : !readyCountsSufficient ? "REST_REQUIRED" : context.witness ? null : "NO_VALID_GROUP" };
  return context;
};
export const evaluateGuidedAvailability = (players: MatchPlayer[], options: MatchmakingOptions = {}): GuidedAvailabilitySummary => buildGuidedSearchContext(applySynergyTeams(players, options.synergyTeams), options).summary;
export const isGuidedMatchAvailable = (players: MatchPlayer[], options: MatchmakingOptions = {}) => evaluateGuidedAvailability(players, options).available;

type GuidedCandidateResult = { groups: MatchPlayer[][]; evaluatedCount: number; bounded: boolean };
const guidedCandidateGroups = (context: GuidedSearchContext, previouslySkippedPlayerIds: Set<string>, boundedSearch: boolean, synergyTeams?: MatchmakingOptions["synergyTeams"]): GuidedCandidateResult => {
  const learnerPool = boundedSearch ? diversePool(context.freeLearners, 20, previouslySkippedPlayerIds, context.freeLearners) : [...context.freeLearners];
  const guidePool = boundedSearch ? diversePool(context.freeGuides, 20, previouslySkippedPlayerIds, context.freeGuides) : [...context.freeGuides];
  const lockedPool = boundedSearch ? context.lockedTeams.slice(0, 20) : context.lockedTeams;
  const groups: MatchPlayer[][] = [];
  const keys = new Set<string>();
  let evaluatedCount = 0;
  let bounded = false;
  const push = (group: MatchPlayer[]) => {
    evaluatedCount += 1;
    const witness = guidedGroupWitness(group, synergyTeams);
    if (!witness) return;
    const key = quartetKey(group);
    if (keys.has(key)) return;
    keys.add(key);
    groups.push(group);
    if (boundedSearch && groups.length >= MAX_BOUNDED_GROUPS) bounded = true;
  };
  if (context.witness) push([...context.witness[0], ...context.witness[1]]);
  if (!bounded) for (let first = 0; first < lockedPool.length; first += 1) for (let second = first + 1; second < lockedPool.length; second += 1) {
    push([...lockedPool[first]!, ...lockedPool[second]!]);
    if (bounded) break;
  }
  if (!bounded) for (const locked of lockedPool) {
    for (const learner of learnerPool) for (const guide of guidePool) {
      push([...locked, learner, guide]);
      if (bounded) break;
    }
    if (bounded) break;
  }
  if (!bounded) forEachCombination(learnerPool, 2, (learners) => {
    if (bounded) return;
    forEachCombination(guidePool, 2, (guides) => {
      if (!bounded) push([...learners, ...guides]);
    });
  });
  return { groups, evaluatedCount, bounded };
};

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
  const eligibleCandidates = players.filter((player) => player.status === "WAITING" && player.queueEnteredAt && restReadyAt(player.lastMatchEndedAt, minimumRestMinutes, now) <= now);
  const eligibleIds = new Set(eligibleCandidates.map((player) => player.id));
  const eligible = eligibleCandidates.filter((player) => !player.synergyTeamId || players.some((candidate) => candidate.synergyTeamId === player.synergyTeamId && candidate.id !== player.id && eligibleIds.has(candidate.id)));
  const ranked = undefeatedChallengePlayers(players);
  const rankedIds = new Set(ranked.map(({ player }) => player.id));
  const readyQualifiers = ranked.filter(({ player }) => eligible.some((candidate) => candidate.id === player.id));
  if (!readyQualifiers.length) return null;
  const supports = diversePool(eligible.filter((player) => !rankedIds.has(player.id)), Math.max(0, MAX_MATCHMAKING_POOL - ranked.length), new Set(), eligible);
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
  const supportGroups = combinationValues(supports, supportSize).filter((group) => qualifierSets.some((qualifierSet) => hasNewbieCompatiblePartition([...qualifierSet, ...group]) && hasSynergyCompatiblePartition([...qualifierSet, ...group])));
  if (!supportGroups.length) return null;
  const minimumSupportGames = supportGroups.reduce((minimum, group) => Math.min(minimum, ...group.map(gamesFor)), Number.POSITIVE_INFINITY);
  const fairSupportExists = supportGroups.some((group) => Math.max(...group.map(gamesFor)) <= minimumSupportGames + 1);
  let best: { key: (number[] | number | string)[]; suggestion: Suggestion } | null = null;

  for (const qualifierSet of qualifierSets) {
    const pairKey = challengePairKey(qualifierSet);
    const pairWasExcluded = excludedPairs.has(pairKey);
    const pairHistory = qualifierSet.length > 1 ? Math.max(...qualifierSet.flatMap((player, index) => qualifierSet.slice(index + 1).map((other) => pairCount(history, player.id, other.id, true)))) : 0;
    for (const supportGroup of supportGroups) {
      const group = [...qualifierSet, ...supportGroup];
      if (!hasSynergyCompatiblePartition(group)) continue;
      const supportGames = supportGroup.map(gamesFor).sort((a, b) => a - b);
      if (fairSupportExists && Math.max(...supportGames) > minimumSupportGames + 1) continue;
      const supportPending = supportGroup.filter((player) => player.latePenaltyState === "PENDING").length;
      const supportPriority = [...supportGroup].map((player) => -(player.manualPriority ?? 0)).sort((a, b) => a - b);
      const supportQueueAge = Math.max(...supportGroup.map((player) => new Date(player.queueEnteredAt!).getTime()));
      const recentPairs = group.flatMap((player, index) => group.slice(index + 1).map((other) => sameSynergyTeam(player, other) ? 0 : pairCount(history, player.id, other.id, true)));
      const allPairs = group.flatMap((player, index) => group.slice(index + 1).map((other) => sameSynergyTeam(player, other) ? 0 : pairCount(history, player.id, other.id, false)));
      for (const [teamA, teamB] of partitions([...group].sort((a, b) => a.id.localeCompare(b.id)))) {
        if (teamA.some((player) => teamB.some((candidate) => sameSynergyTeam(player, candidate)))) continue;
        if (isProhibitedGeneratedGenderMatch(teamA, teamB) || isProhibitedGeneratedNewbieMatch(teamA, teamB)) continue;
        const teamAQualifiers = teamA.filter((player) => qualifierSet.some((candidate) => candidate.id === player.id));
        const teamBQualifiers = teamB.filter((player) => qualifierSet.some((candidate) => candidate.id === player.id));
        if (qualifierSet.length > 1 && (!teamAQualifiers.length || !teamBQualifiers.length)) continue;
        const teamATotal = teamA.reduce((sum, player) => sum + effectiveWeightFor(player), 0);
        const teamBTotal = teamB.reduce((sum, player) => sum + effectiveWeightFor(player), 0);
        const teamDifference = Math.abs(teamATotal - teamBTotal);
        const qualifierTeam = teamAQualifiers.length ? teamA : teamB;
        const opponentTeam = teamAQualifiers.length ? teamB : teamA;
        const challengeAdvantage = opponentTeam.reduce((sum, player) => sum + effectiveWeightFor(player), 0) - qualifierTeam.reduce((sum, player) => sum + effectiveWeightFor(player), 0);
        if (qualifierSet.length === 1 && challengeAdvantage <= 0) continue;
        const qualifierPartner = qualifierSet.length === 1 ? qualifierTeam.find((player) => !qualifierSet.some((candidate) => candidate.id === player.id)) : undefined;
        const pairRotation = qualifierSet.length > 1 && !pairWasExcluded ? 0 : 1;
        const key: (number[] | number | string)[] = [pairRotation, pairHistory, supportPriority, supportGames, supportPending, supportQueueAge, isQualifiedLoneFemaleGroup(group) ? 0 : 1, recentPairs.filter(Boolean).length, recentPairs.reduce((sum, value) => sum + value, 0), allPairs.filter(Boolean).length, allPairs.reduce((sum, value) => sum + value, 0), qualifierSet.length === 1 ? -challengeAdvantage : teamDifference, qualifierPartner ? effectiveWeightFor(qualifierPartner) : 0, teamA.map((player) => player.id).sort().join(","), teamB.map((player) => player.id).sort().join(",")];
        const keyString = challengeGroupKey(teamA, teamB);
        if (excluded.has(keyString)) continue;
        const suggestion: Suggestion = { mode: "UNDEFEATED_CHALLENGE", teamA, teamB, teamATotal, teamBTotal, difference: teamDifference, key: keyString, explanation: { algorithmVersion: MATCHMAKING_ALGORITHM, mode: "UNDEFEATED_CHALLENGE", searchStats: { eligibleCount: eligible.length, evaluatedCount: ranked.length + supports.length, bounded: supports.length < eligible.filter((player) => !rankedIds.has(player.id)).length }, loneFemalePolicy: loneFemalePolicy(teamA, teamB), rest: { minimumRestMinutes, eligibleAt: new Date(now).toISOString() }, challenge: { minimumMatches: 4, rankLimit: 3, qualifyingPlayers: ranked.map(({ player, rank }) => ({ id: player.id, displayName: player.displayName, rank, gamesPlayed: gamesFor(player), wins: winsFor(player), losses: lossesFor(player) })), selectedPlayerIds: qualifierSet.map((player) => player.id), opposingPlayerIds: qualifierSet.length > 1 ? qualifierSet.map((player) => player.id) : [], pairKey, rotatedPair: pairRotation === 1, fallbackIncludedThird: useFallback, difficultyPolicy: qualifierSet.length === 1 ? "WEAKER_TEAM_FAIR_QUEUE" : "QUALIFIED_PLAYERS_OPPOSED" }, teamSkillTotals: { teamA: teamATotal, teamB: teamBTotal, difference: teamDifference }, repeatPenalties: { recentPairCount: recentPairs.filter(Boolean).length, recentPairTotal: recentPairs.reduce((sum, value) => sum + value, 0), allTimePairCount: allPairs.filter(Boolean).length, allTimePairTotal: allPairs.reduce((sum, value) => sum + value, 0) }, fairness: { supportMinimumGames: minimumSupportGames, supportPending } } };
        if (!best || compare(key, best.key) < 0) best = { key, suggestion };
      }
    }
  }
  if (best) best.suggestion.matchupAdvisory = lowSkillLoneFemaleAdvisory(best.suggestion.teamA, best.suggestion.teamB);
  return best?.suggestion ?? null;
}

export function suggestMatch(players: MatchPlayer[], mode: MatchmakingMode, history: MatchHistory, excludedKeys: string[] = [], options: MatchmakingOptions = {}): Suggestion | null {
  const preparedPlayers = applySynergyTeams(players, options.synergyTeams);
  if (mode === "UNDEFEATED_CHALLENGE") return suggestUndefeatedChallenge(preparedPlayers, history, excludedKeys, options);
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const minimumRestMinutes = Math.max(0, options.minimumRestMinutes ?? 0);
  const strengthGap = mode === "BALANCED" ? options.strengthGap ?? DEFAULT_BALANCED_STRENGTH_GAP : undefined;
  const guidedContext = mode === "GUIDED" ? buildGuidedSearchContext(preparedPlayers, options) : null;
  const eligibleCandidates = mode === "GUIDED"
    ? [...(guidedContext?.readyLearners ?? []), ...(guidedContext?.readyGuides ?? [])]
    : preparedPlayers.filter((player) => player.status === "WAITING" && player.queueEnteredAt && restReadyAt(player.lastMatchEndedAt, minimumRestMinutes, now) <= now);
  const eligibleIds = new Set(eligibleCandidates.map((player) => player.id));
  const eligible = eligibleCandidates.filter((player) => !player.synergyTeamId || preparedPlayers.some((candidate) => candidate.synergyTeamId === player.synergyTeamId && candidate.id !== player.id && eligibleIds.has(candidate.id)));
  if (eligible.length < 4) return null;
  const excluded = new Set(excludedKeys);
  const previousSuggestionPlayerIds = new Set(
    excludedKeys.length > 0 && !eligible.some((player) => player.latePenaltyState === "PENDING")
      ? excludedKeys[excludedKeys.length - 1]!.split(/[|,]/).filter(Boolean)
      : [],
  );
  const previouslySkippedPlayerIds = new Set(previousSuggestionPlayerIds.size > 0 ? eligible.filter((player) => !previousSuggestionPlayerIds.has(player.id)).map((player) => player.id) : []);
  const searchPools = boundedEligiblePools(eligible, mode, previouslySkippedPlayerIds);
  const searchPlayers = searchPools.flat();
  const boundedSearch = eligible.length > MAX_MATCHMAKING_POOL;
  const validGroup = (group: MatchPlayer[]) => { const genders = new Set(group.map((player) => player.gender)); if (!hasSynergyCompatiblePartition(group)) return false; if (mode === "GUIDED" && (group.filter((player) => guidedPlayerRole(player) === "LEARNER").length !== 2 || group.filter((player) => guidedPlayerRole(player) === "GUIDE").length !== 2)) return false; if (mode === "SAME_GENDER" && genders.size !== 1) return false; if (mode === "MIXED_DOUBLES" && !isMixedDoublesGroup(group)) return false; if (mode === "SAME_SKILL" && new Set(group.map((player) => effectiveWeightFor(player))).size !== 1) return false; if (mode !== "GUIDED" && group.some((player) => player.skillLevel === "NEWBIE") && !hasNewbieCompatiblePartition(group)) return false; return mode !== "BALANCED" || Math.max(...group.map((player) => effectiveWeightFor(player))) - Math.min(...group.map((player) => effectiveWeightFor(player))) <= strengthGap!; };
  const candidateGroups: MatchPlayer[][] = [];
  let candidateMinimumGames = Number.POSITIVE_INFINITY;
  let evaluatedGroups = 0;
  let boundedGroups = false;
  if (mode === "GUIDED" && guidedContext) {
    const guidedCandidates = guidedCandidateGroups(guidedContext, previouslySkippedPlayerIds, boundedSearch, options.synergyTeams);
    candidateGroups.push(...guidedCandidates.groups);
    evaluatedGroups = guidedCandidates.evaluatedCount;
    boundedGroups = guidedCandidates.bounded;
    for (const group of candidateGroups) candidateMinimumGames = Math.min(candidateMinimumGames, ...group.map((player) => player.gamesPlayed));
  } else {
    for (const pool of searchPools) {
      let enumeratedGroups = 0;
      forEachCombination(pool, 4, (group) => {
        if (boundedSearch && enumeratedGroups >= MAX_BOUNDED_GROUPS) return;
        enumeratedGroups += 1;
        evaluatedGroups += 1;
        if (!validGroup(group)) return;
        candidateGroups.push(group);
        candidateMinimumGames = Math.min(candidateMinimumGames, ...group.map((player) => player.gamesPlayed));
      });
      boundedGroups = boundedGroups || (boundedSearch && enumeratedGroups >= MAX_BOUNDED_GROUPS);
    }
  }
  if (!candidateGroups.length || !Number.isFinite(candidateMinimumGames)) return null;
  const fairGroups = candidateGroups.filter((group) => Math.max(...group.map((player) => player.gamesPlayed)) <= candidateMinimumGames + 1);
  const fairExists = fairGroups.length > 0;
  const hasManualOverride = fairGroups.some((group) => group.some((player) => (player.manualPriority ?? 0) > 0));
  const minimumPending = fairGroups.reduce((minimum, group) => Math.min(minimum, group.filter((player) => player.latePenaltyState === "PENDING").length), Number.POSITIVE_INFINITY);
  let best: { key: (number[] | number | string)[]; suggestion: Suggestion } | null = null;
  for (const group of candidateGroups) {
    if (!hasManualOverride && fairExists && Math.max(...group.map((player) => player.gamesPlayed)) > candidateMinimumGames + 1) continue;
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const skillSpread = Math.max(...group.map((player) => effectiveWeightFor(player))) - Math.min(...group.map((player) => effectiveWeightFor(player)));
    const recentPairValues = group.flatMap((player, i) => group.slice(i + 1).map((other) => sameSynergyTeam(player, other) ? 0 : pairCount(history, player.id, other.id, true)));
    const allPairValues = group.flatMap((player, i) => group.slice(i + 1).map((other) => sameSynergyTeam(player, other) ? 0 : pairCount(history, player.id, other.id, false)));
    const recentQuartetRepeats = history.recentQuartets?.get(quartetKey(group)) ?? 0;
    const allQuartetRepeats = history.quartets.get(quartetKey(group)) ?? 0;
    for (const [teamA, teamB] of partitions(sorted)) {
      const qualifiedLoneFemale = isQualifiedLoneFemaleGroup(group);
      const standardMixedDoubles = isStandardMixedDoublesLineup(teamA, teamB);
      if (mode === "MIXED_DOUBLES" && !standardMixedDoubles) continue;
      if (teamA.some((player) => teamB.some((candidate) => sameSynergyTeam(player, candidate)))) continue;
      if (isProhibitedGeneratedGenderMatch(teamA, teamB) || (mode === "GUIDED" ? validateGuidedLineup(teamA, teamB) : isProhibitedGeneratedNewbieMatch(teamA, teamB))) continue;
      const teamATotal = teamA.reduce((sum, player) => sum + effectiveWeightFor(player), 0);
      const teamBTotal = teamB.reduce((sum, player) => sum + effectiveWeightFor(player), 0);
      if (mode === "BALANCED" && Math.abs(teamATotal - teamBTotal) !== strengthGap!) continue;
      const keyString = `${teamA.map((player) => player.id).sort().join(",")}|${teamB.map((player) => player.id).sort().join(",")}`;
      if (excluded.has(keyString)) continue;
      const recentPartners = (sameSynergyTeam(teamA[0]!, teamA[1]!) ? 0 : partnerCount(history, teamA[0]!.id, teamA[1]!.id, true)) + (sameSynergyTeam(teamB[0]!, teamB[1]!) ? 0 : partnerCount(history, teamB[0]!.id, teamB[1]!.id, true));
      const allPartners = (sameSynergyTeam(teamA[0]!, teamA[1]!) ? 0 : partnerCount(history, teamA[0]!.id, teamA[1]!.id, false)) + (sameSynergyTeam(teamB[0]!, teamB[1]!) ? 0 : partnerCount(history, teamB[0]!.id, teamB[1]!.id, false));
      const partnerMix = (sameSynergyTeam(teamA[0]!, teamA[1]!) ? 0 : Math.abs(effectiveWeightFor(teamA[0]!) - effectiveWeightFor(teamA[1]!))) + (sameSynergyTeam(teamB[0]!, teamB[1]!) ? 0 : Math.abs(effectiveWeightFor(teamB[0]!) - effectiveWeightFor(teamB[1]!)));
      const lowestGames = group.filter((player) => player.gamesPlayed === candidateMinimumGames).length;
      const previouslySkippedCount = group.filter((player) => previouslySkippedPlayerIds.has(player.id)).length;
      const pendingCount = group.filter((player) => player.latePenaltyState === "PENDING").length;
      const mixedShapePriority = mode === "MIXED_DOUBLES" ? (standardMixedDoubles ? 0 : 1) : 0;
      const loneFemalePriority = mode === "MIXED_DOUBLES" ? 1 : qualifiedLoneFemale ? 0 : 1;
      const key: (number[] | number | string)[] = mode === "BALANCED"
        ? [[...group].map((player) => -(player.manualPriority ?? 0)).sort((a, b) => a - b), -lowestGames, Math.max(...group.map((player) => player.gamesPlayed)) - candidateMinimumGames, pendingCount, mixedShapePriority, loneFemalePriority, -previouslySkippedCount, group.map((player) => player.gamesPlayed).sort((a, b) => a - b), sorted.map((player) => player.queueEnteredAt ? new Date(player.queueEnteredAt).getTime() : Number.MAX_SAFE_INTEGER).sort((a, b) => a - b), Math.abs(teamATotal - teamBTotal), recentPairValues.filter(Boolean).length, recentPairValues.reduce((sum, value) => sum + value, 0), recentQuartetRepeats, allPairValues.filter(Boolean).length, allPairValues.reduce((sum, value) => sum + value, 0), allQuartetRepeats, recentPartners, allPartners, -partnerMix, sorted.map((player) => player.id).join(","), keyString]
        : [[...group].map((player) => -(player.manualPriority ?? 0)).sort((a, b) => a - b), -lowestGames, Math.max(...group.map((player) => player.gamesPlayed)) - candidateMinimumGames, pendingCount, mixedShapePriority, loneFemalePriority, recentPairValues.filter(Boolean).length, recentPairValues.reduce((sum, value) => sum + value, 0), recentQuartetRepeats, allPairValues.filter(Boolean).length, allPairValues.reduce((sum, value) => sum + value, 0), allQuartetRepeats, -previouslySkippedCount, mode === "SAME_SKILL" ? skillSpread : 0, group.map((player) => player.gamesPlayed).sort((a, b) => a - b), sorted.map((player) => player.queueEnteredAt ? new Date(player.queueEnteredAt).getTime() : Number.MAX_SAFE_INTEGER).sort((a, b) => a - b), recentPartners, allPartners, 0, Math.abs(teamATotal - teamBTotal), sorted.map((player) => player.id).join(","), keyString];
      const suggestion = {
        mode,
        teamA,
        teamB,
        teamATotal,
        teamBTotal,
        difference: Math.abs(teamATotal - teamBTotal),
        key: keyString,
        matchupAdvisory: lowSkillLoneFemaleAdvisory(teamA, teamB),
        explanation: {
          algorithmVersion: MATCHMAKING_ALGORITHM,
          mode,
          searchStats: { eligibleCount: eligible.length, evaluatedCount: evaluatedGroups, bounded: boundedGroups || searchPlayers.length < eligible.length },
          loneFemalePolicy: loneFemalePolicy(teamA, teamB),
          strengthGap: strengthGap ?? null,
          rest: { minimumRestMinutes, eligibleAt: new Date(now).toISOString() },
          teamSkillTotals: { teamA: teamATotal, teamB: teamBTotal, difference: Math.abs(teamATotal - teamBTotal) },
          synergy: { teamIds: [...new Set(group.flatMap((player) => player.synergyTeamId ? [player.synergyTeamId] : []))], effectiveSkillWeights: group.filter((player) => player.synergyTeamId).map((player) => ({ id: player.id, weight: effectiveWeightFor(player) })) },
          skillDiversity: { groupSpread: skillSpread, partnerMix },
          ...(mode === "GUIDED" ? { guided: buildGuidedExplanation(group) } : {}),
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
  }
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
