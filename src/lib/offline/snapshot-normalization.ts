import type { CloudSnapshotV2 } from "./domain-compat";

const skillWeights: Record<string, number> = { NEWBIE: 1, BEGINNER: 2, UPPER_BEGINNER: 3, INTERMEDIATE: 4, UPPER_INTERMEDIATE: 5, ADVANCED: 6 };

/**
 * Keeps queue-player snapshots compatible with the strict sync wire contract.
 * Older offline records may omit fields that are nullable or have database defaults.
 */
export function normalizeSnapshotForSync(snapshot: CloudSnapshotV2): CloudSnapshotV2 {
  return {
    ...snapshot,
    settings: snapshot.settings ? { ...snapshot.settings, lateArrivalGraceMinutes: snapshot.settings.lateArrivalGraceMinutes ?? 10 } : null,
    players: snapshot.players.map((player) => ({ ...player, skillWeight: skillWeights[player.skillLevel] ?? player.skillWeight })),
    queuePlayers: snapshot.queuePlayers.map((player) => ({
      ...player,
      skillWeight: skillWeights[player.skillLevel] ?? player.skillWeight,
      queueEnteredAt: player.queueEnteredAt === undefined ? null : player.queueEnteredAt,
      lastMatchEndedAt: player.lastMatchEndedAt === undefined ? null : player.lastMatchEndedAt,
      amountDueMinor: player.amountDueMinor === undefined ? 0 : player.amountDueMinor,
      manualPriority: player.manualPriority === undefined ? 0 : player.manualPriority,
      priorityReason: player.priorityReason === undefined ? null : player.priorityReason,
      latePenaltyState: player.latePenaltyState === undefined ? null : player.latePenaltyState,
      latePenaltyAppliedAt: player.latePenaltyAppliedAt === undefined ? null : player.latePenaltyAppliedAt,
      currentMatchId: player.currentMatchId === undefined ? null : player.currentMatchId,
      checkedInAt: player.checkedInAt === undefined ? null : player.checkedInAt,
      checkedOutAt: player.checkedOutAt === undefined ? null : player.checkedOutAt,
      restStartedAt: player.restStartedAt === undefined ? null : player.restStartedAt,
    })),
  };
}
