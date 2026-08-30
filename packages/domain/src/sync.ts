import { allocateFinalFeeAmounts } from "./fees.js";
import type { CloudSnapshotV2, DomainMatch } from "./index.js";

export type SyncClock = { at: string; deviceId: string; sequence: number };
export type SyncRecordMetadata = { clock?: SyncClock | undefined; fields?: Record<string, SyncClock> | undefined; tombstone?: SyncClock | undefined };
export type SyncMetadata = { version: 3; records: Record<string, SyncRecordMetadata> };
export type CloudSnapshotV3 = Omit<CloudSnapshotV2, "schemaVersion"> & { schemaVersion: 3 };

type Snapshot = CloudSnapshotV2 | CloudSnapshotV3;
type CollectionName = "players" | "queuePlayers" | "synergyTeams" | "courts" | "matches" | "payments" | "audits";
type ClockMap = Record<string, SyncRecordMetadata>;

const clone = <T,>(value: T): T => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
const clockValue = (clock: SyncClock | undefined) => clock ? `${clock.at}\u0000${clock.sequence}\u0000${clock.deviceId}` : "";
const compareClock = (a: SyncClock | undefined, b: SyncClock | undefined) => clockValue(a).localeCompare(clockValue(b));
const recordKey = (collection: string, id: string) => `${collection}/${id}`;
const normalizedName = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const collections: CollectionName[] = ["players", "queuePlayers", "synergyTeams", "courts", "matches", "payments", "audits"];
const collectionItems = (snapshot: Snapshot, collection: CollectionName) => snapshot[collection] ?? [];

export function emptySyncMetadata(): SyncMetadata { return { version: 3, records: {} }; }

export function seedSyncMetadata(snapshot: Snapshot, deviceId: string, at = new Date().toISOString()): SyncMetadata {
  const metadata = emptySyncMetadata();
  const clock = { at, deviceId, sequence: 0 };
  for (const collection of collections) for (const item of collectionItems(snapshot, collection)) metadata.records[recordKey(collection, item.id)] = { clock };
  if (snapshot.settings) metadata.records["settings/main"] = { clock };
  metadata.records["workspace/main"] = { clock };
  if (snapshot.feeConfig) metadata.records["feeConfig/main"] = { clock };
  return metadata;
}

function changedFields(before: Record<string, unknown> | undefined, after: Record<string, unknown>) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  return [...keys].filter((key) => key !== "version" && !equal(before?.[key], after[key]));
}

function stampRecord(metadata: SyncMetadata, key: string, fields: string[], clock: SyncClock) {
  const current = metadata.records[key] ?? {};
  const next: SyncRecordMetadata = { ...current, tombstone: undefined };
  if (!fields.length || !current.clock) next.clock = clock;
  if (fields.length) next.fields = { ...(current.fields ?? {}) };
  for (const field of fields) next.fields![field] = clock;
  metadata.records[key] = next;
}

export function stampSnapshotChanges(before: Snapshot, after: Snapshot, prior: SyncMetadata | undefined, deviceId: string, at = new Date().toISOString(), sequence = 0): SyncMetadata {
  const metadata = clone(prior ?? emptySyncMetadata());
  metadata.version = 3;
  const clock = { at, deviceId, sequence };
  for (const collection of collections) {
    const previous = new Map(collectionItems(before, collection).map((item) => [item.id, item]));
    const current = new Map(collectionItems(after, collection).map((item) => [item.id, item]));
    for (const [id, item] of current) {
      const fields = changedFields(previous.get(id) as Record<string, unknown> | undefined, item as Record<string, unknown>);
      if (fields.length || !previous.has(id)) stampRecord(metadata, recordKey(collection, id), collection === "players" ? fields : [], clock);
    }
    for (const id of previous.keys()) if (!current.has(id)) {
      const key = recordKey(collection, id);
      metadata.records[key] = { ...(metadata.records[key] ?? {}), tombstone: clock };
    }
  }
  const special: Array<[string, unknown, unknown, string[]]> = [
    ["settings/main", before.settings, after.settings, changedFields(before.settings as unknown as Record<string, unknown> | undefined, after.settings as unknown as Record<string, unknown> ?? {})],
    ["workspace/main", before.workspace, after.workspace, []],
    ["feeConfig/main", before.feeConfig, after.feeConfig, []],
  ];
  for (const [key, oldValue, newValue, fields] of special) {
    if (!equal(oldValue, newValue)) stampRecord(metadata, key, fields, clock);
    if (oldValue && !newValue) metadata.records[key] = { ...(metadata.records[key] ?? {}), tombstone: clock };
  }
  return metadata;
}

