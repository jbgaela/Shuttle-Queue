import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Public rankings | Shuttle Queue",
  description: "Live rankings for a Shuttle Queue session.",
  robots: { index: false, follow: false },
};

export default function PublicRankingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
