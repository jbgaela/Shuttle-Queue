import type { CloudSnapshotV2 } from "./domain-compat";

/**
 * Keeps queue-player snapshots compatible with the strict sync wire contract.
 * Older offline records may omit fields that are nullable or have database defaults.
 */
export function normalizeSnapshotForSync(snapshot: CloudSnapshotV2): CloudSnapshotV2 {
  return {
    ...snapshot,
    queuePlayers: snapshot.queuePlayers.map((player) => ({
      ...player,
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
