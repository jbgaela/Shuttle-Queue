import Dexie, { type Table } from "dexie";
import type { CloudSnapshotV2, SyncMetadata } from "./domain-compat";
import { reviewSyncSnapshots, seedSyncMetadata, stampSnapshotChanges } from "./domain-compat";
import type { SyncChoices, SyncConflict } from "./domain-compat";
import { normalizeSnapshotForSync } from "./snapshot-normalization";
import { operationIdForRevision } from "./sync-operation";

export type LocalSyncMeta = {
  accountId: string;
  deviceId: string;
  localRevision: number;
  lastUploadedRevision: number;
  baseCloudRevision: number;
  dirty: boolean;
  pendingOperationId?: string;
  pendingOperationRevision?: number;
  lastSyncAt?: string | null;
  lastError?: string | null;
  syncAttention?: "manual" | undefined;
  review?: { cloudRevision: number; localRevision: number; conflicts: SyncConflict[] } | undefined;
};

export type LocalProfile = { accountId: string; username: string; role: string; updatedAt: string };
export type LocalAuditEvent = {
  id: string;
  accountId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  createdAt: string;
};
type SnapshotRow = {
  accountId: string;
  snapshot: CloudSnapshotV2;
  baseline?: CloudSnapshotV2;
  pendingUpload?: SnapshotUploadBatch | undefined;
  metadata?: SyncMetadata;
  updatedAt: string;
  readinessProbe?: string;
};

export type SnapshotUploadBatch = {
  snapshot: CloudSnapshotV2;
  metadata: SyncMetadata;
  localRevision: number;
  operationId: string;
  auditEvents: LocalAuditEvent[];
  baseSnapshot?: CloudSnapshotV2;
  sentSnapshot?: CloudSnapshotV2;
  resolutions?: SyncChoices;
  reviewedCloudRevision?: number | undefined;
};

class OfflineDatabase extends Dexie {
  profiles!: Table<LocalProfile, string>;
  meta!: Table<LocalSyncMeta, string>;
  snapshots!: Table<SnapshotRow, string>;
  audits!: Table<LocalAuditEvent, string>;

  constructor() {
    super("shuttle-queue-offline");
    this.version(1).stores({
      profiles: "accountId,updatedAt",
      meta: "accountId,dirty,baseCloudRevision",
      snapshots: "accountId,updatedAt",
      audits: "id,accountId,createdAt",
    });
    this.version(2).stores({
      profiles: "accountId,updatedAt",
      meta: "accountId,dirty,baseCloudRevision",
      snapshots: "accountId,updatedAt",
      audits: "id,accountId,createdAt",
    });
    this.version(3).stores({
      profiles: "accountId,updatedAt",
      meta: "accountId,dirty,baseCloudRevision",
      snapshots: "accountId,updatedAt",
      audits: "id,accountId,createdAt",
    });
  }
}

export const offlineDb = new OfflineDatabase();

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function getDeviceId() {
  if (typeof window === "undefined") return "server";
  const key = "shuttle-queue-device-id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const value = randomId();
    window.localStorage.setItem(key, value);
    return value;
  } catch {
    return randomId();
  }
}

export async function getMeta(accountId: string) {
  return offlineDb.meta.get(accountId);
}

export async function hasSnapshot(accountId?: string) {
  if (typeof window === "undefined") return false;
  if (!accountId) return (await offlineDb.snapshots.count()) > 0;
  return Boolean(await offlineDb.snapshots.get(accountId));
}

export async function readSnapshot(accountId: string) {
  const snapshot = (await offlineDb.snapshots.get(accountId))?.snapshot;
  return snapshot ? normalizeSnapshotForSync(snapshot) : null;
}

export async function replaceSnapshot(
  accountId: string,
  snapshot: CloudSnapshotV2,
  cloudRevision: number,
  metadata?: SyncMetadata,
) {
  if (snapshot.schemaVersion !== 2 && snapshot.schemaVersion !== 3)
    throw new Error("This offline snapshot is incompatible. Download the current queue online.");
  const normalizedSnapshot = normalizeSnapshotForSync(snapshot);
  const now = new Date().toISOString();
  await offlineDb.transaction(
    "rw",
    offlineDb.snapshots,
    offlineDb.meta,
    offlineDb.audits,
    async () => {
      await offlineDb.snapshots.put({
        accountId,
        snapshot: normalizedSnapshot,
        baseline: normalizedSnapshot,
        metadata: metadata ?? seedSyncMetadata(normalizedSnapshot, getDeviceId(), now),
        updatedAt: now,
      });
      await offlineDb.meta.put({
        accountId,
        deviceId: getDeviceId(),
        localRevision: 0,
        lastUploadedRevision: cloudRevision,
        baseCloudRevision: cloudRevision,
        dirty: false,
        lastSyncAt: now,
        lastError: null,
      });
      await offlineDb.audits.where("accountId").equals(accountId).delete();
    },
  );
  notifyOfflineChange();
}

