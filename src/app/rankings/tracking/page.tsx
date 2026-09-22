"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RankingTrackingBoundary, RankingTrackingLinks } from "@/components/ranking-tracking";
import { LoadingState } from "@/components/ui";

function LinksPage() {
  const params = useSearchParams();
  const accountId = params.get("accountId") || undefined;
  return <RankingTrackingBoundary>{(user) => <main className="mx-auto max-w-4xl space-y-5 p-5 sm:p-8"><Link prefetch={false} className="focus-ring inline-block rounded-xl p-2 text-sm font-semibold text-[var(--teal)]" href="/?tab=rankings">Back to Rankings</Link><h1 className="display text-4xl">Shared links</h1>{accountId && accountId !== user.id && user.role !== "SUPER_ADMIN" ? <p role="alert">Tracking link not found.</p> : <RankingTrackingLinks key={`${user.id}:${accountId ?? "self"}`} ownerKey={user.id} accountId={accountId} />}</main>}</RankingTrackingBoundary>;
}
export default function TrackingLinksPage() { return <Suspense fallback={<LoadingState variant="fullPage" label="Loading tracking" />}><LinksPage /></Suspense>; }
