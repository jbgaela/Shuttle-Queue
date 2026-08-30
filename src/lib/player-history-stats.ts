import type { FrequentPlayer, HistoryMatch, PlayerHistoryStats } from "./api";

type HistorySummary = Pick<PlayerHistoryStats, "averageDurationSeconds" | "mostPlayedPartner" | "mostPlayedOpponent">;

function chooseFrequentPlayer(counts: Map<string, FrequentPlayer>) {
  return [...counts.values()].sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName) || left.queuePlayerId.localeCompare(right.queuePlayerId))[0] ?? null;
}

export function playerHistoryStats(matches: HistoryMatch[], queuePlayerId: string): HistorySummary {
  const durations: number[] = [];
  const partners = new Map<string, FrequentPlayer>();
  const opponents = new Map<string, FrequentPlayer>();
  const increment = (counts: Map<string, FrequentPlayer>, participant: HistoryMatch["participants"][number]) => {
    const current = counts.get(participant.queuePlayerId);
    counts.set(participant.queuePlayerId, {
      queuePlayerId: participant.queuePlayerId,
      sessionPlayerId: participant.sessionPlayerId ?? participant.queuePlayerId,
      displayName: participant.displayName,
      count: (current?.count ?? 0) + 1,
    });
  };

  for (const match of matches) {
    const selected = match.participants.find((participant) => participant.queuePlayerId === queuePlayerId);
    if (!selected) continue;
    if (typeof match.durationSeconds === "number" && Number.isFinite(match.durationSeconds)) durations.push(Math.max(0, match.durationSeconds));
    for (const participant of match.participants) {
      if (participant.queuePlayerId === queuePlayerId) continue;
      increment(participant.team === selected.team ? partners : opponents, participant);
    }
  }

  return {
    averageDurationSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    mostPlayedPartner: chooseFrequentPlayer(partners),
    mostPlayedOpponent: chooseFrequentPlayer(opponents),
  };
}