export async function saveProfile(profile: LocalProfile) {
  await offlineDb.profiles.put(profile);
  try {
    window.localStorage.setItem("shuttle-queue-current-account", profile.accountId);
  } catch {
    /* ignore storage access failures */
  }
}

export async function getProfile(accountId: string) {
  return offlineDb.profiles.get(accountId);
}

export async function firstProfile() {
  return (await offlineDb.profiles.toArray()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )[0];
}

export async function updateLocalSnapshot<T>(
  accountId: string,
  update: (snapshot: CloudSnapshotV2) => T | Promise<T>,
) {
  let result!: T;
  await offlineDb.transaction(
    "rw",
    offlineDb.snapshots,
    offlineDb.meta,
    offlineDb.audits,
    async () => {
      const row = await offlineDb.snapshots.get(accountId);
      if (!row) throw new Error("Download this account before working offline.");
      const prior = await offlineDb.meta.get(accountId);
      const snapshot = normalizeSnapshotForSync(
        typeof structuredClone === "function"
          ? structuredClone(row.snapshot)
          : (JSON.parse(JSON.stringify(row.snapshot)) as CloudSnapshotV2),
      );
      const metadata =
        row.metadata ?? seedSyncMetadata(snapshot, prior?.deviceId ?? getDeviceId(), row.updatedAt);
      result = await update(snapshot);
      const nextMetadata = stampSnapshotChanges(
        row.snapshot,
        snapshot,
        metadata,
        prior?.deviceId ?? getDeviceId(),
        new Date().toISOString(),
        (prior?.localRevision ?? 0) + 1,
      );
      const localRevision = (prior?.localRevision ?? 0) + 1;
      await offlineDb.snapshots.put({
        ...row,
        snapshot,
        metadata: nextMetadata,
        updatedAt: new Date().toISOString(),
      });
      await offlineDb.meta.put({
        ...prior,
        accountId,
        deviceId: prior?.deviceId ?? getDeviceId(),
        localRevision,
        lastUploadedRevision: prior?.lastUploadedRevision ?? 0,
        baseCloudRevision: prior?.baseCloudRevision ?? 0,
        dirty: true,
        pendingOperationId: randomId(),
        pendingOperationRevision: localRevision,
        lastError: null,
      });
    },
  );
  notifyOfflineChange();
  return result;
}

export async function prepareSnapshotUpload(
  accountId: string,
  resolutions?: SyncChoices,
): Promise<SnapshotUploadBatch> {
  return offlineDb.transaction(
    "rw",
    offlineDb.snapshots,
    offlineDb.meta,
    offlineDb.audits,
    async () => {
      const row = await offlineDb.snapshots.get(accountId);
      const current = await offlineDb.meta.get(accountId);
      if (!row || !current) throw new Error("Local data is missing.");
      if (resolutions && current.review?.localRevision !== current.localRevision)
        throw new Error(
          "Local work changed during review. Sync again to review the latest changes.",
        );
      if (row.pendingUpload && !resolutions) return row.pendingUpload;
      const operationId = operationIdForRevision(
        current.pendingOperationId,
        current.pendingOperationRevision,
        current.localRevision,
        randomId,
      );
      if (
        operationId !== current.pendingOperationId ||
        current.pendingOperationRevision !== current.localRevision
      ) {
        await offlineDb.meta.put({
          ...current,
          pendingOperationId: operationId,
          pendingOperationRevision: current.localRevision,
        });
      }
      const batch: SnapshotUploadBatch = {
        snapshot: { ...normalizeSnapshotForSync(row.snapshot), schemaVersion: 3 as const },
        metadata: row.metadata ?? seedSyncMetadata(row.snapshot, current.deviceId, row.updatedAt),
        localRevision: current.localRevision,
        operationId: resolutions ? randomId() : operationId,
        auditEvents: await offlineDb.audits.where("accountId").equals(accountId).toArray(),
        ...(row.baseline ? { baseSnapshot: row.baseline } : {}),
        ...(resolutions
          ? { resolutions, reviewedCloudRevision: current.review?.cloudRevision }
          : {}),
      };
      await offlineDb.meta.put({
        ...current,
        pendingOperationId: batch.operationId,
        pendingOperationRevision: batch.localRevision,
      });
      await offlineDb.snapshots.put({ ...row, pendingUpload: batch });
      return batch;
    },
  );
}

