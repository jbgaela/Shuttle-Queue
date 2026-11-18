export const PRIZE_RANKING_MIN_MATCHES = 5;
export const PRIZE_RANKING_PRIZE_PLACES = 3;
export const PRIZE_RANKING_RESERVED_PLACES = 10;
export const PRIZE_RANKING_VERSION = "wilson95-v4";
const WILSON_Z = 1.96;
export type PrizeRankingInput = {
  id: string;
  displayName: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};
export type PrizeRankingRow<T extends PrizeRankingInput = PrizeRankingInput> = T & {
  rank: number | null;
  eligible: boolean;
  gamesNeeded: number;
  rankingScoreBasisPoints: number | null;
  pointPercentageBasisPoints: number | null;
  isPrizePosition: boolean;
  seededDrawUsed: boolean;
};
export type PrizeRankingMethod = {
  version: typeof PRIZE_RANKING_VERSION;
  minimumMatches: number;
  prizePlaces: number;
  score: "WILSON_LOWER_BOUND_95";
  tiebreaks: readonly ["RAW_WIN_RATE", "POINT_DIFFERENTIAL", "POINT_PERCENTAGE", "MATCHES_PLAYED"];
};
export const PRIZE_RANKING_METHOD: PrizeRankingMethod = {
  version: PRIZE_RANKING_VERSION,
  minimumMatches: PRIZE_RANKING_MIN_MATCHES,
  prizePlaces: PRIZE_RANKING_PRIZE_PLACES,
  score: "WILSON_LOWER_BOUND_95",
  tiebreaks: ["RAW_WIN_RATE", "POINT_DIFFERENTIAL", "POINT_PERCENTAGE", "MATCHES_PLAYED"],
};
const safeInteger = (value: number) =>
  Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : 0;
export function wilsonLowerBound(wins: number, matchesPlayed: number) {
  const n = safeInteger(matchesPlayed);
  if (!n) return 0;
  const w = Math.min(n, safeInteger(wins));
  const p = w / n;
  const z2 = WILSON_Z * WILSON_Z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const spread = WILSON_Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (center - spread) / denominator);
}
const basisPoints = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 10000);
const pointPercentage = (player: PrizeRankingInput) => {
  const total = safeInteger(player.pointsFor) + safeInteger(player.pointsAgainst);
  return total > 0 ? safeInteger(player.pointsFor) / total : 0;
};
function performanceCompare(left: PrizeRankingInput, right: PrizeRankingInput) {
  const scoreDifference =
    wilsonLowerBound(right.wins, right.matchesPlayed) -
    wilsonLowerBound(left.wins, left.matchesPlayed);
  if (scoreDifference) return scoreDifference;
  const rawRateDifference =
    safeInteger(right.wins) * safeInteger(left.matchesPlayed) -
    safeInteger(left.wins) * safeInteger(right.matchesPlayed);
  if (rawRateDifference) return rawRateDifference;
  const leftPointDifferential = safeInteger(left.pointsFor) - safeInteger(left.pointsAgainst);
  const rightPointDifferential = safeInteger(right.pointsFor) - safeInteger(right.pointsAgainst);
  const pointDifferentialDifference = rightPointDifferential - leftPointDifferential;
  if (pointDifferentialDifference) return pointDifferentialDifference;
  const leftPoints = safeInteger(left.pointsFor) + safeInteger(left.pointsAgainst);
  const rightPoints = safeInteger(right.pointsFor) + safeInteger(right.pointsAgainst);
  const pointDifference =
    safeInteger(right.pointsFor) * leftPoints - safeInteger(left.pointsFor) * rightPoints;
  if (pointDifference) return pointDifference;
  return safeInteger(right.matchesPlayed) - safeInteger(left.matchesPlayed);
}
function sortByPerformance<T extends PrizeRankingInput>(players: T[]) {
  return players
    .slice()
    .sort((left, right) => performanceCompare(left, right) || left.id.localeCompare(right.id));
}
function rankPlayers<T extends PrizeRankingInput>(players: T[], firstRank: number) {
  let rank = firstRank - 1;
  let previous: PrizeRankingInput | undefined;
  return players.map((player) => {
    if (!previous || performanceCompare(previous, player) !== 0) rank += 1;
    previous = player;
    return { player, rank };
  });
}
export function prizeRankingRows<T extends PrizeRankingInput>(
  players: T[],
  _sessionStartedAt: string,
): Array<PrizeRankingRow<T>> {
  const played = players.filter((player) => safeInteger(player.matchesPlayed) > 0);
  const eligiblePlayers = sortByPerformance(
    played.filter((player) => safeInteger(player.matchesPlayed) >= PRIZE_RANKING_MIN_MATCHES),
  );
  const provisionalPlayers = sortByPerformance(
    played.filter((player) => safeInteger(player.matchesPlayed) < PRIZE_RANKING_MIN_MATCHES),
  );
  const rankedEligible = rankPlayers(eligiblePlayers, 1);
  const lastEligibleRank = rankedEligible.length
    ? rankedEligible[rankedEligible.length - 1]!.rank
    : 0;
  const provisionalRankStart = Math.max(PRIZE_RANKING_RESERVED_PLACES, lastEligibleRank) + 1;
  const rankedProvisional = rankPlayers(provisionalPlayers, provisionalRankStart);
  const rankingFields = (player: T, rank: number, eligible: boolean) => ({
    ...player,
    rank,
    eligible,
    gamesNeeded: Math.max(0, PRIZE_RANKING_MIN_MATCHES - safeInteger(player.matchesPlayed)),
    rankingScoreBasisPoints: basisPoints(wilsonLowerBound(player.wins, player.matchesPlayed)),
    pointPercentageBasisPoints: basisPoints(pointPercentage(player)),
    isPrizePosition: eligible && rank <= PRIZE_RANKING_PRIZE_PLACES,
    seededDrawUsed: false,
  });
  const ranked = [
    ...rankedEligible.map(({ player, rank }) => rankingFields(player, rank, true)),
    ...rankedProvisional.map(({ player, rank }) => rankingFields(player, rank, false)),
  ];
  const didNotPlay = players
    .filter((player) => safeInteger(player.matchesPlayed) === 0)
    .slice()
    .sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    )
    .map((player) => ({
      ...player,
      rank: null,
      eligible: false,
      gamesNeeded: PRIZE_RANKING_MIN_MATCHES,
      rankingScoreBasisPoints: null,
      pointPercentageBasisPoints: null,
      isPrizePosition: false,
      seededDrawUsed: false,
    }));
  return [...ranked, ...didNotPlay];
}
