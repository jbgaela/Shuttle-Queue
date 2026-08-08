import Dexie, { type Table } from "dexie";
import type { CloudSnapshotV1 } from "@shuttle-queue/domain";

export type LocalSyncMeta = {
  accountId: string;
  deviceId: string;
  localRevision: number;
  lastUploadedRevision: number;
  baseCloudRevision: number;
  dirty: boolean;
  pendingOperationId?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

export type LocalProfile = { accountId: string; username: string; role: string; updatedAt: string };
export type LocalAuditEvent = { id: string; accountId: string; sessionId?: string | null; action: string; entityType: string; entityId: string; reason?: string; beforeJson?: unknown; afterJson?: unknown; createdAt: string };
type SnapshotRow = { accountId: string; snapshot: CloudSnapshotV1; updatedAt: string };

class OfflineDatabase extends Dexie {
  profiles!: Table<LocalProfile, string>;
  meta!: Table<LocalSyncMeta, string>;
  snapshots!: Table<SnapshotRow, string>;
  audits!: Table<LocalAuditEvent, string>;

  constructor() {
    super("shuttle-queue-offline");
    this.version(1).stores({ profiles: "accountId,updatedAt", meta: "accountId,dirty,baseCloudRevision", snapshots: "accountId,updatedAt", audits: "id,accountId,createdAt" });
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
  return (await offlineDb.snapshots.get(accountId))?.snapshot ?? null;
}

export async function replaceSnapshot(accountId: string, snapshot: CloudSnapshotV1, cloudRevision: number) {
  const now = new Date().toISOString();
  await offlineDb.transaction("rw", offlineDb.snapshots, offlineDb.meta, offlineDb.audits, async () => {
    await offlineDb.snapshots.put({ accountId, snapshot, updatedAt: now });
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

export async function updateLocalSnapshot<T>(accountId: string, update: (snapshot: CloudSnapshotV1) => T | Promise<T>) {
  let result!: T;
  await offlineDb.transaction("rw", offlineDb.snapshots, offlineDb.meta, offlineDb.audits, async () => {
    const row = await offlineDb.snapshots.get(accountId);
    if (!row) throw new Error("Download this account before working offline.");
    const snapshot = typeof structuredClone === "function" ? structuredClone(row.snapshot) : JSON.parse(JSON.stringify(row.snapshot)) as CloudSnapshotV1;
    result = await update(snapshot);
    const prior = await offlineDb.meta.get(accountId);
    const localRevision = (prior?.localRevision ?? 0) + 1;
    await offlineDb.snapshots.put({ ...row, snapshot, updatedAt: new Date().toISOString() });
    await offlineDb.meta.put({ accountId, deviceId: prior?.deviceId ?? getDeviceId(), localRevision, lastUploadedRevision: prior?.lastUploadedRevision ?? 0, baseCloudRevision: prior?.baseCloudRevision ?? 0, dirty: true, ...(prior?.pendingOperationId !== undefined ? { pendingOperationId: prior.pendingOperationId } : {}), ...(prior?.lastSyncAt !== undefined ? { lastSyncAt: prior.lastSyncAt } : {}), lastError: null });
  });
  notifyOfflineChange();
  return result;
}

export async function appendAudit(accountId: string, event: Omit<LocalAuditEvent, "id" | "accountId" | "createdAt">) {
  await offlineDb.audits.put({ ...event, id: randomId(), accountId, createdAt: new Date().toISOString() });
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
