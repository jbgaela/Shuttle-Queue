"use client";
import Link from "next/link";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, RefreshCw } from "lucide-react";
import { api, onAuthRequired, type RankingLocationStatus, type RankingTrackingLink } from "@/lib/api";
import { Button, Card, LoadingState, Select } from "@/components/ui";

export const rankingLocationLabels: Record<RankingLocationStatus, string> = { PENDING: "Awaiting location", GRANTED: "Location granted", DENIED: "Denied", TIMEOUT: "Timed out", UNAVAILABLE: "Unavailable" };
const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "2-digit", day: "2-digit", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
export function trackingDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : dateFormat.format(date); }
export function trackingTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : timeFormat.format(date); }
const linkState = (link: RankingTrackingLink) => link.revokedAt ? "Revoked" : link.publication.finalizedAt ? "Final" : "Live";
const linkClass = "focus-ring inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--teal)] hover:bg-[#edf8f4]";

export function TrackRankingLink({ linkId }: { linkId: string | undefined }) {
  return linkId ? <Link prefetch={false} className={linkClass} href={`/rankings/tracking/${encodeURIComponent(linkId)}`}><Eye size={15} aria-hidden="true" />Track</Link> : null;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="p-4"><p role="alert" className="text-sm text-[#8d4824]">{message}</p><Button variant="quiet" className="mt-3" onClick={retry}>Try again</Button></div>; }
function TrackingPagination({ cursors, setCursors, nextCursor }: { cursors: string[]; setCursors: (value: string[]) => void; nextCursor: string | null }) {
  return <nav aria-label="Tracking pagination" className="flex items-center justify-between gap-3 border-t border-[var(--line)] p-4"><Button variant="quiet" disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</Button><span className="text-sm">Page {cursors.length + 1}</span><Button variant="quiet" disabled={!nextCursor} onClick={() => { if (nextCursor) setCursors([...cursors, nextCursor]); }}>Next</Button></nav>;
}

export function RankingTrackingBoundary({ children }: { children: (user: { id: string; role: string }) => ReactNode }) {
  const queryClient = useQueryClient();
  const [blocked, setBlocked] = useState(false);
  const auth = useQuery({ queryKey: ["rankingTrackingAuth"], queryFn: api.me, staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: "always" });
  useEffect(() => {
    const clear = () => { void queryClient.cancelQueries({ queryKey: ["rankingTracking"] }); queryClient.removeQueries({ queryKey: ["rankingTracking"] }); };
    const refresh = () => { setBlocked(false); clear(); void queryClient.resetQueries({ queryKey: ["rankingTrackingAuth"] }); };
    const unsubscribe = onAuthRequired(() => { setBlocked(true); clear(); });
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("ranking-tracking-auth") : null;
    if (channel) channel.onmessage = refresh;
    window.addEventListener("storage", refresh);
    window.addEventListener("offline", refresh);
    return () => { unsubscribe(); channel?.close(); window.removeEventListener("storage", refresh); window.removeEventListener("offline", refresh); clear(); };
  }, [queryClient]);
  if (auth.isFetching) return <LoadingState variant="fullPage" label="Checking tracking access" />;
  if (blocked || auth.isError || !auth.data || auth.fetchStatus === "paused") return <main className="mx-auto max-w-xl p-6"><Card><h1 className="display text-3xl">Tracking access required</h1><p role="alert" className="mt-3 text-sm">{auth.fetchStatus === "paused" ? "Connect to the internet to view private tracking records." : auth.error?.message ?? "Sign in to view tracking records."}</p><Link prefetch={false} className={`${linkClass} mt-4`} href="/">Go to sign in</Link><Button variant="quiet" onClick={() => { setBlocked(false); void auth.refetch(); }}>Retry</Button></Card></main>;
  return children(auth.data.user);
}

