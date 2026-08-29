type DidNotPlayPlayer = { player: string };
type NotYetEligiblePlayer = { player: string; matchesPlayed: number; gamesNeeded?: number };

export function NotYetEligibleSection({ players }: { players: NotYetEligiblePlayer[] }) {
  if (!players.length) return null;
  return <section data-testid="not-yet-eligible-section" className="border-t border-[var(--line)] bg-[#fffaf5]">
    <div className="border-b border-[var(--line)] px-4 py-3"><h3 className="font-semibold">Not yet eligible</h3><p className="mt-1 text-xs text-[var(--muted)]">Players need 5 completed games to enter the prize rankings.</p></div>
    <ul>{players.map((player) => <li key={player.player} className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 text-sm last:border-0"><span>{player.player}</span><span className="text-xs font-semibold text-[var(--muted)]">{player.matchesPlayed}/5 games</span></li>)}</ul>
  </section>;
}

export function DidNotPlaySection({ players }: { players: DidNotPlayPlayer[] }) {
  if (!players.length) return null;
  return <section data-testid="did-not-play-section" className="border-t border-[var(--line)] bg-[#fbfdfb]">
    <div className="border-b border-[var(--line)] px-4 py-3">
      <h3 className="font-semibold">Did not play</h3>
    </div>
    <ul>{players.map((player) => <li key={player.player} className="border-b border-[var(--line)] px-4 py-3 text-sm last:border-0">{player.player}</li>)}</ul>
  </section>;
}
