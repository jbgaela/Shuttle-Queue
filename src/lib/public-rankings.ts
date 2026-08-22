import type { PublicRankingPublication, PublicRankingPublicationResponse } from "./api";

const emptyPublicRankingPublications: PublicRankingPublicationResponse = { current: null, archives: [] };

export function visiblePublicRankingPublication(response: PublicRankingPublicationResponse | undefined, optimistic: PublicRankingPublication | null): PublicRankingPublication | null {
  return response?.current ?? optimistic;
}

export function publishedPublicRankingState(previous: PublicRankingPublicationResponse | undefined, publication: PublicRankingPublication): PublicRankingPublicationResponse {
  const current = previous ?? emptyPublicRankingPublications;
  return {
    current: publication,
    archives: current.archives.filter((item) => item.id !== publication.id),
  };
}

export function revokedPublicRankingState(previous: PublicRankingPublicationResponse | undefined, publication: PublicRankingPublication): PublicRankingPublicationResponse {
  const current = previous ?? emptyPublicRankingPublications;
  return {
    current: current.current?.id === publication.id ? null : current.current,
    archives: current.archives.filter((item) => item.id !== publication.id),
  };
}
