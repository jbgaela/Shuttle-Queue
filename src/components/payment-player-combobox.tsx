"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui";
import { filterFeePlayerOptions, sortFeePlayerOptions, type FeePlayerSearchOption } from "@/lib/fee-player-options";

type PaymentPlayerComboboxProps = {
  players: readonly FeePlayerSearchOption[];
  selectedId: string;
  currency: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onInputEdit: () => void;
};

function formatOutstanding(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(amountMinor / 100);
}

export function PaymentPlayerCombobox({ players, selectedId, currency, disabled = false, onSelect, onInputEdit }: PaymentPlayerComboboxProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionIdPrefix = `${listId}-option`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const editingRef = useRef(false);
  const sortedPlayers = useMemo(() => sortFeePlayerOptions(players), [players]);
  const filteredPlayers = useMemo(() => filterFeePlayerOptions(sortedPlayers, query), [query, sortedPlayers]);
  const selectedPlayer = sortedPlayers.find((player) => player.id === selectedId);

  useEffect(() => {
    if (editingRef.current) {
      editingRef.current = false;
      return;
    }
    setQuery(selectedPlayer?.displayName ?? "");
  }, [selectedPlayer?.displayName, selectedId]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choose = (player: FeePlayerSearchOption) => {
    editingRef.current = false;
    setQuery(player.displayName);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(player.id);
  };

  const editQuery = (value: string) => {
    editingRef.current = true;
    setQuery(value);
    setOpen(true);
    setActiveIndex(-1);
    if (selectedId) onInputEdit();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (!filteredPlayers.length) return -1;
        const safeCurrent = current >= 0 && current < filteredPlayers.length ? current : -1;
        return (safeCurrent + 1) % filteredPlayers.length;
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (!filteredPlayers.length) return -1;
        const safeCurrent = current >= 0 && current < filteredPlayers.length ? current : 0;
        return safeCurrent <= 0 ? filteredPlayers.length - 1 : safeCurrent - 1;
      });
    } else if (event.key === "Enter" && open && activeIndex >= 0 && activeIndex < filteredPlayers.length && filteredPlayers[activeIndex]) {
      event.preventDefault();
      choose(filteredPlayers[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const visibleActiveIndex = activeIndex >= 0 && activeIndex < filteredPlayers.length ? activeIndex : -1;
  const activeOption = visibleActiveIndex >= 0 ? filteredPlayers[visibleActiveIndex] : undefined;
  return <div ref={rootRef} className="relative mt-1">
    <div className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => editQuery(event.target.value)}
        onFocus={() => { setOpen(true); setActiveIndex(-1); }}
        onKeyDown={handleKeyDown}
        placeholder="Search or select a player"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeOption ? `${optionIdPrefix}-${activeOption.id}` : undefined}
        aria-label="Player"
        autoComplete="off"
        disabled={disabled}
      />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={open ? "Close player list" : "Open player list"} className="focus-ring absolute right-1 top-1 grid size-10 place-items-center rounded-xl text-[var(--muted)]" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) { setOpen(false); } else { setOpen(true); inputRef.current?.focus(); } }}><ChevronDown size={17} aria-hidden="true" className={open ? "rotate-180 transition" : "transition"} /></button>
    </div>
    {open && <div id={listId} role="listbox" aria-label="Payable players" className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-[var(--line)] bg-white p-1.5 shadow-xl">
      {filteredPlayers.length ? filteredPlayers.map((player, index) => <button key={player.id} id={`${optionIdPrefix}-${player.id}`} type="button" role="option" aria-selected={player.id === selectedId} className={`focus-ring flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm ${index === visibleActiveIndex ? "bg-[#edf8f4]" : "hover:bg-[#f7faf8]"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(player)}><span className="min-w-0 truncate font-semibold">{player.displayName}</span><span className="shrink-0 text-xs text-[var(--muted)]">due {formatOutstanding(player.outstandingMinor, currency)}</span></button>) : <p className="px-3 py-3 text-sm text-[var(--muted)]">No matching players.</p>}
    </div>}
  </div>;
}
