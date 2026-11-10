import type { CloudSnapshotV2 } from "./domain-compat";
import type { OfflineWorkerCommand, OfflineWorkerReply } from "./readiness-protocol";
import { OFFLINE_WORKER_PROTOCOL_VERSION } from "./readiness-protocol";
import { offlineDb } from "./db";

export type OfflinePreparationStage =
  "checking-device" | "preparing-ui" | "preparing-account" | "verifying" | "blocked";

export type OfflinePreparationProgress = {
  stage: OfflinePreparationStage;
  verified?: number;
  total?: number;
  persistentStorage?: boolean;
  message?: string;
};

const WORKER_RESPONSE_TIMEOUT_MS = 10_000;
const WORKER_IDLE_TIMEOUT_MS = 10_000;
const WORKER_INSTALL_TIMEOUT_MS = 120_000;

export function assertOfflineDeviceCapabilities() {
  if (process.env.NODE_ENV !== "production")
    throw new Error(
      "Offline preparation is disabled during development. Run npm run build:frontend then npm run start --workspace badminton-queue-frontend.",
    );
  if (!window.isSecureContext)
    throw new Error("Open Shuttle Queue over HTTPS or localhost to prepare offline access.");
  if (!navigator.serviceWorker?.register)
    throw new Error("This browser does not support offline app installation.");
  if (!window.caches?.open)
    throw new Error("This browser cannot store the app files needed for offline use.");
  if (!window.indexedDB?.open) throw new Error("This browser cannot store the offline queue data.");
}

function timeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

function requestWorker(
  worker: ServiceWorker,
  command: OfflineWorkerCommand,
  onProgress?: (progress: { verified: number; total: number }) => void,
) {
  return new Promise<OfflineWorkerReply>((resolve, reject) => {
    const channel = new MessageChannel();
    let timer = 0;
    const close = () => {
      window.clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
    };
    const armTimeout = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        close();
        reject(new Error("The offline app worker did not respond. Retry preparation."));
      }, WORKER_IDLE_TIMEOUT_MS);
    };
    channel.port1.onmessage = (event: MessageEvent<OfflineWorkerReply>) => {
      const reply = event.data;
      if (!reply || reply.requestId !== command.requestId) return;
      if (reply.protocolVersion !== OFFLINE_WORKER_PROTOCOL_VERSION) {
        close();
        reject(new Error("The offline worker uses an unsupported protocol. Reload and retry."));
        return;
      }
      if (reply.progress) {
        onProgress?.(reply.progress);
        armTimeout();
        return;
      }
      close();
      if (!reply.ok) reject(new Error(reply.error ?? "The offline app could not be verified."));
      else resolve(reply);
    };
    armTimeout();
    try {
      worker.postMessage({ ...command, protocolVersion: OFFLINE_WORKER_PROTOCOL_VERSION }, [
        channel.port2,
      ]);
    } catch (error) {
      close();
      reject(error);
    }
  });
}

function requestId() {
  return crypto.randomUUID();
}

async function waitForActiveWorker(registration: ServiceWorkerRegistration) {
  const existing = registration.active;
  if (existing) return existing;
  const installing = registration.installing ?? registration.waiting;
  if (!installing)
    throw new Error("The offline app worker has not installed. Check your connection and retry.");
  return timeout(
    new Promise<ServiceWorker>((resolve, reject) => {
      const onStateChange = () => {
        if (registration.active) {
          installing.removeEventListener("statechange", onStateChange);
          resolve(registration.active);
        } else if (installing.state === "redundant") {
          installing.removeEventListener("statechange", onStateChange);
          reject(new Error("The offline app worker could not install. Check your connection."));
        }
      };
      installing.addEventListener("statechange", onStateChange);
      onStateChange();
    }),
    WORKER_INSTALL_TIMEOUT_MS,
    "The offline app worker is taking too long to install. Retry when your connection is stable.",
  );
}

function waitForControllerChange() {
  let onChange: (() => void) | undefined;
  let resolveChange!: (changed: boolean) => void;
  let timer = 0;
  const promise = new Promise<boolean>((resolve) => {
    resolveChange = resolve;
    onChange = () => resolve(true);
    navigator.serviceWorker.addEventListener("controllerchange", onChange, { once: true });
    timer = window.setTimeout(() => resolve(false), WORKER_RESPONSE_TIMEOUT_MS);
  });
  return {
    promise,
    cancel() {
      window.clearTimeout(timer);
      if (onChange) navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      resolveChange(false);
    },
  };
}

function sendReloadForBuild(buildId: string) {
  const key = "shuttle-queue-offline-reload-build";
  if (sessionStorage.getItem(key) === buildId)
    throw new Error("The app update did not finish loading. Close other app tabs and retry.");
  sessionStorage.setItem(key, buildId);
  window.location.reload();
  return new Promise<never>(() => undefined);
}

