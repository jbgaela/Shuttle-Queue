"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, Clock3, Download, Trophy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, type PublicRankingMatch, type PublicRankingPayload, type PublicRankingRow } from "@/lib/api";
import { Badge, Button, Card, LoadingState } from "@/components/ui";
import { DidNotPlaySection } from "@/components/did-not-play";
import { partitionPublicRankingRows } from "@/lib/ranking-presentation";
import { saveRankingsToDevice } from "@/lib/rankings-image";

function formatDate(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatHistoryDuration(seconds: number | null) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "Duration unavailable";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "These public rankings are no longer available.";
}

function sessionMetadata(data: PublicRankingPayload) {
  const start = data.firstMatchStartedAt
    ? `Session started ${formatDate(data.firstMatchStartedAt)}`
    : data.state === "LIVE" ? "Session start: Waiting for first match" : null;
  const ended = data.sessionEndedAt ? `ended ${formatDate(data.sessionEndedAt)}` : null;
  return [start, ended].filter((value): value is string => Boolean(value)).join(" · ");
}

function HistoryMatchEntry({ match }: { match: PublicRankingMatch }) {
  return <article className="border-b border-[var(--line)] px-4 py-3 last:border-0"><div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]"><Badge tone={match.result === "WIN" ? "teal" : "gray"}>{match.result === "WIN" ? "Win" : "Loss"}</Badge><span>{formatDate(match.completedAt)}</span></div><div className="mt-2 grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3"><div className={`min-w-0 break-words ${match.winnerTeam === "A" ? "font-semibold text-[var(--teal)]" : "font-semibold"}`}><span className="mr-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">A</span>{match.teamA.join(" + ") || "Team unavailable"}</div><span className="text-xs font-semibold text-[var(--muted)]">vs</span><div className={`min-w-0 break-words ${match.winnerTeam === "B" ? "font-semibold text-[var(--teal)] sm:text-right" : "font-semibold sm:text-right"}`}><span className="mr-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">B</span>{match.teamB.join(" + ") || "Team unavailable"}</div></div>{match.games.length ? <div className="mt-2 flex flex-wrap gap-1.5">{match.games.map((game) => <span key={`${match.matchKey}-${game.gameNumber}`} className="rounded-lg bg-[#f1f7f3] px-2 py-1 text-xs font-semibold text-[var(--ink)]">Game {game.gameNumber}: {game.teamAScore}-{game.teamBScore}</span>)}</div> : <p className="mt-2 text-xs text-[var(--muted)]">Score unavailable</p>}</article>;
}

