type PlayerNameRecord = {
  id: string;
  displayName: string;
};

type QueuePlayerNameRecord = {
  playerId?: string | null;
  displayName: string;
};

export function normalizePlayerName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export function hasPlayerNameConflict(
  players: readonly PlayerNameRecord[],
  queuePlayers: readonly QueuePlayerNameRecord[],
  displayName: string,
  excludedPlayerId?: string,
) {
  const normalizedName = normalizePlayerName(displayName);
  return players.some((player) => player.id !== excludedPlayerId && normalizePlayerName(player.displayName) === normalizedName)
    || queuePlayers.some((player) => player.playerId !== excludedPlayerId && normalizePlayerName(player.displayName) === normalizedName);
}
