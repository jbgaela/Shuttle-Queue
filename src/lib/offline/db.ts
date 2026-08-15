import Dexie, { type Table } from "dexie";
import type { CloudSnapshotV2 } from "./domain-compat";
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
  syncAttention?: "manual";
};

export type LocalProfile = { accountId: string; username: string; role: string; updatedAt: string };
export type LocalAuditEvent = { id: string; accountId: string; action: string; entityType: string; entityId: string; reason?: string; beforeJson?: unknown; afterJson?: unknown; createdAt: string };
type SnapshotRow = { accountId: string; snapshot: CloudSnapshotV2; updatedAt: string };

export type SnapshotUploadBatch = {
  snapshot: CloudSnapshotV2;
  localRevision: number;
  operationId: string;
  auditEvents: LocalAuditEvent[];
};

class OfflineDatabase extends Dexie {
  profiles!: Table<LocalProfile, string>;
  meta!: Table<LocalSyncMeta, string>;
  snapshots!: Table<SnapshotRow, string>;
  audits!: Table<LocalAuditEvent, string>;

  constructor() {
    super("shuttle-queue-offline");
    this.version(1).stores({ profiles: "accountId,updatedAt", meta: "accountId,dirty,baseCloudRevision", snapshots: "accountId,updatedAt", audits: "id,accountId,createdAt" });
    this.version(2).stores({ profiles: "accountId,updatedAt", meta: "accountId,dirty,baseCloudRevision", snapshots: "accountId,updatedAt", audits: "id,accountId,createdAt" }).upgrade(async (transaction) => {
      await Promise.all([transaction.table("meta").clear(), transaction.table("snapshots").clear(), transaction.table("audits").clear()]);
    });
  }
}

export const offlineDb = new OfflineDatabase();

const randomId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

export async function replaceSnapshot(accountId: string, snapshot: CloudSnapshotV2, cloudRevision: number) {
  if (snapshot.schemaVersion !== 2) throw new Error("This offline snapshot is incompatible. Download the current queue online.");
  const normalizedSnapshot = normalizeSnapshotForSync(snapshot);
  const now = new Date().toISOString();
  await offlineDb.transaction("rw", offlineDb.snapshots, offlineDb.meta, offlineDb.audits, async () => {
    await offlineDb.snapshots.put({ accountId, snapshot: normalizedSnapshot, updatedAt: now });
    await offlineDb.meta.put({ accountId, deviceId: getDeviceId(), localRevision: 0, lastUploadedRevision: cloudRevision, baseCloudRevision: cloudRevision, dirty: false, lastSyncAt: now, lastError: null });
    await offlineDb.audits.where("accountId").equals(accountId).delete();
  });
  notifyOfflineChange();
}

export async function saveProfile(profile: LocalProfile) {
  await offlineDb.profiles.put(profile);
  try { window.localStorage.setItem("shuttle-queue-current-account", profile.accountId); } catch { /* ignore storage access failures */ }
}

export async function getProfile(accountId: string) {
  return offlineDb.profiles.get(accountId);
}

