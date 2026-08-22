"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock3, Trophy } from "lucide-react";
import { api, type PublicRankingPayload } from "@/lib/api";
import { Badge, Card, LoadingState } from "@/components/ui";

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "These public rankings are no longer available.";
}

export default function PublicRankingsPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const rankingsQuery = useQuery<PublicRankingPayload>({ queryKey: ["publicRankings", token], queryFn: () => api.publicRankings(token), enabled: Boolean(token), retry: false, refetchInterval: (query) => query.state.data?.state === "LIVE" ? 8_000 : false });
  const data = rankingsQuery.data;

  if (rankingsQuery.isPending) return <LoadingState variant="fullPage" label="Loading public rankings" />;
  if (rankingsQuery.isError || !data) return <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-5 py-10"><Card className="max-w-md p-7 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#fff0e4] text-[#a74646]"><Trophy size={22} /></div><h1 className="display mt-5 text-3xl">Rankings unavailable</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{errorText(rankingsQuery.error)}</p></Card></main>;

  return <main className="min-h-screen bg-[var(--paper)] px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-3xl"><header className="mb-7"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-[var(--teal)] text-white"><Activity size={21} /></div><div><p className="text-sm font-bold">Shuttle Queue</p><p className="text-xs text-[var(--muted)]">Public session rankings</p></div><span className="ml-auto"><Badge tone={data.state === "LIVE" ? "teal" : "gray"}>{data.state === "LIVE" ? "Live" : "Final"}</Badge></span></div><h1 className="display mt-7 text-4xl sm:text-5xl">Results that stay useful.</h1><p className="mt-2 text-sm text-[var(--muted)]">Session started {formatDate(data.sessionStartedAt)}{data.sessionEndedAt ? ` · ended ${formatDate(data.sessionEndedAt)}` : ""}</p></header><Card className="overflow-hidden p-0"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#fbfdfb] px-4 py-3 text-xs text-[var(--muted)]"><span className="inline-flex items-center gap-1.5"><Clock3 size={14} /> Last published {formatDate(data.lastUpdatedAt)}</span><span>{data.state === "LIVE" ? "Refreshes automatically" : "Final standings"}</span></div>{data.rankings.length === 0 ? <div className="p-8 text-center text-sm text-[var(--muted)]">No players have joined this queue yet.</div> : <div>{data.rankings.map((row) => <div key={`${row.rank}-${row.player}`} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-4 last:border-0 sm:gap-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#edf8f4] text-sm font-bold text-[var(--teal)]">{row.rank}</span><div className="min-w-0 flex-1"><p className="truncate font-semibold">{row.player}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{row.matchesPlayed} games · {row.wins}W / {row.losses}L</p></div><div className="hidden text-right sm:block"><p className="font-semibold">{row.pointsFor}–{row.pointsAgainst}</p><p className="text-xs text-[var(--muted)]">points</p></div><div className="text-right"><p className="font-semibold">{(row.winRateBasisPoints / 100).toFixed(0)}%</p><p className="text-xs text-[var(--muted)]">win rate</p></div></div>)}</div>}</Card><p className="mt-5 text-center text-xs leading-5 text-[var(--muted)]">This read-only page is shared by the Queue Master. It contains ranking statistics only.</p><p className="mt-2 text-center text-xs text-[var(--muted)]">Created by: LindeDrive PH: Jean Benedict Gaela</p></div></main>;
}
