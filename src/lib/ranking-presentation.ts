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
  notYetEligible: T[];
  didNotPlay: T[];
};

function comparePlayerNames<T extends RankingPresentationRow>(left: T, right: T) {
  return left.player.localeCompare(right.player, undefined, { sensitivity: "base" }) || left.player.localeCompare(right.player);
}

/** Split ranking rows into the numbered leaderboard and unranked roster sections. */
export function partitionRankingRows<T extends RankingPresentationRow>(rows: T[]): RankingPresentationGroups<T> {
  const ranked = rows.filter((row) => row.matchesPlayed >= 5 && row.eligible !== false).map((row, index) => ({ ...row, rank: index + 1 }));
  const notYetEligible = rows.filter((row) => row.matchesPlayed > 0 && (row.matchesPlayed < 5 || row.eligible === false));
  const didNotPlay = rows.filter((row) => row.matchesPlayed === 0).slice().sort(comparePlayerNames);
  return { ranked, notYetEligible, didNotPlay };
}

function comparePublicRankingRows<T extends PublicRankingPresentationRow>(left: T, right: T) {
  const winRateDifference = right.wins * left.matchesPlayed - left.wins * right.matchesPlayed;
  return winRateDifference
    || right.matchesPlayed - left.matchesPlayed
    || left.player.localeCompare(right.player, undefined, { sensitivity: "base" })
    || String(left.playerKey ?? "").localeCompare(String(right.playerKey ?? ""));
}

/** Build the public live leaderboard without applying the prize qualification gate. */
export function partitionPublicRankingRows<T extends PublicRankingPresentationRow>(rows: T[]) {
  const played = rows.filter((row) => row.matchesPlayed > 0).slice().sort(comparePublicRankingRows);
  const ranked = played.map((row, index) => ({ ...row, rank: index + 1 }));
  const didNotPlay = rows.filter((row) => row.matchesPlayed === 0).slice().sort(comparePlayerNames);
  return { ranked, didNotPlay };
}
