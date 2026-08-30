import type { DomainFeeConfig, DomainQueuePlayer } from "./index.js";

export function allocateFinalFeeAmounts(
  config: Pick<DomainFeeConfig, "mode" | "fixedAmountPerPlayerMinor" | "expectedQueueCostMinor" | "noShowPenaltyMinor">,
  players: ReadonlyArray<Pick<DomainQueuePlayer, "id" | "matchesPlayed">>,
) {
  const ordered = [...players].sort((left, right) => left.id.localeCompare(right.id));
  const penalty = Math.max(0, config.noShowPenaltyMinor ?? 0);
  const noShows = ordered.filter((player) => player.matchesPlayed === 0);
  const played = ordered.filter((player) => player.matchesPlayed > 0);
  const allocations = new Map<string, number>(noShows.map((player) => [player.id, penalty]));
  if (config.mode === "EQUAL_SPLIT") {
    const remaining = Math.max(0, (config.expectedQueueCostMinor ?? 0) - penalty * noShows.length);
    const base = played.length ? Math.floor(remaining / played.length) : 0;
    const remainder = played.length ? remaining % played.length : 0;
    played.forEach((player, index) => allocations.set(player.id, base + (index < remainder ? 1 : 0)));
  } else {
    const fixed = Math.max(0, config.fixedAmountPerPlayerMinor ?? 0);
    for (const player of played) allocations.set(player.id, fixed);
  }
  return allocations;
}