function PublicRankingPlayerRow({ token, row, historyAvailable, live, expanded, onToggle }: { token: string; row: PublicRankingRow; historyAvailable: boolean; live: boolean; expanded: boolean; onToggle: () => void }) {
  const canExpand = historyAvailable && Boolean(row.playerKey) && row.matchesPlayed > 0;
  const panelId = `public-ranking-history-${row.playerKey ?? row.rank}`;
  const historyQuery = useQuery({ queryKey: ["publicRankingPlayerHistory", token, row.playerKey], queryFn: () => api.publicRankingPlayerHistory(token, row.playerKey as string), enabled: canExpand && expanded, retry: false, refetchInterval: expanded && live ? 8_000 : false });
  const panel = historyQuery.isPending && !historyQuery.data
    ? <div className="space-y-2 p-4"><div className="h-4 animate-pulse rounded bg-[#edf3ef]" /><div className="h-4 w-3/4 animate-pulse rounded bg-[#edf3ef]" /><div className="h-4 w-1/2 animate-pulse rounded bg-[#edf3ef]" /></div>
    : historyQuery.isError
      ? <div className="flex flex-wrap items-center justify-between gap-3 p-4"><p role="alert" className="text-sm text-[#8d4824]">{errorText(historyQuery.error)}</p><button type="button" className="focus-ring rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--teal)] hover:bg-[#edf8f4]" onClick={() => void historyQuery.refetch()}>Try again</button></div>
      : !historyQuery.data
        ? <p className="p-4 text-sm text-[var(--muted)]">No completed matches for this player yet.</p>
        : <div>
          <div data-testid="public-ranking-history-stats" className="grid gap-2 border-b border-[var(--line)] p-4 sm:grid-cols-3">
            <div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Avg duration</p><p className="mt-1 font-semibold">{formatHistoryDuration(historyQuery.data.stats.averageDurationSeconds)}</p></div>
            <div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Top partner</p><p className="mt-1 break-words font-semibold" title={historyQuery.data.stats.mostPlayedPartner?.displayName}>{historyQuery.data.stats.mostPlayedPartner ? `${historyQuery.data.stats.mostPlayedPartner.displayName} (${historyQuery.data.stats.mostPlayedPartner.count})` : "—"}</p></div>
            <div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Top opponent</p><p className="mt-1 break-words font-semibold" title={historyQuery.data.stats.mostPlayedOpponent?.displayName}>{historyQuery.data.stats.mostPlayedOpponent ? `${historyQuery.data.stats.mostPlayedOpponent.displayName} (${historyQuery.data.stats.mostPlayedOpponent.count})` : "—"}</p></div>
          </div>
          {historyQuery.data.matches.length ? <div className="max-h-[28rem] overflow-y-auto">{historyQuery.data.matches.map((match) => <HistoryMatchEntry key={match.matchKey} match={match} />)}</div> : <p className="p-4 text-sm text-[var(--muted)]">No completed matches for this player yet.</p>}
        </div>;

  const rankTone = row.rank === 1 ? "bg-[#fff0c8] text-[#8d5a16]" : row.rank === 2 ? "bg-[#e6eef0] text-[#516b70]" : row.rank === 3 ? "bg-[#f3dfca] text-[#98633c]" : "bg-[#edf8f4] text-[var(--teal)]";
  const provisional = row.matchesPlayed < 5 || row.eligible === false;
  const rowContent = <><span className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold ${rankTone}`}>{row.rank}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{row.player}{provisional ? <span className="ml-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Provisional</span> : row.isPrizePosition ? <span className="ml-2 text-xs font-bold uppercase tracking-[0.1em] text-[#a85b2b]">Prize</span> : null}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{row.matchesPlayed} games · {row.wins}W / {row.losses}L{provisional ? ` · ${row.gamesNeeded ?? Math.max(0, 5 - row.matchesPlayed)} games to prize` : ""}</span></span><span className="text-right"><span className="block font-semibold">{(row.winRateBasisPoints / 100).toFixed(0)}%</span><span className="block text-xs text-[var(--muted)]">win rate</span></span>{canExpand && <ChevronDown aria-hidden="true" size={18} className={`shrink-0 text-[var(--muted)] transition-transform duration-300 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />}</>;

  return <div className="border-b border-[var(--line)] last:border-0">{canExpand ? <button type="button" className="focus-ring flex w-full items-center gap-3 px-4 py-4 text-left sm:gap-4" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>{rowContent}</button> : <div className="flex w-full items-center gap-3 px-4 py-4 sm:gap-4">{rowContent}</div>} {canExpand && <div id={panelId} aria-hidden={!expanded} inert={!expanded} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden"><div className="border-t border-[var(--line)] bg-[#fbfdfb]">{panel}</div></div></div>}</div>;
}

export default function PublicRankingsPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [expandedPlayerKey, setExpandedPlayerKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rankingsQuery = useQuery<PublicRankingPayload>({ queryKey: ["publicRankings", token], queryFn: () => api.publicRankings(token), enabled: Boolean(token), retry: false, refetchInterval: (query) => query.state.data?.state === "LIVE" ? 8_000 : false });
  const data = rankingsQuery.data;

  if (rankingsQuery.isPending) return <LoadingState variant="fullPage" label="Loading public rankings" />;
  if (rankingsQuery.isError || !data) return <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-5 py-10"><Card className="max-w-md p-7 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#fff0e4] text-[#a74646]"><Trophy size={22} /></div><h1 className="display mt-5 text-3xl">Rankings unavailable</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{errorText(rankingsQuery.error)}</p></Card></main>;
  const metadata = sessionMetadata(data);
  const { ranked, didNotPlay } = partitionPublicRankingRows(data.rankings);
  const save = async () => {
    if (!data.rankings.length || saving) return;
    setSaving(true);
    try {
      await saveRankingsToDevice(data.rankings, new Date(), { variant: "public" });
      toast.success("Rankings saved to your device.");
    } catch (reason) {
      toast.error(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  return <main className="min-h-screen bg-[var(--paper)] px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-3xl"><header className="mb-7"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-[var(--teal)] text-white"><Activity size={21} /></div><div><p className="text-sm font-bold">Shuttle Queue</p><p className="text-xs text-[var(--muted)]">Public session rankings</p></div><span className="ml-auto"><Badge tone={data.state === "LIVE" ? "teal" : "gray"}>{data.state === "LIVE" ? "Live" : "Final"}</Badge></span></div><h1 className="display mt-7 text-4xl sm:text-5xl">LineDrive Afternoon Queue</h1>{metadata && <p className="mt-2 text-sm text-[var(--muted)]">{metadata}</p>}<div className="mt-4 flex justify-end"><Button variant="quiet" className="px-3" disabled={!data.rankings.length || saving} loading={saving} onClick={() => void save()}><Download size={16} /> {saving ? "Saving…" : "Save to device"}</Button></div></header><Card className="overflow-hidden p-0"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#fbfdfb] px-4 py-3 text-xs text-[var(--muted)]"><span className="inline-flex items-center gap-1.5"><Clock3 size={14} /> Last published {formatDate(data.lastUpdatedAt)}</span><span>{data.state === "LIVE" ? "Refreshes automatically" : "Final standings"}</span></div><p className="border-b border-[var(--line)] bg-[#fbfdfb] px-4 py-2 text-xs text-[var(--muted)]">Live rankings start after 1 completed game; players become prize-eligible after 5.</p>{data.state === "FINAL" && !data.historyAvailable && <p className="border-b border-[var(--line)] bg-[#fffaf5] px-4 py-3 text-xs leading-5 text-[#8d4824]">Match history is not available for this older shared session.</p>}{data.rankings.length === 0 ? <div className="p-8 text-center text-sm text-[var(--muted)]">No players have joined this queue yet.</div> : <><div>{ranked.map((row) => { const rowKey = row.playerKey ?? `${row.rank}-${row.player}`; return <PublicRankingPlayerRow key={rowKey} token={token} row={row} historyAvailable={data.historyAvailable} live={data.state === "LIVE"} expanded={expandedPlayerKey === rowKey} onToggle={() => setExpandedPlayerKey((current) => current === rowKey ? null : rowKey)} />; })}</div><DidNotPlaySection players={didNotPlay} variant="compact" /></>}</Card><p className="mt-5 text-center text-xs leading-5 text-[var(--muted)]">This read-only page is shared by the Queue Master. It contains ranking statistics only.</p><p className="mt-2 text-center text-xs text-[var(--muted)]">Created by: LindeDrive PH: Jean Benedict Gaela & Jendii</p></div></main>;
}