const metadataFor = (metadata: SyncMetadata | undefined, key: string): SyncRecordMetadata => metadata?.records[key] ?? {};
const choose = <T,>(local: T, remote: T, localMeta: SyncRecordMetadata, remoteMeta: SyncRecordMetadata) => compareClock(localMeta.clock, remoteMeta.clock) > 0 ? local : remote;

function mergeFields<T extends Record<string, unknown>>(local: T, remote: T, localMeta: SyncRecordMetadata, remoteMeta: SyncRecordMetadata): T {
  const result = { ...remote } as T;
  const fields = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const field of fields) {
    const left = localMeta.fields?.[field] ?? localMeta.clock;
    const right = remoteMeta.fields?.[field] ?? remoteMeta.clock;
    if (compareClock(left, right) > 0) result[field as keyof T] = local[field] as T[keyof T];
  }
  return result;
}

function mergeMatch(local: DomainMatch, remote: DomainMatch, localMeta: SyncRecordMetadata, remoteMeta: SyncRecordMetadata): DomainMatch {
  const chosen = choose(local, remote, localMeta, remoteMeta);
  // A match lineup is an aggregate. Match edits replace participant rows and
  // therefore may legitimately assign new row IDs to unchanged players.
  const participants = clone(chosen.participants);
  const revisions = [...new Map([...remote.scoreRevisions, ...local.scoreRevisions].map((item) => [item.id, item])).values()];
  const games = revisions.map((revision) => ({ ...revision, games: [...new Map([...revision.games, ...(local.scoreRevisions.find((item) => item.id === revision.id)?.games ?? [])].map((item) => [item.id, item])).values()] }));
  return { ...chosen, participants, scoreRevisions: games };
}
const compareSynergyClock = (a: SyncClock | undefined, b: SyncClock | undefined) => { const left = a ? `${a.at}\u0000${a.sequence}` : ""; const right = b ? `${b.at}\u0000${b.sequence}` : ""; return left.localeCompare(right); };
function normalizeSynergyTeams(snapshot: CloudSnapshotV3, metadata: SyncMetadata) {
  const claimed = new Set<string>();
  const queueIds = new Set(snapshot.queuePlayers.map((player) => player.id));
  const valid = (snapshot.synergyTeams ?? []).filter((team) => Array.isArray(team.queuePlayerIds) && team.queuePlayerIds.length === 2 && team.queuePlayerIds[0] !== team.queuePlayerIds[1] && team.queuePlayerIds.every((id) => queueIds.has(id))).slice().sort((left, right) => compareSynergyClock(metadataFor(metadata, recordKey("synergyTeams", right.id)).clock, metadataFor(metadata, recordKey("synergyTeams", left.id)).clock) || right.version - left.version || left.id.localeCompare(right.id));
  snapshot.synergyTeams = valid.filter((team) => { if (team.queuePlayerIds.some((id) => claimed.has(id))) return false; team.queuePlayerIds.forEach((id) => claimed.add(id)); return true; });
}

function isDeleted(meta: SyncRecordMetadata, recordMeta: SyncRecordMetadata) {
  return meta.tombstone && compareClock(meta.tombstone, recordMeta.clock) >= 0;
}

