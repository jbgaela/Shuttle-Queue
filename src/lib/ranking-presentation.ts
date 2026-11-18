import { PRIZE_RANKING_MIN_MATCHES, PRIZE_RANKING_RESERVED_PLACES } from "@shuttle-queue/domain";

export type RankingPresentationRow = {
  rank: number | null;
  player: string;
  matchesPlayed: number;
  eligible?: boolean;
  gamesNeeded?: number;
};

export type PublicRankingPresentationRow = RankingPresentationRow & {
  playerKey?: string;
  wins: number;
};

export type RankingPresentationGroups<T extends RankingPresentationRow> = {
  ranked: Array<T & { rank: number }>;
  didNotPlay: T[];
};

function comparePlayerNames<T extends RankingPresentationRow>(left: T, right: T) {
  return (
    left.player.localeCompare(right.player, undefined, { sensitivity: "base" }) ||
    left.player.localeCompare(right.player)
  );
}

function compareRankingOrder<T extends RankingPresentationRow>(left: T, right: T) {
  if (typeof left.rank === "number" && typeof right.rank === "number")
    return left.rank - right.rank;
  if (typeof left.rank === "number") return -1;
  if (typeof right.rank === "number") return 1;
  return 0;
}

function isPrizeEligible<T extends RankingPresentationRow>(row: T) {
  return row.matchesPlayed >= PRIZE_RANKING_MIN_MATCHES && row.eligible !== false;
}

function denseRankRows<T extends RankingPresentationRow>(rows: T[], firstRank: number) {
  let rank = firstRank - 1;
  let previousSourceRank: number | null | undefined;
  return rows.map((row, index) => {
    const sourceRank = typeof row.rank === "number" ? row.rank : null;
    if (
      index === 0 ||
      sourceRank === null ||
      previousSourceRank === null ||
      sourceRank !== previousSourceRank
    )
      rank += 1;
    previousSourceRank = sourceRank;
    return { ...row, rank };
  });
}

function rankedRows<T extends RankingPresentationRow>(rows: T[]) {
  const played = rows
    .filter((row) => row.matchesPlayed > 0)
    .slice()
    .sort(compareRankingOrder);
  const eligible = played.filter(isPrizeEligible);
  const provisional = played.filter((row) => !isPrizeEligible(row));
  const rankedEligible = denseRankRows(eligible, 1);
  const lastEligibleRank = rankedEligible.length
    ? rankedEligible[rankedEligible.length - 1]!.rank
    : 0;
  const provisionalRankStart = Math.max(PRIZE_RANKING_RESERVED_PLACES, lastEligibleRank) + 1;
  const rankedProvisional = denseRankRows(provisional, provisionalRankStart);
  return [...rankedEligible, ...rankedProvisional];
}

/** Split ranking rows into the numbered leaderboard and unranked roster sections. */
export function partitionRankingRows<T extends RankingPresentationRow>(
  rows: T[],
): RankingPresentationGroups<T> {
  const ranked = rankedRows(rows);
  const didNotPlay = rows
    .filter((row) => row.matchesPlayed === 0)
    .slice()
    .sort(comparePlayerNames)
    .map((row) => ({ ...row, rank: null }));
  return { ranked, didNotPlay };
}

/** Build the public live leaderboard from the server-provided ranking order. */
export function partitionPublicRankingRows<T extends PublicRankingPresentationRow>(rows: T[]) {
  const ranked = rankedRows(rows);
  const didNotPlay = rows
    .filter((row) => row.matchesPlayed === 0)
    .slice()
    .sort(comparePlayerNames)
    .map((row) => ({ ...row, rank: null }));
  return { ranked, didNotPlay };
}
