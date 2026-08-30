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
  return left.player.localeCompare(right.player, undefined, { sensitivity: "base" }) || left.player.localeCompare(right.player);
}

function compareRankingOrder<T extends RankingPresentationRow>(left: T, right: T) {
  if (typeof left.rank === "number" && typeof right.rank === "number") return left.rank - right.rank;
  if (typeof left.rank === "number") return -1;
  if (typeof right.rank === "number") return 1;
  return 0;
}

/** Split ranking rows into the numbered leaderboard and unranked roster sections. */
export function partitionRankingRows<T extends RankingPresentationRow>(rows: T[]): RankingPresentationGroups<T> {
  const ranked = rows.filter((row) => row.matchesPlayed > 0).slice().sort(compareRankingOrder).map((row, index) => ({ ...row, rank: index + 1 }));
  const didNotPlay = rows.filter((row) => row.matchesPlayed === 0).slice().sort(comparePlayerNames).map((row) => ({ ...row, rank: null }));
  return { ranked, didNotPlay };
}

/** Build the public live leaderboard from the server-provided ranking order. */
export function partitionPublicRankingRows<T extends PublicRankingPresentationRow>(rows: T[]) {
  const played = rows.filter((row) => row.matchesPlayed > 0).slice().sort(compareRankingOrder);
  const ranked = played.map((row, index) => ({ ...row, rank: index + 1 }));
  const didNotPlay = rows.filter((row) => row.matchesPlayed === 0).slice().sort(comparePlayerNames).map((row) => ({ ...row, rank: null }));
  return { ranked, didNotPlay };
}