export function RankingTrackingLinks({ accountId, ownerKey = "owner" }: { accountId?: string | undefined; ownerKey?: string }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const query = useQuery({ queryKey: ["rankingTracking", ownerKey, "links", accountId, cursors.at(-1)], queryFn: () => api.rankingTrackingLinks(cursors.at(-1), accountId), retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  return <Card className="overflow-hidden p-0"><div className="flex flex-wrap items-center justify-between gap-3 p-5"><h2 className="display text-2xl">Link tracking history</h2><Button variant="quiet" loading={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} aria-hidden="true" />Refresh</Button></div>{query.fetchStatus === "paused" ? <p role="alert" className="p-5">Connect to the internet to view tracking history.</p> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : query.isPending ? <LoadingState label="Loading shared links" /> : <><div className="divide-y divide-[var(--line)]">{query.data.items.length ? query.data.items.map((link) => <div key={link.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="font-semibold">{linkState(link)} · Session {trackingDate(link.publication.sessionStartedAt)}</p><p className="mt-1 text-xs text-[var(--muted)]">Published {trackingDate(link.issuedAt)} {trackingTime(link.issuedAt)} · Asia/Manila</p></div><TrackRankingLink linkId={link.id} /></div>) : <p className="p-5 text-sm text-[var(--muted)]">No shared links yet.</p>}</div><TrackingPagination cursors={cursors} setCursors={setCursors} nextCursor={query.data.nextCursor} /></>}</Card>;
}

export function RankingTrackingTable({ linkId, ownerKey }: { linkId: string; ownerKey: string }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [status, setStatus] = useState<RankingLocationStatus | "">("");
  const query = useQuery({ queryKey: ["rankingTracking", ownerKey, linkId, status, cursors.at(-1)], queryFn: () => api.rankingTrackingVisits(linkId, cursors.at(-1), status || undefined), retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const link = query.data?.link;
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6"><Link prefetch={false} className={linkClass} href="/?tab=rankings"><ArrowLeft size={16} aria-hidden="true" />Back to Rankings</Link><header><h1 className="display text-4xl">Shared link visits</h1>{link && <p className="mt-3 text-sm">{linkState(link)} · Session {trackingDate(link.publication.sessionStartedAt)} · Published {trackingDate(link.issuedAt)} {trackingTime(link.issuedAt)}</p>}<p className="mt-2 text-sm text-[var(--muted)]">Asia/Manila · UTC+08:00. Visit details are retained for 90 days. These records describe visits, not verified identities.</p></header><div className="flex flex-wrap items-end justify-between gap-4"><label className="text-sm font-semibold">Location status<Select className="mt-2" value={status} onChange={(event) => { setStatus(event.target.value as RankingLocationStatus | ""); setCursors([]); }}><option value="">All statuses</option>{Object.entries(rankingLocationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label><Button variant="quiet" loading={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={16} aria-hidden="true" />Refresh</Button></div><Card className="overflow-hidden p-0">{query.fetchStatus === "paused" ? <p role="alert" className="p-5">Connect to the internet to view private tracking records.</p> : query.isError ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : query.isPending ? <LoadingState label="Loading visits" /> : <><div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Visit records"><table className="w-full min-w-[1000px] text-left text-sm"><caption className="sr-only">Visits to this shared ranking link, newest first. Times use Asia/Manila.</caption><thead className="border-b border-[var(--line)] bg-[#f1f7f3]"><tr>{["Date", "Time", "Device", "IP address", "Approximate location", "Browser location", "Access status"].map((title) => <th key={title} scope="col" className="px-4 py-3 font-semibold">{title}</th>)}</tr></thead><tbody className="divide-y divide-[var(--line)]">{query.data.items.map((visit) => <tr key={visit.id}><td className="whitespace-nowrap px-4 py-4">{trackingDate(visit.openedAt)}</td><td className="whitespace-nowrap px-4 py-4">{trackingTime(visit.openedAt)}</td><td className="px-4 py-4"><span className="capitalize">{visit.device || "Unknown"}</span><span className="mt-1 block text-xs text-[var(--muted)]">{visit.browser || "Unknown"}<br />{visit.operatingSystem || "Unknown"}</span></td><td className="max-w-48 break-all px-4 py-4 font-mono text-xs">{visit.ipAddress || "Unknown"}</td><td className="px-4 py-4">{[visit.city, visit.region, visit.country].filter(Boolean).join(", ") || "Unknown"}<span className="mt-1 block text-xs text-[var(--muted)]">IP-based estimate</span></td><td className="px-4 py-4">{typeof visit.latitude === "number" && typeof visit.longitude === "number" ? <>{visit.latitude.toFixed(6)}, {visit.longitude.toFixed(6)}<span className="mt-1 block text-xs text-[var(--muted)]">Reported accuracy: {visit.accuracy ?? "Unknown"} m</span></> : "Not provided"}</td><td className="px-4 py-4">{rankingLocationLabels[visit.locationStatus] ?? "Unknown"}</td></tr>)}</tbody></table></div>{!query.data.items.length && <p className="p-6 text-center text-sm text-[var(--muted)]">No recorded visits match this view within the last 90 days.</p>}<TrackingPagination cursors={cursors} setCursors={setCursors} nextCursor={query.data.nextCursor} /></>}</Card></main>;
}
