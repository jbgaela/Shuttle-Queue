import type { QueuePlayer, QueueState } from "./api";

type WaitingQueue = Pick<QueueState, "waiting" | "lateArrivalCutoffAt" | "serverTime" | "synergyTeams" | "minimumRestMinutes"> & { resting?: QueueState["resting"] };

/** Return the rest state that can affect matchmaking without including clock drift. */
export function queuePlayerReadiness(player: Pick<QueuePlayer, "restEligibleAt" | "lastMatchEndedAt">, serverTime: string, minimumRestMinutes = 0) {
  // A queue with no required rest never has a clock-dependent resting state.
  if (minimumRestMinutes <= 0 || !player.lastMatchEndedAt) return "READY";

  const lastMatchEndedAt = Date.parse(player.lastMatchEndedAt);
  const now = Date.parse(serverTime);
  if (!Number.isFinite(lastMatchEndedAt) || !Number.isFinite(now)) return "READY";
  const deadline = lastMatchEndedAt + minimumRestMinutes * 60_000;
  if (deadline <= now) return "READY";
  return `RESTING:${new Date(deadline).toISOString()}`;
}

export function isQueuePlayerReady(player: Pick<QueuePlayer, "restEligibleAt" | "lastMatchEndedAt">, serverTime: string, minimumRestMinutes = 0) {
  return queuePlayerReadiness(player, serverTime, minimumRestMinutes) === "READY";
}

/** Build a deterministic scope from matchmaking inputs, ignoring polling timestamps for ready players. */
export function matchmakingWaitingFingerprint(queue: WaitingQueue) {
  const minimumRestMinutes = queue.minimumRestMinutes ?? 0;
  const players = [...queue.waiting, ...(queue.resting ?? [])]
    .map((player) => [
      player.id,
      player.status,
      player.gender,
      player.skillLevel,
      player.effectiveSkillLevel ?? null,
      player.effectiveSkillWeight ?? null,
      player.matchesPlayed,
      player.wins,
      player.losses,
      player.pointsFor ?? 0,
      player.pointsAgainst ?? 0,
      player.manualPriority ?? 0,
      player.queueEnteredAt ?? null,
      player.lastMatchEndedAt ?? null,
      player.latePenaltyState ?? null,
      player.latePenaltyAppliedAt ?? null,
      queuePlayerReadiness(player, queue.serverTime, minimumRestMinutes),
    ])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

  const teams = (queue.synergyTeams ?? []).map((team) => [team.id, ...team.queuePlayerIds, team.version, team.effectiveSkillWeight]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return JSON.stringify([queue.lateArrivalCutoffAt ?? null, minimumRestMinutes, players, teams]);
}