export async function firstProfile() {
  return (await offlineDb.profiles.toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export async function updateLocalSnapshot<T>(accountId: string, update: (snapshot: CloudSnapshotV2) => T | Promise<T>) {
  let result!: T;
  await offlineDb.transaction("rw", offlineDb.snapshots, offlineDb.meta, offlineDb.audits, async () => {
    const row = await offlineDb.snapshots.get(accountId);
    if (!row) throw new Error("Download this account before working offline.");
    const snapshot = normalizeSnapshotForSync(typeof structuredClone === "function" ? structuredClone(row.snapshot) : JSON.parse(JSON.stringify(row.snapshot)) as CloudSnapshotV2);
    result = await update(snapshot);
    const prior = await offlineDb.meta.get(accountId);
    const localRevision = (prior?.localRevision ?? 0) + 1;
    await offlineDb.snapshots.put({ ...row, snapshot, updatedAt: new Date().toISOString() });
    await offlineDb.meta.put({ accountId, deviceId: prior?.deviceId ?? getDeviceId(), localRevision, lastUploadedRevision: prior?.lastUploadedRevision ?? 0, baseCloudRevision: prior?.baseCloudRevision ?? 0, dirty: true, pendingOperationId: randomId(), pendingOperationRevision: localRevision, ...(prior?.lastSyncAt !== undefined ? { lastSyncAt: prior.lastSyncAt } : {}), ...(prior?.syncAttention !== undefined ? { syncAttention: prior.syncAttention } : {}), lastError: null });
  });
  notifyOfflineChange();
  return result;
}

export async function prepareSnapshotUpload(accountId: string): Promise<SnapshotUploadBatch> {
  return offlineDb.transaction("rw", offlineDb.snapshots, offlineDb.meta, offlineDb.audits, async () => {
    const row = await offlineDb.snapshots.get(accountId);
    const current = await offlineDb.meta.get(accountId);
    if (!row || !current) throw new Error("Local data is missing.");
    const operationId = operationIdForRevision(current.pendingOperationId, current.pendingOperationRevision, current.localRevision, randomId);
    if (operationId !== current.pendingOperationId || current.pendingOperationRevision !== current.localRevision) {
      await offlineDb.meta.put({ ...current, pendingOperationId: operationId, pendingOperationRevision: current.localRevision });
    }
    return { snapshot: normalizeSnapshotForSync(row.snapshot), localRevision: current.localRevision, operationId, auditEvents: await offlineDb.audits.where("accountId").equals(accountId).toArray() };
  });
}

export async function completeSnapshotUpload(accountId: string, batch: SnapshotUploadBatch, cloudRevision: number) {
  const sentAuditIds = batch.auditEvents.map((event) => event.id);
  const now = new Date().toISOString();
  let sameBatchResult = false;
  await offlineDb.transaction("rw", offlineDb.snapshots, offlineDb.meta, offlineDb.audits, async () => {
    const row = await offlineDb.snapshots.get(accountId);
    const current = await offlineDb.meta.get(accountId);
    if (!row || !current) return;
    const sameBatch = current.localRevision === batch.localRevision && current.pendingOperationId === batch.operationId;
    sameBatchResult = sameBatch;
    if (sameBatch) {
      await offlineDb.snapshots.put({ ...row, snapshot: normalizeSnapshotForSync(batch.snapshot), updatedAt: now });
      const { pendingOperationId: _operationId, pendingOperationRevision: _operationRevision, ...cleanMeta } = current;
      await offlineDb.meta.put({ ...cleanMeta, lastUploadedRevision: current.localRevision, baseCloudRevision: cloudRevision, dirty: false, lastSyncAt: now, lastError: null });
    } else {
      await offlineDb.meta.put({ ...current, lastUploadedRevision: batch.localRevision, baseCloudRevision: cloudRevision, dirty: true, lastSyncAt: now, lastError: null });
    }
    if (sentAuditIds.length) await offlineDb.audits.bulkDelete(sentAuditIds);
  });
  notifyOfflineChange();
  return sameBatchResult;
}

export async function appendAudit(accountId: string, event: Omit<LocalAuditEvent, "id" | "accountId" | "createdAt">) {
  await offlineDb.transaction("rw", offlineDb.audits, offlineDb.meta, async () => {
    await offlineDb.audits.put({ ...event, id: randomId(), accountId, createdAt: new Date().toISOString() });
    const current = await offlineDb.meta.get(accountId);
    if (!current) return;
    const localRevision = current.localRevision + 1;
    await offlineDb.meta.put({ ...current, localRevision, pendingOperationId: randomId(), pendingOperationRevision: localRevision, dirty: true, lastError: null });
  });
}

export async function markSyncAttention(accountId: string, attention: "manual" | null) {
  const current = await offlineDb.meta.get(accountId);
  if (!current) return;
  const next = attention ? { ...current, syncAttention: attention } : (() => { const { syncAttention: _syncAttention, ...rest } = current; return rest; })();
  await offlineDb.meta.put(next);
  notifyOfflineChange();
}

export async function listPendingAudits(accountId: string) {
  return offlineDb.audits.where("accountId").equals(accountId).toArray();
}

export async function clearAccountData(accountId: string) {
  await offlineDb.transaction("rw", offlineDb.profiles, offlineDb.meta, offlineDb.snapshots, offlineDb.audits, async () => {
    await Promise.all([offlineDb.profiles.delete(accountId), offlineDb.meta.delete(accountId), offlineDb.snapshots.delete(accountId), offlineDb.audits.where("accountId").equals(accountId).delete()]);
  });
  try { if (window.localStorage.getItem("shuttle-queue-current-account") === accountId) window.localStorage.removeItem("shuttle-queue-current-account"); } catch { /* ignore storage access failures */ }
  notifyOfflineChange();
}

export function notifyOfflineChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("shuttle-queue-offline-change"));
}

export async function storageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}