export async function completeSnapshotUpload(
  accountId: string,
  batch: SnapshotUploadBatch,
  cloudRevision: number,
) {
  const sentAuditIds = batch.auditEvents.map((event) => event.id);
  const now = new Date().toISOString();
  let sameBatchResult = false;
  await offlineDb.transaction(
    "rw",
    offlineDb.snapshots,
    offlineDb.meta,
    offlineDb.audits,
    async () => {
      const row = await offlineDb.snapshots.get(accountId);
      const current = await offlineDb.meta.get(accountId);
      if (!row || !current) return;
      const sameBatch =
        current.localRevision === batch.localRevision &&
        current.pendingOperationId === batch.operationId;
      sameBatchResult = sameBatch;
      if (sameBatch) {
        await offlineDb.snapshots.put({
          ...row,
          pendingUpload: undefined,
          baseline: normalizeSnapshotForSync(batch.snapshot),
          snapshot: normalizeSnapshotForSync(batch.snapshot),
          metadata: batch.metadata,
          updatedAt: now,
        });
        const {
          pendingOperationId: _operationId,
          pendingOperationRevision: _operationRevision,
          ...cleanMeta
        } = current;
        await offlineDb.meta.put({
          ...cleanMeta,
          review: undefined,
          syncAttention: undefined,
          lastUploadedRevision: current.localRevision,
          baseCloudRevision: cloudRevision,
          dirty: false,
          lastSyncAt: now,
          lastError: null,
        });
      } else {
        const base = batch.sentSnapshot ?? batch.snapshot;
        const review = reviewSyncSnapshots(row.snapshot, batch.snapshot, base);
        const choices = Object.fromEntries(
          review.conflicts.map((item) => [item.key, { choice: "local" as const }]),
        );
        const rebased = review.conflicts.length
          ? reviewSyncSnapshots(row.snapshot, batch.snapshot, base, choices).snapshot
          : review.snapshot;
        await offlineDb.snapshots.put({
          ...row,
          pendingUpload: undefined,
          baseline: review.conflicts.length ? base : batch.snapshot,
          snapshot: normalizeSnapshotForSync(rebased),
          metadata: stampSnapshotChanges(
            batch.snapshot,
            rebased,
            batch.metadata,
            current.deviceId,
            now,
            current.localRevision,
          ),
          updatedAt: now,
        });
        await offlineDb.meta.put({
          ...current,
          lastUploadedRevision: batch.localRevision,
          baseCloudRevision: cloudRevision,
          dirty: true,
          lastSyncAt: now,
          lastError: null,
        });
      }
      if (sentAuditIds.length) await offlineDb.audits.bulkDelete(sentAuditIds);
    },
  );
  notifyOfflineChange();
  return sameBatchResult;
}

export async function recordSyncFailure(
  accountId: string,
  message: string,
  review?: { cloudRevision: number; conflicts: SyncConflict[] },
  resetReview = false,
) {
  await offlineDb.transaction("rw", offlineDb.meta, offlineDb.snapshots, async () => {
    const current = await offlineDb.meta.get(accountId);
    if (!current) return;
    const row = await offlineDb.snapshots.get(accountId);
    await offlineDb.meta.put({
      ...current,
      lastError: message,
      ...(review
        ? {
            syncAttention: "manual",
            review: {
              ...review,
              localRevision: row?.pendingUpload?.localRevision ?? current.localRevision,
            },
          }
        : resetReview
          ? { syncAttention: undefined, review: undefined }
          : {}),
    });
    if (review || resetReview) {
      if (row) await offlineDb.snapshots.put({ ...row, pendingUpload: undefined });
    }
  });
  notifyOfflineChange();
}

export async function appendAudit(
  accountId: string,
  event: Omit<LocalAuditEvent, "id" | "accountId" | "createdAt">,
) {
  await offlineDb.transaction("rw", offlineDb.audits, offlineDb.meta, async () => {
    await offlineDb.audits.put({
      ...event,
      id: randomId(),
      accountId,
      createdAt: new Date().toISOString(),
    });
    const current = await offlineDb.meta.get(accountId);
    if (!current) return;
    const localRevision = current.localRevision + 1;
    await offlineDb.meta.put({
      ...current,
      localRevision,
      pendingOperationId: randomId(),
      pendingOperationRevision: localRevision,
      dirty: true,
      lastError: null,
    });
  });
}

export async function markSyncAttention(accountId: string, attention: "manual" | null) {
  const current = await offlineDb.meta.get(accountId);
  if (!current) return;
  const next = attention
    ? { ...current, syncAttention: attention }
    : (() => {
        const { syncAttention: _syncAttention, ...rest } = current;
        return rest;
      })();
  await offlineDb.meta.put(next);
  notifyOfflineChange();
}

export async function listPendingAudits(accountId: string) {
  return offlineDb.audits.where("accountId").equals(accountId).toArray();
}

export async function clearAccountData(accountId: string) {
  await offlineDb.transaction(
    "rw",
    offlineDb.profiles,
    offlineDb.meta,
    offlineDb.snapshots,
    offlineDb.audits,
    async () => {
      await Promise.all([
        offlineDb.profiles.delete(accountId),
        offlineDb.meta.delete(accountId),
        offlineDb.snapshots.delete(accountId),
        offlineDb.audits.where("accountId").equals(accountId).delete(),
      ]);
    },
  );
  try {
    if (window.localStorage.getItem("shuttle-queue-current-account") === accountId) {
      window.localStorage.removeItem("shuttle-queue-current-account");
      window.localStorage.removeItem("bq-public-sharing-active");
    }
  } catch {
    /* ignore storage access failures */
  }
  notifyOfflineChange();
}

export function notifyOfflineChange() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("shuttle-queue-offline-change"));
}

export async function storageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}