async function verifyWorkerCache(
  worker: ServiceWorker,
  buildId: string,
  onProgress: (progress: { verified: number; total: number }) => void,
) {
  let verified = await requestWorker(
    worker,
    { type: "OFFLINE_VERIFY_CACHE", requestId: requestId(), buildId },
    onProgress,
  );
  if (verified.missing?.length) {
    if (!navigator.onLine)
      throw new Error("Some app files are missing. Reconnect and retry to download them.");
    await requestWorker(
      worker,
      { type: "OFFLINE_REPAIR_CACHE", requestId: requestId(), buildId },
      onProgress,
    );
    verified = await requestWorker(
      worker,
      { type: "OFFLINE_VERIFY_CACHE", requestId: requestId(), buildId },
      onProgress,
    );
    if (verified.missing?.length)
      throw new Error("Some app files could not be downloaded. Check your connection and retry.");
  }
  return verified;
}

async function activateWaitingWorker(
  waiting: ServiceWorker,
  onProgress: (progress: { verified: number; total: number }) => void,
) {
  const version = await requestWorker(waiting, {
    type: "OFFLINE_GET_BUILD",
    requestId: requestId(),
  });
  await verifyWorkerCache(waiting, version.buildId, onProgress);

  const controllerChange = waitForControllerChange();
  try {
    const activation = await requestWorker(waiting, {
      type: "OFFLINE_ACTIVATE_IF_SAFE",
      requestId: requestId(),
      buildId: version.buildId,
    });
    if (activation.activated && !(await controllerChange.promise))
      throw new Error(
        "The offline app worker installed but did not take control. Reload and retry.",
      );
    return { version, activation };
  } finally {
    controllerChange.cancel();
  }
}

export async function prepareOfflineUi(
  buildId: string,
  onProgress: (progress: { verified: number; total: number }) => void,
) {
  assertOfflineDeviceCapabilities();
  if (sessionStorage.getItem("shuttle-queue-offline-reload-build") === buildId)
    sessionStorage.removeItem("shuttle-queue-offline-reload-build");

  const registration = await registerOfflineWorker();
  let active = registration.active ?? (await waitForActiveWorker(registration));
  const activeVersion = await requestWorker(active, {
    type: "OFFLINE_GET_BUILD",
    requestId: requestId(),
  }).catch(() => null);

  if (activeVersion?.buildId !== buildId) {
    let waiting = registration.waiting;
    if (!waiting) {
      if (!navigator.onLine)
        throw new Error(
          "This saved app needs an offline update. Connect and retry to prepare this version.",
        );
      await registration.update().catch(() => undefined);
      waiting = await waitForWaitingWorker(registration);
    }
    if (!waiting)
      throw new Error(
        "The app and its offline worker have different versions. Close other app tabs, then retry.",
      );
    const { version: waitingVersion, activation } = await activateWaitingWorker(
      waiting,
      onProgress,
    );
    const targetBuildId = waitingVersion.buildId;
    if (!activation.activated)
      throw new Error(
        "A different app version is open in another tab. Finish that session, close its tab, and retry.",
      );
    if (targetBuildId !== buildId) return sendReloadForBuild(targetBuildId);
    active = registration.active ?? waiting;
  } else if (registration.waiting) {
    const waiting = registration.waiting;
    const waitingVersion = await requestWorker(waiting, {
      type: "OFFLINE_GET_BUILD",
      requestId: requestId(),
    });
    if (waitingVersion.buildId !== buildId) {
      const { activation } = await activateWaitingWorker(waiting, onProgress);
      if (activation.activated) return sendReloadForBuild(waitingVersion.buildId);
    }
  }
  const updatePending = Boolean(registration.waiting);
  const verified = await verifyWorkerCache(active, buildId, onProgress);
  return { total: verified.total, updatePending };
}

let workerRegistration: Promise<ServiceWorkerRegistration> | undefined;

export function registerOfflineWorker() {
  if (!workerRegistration) {
    workerRegistration = navigator.serviceWorker
      .register("/serwist/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error) => {
        workerRegistration = undefined;
        throw error;
      });
  }
  return workerRegistration;
}

function waitForWaitingWorker(registration: ServiceWorkerRegistration) {
  let cleanup: () => void = () => undefined;
  return timeout(
    new Promise<ServiceWorker>((resolve, reject) => {
      let installing: ServiceWorker | null = null;
      cleanup = () => {
        registration.removeEventListener("updatefound", check);
        installing?.removeEventListener("statechange", check);
      };
      const check = () => {
        if (registration.waiting) {
          cleanup();
          resolve(registration.waiting);
          return;
        }
        if (registration.installing && registration.installing !== installing) {
          installing?.removeEventListener("statechange", check);
          installing = registration.installing;
          installing.addEventListener("statechange", check);
        }
        if (installing?.state === "redundant") {
          cleanup();
          reject(
            new Error("The updated offline app could not install. Retry with a stable connection."),
          );
        }
      };
      registration.addEventListener("updatefound", check);
      check();
    }),
    WORKER_INSTALL_TIMEOUT_MS,
    "The updated offline app is taking too long to install. Retry when your connection is stable.",
  ).finally(() => cleanup());
}

