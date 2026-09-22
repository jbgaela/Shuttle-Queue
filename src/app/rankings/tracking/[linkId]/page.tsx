"use client";
import { useParams } from "next/navigation";
import { RankingTrackingBoundary, RankingTrackingTable } from "@/components/ranking-tracking";

export default function TrackingPage() {
  const { linkId } = useParams<{ linkId: string }>();
  return <RankingTrackingBoundary>{(user) => <RankingTrackingTable key={`${user.id}:${linkId}`} linkId={linkId} ownerKey={user.id} />}</RankingTrackingBoundary>;
}
