import type { QueuePlayer, QueueState } from "./api";

type WaitingQueue = Pick<QueueState, "waiting" | "lateArrivalCutoffAt" | "serverTime" | "synergyTeams">;

/** Return the rest state that can affect matchmaking without including clock drift. */
export function queuePlayerReadiness(player: Pick<QueuePlayer, "restEligibleAt">, serverTime: string) {
  if (!player.restEligibleAt) return "READY";

  const eligibleAt = Date.parse(player.restEligibleAt);
  const now = Date.parse(serverTime);
  if (!Number.isFinite(eligibleAt) || !Number.isFinite(now) || eligibleAt <= now) return "READY";
  return `RESTING:${player.restEligibleAt}`;
}

export function isQueuePlayerReady(player: Pick<QueuePlayer, "restEligibleAt">, serverTime: string) {
  return queuePlayerReadiness(player, serverTime) === "READY";
}

/** Build a deterministic scope from matchmaking inputs, ignoring polling timestamps for ready players. */
export function matchmakingWaitingFingerprint(queue: WaitingQueue) {
  const players = queue.waiting
    .map((player) => [
      player.id,
      player.status,
      player.gender,
      player.skillLevel,
      player.matchesPlayed,
      player.wins,
      player.losses,
      player.manualPriority ?? 0,
      player.queueEnteredAt ?? null,
      player.lastMatchEndedAt ?? null,
      player.latePenaltyState ?? null,
      player.latePenaltyAppliedAt ?? null,
      queuePlayerReadiness(player, queue.serverTime),
    ])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

  const teams = (queue.synergyTeams ?? []).map((team) => [team.id, ...team.queuePlayerIds, team.version, team.effectiveSkillWeight]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return JSON.stringify([queue.lateArrivalCutoffAt ?? null, players, teams]);
}
