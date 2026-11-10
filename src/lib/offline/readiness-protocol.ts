export type OfflineWorkerCommand =
  | { type: "OFFLINE_GET_BUILD"; requestId: string }
  | { type: "OFFLINE_VERIFY_CACHE"; requestId: string; buildId: string }
  | { type: "OFFLINE_REPAIR_CACHE"; requestId: string; buildId: string }
  | { type: "OFFLINE_ACTIVATE_IF_SAFE"; requestId: string; buildId: string };

export type OfflineWorkerReply = {
  protocolVersion: number;
  requestId: string;
  buildId: string;
  ok: boolean;
  verified: number;
  total: number;
  missing?: string[];
  olderClients?: number;
  activated?: boolean;
  error?: string;
  progress?: { verified: number; total: number };
};

export const OFFLINE_WORKER_PROTOCOL_VERSION = 1;
