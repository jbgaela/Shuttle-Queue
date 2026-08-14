import type { CloudSnapshotV2 } from "./domain-compat";

export type SyncRecordCounts = {
  players: number;
  queuePlayers: number;
  courts: number;
  matches: number;
  payments: number;
  feeConfig: number;
};

export type SyncRemovalCounts = SyncRecordCounts & { playerNames: string[] };

export type SyncPreview = {
  cloudRevision: number;
  cloudChanged: boolean;
  local: SyncRecordCounts;
  cloud: SyncRecordCounts;
  removed: SyncRemovalCounts;
};

const idsMissingFrom = <T extends { id: string }>(cloud: T[], local: T[]) => {
  const localIds = new Set(local.map((item) => item.id));
  return cloud.filter((item) => !localIds.has(item.id));
};

export function snapshotCounts(snapshot: CloudSnapshotV2): SyncRecordCounts {
  return {
    players: snapshot.players.length,
    queuePlayers: snapshot.queuePlayers.length,
    courts: snapshot.courts.length,
    matches: snapshot.matches.length,
    payments: snapshot.payments.length,
    feeConfig: snapshot.feeConfig ? 1 : 0,
  };
}

export function createSyncPreview(local: CloudSnapshotV2, cloud: CloudSnapshotV2, cloudRevision: number, cloudChanged: boolean): SyncPreview {
  const removedPlayers = idsMissingFrom(cloud.players, local.players);
  const removedQueuePlayers = idsMissingFrom(cloud.queuePlayers, local.queuePlayers);
  const removedCourts = idsMissingFrom(cloud.courts, local.courts);
  const removedMatches = idsMissingFrom(cloud.matches, local.matches);
  const removedPayments = idsMissingFrom(cloud.payments, local.payments);
  return {
    cloudRevision,
    cloudChanged,
    local: snapshotCounts(local),
    cloud: snapshotCounts(cloud),
    removed: {
      players: removedPlayers.length,
      queuePlayers: removedQueuePlayers.length,
      courts: removedCourts.length,
      matches: removedMatches.length,
      payments: removedPayments.length,
      feeConfig: cloud.feeConfig && !local.feeConfig ? 1 : 0,
      playerNames: removedPlayers.map((player) => player.displayName),
    },
  };
}

export function hasDestructiveSyncChanges(preview: SyncPreview) {
  return preview.removed.players > 0 || preview.removed.queuePlayers > 0 || preview.removed.courts > 0 || preview.removed.matches > 0 || preview.removed.payments > 0 || preview.removed.feeConfig > 0;
}
