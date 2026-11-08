import type { CloudSnapshotV2 } from "./index.js";

export type SyncChoice = { choice: "local" | "cloud" | "rename"; name?: string };
export type SyncConflict = {
  key: string;
  collection: string;
  id: string;
  field: string;
  local: unknown;
  cloud: unknown;
  kind: "edit" | "identity" | "session";
};
export type SyncChoices = Record<string, SyncChoice>;
type Row = Record<string, any>;
const copy = <T>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const normalized = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const ignored = new Set([
  "version",
  "matchesPlayed",
  "wins",
  "losses",
  "pointsFor",
  "pointsAgainst",
  "lastMatchEndedAt",
  "amountDueMinor",
  "skillWeight",
]);
const comparable = (row: any): any =>
  row && typeof row === "object" && !Array.isArray(row)
    ? Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => !ignored.has(key))
          .sort(([a], [b]) => a.localeCompare(b)),
      )
    : row;

/** Three-way merge before clock-based normalization. Missing baselines are conservative. */
export function reviewSyncSnapshots(
  local: CloudSnapshotV2,
  cloud: CloudSnapshotV2,
  base?: CloudSnapshotV2,
  choices: SyncChoices = {},
) {
  const snapshot = copy(cloud);
  const conflicts: SyncConflict[] = [];
  const select = (
    collection: string,
    id: string,
    field: string,
    left: any,
    right: any,
    previous: any,
    kind: SyncConflict["kind"] = "edit",
  ) => {
    if (equal(comparable(left), comparable(right))) return copy(right);
    if (base && equal(comparable(left), comparable(previous))) return copy(right);
    if (base && equal(comparable(right), comparable(previous))) return copy(left);
    const key = `${collection}/${id}/${field}`;
    const selected = choices[key];
    if (selected?.choice === "local") return copy(left);
    if (selected?.choice === "cloud") return copy(right);
    conflicts.push({ key, collection, id, field, local: left ?? null, cloud: right ?? null, kind });
    return copy(right);
  };
  const collections = [
    "players",
    "queuePlayers",
    "courts",
    "matches",
    "payments",
    "audits",
    "synergyTeams",
  ] as const;
  for (const collection of collections) {
    const left = new Map<string, Row>((local[collection] ?? []).map((row) => [row.id, row]));
    const right = new Map<string, Row>((cloud[collection] ?? []).map((row) => [row.id, row]));
    const previous = new Map<string, Row>((base?.[collection] ?? []).map((row) => [row.id, row]));
    const rows: Row[] = [];
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id),
        b = right.get(id),
        old = previous.get(id);
      let row: Row | undefined;
      if ((!base && (!a || !b)) || (collection === "audits" && !old)) row = copy(a ?? b);
      else if (collection === "players" && a && b && old) {
        row = { ...b };
        for (const field of Object.keys({ ...a, ...b })) {
          if (!ignored.has(field))
            row[field] = select(collection, id, field, a[field], b[field], old[field]);
        }
      } else row = select(collection, id, "$record", a, b, old);
      if (row) rows.push(row);
    }
    (snapshot as any)[collection] = rows;
  }
  for (const collection of ["settings", "workspace", "feeConfig"] as const) {
    const a = local[collection] as Row | null,
      b = cloud[collection] as Row | null,
      old = base?.[collection] as Row | null | undefined;
    if (collection === "settings" && a && b && old) {
      const result = { ...b };
      for (const field of Object.keys({ ...a, ...b }))
        if (!ignored.has(field))
          result[field] = select(collection, "main", field, a[field], b[field], old[field]);
      (snapshot as any)[collection] = result;
    } else
      (snapshot as any)[collection] = select(
        collection,
        "main",
        "$record",
        a,
        b,
        old,
        collection === "workspace" ? "session" : "edit",
      );
  }
  const playerRemap = new Map<string, string>();
  const courtRemap = new Map<string, string>();
  for (const collection of ["players", "courts"] as const) {
    const remap = collection === "players" ? playerRemap : courtRemap;
    const field = collection === "players" ? "displayName" : "name";
    const rows = snapshot[collection] as unknown as Row[];
    const cloudIds = new Set(cloud[collection].map((row) => row.id));
    const claimed = new Map<string, Row>();
    for (const row of rows
      .slice()
      .sort(
        (a, b) =>
          Number(cloudIds.has(b.id)) - Number(cloudIds.has(a.id)) || a.id.localeCompare(b.id),
      )) {
      const identity = normalized(row[field]);
      const existing = claimed.get(identity);
      if (!existing) {
        claimed.set(identity, row);
        continue;
      }
      const key = `${collection}/${row.id}/$identity`;
      const resolution = choices[key];
      if (resolution?.choice === "cloud") {
        remap.set(row.id, existing.id);
        continue;
      }
      const name = resolution?.choice === "rename" ? resolution.name?.trim() : undefined;
      if (
        name &&
        name.length <= (collection === "players" ? 80 : 60) &&
        !claimed.has(normalized(name)) &&
        !rows.some((other) => other.id !== row.id && normalized(other[field]) === normalized(name))
      ) {
        row[field] = name;
        if (collection === "courts") row.normalizedName = normalized(name);
        claimed.set(normalized(name), row);
      } else
        conflicts.push({
          key,
          collection,
          id: row.id,
          field,
          local: row,
          cloud: existing,
          kind: "identity",
        });
    }
    (snapshot as any)[collection] = rows.filter((row) => !remap.has(row.id));
  }
  for (const row of snapshot.queuePlayers)
    row.playerId = playerRemap.get(row.playerId) ?? row.playerId;
  const queueRemap = new Map<string, string>();
  const queueByPlayer = new Map<string, string>();
  const cloudQueueIds = new Set(cloud.queuePlayers.map((row) => row.id));
  for (const row of snapshot.queuePlayers
    .slice()
    .sort((a, b) => Number(cloudQueueIds.has(b.id)) - Number(cloudQueueIds.has(a.id)))) {
    const existing = queueByPlayer.get(row.playerId);
    if (existing) {
      const key = `queuePlayers/${row.id}/$identity`;
      if (choices[key]?.choice === "cloud" || [...playerRemap.values()].includes(row.playerId))
        queueRemap.set(row.id, existing);
      else
        conflicts.push({
          key,
          collection: "queuePlayers",
          id: row.id,
          field: "playerId",
          local: row,
          cloud: snapshot.queuePlayers.find((item) => item.id === existing),
          kind: "identity",
        });
    } else queueByPlayer.set(row.playerId, row.id);
  }
  snapshot.queuePlayers = snapshot.queuePlayers.filter((row) => !queueRemap.has(row.id));
  for (const match of snapshot.matches) {
    match.courtId = match.courtId ? (courtRemap.get(match.courtId) ?? match.courtId) : null;
    for (const participant of match.participants)
      participant.queuePlayerId =
        queueRemap.get(participant.queuePlayerId) ?? participant.queuePlayerId;
  }
  for (const payment of snapshot.payments)
    payment.queuePlayerId = queueRemap.get(payment.queuePlayerId) ?? payment.queuePlayerId;
  for (const team of snapshot.synergyTeams ?? [])
    team.queuePlayerIds = team.queuePlayerIds.map((id) => queueRemap.get(id) ?? id) as [
      string,
      string,
    ];
  const cloudTeamIds = new Set((cloud.synergyTeams ?? []).map((team) => team.id));
  const keptTeams: NonNullable<CloudSnapshotV2["synergyTeams"]> = [];
  for (const team of (snapshot.synergyTeams ?? [])
    .slice()
    .sort((a, b) => Number(cloudTeamIds.has(b.id)) - Number(cloudTeamIds.has(a.id)))) {
    const overlaps = keptTeams.filter((other) =>
      other.queuePlayerIds.some((id) => team.queuePlayerIds.includes(id)),
    );
    if (!overlaps.length) {
      keptTeams.push(team);
      continue;
    }
    const key = `synergyTeams/${team.id}/$membership`;
    if (choices[key]?.choice === "local") {
      for (const other of overlaps) keptTeams.splice(keptTeams.indexOf(other), 1);
      keptTeams.push(team);
    } else if (choices[key]?.choice !== "cloud") {
      conflicts.push({
        key,
        collection: "synergyTeams",
        id: team.id,
        field: "queuePlayerIds",
        local: team,
        cloud: overlaps,
        kind: "edit",
      });
    }
  }
  snapshot.synergyTeams = keptTeams;
  return { snapshot, conflicts };
}