function rebuildDerivedState(snapshot: CloudSnapshotV3) {
  const skillWeights: Record<string, number> = { NEWBIE: 1, BEGINNER: 2, UPPER_BEGINNER: 3, INTERMEDIATE: 4, UPPER_INTERMEDIATE: 5, ADVANCED: 6 };
  for (const player of snapshot.players) player.skillWeight = skillWeights[player.skillLevel] ?? player.skillWeight;
  const players = new Map(snapshot.players.map((player) => [player.id, player]));
  for (const queuePlayer of snapshot.queuePlayers) {
    const profile = players.get(queuePlayer.playerId);
    if (profile) Object.assign(queuePlayer, { displayName: profile.displayName, gender: profile.gender, skillLevel: profile.skillLevel, skillWeight: profile.skillWeight });
    else queuePlayer.skillWeight = skillWeights[queuePlayer.skillLevel] ?? queuePlayer.skillWeight;
    Object.assign(queuePlayer, { matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, lastMatchEndedAt: null });
  }
  const queuePlayers = new Map(snapshot.queuePlayers.map((player) => [player.id, player]));
  for (const match of snapshot.matches.filter((item) => item.status === "COMPLETED")) {
    const revision = match.scoreRevisions.find((item) => item.id === match.currentRevisionId) ?? [...match.scoreRevisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
    if (!revision) continue;
    const points = revision.games.reduce((sum, game) => ({ a: sum.a + game.teamAScore, b: sum.b + game.teamBScore }), { a: 0, b: 0 });
    for (const participant of match.participants) { const player = queuePlayers.get(participant.queuePlayerId); if (!player) continue; const won = participant.team === revision.winnerTeam; player.matchesPlayed += 1; player.wins += won ? 1 : 0; player.losses += won ? 0 : 1; player.pointsFor += participant.team === "A" ? points.a : points.b; player.pointsAgainst += participant.team === "A" ? points.b : points.a; if (!player.lastMatchEndedAt || String(match.completedAt ?? "") > String(player.lastMatchEndedAt)) player.lastMatchEndedAt = match.completedAt ?? player.lastMatchEndedAt ?? null; }
  }
  const activeMatchByPlayer = new Map<string, string>(); const queuedMatchByPlayer = new Map<string, string>();
  for (const match of snapshot.matches) for (const participant of match.participants) { if (match.status === "IN_PROGRESS") activeMatchByPlayer.set(participant.queuePlayerId, match.id); if (match.status === "QUEUED" && !queuedMatchByPlayer.has(participant.queuePlayerId)) queuedMatchByPlayer.set(participant.queuePlayerId, match.id); }
  for (const player of snapshot.queuePlayers) { const active = activeMatchByPlayer.get(player.id); const queued = queuedMatchByPlayer.get(player.id); if (active) { player.status = "PLAYING"; player.currentMatchId = active; } else if (queued) { player.status = "QUEUED"; player.currentMatchId = queued; } else if (player.status === "PLAYING" || player.status === "QUEUED") { player.status = "WAITING"; player.currentMatchId = null; } }
  for (const court of snapshot.courts) { const active = snapshot.matches.find((match) => match.status === "IN_PROGRESS" && match.courtId === court.id); court.currentMatchId = active?.id ?? null; if (court.status === "OCCUPIED" && !active) court.status = "AVAILABLE"; if (active && court.status === "AVAILABLE") court.status = "OCCUPIED"; }
  if (snapshot.feeConfig) {
    const roster = snapshot.queuePlayers.filter((player) => snapshot.workspace.endedAt || Boolean(player.checkedInAt)).slice().sort((a, b) => a.id.localeCompare(b.id));
    if (snapshot.workspace.endedAt) {
      const allocations = allocateFinalFeeAmounts(snapshot.feeConfig, roster);
      for (const player of roster) player.amountDueMinor = allocations.get(player.id) ?? 0;
    } else {
      const total = snapshot.feeConfig.expectedQueueCostMinor ?? 0;
      const base = roster.length ? Math.floor(total / roster.length) : 0;
      roster.forEach((player, index) => { player.amountDueMinor = snapshot.feeConfig?.mode === "FIXED_PER_PLAYER" ? snapshot.feeConfig.fixedAmountPerPlayerMinor ?? 0 : base + (index < total - (base * roster.length) ? 1 : 0); });
    }
  }
}

export function mergeSyncMetadata(local: SyncMetadata | undefined, remote: SyncMetadata | undefined): SyncMetadata {
  const result = emptySyncMetadata();
  const keys = new Set([...Object.keys(local?.records ?? {}), ...Object.keys(remote?.records ?? {})]);
  for (const key of keys) {
    const left = local?.records[key] ?? {};
    const right = remote?.records[key] ?? {};
    const next: SyncRecordMetadata = {};
    next.clock = compareClock(left.clock, right.clock) >= 0 ? left.clock : right.clock;
    next.tombstone = compareClock(left.tombstone, right.tombstone) >= 0 ? left.tombstone : right.tombstone;
    const fields = new Set([...Object.keys(left.fields ?? {}), ...Object.keys(right.fields ?? {})]);
    if (fields.size) next.fields = Object.fromEntries([...fields].map((field) => [field, compareClock(left.fields?.[field], right.fields?.[field]) >= 0 ? left.fields?.[field] : right.fields?.[field]]).filter((entry): entry is [string, SyncClock] => Boolean(entry[1])));
    result.records[key] = next;
  }
  return result;
}

export function mergeSyncSnapshots(local: Snapshot, remote: Snapshot, localMetadata?: SyncMetadata, remoteMetadata?: SyncMetadata): { snapshot: CloudSnapshotV3; metadata: SyncMetadata } {
  const leftMeta = localMetadata ?? seedSyncMetadata(local, "legacy-local");
  // A v2 cloud snapshot has no clocks. Treat its existing records as the
  // baseline so a device's already-recorded offline edits are not discarded
  // during the first v3 merge; cloud-only records are still unioned below.
  const rightMeta = remoteMetadata ?? seedSyncMetadata(remote, "cloud", "1970-01-01T00:00:00.000Z");
  const metadata = mergeSyncMetadata(leftMeta, rightMeta);
  const result = clone(remote) as CloudSnapshotV3;
  result.schemaVersion = 3;
  for (const collection of collections) {
    const left = new Map(collectionItems(local, collection).map((item) => [item.id, item]));
    const right = new Map(collectionItems(remote, collection).map((item) => [item.id, item]));
    const ids = new Set([...left.keys(), ...right.keys()]);
    (result as any)[collection] = [...ids].map((id) => {
      const key = recordKey(collection, id);
      const lm = metadataFor(leftMeta, key);
      const rm = metadataFor(rightMeta, key);
      const mergedMeta = metadata.records[key] ?? {};
      if (isDeleted(mergedMeta, { clock: lm.clock }) || isDeleted(mergedMeta, { clock: rm.clock })) return null;
      const a = left.get(id);
      const b = right.get(id);
      if (!a) return clone(b!);
      if (!b) return clone(a);
      if (collection === "players") return mergeFields(a as Record<string, unknown>, b as Record<string, unknown>, lm, rm) as typeof a;
      if (collection === "matches") return mergeMatch(a as DomainMatch, b as DomainMatch, lm, rm) as typeof a;
      return clone(choose(a, b, lm, rm));
    }).filter(Boolean);
  }
  const playerByName = new Map<string, string>();
  const playerRemap = new Map<string, string>();
  for (const player of result.players.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const key = normalizedName(player.displayName);
    const canonical = playerByName.get(key);
    if (canonical) playerRemap.set(player.id, canonical);
    else playerByName.set(key, player.id);
  }
  if (playerRemap.size) {
    result.players = result.players.filter((player) => !playerRemap.has(player.id));
    for (const player of result.queuePlayers) if (playerRemap.has(player.playerId)) player.playerId = playerRemap.get(player.playerId)!;
    const queueByPlayer = new Map<string, string>();
    const queueRemap = new Map<string, string>();
    for (const player of result.queuePlayers.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const canonical = queueByPlayer.get(player.playerId);
      if (canonical) queueRemap.set(player.id, canonical);
      else queueByPlayer.set(player.playerId, player.id);
    }
    result.queuePlayers = result.queuePlayers.filter((player) => !queueRemap.has(player.id));
    for (const match of result.matches) { for (const participant of match.participants) if (queueRemap.has(participant.queuePlayerId)) participant.queuePlayerId = queueRemap.get(participant.queuePlayerId)!; match.participants = [...new Map(match.participants.map((participant) => [participant.queuePlayerId, participant])).values()]; }
    for (const payment of result.payments) if (queueRemap.has(payment.queuePlayerId)) payment.queuePlayerId = queueRemap.get(payment.queuePlayerId)!;
    for (const team of result.synergyTeams ?? []) team.queuePlayerIds = team.queuePlayerIds.map((id) => queueRemap.get(id) ?? id) as [string, string];
  }
  normalizeSynergyTeams(result, metadata);
  const courtByName = new Map<string, string>();
  const courtRemap = new Map<string, string>();
  for (const court of result.courts.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const canonical = courtByName.get(normalizedName(court.name));
    if (canonical) courtRemap.set(court.id, canonical);
    else courtByName.set(normalizedName(court.name), court.id);
  }
  if (courtRemap.size) {
    result.courts = result.courts.filter((court) => !courtRemap.has(court.id));
    for (const match of result.matches) if (match.courtId && courtRemap.has(match.courtId)) match.courtId = courtRemap.get(match.courtId)!;
  }
  result.settings = local.settings && remote.settings ? mergeFields(local.settings as unknown as Record<string, unknown>, remote.settings as unknown as Record<string, unknown>, metadataFor(leftMeta, "settings/main"), metadataFor(rightMeta, "settings/main")) as typeof result.settings : local.settings ?? remote.settings;
  result.workspace = choose(local.workspace, remote.workspace, metadataFor(leftMeta, "workspace/main"), metadataFor(rightMeta, "workspace/main"));
  result.feeConfig = local.feeConfig && remote.feeConfig ? choose(local.feeConfig, remote.feeConfig, metadataFor(leftMeta, "feeConfig/main"), metadataFor(rightMeta, "feeConfig/main")) : local.feeConfig ?? remote.feeConfig;
  rebuildDerivedState(result);
  return { snapshot: result, metadata };
}
