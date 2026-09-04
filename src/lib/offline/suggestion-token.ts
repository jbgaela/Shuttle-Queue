export const VALID_MATCHMAKING_MODES = ["OPEN", "SAME_SKILL", "BALANCED", "SAME_GENDER", "MIXED_DOUBLES", "GUIDED", "UNDEFEATED_CHALLENGE"] as const;

type LocalSuggestionPayload = {
  algorithmVersion: string;
  revision: number;
  mode: (typeof VALID_MATCHMAKING_MODES)[number];
  strengthGap?: 1 | 2 | 3;
  key: string;
  teamA: [string] | [string, string];
  teamB: [string] | [string, string];
  expiresAt: number;
};

const staleError = () => new Error("SUGGESTION_STALE: Generate a new suggestion.");

export function decodeLocalSuggestion(value: string): LocalSuggestionPayload {
  if (!value.startsWith("local:")) throw staleError();
  try {
    const parsed: unknown = JSON.parse(atob(value.slice(6)));
    if (!parsed || typeof parsed !== "object") throw new Error();
    const payload = parsed as Record<string, unknown>;
    const allowedKeys = new Set(["algorithmVersion", "revision", "mode", "strengthGap", "key", "teamA", "teamB", "expiresAt"]);
    if (Object.keys(payload).some((key) => !allowedKeys.has(key))) throw new Error();
    if (typeof payload.algorithmVersion !== "string" || payload.algorithmVersion.length === 0 || typeof payload.mode !== "string" || !Array.isArray(payload.teamA) || !Array.isArray(payload.teamB) || typeof payload.key !== "string" || payload.key.length < 3 || typeof payload.revision !== "number" || !Number.isInteger(payload.revision) || payload.revision < 0 || typeof payload.expiresAt !== "number" || !Number.isInteger(payload.expiresAt) || payload.expiresAt <= 0 || payload.expiresAt < Date.now()) throw new Error();
    if (![1, 2].includes(payload.teamA.length) || payload.teamA.length !== payload.teamB.length || payload.teamA.some((id) => typeof id !== "string" || id.length === 0) || payload.teamB.some((id) => typeof id !== "string" || id.length === 0)) throw new Error();
    const teamA = payload.teamA as string[];
    const teamB = payload.teamB as string[];
    const lineupIds = [...teamA, ...teamB];
    if (new Set(lineupIds).size !== lineupIds.length) throw new Error();
    const expectedKey = `${[...teamA].sort().join(",")}|${[...teamB].sort().join(",")}`;
    if (payload.key !== expectedKey) throw new Error();
    if (!(VALID_MATCHMAKING_MODES as readonly string[]).includes(payload.mode)) throw new Error();
    if (payload.mode === "BALANCED" && !(typeof payload.strengthGap === "number" && Number.isInteger(payload.strengthGap) && [1, 2, 3].includes(payload.strengthGap))) throw new Error();
    if (payload.mode !== "BALANCED" && payload.strengthGap !== undefined) throw new Error();
    return {
      algorithmVersion: payload.algorithmVersion,
      revision: payload.revision,
      mode: payload.mode as LocalSuggestionPayload["mode"],
      ...(payload.strengthGap === undefined ? {} : { strengthGap: payload.strengthGap as 1 | 2 | 3 }),
      key: payload.key,
      teamA: teamA as LocalSuggestionPayload["teamA"],
      teamB: teamB as LocalSuggestionPayload["teamB"],
      expiresAt: payload.expiresAt,
    };
  } catch {
    throw staleError();
  }
}

export function persistedSuggestionKey(payload: { key?: unknown } | null, encodedToken?: string | null) {
  return typeof payload?.key === "string" ? payload.key : encodedToken ?? null;
}