function assertSnapshotIntegrity(snapshot: CloudSnapshotV2, accountId: string) {
  const arrays = ["players", "queuePlayers", "courts", "matches", "payments", "audits"] as const;
  if (
    (snapshot.schemaVersion !== 2 && snapshot.schemaVersion !== 3) ||
    snapshot.queueMasterId !== accountId ||
    !snapshot.workspace ||
    arrays.some((key) => !Array.isArray(snapshot[key]))
  )
    throw new Error("The saved offline queue is incomplete or belongs to another account.");

  const uniqueIds = (records: Array<{ id: string }>) => {
    const ids = records.map((record) => record?.id);
    return (
      ids.every((id) => typeof id === "string" && id.length > 0) && new Set(ids).size === ids.length
    );
  };
  if (
    !uniqueIds(snapshot.players) ||
    !uniqueIds(snapshot.queuePlayers) ||
    !uniqueIds(snapshot.courts) ||
    !uniqueIds(snapshot.matches) ||
    !uniqueIds(snapshot.payments) ||
    !uniqueIds(snapshot.audits)
  )
    throw new Error("The saved offline queue has duplicate or missing record identities.");

  const players = new Set(snapshot.players.map((row) => row.id));
  const queuePlayers = new Set(snapshot.queuePlayers.map((row) => row.id));
  const courts = new Set(snapshot.courts.map((row) => row.id));
  const matches = new Set(snapshot.matches.map((row) => row.id));
  const payments = new Set(snapshot.payments.map((row) => row.id));
  const synergyMembers = new Set<string>();
  if (
    snapshot.queuePlayers.some((row) => !players.has(row.playerId)) ||
    snapshot.matches.some(
      (match) =>
        (match.courtId != null && !courts.has(match.courtId)) ||
        !Array.isArray(match.participants) ||
        match.participants.some(
          (participant) =>
            !queuePlayers.has(participant.queuePlayerId) || participant.matchId !== match.id,
        ),
    ) ||
    snapshot.queuePlayers.some(
      (row) => row.currentMatchId != null && !matches.has(row.currentMatchId),
    ) ||
    snapshot.courts.some((row) => row.currentMatchId != null && !matches.has(row.currentMatchId)) ||
    snapshot.payments.some(
      (row) =>
        !queuePlayers.has(row.queuePlayerId) ||
        (row.reversalOfPaymentId != null && !payments.has(row.reversalOfPaymentId)),
    ) ||
    (snapshot.synergyTeams ?? []).some((team) => {
      const ids = team.queuePlayerIds;
      if (
        ids.length !== 2 ||
        ids[0] === ids[1] ||
        ids.some((id) => !queuePlayers.has(id) || synergyMembers.has(id))
      )
        return true;
      ids.forEach((id) => synergyMembers.add(id));
      return false;
    })
  )
    throw new Error(
      "The saved offline queue contains broken references. Keep the data and retry online.",
    );
}

export async function verifyAccountData(accountId: string) {
  const row = await offlineDb.snapshots.get(accountId);
  if (!row) throw new Error("This account has no downloaded offline queue. Connect and retry.");
  assertSnapshotIntegrity(row.snapshot, accountId);

  const probe = crypto.randomUUID();
  await offlineDb.transaction("rw", offlineDb.snapshots, async () => {
    const current = await offlineDb.snapshots.get(accountId);
    if (!current) throw new Error("The saved offline queue is missing. Keep the data and retry.");
    await offlineDb.snapshots.put({ ...current, readinessProbe: probe });
    const written = await offlineDb.snapshots.get(accountId);
    if (written?.readinessProbe !== probe)
      throw new Error("The browser could not verify offline storage. Free storage and retry.");
    const { readinessProbe: _probe, ...clean } = written;
    await offlineDb.snapshots.put(clean);
  });

  let persistentStorage: boolean | undefined;
  try {
    persistentStorage = (await navigator.storage?.persisted?.()) ?? undefined;
    if (persistentStorage === false && navigator.storage?.persist) {
      void navigator.storage
        .persist()
        .then((granted) => {
          window.dispatchEvent(
            new CustomEvent("shuttle-queue-storage-persistence", { detail: granted }),
          );
        })
        .catch(() => undefined);
    }
  } catch {
    persistentStorage = false;
  }
  return { persistentStorage };
}
