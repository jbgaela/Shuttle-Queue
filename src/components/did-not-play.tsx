type DidNotPlayPlayer = { player: string };
type NotYetEligiblePlayer = { player: string; matchesPlayed: number; gamesNeeded?: number };

export function NotYetEligibleSection({ players }: { players: NotYetEligiblePlayer[] }) {
  if (!players.length) return null;
  return <section data-testid="not-yet-eligible-section" className="border-t border-[var(--line)] bg-[#fffaf5]">
    <div className="border-b border-[var(--line)] px-4 py-3"><h3 className="font-semibold">Not yet eligible</h3><p className="mt-1 text-xs text-[var(--muted)]">Players need 5 completed games to enter the prize rankings.</p></div>
    <ul>{players.map((player) => <li key={player.player} className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 text-sm last:border-0"><span>{player.player}</span><span className="text-xs font-semibold text-[var(--muted)]">{player.matchesPlayed}/5 games</span></li>)}</ul>
  </section>;
}

export function DidNotPlaySection({ players, variant = "default" }: { players: DidNotPlayPlayer[]; variant?: "default" | "compact" }) {
  if (!players.length) return null;
  if (variant === "compact") {
    return <section data-testid="did-not-play-section" className="border-t border-[var(--line)] bg-[#f5f8f6]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3"><h3 className="font-semibold">Did not play</h3><span aria-label={`${players.length} players did not play`} className="rounded-full bg-[#e4eeea] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">{players.length}</span></div>
      <ul className="flex flex-wrap gap-2 px-4 py-4">{players.map((player) => <li key={player.player} className="rounded-full border border-[#d7e6df] bg-white px-3 py-1.5 text-sm font-medium text-[var(--ink)] shadow-[0_1px_2px_rgba(16,42,45,0.05)]">{player.player}</li>)}</ul>
    </section>;
  }
  return <section data-testid="did-not-play-section" className="border-t border-[var(--line)] bg-[#fbfdfb]">
    <div className="border-b border-[var(--line)] px-4 py-3">
      <h3 className="font-semibold">Did not play</h3>
    </div>
    <ul>{players.map((player) => <li key={player.player} className="border-b border-[var(--line)] px-4 py-3 text-sm last:border-0">{player.player}</li>)}</ul>
  </section>;
}
