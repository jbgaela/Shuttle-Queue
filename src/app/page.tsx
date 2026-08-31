"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Filter,
  History as HistoryIcon,
  KeyRound,
  LogOut,
  MapPinned,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Trash2,
  UsersRound,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { api, ApiError, onAuthRequired, setPublicSharingActive, type AccountRole, type AccountSummary, type Court, type FeeSummary, type HistoryMatch, type Match, type Payment, type PaymentMethod, type Player, type PlayerDeletionPreview, type PlayerHistoryResponse, type PublicRankingPublication, type PublicRankingPublicationResponse, type QueuePlayer, type QueueState, type Ranking, type SessionPlayer, type SessionSummary, type Suggestion, type SuggestionNoMatchCode, type SynergyTeam } from "@/lib/api";
import { Badge, Button as UiButton, Card, Input, LoadingState, Select } from "@/components/ui";
import { clearAccountData, confirmLocalReplacement, currentAccountId, downloadFromCloud, getMeta, hasSnapshot, retainedProfile, saveProfile, storageEstimate, syncAccount, type SyncPreview } from "@/lib/offline/repository";
import { liveCourtStatusLabel, participantSkillLabel, playerGenderLabel } from "@/lib/live-court";
import { PlayerGenderIcon } from "@/components/player-gender-icon";
import { DidNotPlaySection } from "@/components/did-not-play";
import { hasPlayerNameConflict } from "@/lib/player-names";
import { saveRankingsToDevice } from "@/lib/rankings-image";
import { partitionRankingRows } from "@/lib/ranking-presentation";
import { publishedPublicRankingState, revokedPublicRankingState, visiblePublicRankingPublication } from "@/lib/public-rankings";
import { lowSkillLoneFemaleAdvisory, validateMixedDoublesLineup } from "@/lib/offline/domain-compat";
import { isQueuePlayerReady, matchmakingWaitingFingerprint } from "@/lib/matchmaking-scope";

const PAGE_SIZE = 15;
const MAX_PLAYER_ADD_BATCH = 100;
const QUEUE_TABLE_GRID_COLUMNS = "md:grid-cols-[minmax(140px,1.4fr)_70px_76px_56px_68px_84px_152px]";
const SKILLS = ["NEWBIE", "BEGINNER", "UPPER_BEGINNER", "INTERMEDIATE", "UPPER_INTERMEDIATE", "ADVANCED"];

const Button = UiButton;
const PLAYER_NAME_CONFLICT_MESSAGE = "A player with this name has already been created or is already in the current queue.";
const tabLabels = { live: "Live", queue: "Queue", players: "Players", history: "History", rankings: "Rankings", fees: "Fees", settings: "Settings" } as const;
type Tab = keyof typeof tabLabels;
type QueueFilter = "ALL" | "WAITING" | "RESTING" | "INACTIVE" | "QUEUED" | "PLAYING";
type AuthUser = { id: string; username: string; role: AccountRole };
type FeePaymentFilter = "ALL" | PaymentMethod;
const FEE_PAYMENT_FILTERS: Array<[string, FeePaymentFilter]> = [["All", "ALL"], ["Cash", "CASH"], ["E-wallet", "EWALLET"], ["Other", "OTHER"]];
const EMPTY_PAYMENTS: Payment[] = [];
const EMPTY_PLAYERS: Player[] = [];
const feePlayerId = (player: FeeSummary["players"][number]) => player.sessionPlayerId ?? player.queuePlayerId;

function paymentFilterLabel(value: PaymentMethod) {
  return value === "EWALLET" ? "E-wallet" : value === "CASH" ? "Cash" : "Other";
}

function pretty(value: string) {
  return value.toLowerCase().split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function formatMoney(amountMinor: number, currency = "PHP") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(amountMinor / 100);
}

function playerDetails(player: Pick<QueuePlayer, "gender" | "skillLevel"> & Pick<QueuePlayer, "latePenaltyState">) {
  const gender = player.gender === "MALE" ? "Male" : player.gender === "FEMALE" ? "Female" : "Gender unavailable";
  const skill = player.skillLevel ? pretty(player.skillLevel) : "Skill unavailable";
  if (player.latePenaltyState === "PENDING") return `${gender} - ${skill} - Late priority pending`;
  return `${gender} · ${skill}`;
}

function prohibitedGeneratedGenderLineup(teamA: SessionPlayer[], teamB: SessionPlayer[]) {
  return teamA.length === 2 && teamB.length === 2
    && ((teamA.every((player) => player.gender === "FEMALE") && teamB.every((player) => player.gender === "MALE"))
      || (teamA.every((player) => player.gender === "MALE") && teamB.every((player) => player.gender === "FEMALE")));
}

function balancedLineupError(teamA: SessionPlayer[], teamB: SessionPlayer[], gap: number) {
  const players = [...teamA, ...teamB];
  if (players.length !== 4) return null;
  const spread = Math.max(...players.map(strengthValue)) - Math.min(...players.map(strengthValue));
  if (spread > gap) return `Handicap matchups require a player strength spread of at most ${gap}.`;
  const difference = Math.abs(teamA.reduce((sum, player) => sum + strengthValue(player), 0) - teamB.reduce((sum, player) => sum + strengthValue(player), 0));
  if (difference !== gap) return `Handicap matchups require team strength totals to differ by exactly ${gap}.`;
  return null;
}

function handicapAdvantageLabel(teamATotal: number, teamBTotal: number) {
  const difference = Math.abs(teamATotal - teamBTotal);
  if (difference === 0) return null;
  return `${teamATotal > teamBTotal ? "Team A" : "Team B"} +${difference} strength advantage`;
}

function rotationMessage(suggestion: Suggestion) {
  if (suggestion.explanation?.cycleRestarted) return "All alternatives were reviewed; showing the best available lineup again.";
  if (suggestion.explanation?.lateArrival?.preferenceApplied && (suggestion.explanation.lateArrival.selectedPending ?? 0) > 0) return "On-time players were prioritized; a pending late-arrival player was needed to complete this lineup.";
  if (suggestion.explanation?.lateArrival?.preferenceApplied) return "On-time players were prioritized over pending late-arrival penalties.";
  if (suggestion.explanation?.fairness?.manualOverride) return "Queue Master priority applied; rotation remains active for the remaining players.";
  const penalties = suggestion.explanation?.repeatPenalties;
  if (penalties?.recentPairCount === 0) return "Fresh opponents selected.";
  if (penalties?.recentPartnerRepeats === 0) return "Recent repeats considered; partners rotated where balance allows.";
  return "Best handicap lineup under the current rotation constraints.";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function isAuthRequired(error: unknown) {
  return error instanceof ApiError && error.status === 401 && error.code === "AUTH_REQUIRED";
}

function isOfflineFallbackError(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500;
}

function statusTone(status: string): "teal" | "orange" | "gray" {
  if (["WAITING", "AVAILABLE", "ACTIVE"].includes(status)) return "teal";
  if (["PLAYING", "OCCUPIED", "QUEUED"].includes(status)) return "orange";
  return "gray";
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{pretty(status)}</Badge>;
}

function LatePenaltyBadge({ state }: { state?: QueuePlayer["latePenaltyState"] }) {
  if (state !== "PENDING") return null;
  return <Badge tone="orange">Late priority pending</Badge>;
}

function useRefreshInterval(enabled: boolean) {
  return enabled ? 8000 : false;
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: async () => {
      const result = await api.login(username.trim(), password);
      const verified = await api.me();
      if (verified.user.id !== result.user.id) throw new Error("The signed-in account could not be verified.");
      return { user: verified.user };
    },
    onSuccess: (result) => { try { window.sessionStorage.removeItem("shuttle-queue-offline-signed-out"); } catch { /* ignore storage cleanup failures */ } onLoggedIn(result.user); toast.success("Welcome back."); },
  });
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <Card className="w-full max-w-md p-7 sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-[var(--teal)] text-white"><Zap size={23} /></div>
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--teal)]">Shuttle Queue</p><h1 className="display text-3xl">Badminton Queueing System</h1></div>
        </div>
        <p className="mb-7 text-sm leading-6 text-[var(--muted)]">By: LineDrive PH: Jean Benedict Gaela & Jendii</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); login.mutate(); }}>
          <label className="block text-sm font-semibold">Username<Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label className="block text-sm font-semibold">Password<Input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" type="password" required /></label>
          {login.isError && <p className="rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{isAuthRequired(login.error) ? "The server could not verify this login session. Check your connection and try again." : errorMessage(login.error)}</p>}
          <Button type="submit" className="w-full" loading={login.isPending}>Sign in</Button>
        </form>
      </Card>
    </main>
  );
}

function SessionReauthenticationGate({ user, onAuthenticated, onSignOut }: { user: AuthUser; onAuthenticated: (user: AuthUser) => void; onSignOut: () => void }) {
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: async () => {
      const result = await api.login(user.username, password);
      const verified = await api.me();
      if (verified.user.id !== user.id || result.user.id !== user.id) throw new Error("Sign in with the current account to continue.");
      return verified.user;
    },
    onSuccess: (verified) => { setPassword(""); onAuthenticated(verified); toast.success("Session restored."); },
  });
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl sm:mx-auto sm:max-w-md sm:rounded-3xl"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#fff0e4] text-[#a74646]"><AlertTriangle size={20} /></div><div><h2 id="session-dialog-title" className="font-semibold">Sign in to continue</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Your server session expired. Your downloaded queue and pending local changes are still safe; sign in to sync and continue.</p></div></div><form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); login.mutate(); }}><label className="block text-sm font-semibold">Username<Input value={user.username} readOnly autoComplete="username" /></label><label className="block text-sm font-semibold">Password<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus /></label>{login.isError && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{isAuthRequired(login.error) ? "The new session could not be verified. Please try again." : errorMessage(login.error)}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="quiet" type="button" onClick={onSignOut} disabled={login.isPending}>Sign out</Button><Button type="submit" loading={login.isPending}>Sign in and continue</Button></div></form></div></div>;
}

function LogoutDialog({ pending, onKeep, onRemove, onClose }: { pending: boolean; onKeep: () => void; onRemove: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, pending]);
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl outline-none sm:mx-auto sm:max-w-md sm:rounded-3xl"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#edf8f4] text-[var(--teal)]"><LogOut size={20} /></div><div><h2 id="logout-dialog-title" className="font-semibold">Sign out of Shuttle Queue?</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Keep downloaded data to preserve pending queue work and continue offline. Remove it only if this is a shared device.</p></div></div><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="quiet" disabled={pending} onClick={onClose}>Cancel</Button><Button variant="quiet" disabled={pending} onClick={onKeep}>Sign out and keep data</Button><Button variant="danger" loading={pending} onClick={onRemove}>Remove data and sign out</Button></div></div></div>;
}

function OfflineBootstrap({ user, onLogout, onSessionRequired }: { user: AuthUser; onLogout: () => void; onSessionRequired: () => void }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onAuthRequired(() => onSessionRequired()), [onSessionRequired]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await saveProfile({ accountId: user.id, username: user.username, role: user.role, updatedAt: new Date().toISOString() });
      try { await syncAccount(user.id); queryClient.invalidateQueries(); } catch (reason) {
        if (isAuthRequired(reason)) onSessionRequired();
        else if (!(await hasSnapshot(user.id))) { if (!cancelled) setError(errorMessage(reason)); return; }
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [user, queryClient, onSessionRequired]);
  useEffect(() => {
    const attempt = () => {
      if (!navigator.onLine) return;
      void syncAccount(user.id).then(() => queryClient.invalidateQueries()).catch((reason) => { if (isAuthRequired(reason)) onSessionRequired(); });
    };
    const onVisible = () => { if (document.visibilityState === "visible") attempt(); };
    window.addEventListener("online", attempt); document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(attempt, 60_000);
    return () => { window.removeEventListener("online", attempt); document.removeEventListener("visibilitychange", onVisible); window.clearInterval(timer); };
  }, [user.id, queryClient, onSessionRequired]);
  useEffect(() => {
    let shared = false;
    let cancelled = false;
    const publishSync = async () => {
      if (!navigator.onLine) return;
      try {
        const publications = await api.publicRankingPublications();
        shared = Boolean(publications.current);
        setPublicSharingActive(shared);
        if (shared) await syncAccount(user.id, "background");
      } catch { /* the normal sync/status panel reports connectivity problems */ }
      if (!cancelled && shared) queryClient.invalidateQueries();
    };
    let timer: number | undefined;
    const schedule = () => { if (!cancelled) timer = window.setTimeout(async () => { await publishSync(); schedule(); }, shared ? 8_000 : 30_000); };
    const onSharing = () => { void publishSync().then(schedule); };
    void publishSync().then(schedule);
    window.addEventListener("shuttle-queue-public-sharing", onSharing);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener("shuttle-queue-public-sharing", onSharing); };
  }, [user.id, queryClient]);
  if (error) return <main className="grid min-h-screen place-items-center px-5"><Card className="max-w-md p-6"><h1 className="display text-3xl">Download required</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Sign in once while online to download this account for offline use.</p><p role="alert" className="mt-4 rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{error}</p><Button className="mt-5 w-full" onClick={() => window.location.reload()}>Try again</Button></Card></main>;
  if (!ready) return <LoadingState variant="fullPage" label="Preparing your offline workspace" />;
  return <AppShell user={user} onLogout={onLogout} />;
}

function EmptyState({ icon: Icon = CircleDot, title, body, action }: { icon?: typeof CircleDot; title: string; body: string; action?: React.ReactNode }) {
  return <div className="grid place-items-center rounded-3xl border border-dashed border-[var(--line)] bg-[#fbfdfb] px-6 py-12 text-center"><Icon className="mb-3 text-[var(--teal)]" size={28} /><h3 className="font-semibold">{title}</h3><p className="mt-1 max-w-sm text-sm text-[var(--muted)]">{body}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

function DestructiveConfirmDialog({ title, body, confirmLabel, pending, error, secondaryLabel, onSecondary, onConfirm, onClose }: { title: string; body: string; confirmLabel: string; pending: boolean; error?: unknown; secondaryLabel?: string; onSecondary?: () => void; onConfirm: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, pending]);
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="danger-dialog-title" className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl outline-none sm:mx-auto sm:max-w-md sm:rounded-3xl"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#fff0e4] text-[#a74646]"><AlertTriangle aria-hidden="true" size={20} /></div><div className="min-w-0"><h2 id="danger-dialog-title" className="font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p></div></div>{error !== undefined && error !== null && <p role="alert" className="mt-4 rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{errorMessage(error)}</p>}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="quiet" className="min-h-11" disabled={pending} onClick={onClose}>Cancel</Button>{secondaryLabel && <Button variant="quiet" className="min-h-11" disabled={pending} onClick={onSecondary}>{secondaryLabel}</Button>}<Button variant="danger" className="min-h-11" loading={pending} disabled={pending} onClick={onConfirm}>{confirmLabel}</Button></div></div></div>;
}
function LoneFemaleWarningIcon({ advisory }: { advisory: NonNullable<Match["matchupAdvisory"]> }) {
  const [open, setOpen] = useState(false);
  const tooltipId = `lone-female-warning-${advisory.queuePlayerId}`;
  useEffect(() => {
    if (!open) return undefined;
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [open]);
  const message = `${advisory.displayName} is the only female player and is listed as ${pretty(advisory.skillLevel)}. Confirm she is comfortable playing against the all-male pair before starting.`;
  return <span className="group relative inline-flex shrink-0 align-middle">
    <button type="button" className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[#b96b32] hover:bg-[#fff0e4]" aria-label={`Player preference warning for ${advisory.displayName}`} aria-expanded={open} aria-describedby={open ? tooltipId : undefined} title={message} onClick={() => setOpen((current) => !current)}><AlertTriangle aria-hidden="true" size={15} /></button>
    <span id={tooltipId} role="tooltip" aria-hidden={!open} className={`pointer-events-none absolute left-0 top-full z-20 mt-1 w-64 rounded-xl bg-[#102a2d] px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-xl transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>{message}</span>
  </span>;
}

function MatchupAdvisoryDialog({ advisory, teamA, teamB, queued, pending, error, onConfirm, onEdit, onAlternative, onDiscard, onClose }: { advisory: NonNullable<Match["matchupAdvisory"]>; teamA: string; teamB: string; queued: boolean; pending: boolean; error?: unknown; onConfirm: () => void; onEdit: () => void; onAlternative: () => void; onDiscard?: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, pending]);
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="matchup-advisory-title" aria-describedby="matchup-advisory-description" className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl outline-none sm:mx-auto sm:max-w-lg sm:rounded-3xl">
    <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#fff0e4] text-[#b96b32]"><AlertTriangle aria-hidden="true" size={20} /></div><div className="min-w-0"><h2 id="matchup-advisory-title" className="font-semibold">Check with {advisory.displayName} before starting</h2><p id="matchup-advisory-description" className="mt-2 text-sm leading-6 text-[var(--muted)]">{advisory.displayName} is a {pretty(advisory.skillLevel)} and the only female player in this matchup. Only continue after she agrees to play against the all-male pair.</p></div><Button variant="quiet" className="ml-auto shrink-0 px-3" aria-label="Close player preference check" onClick={onClose} disabled={pending}><X size={18} /></Button></div>
     <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="min-w-0 rounded-2xl bg-[#edf8f4] p-3"><p className="text-xs font-bold uppercase text-[var(--teal)]">Team A</p><p className="mt-1 break-words font-semibold">{teamA}</p></div><div className="min-w-0 rounded-2xl bg-[#fff4ec] p-3"><p className="text-xs font-bold uppercase text-[#a85b2b]">Team B</p><p className="mt-1 break-words font-semibold">{teamB}</p></div></div>
    {error !== undefined && error !== null && <p role="alert" className="mt-4 rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{errorMessage(error)}</p>}
     <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end"><Button className="min-h-11" variant="quiet" disabled={pending} onClick={onClose}>Back</Button><Button className="min-h-11" variant="quiet" disabled={pending} onClick={onEdit}>Edit lineup</Button>{queued ? <Button className="min-h-11" variant="danger" disabled={pending} onClick={onDiscard}>Discard matchup</Button> : <Button className="min-h-11" variant="quiet" disabled={pending} onClick={onAlternative}>Try another lineup</Button>}<Button className="min-h-11 sm:ml-auto" loading={pending} onClick={onConfirm}>{advisory.displayName} accepts — Start match</Button></div>
  </div></div>;
}

type ManualAdvisoryRequest = { advisory: NonNullable<Match["matchupAdvisory"]>; teamA: string; teamB: string; confirm: () => void };

function ManualAdvisoryHost() {
  const [request, setRequest] = useState<ManualAdvisoryRequest | null>(null);
  useEffect(() => {
    const listener = (event: Event) => setRequest((event as CustomEvent<ManualAdvisoryRequest>).detail);
    window.addEventListener("queue-manual-advisory", listener);
    return () => window.removeEventListener("queue-manual-advisory", listener);
  }, []);
  if (!request) return null;
  return <MatchupAdvisoryDialog advisory={request.advisory} teamA={request.teamA} teamB={request.teamB} queued={false} pending={false} onConfirm={() => { request.confirm(); setRequest(null); }} onEdit={() => setRequest(null)} onAlternative={() => setRequest(null)} onClose={() => setRequest(null)} />;
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const change = useMutation({ mutationFn: () => api.changePassword(currentPassword, newPassword), onSuccess: () => { toast.success("Password changed."); onClose(); } });
  const valid = newPassword.length >= 8 && newPassword === confirmation;
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl sm:mx-auto sm:max-w-md sm:rounded-3xl"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#edf8f4] text-[var(--teal)]"><KeyRound size={20} /></div><div><h2 id="password-dialog-title" className="font-semibold">Change password</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Use at least 8 characters. Passwords are never sent by email.</p></div></div><form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); change.mutate(); }}><label className="block text-sm font-semibold">Current password<Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="block text-sm font-semibold">New password<Input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label className="block text-sm font-semibold">Confirm new password<Input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>{confirmation && newPassword !== confirmation && <p role="alert" className="text-sm text-[#8d4824]">Passwords do not match.</p>}{change.isError && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(change.error)}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="quiet" onClick={onClose} disabled={change.isPending}>Cancel</Button><Button type="submit" disabled={!valid || change.isPending}>{change.isPending ? "Saving…" : "Change password"}</Button></div></form></div></div>;
}

function AccountDeleteDialog({ account, preview, pending, error, onConfirm, onClose }: { account: AccountSummary; preview: Awaited<ReturnType<typeof api.accountDeletionPreview>>; pending: boolean; error?: unknown; onConfirm: (confirmationUsername: string, currentPassword: string) => void; onClose: () => void }) {
  const [confirmationUsername, setConfirmationUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const deletion = preview.deletion;
  const valid = confirmationUsername === account.username && currentPassword.length > 0;
  return <div className="fixed inset-0 z-50 grid items-end overflow-y-auto bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div role="dialog" aria-modal="true" aria-labelledby="account-delete-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl sm:mx-auto sm:max-w-lg sm:rounded-3xl"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#fff0e4] text-[#a74646]"><Trash2 size={20} /></div><div><h2 id="account-delete-title" className="font-semibold">Delete {account.username} permanently?</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">This cannot be undone. The account must already be disabled.</p></div></div><div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{[["Sessions", deletion.sessionCount], ["Players", deletion.playerCount], ["Matches", deletion.matchCount], ["Payments", deletion.paymentCount]].map(([label, value]) => <div key={label} className="rounded-2xl bg-[#f7faf8] p-3"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div><form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) onConfirm(confirmationUsername, currentPassword); }}><label className="block text-sm font-semibold">Type <span className="font-mono">{account.username}</span> to confirm<Input value={confirmationUsername} onChange={(event) => setConfirmationUsername(event.target.value)} autoComplete="off" required /></label><label className="block text-sm font-semibold">Your Super Admin password<Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>{error !== undefined && error !== null && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(error)}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="quiet" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" variant="danger" disabled={!valid || pending}>{pending ? "Deleting…" : "Delete permanently"}</Button></div></form></div></div>;
}

function AccountResetDialog({ account, pending, error, onConfirm, onClose }: { account: AccountSummary; pending: boolean; error?: unknown; onConfirm: (password: string) => void; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const valid = password.length >= 8 && password === confirmation;
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div role="dialog" aria-modal="true" aria-labelledby="account-reset-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl sm:mx-auto sm:max-w-md sm:rounded-3xl"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#edf8f4] text-[var(--teal)]"><KeyRound size={20} /></div><div><h2 id="account-reset-title" className="font-semibold">Reset {account.username}’s password</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Share this new permanent password with the account owner out of band.</p></div></div><form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) onConfirm(password); }}><label className="block text-sm font-semibold">New password<Input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="block text-sm font-semibold">Confirm password<Input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>{confirmation && password !== confirmation && <p role="alert" className="text-sm text-[#8d4824]">Passwords do not match.</p>}{error !== undefined && error !== null && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(error)}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="quiet" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={!valid || pending}>{pending ? "Resetting…" : "Reset password"}</Button></div></form></div></div>;
}

function accountRoleLabel(role: AccountRole) { return role === "SUPER_ADMIN" ? "Super Admin" : "Queue Master"; }

function AccountManagementView({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({ queryKey: ["adminAccounts"], queryFn: api.adminAccounts, retry: false });
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [role, setRole] = useState<AccountRole>("QUEUE_MASTER");
  const [resetTarget, setResetTarget] = useState<AccountSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ account: AccountSummary; preview: Awaited<ReturnType<typeof api.accountDeletionPreview>> } | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  const create = useMutation({ mutationFn: () => api.createAccount({ username: username.trim(), password, role }), onSuccess: () => { setUsername(""); setPassword(""); setPasswordConfirmation(""); queryClient.invalidateQueries({ queryKey: ["adminAccounts"] }); toast.success("Account created. Share the password securely."); } });
  const update = useMutation({ mutationFn: (input: { account: AccountSummary; body: { role?: AccountRole | "ACTIVE" | "DISABLED"; status?: "ACTIVE" | "DISABLED" } }) => { const body = input.body.role === "ACTIVE" || input.body.role === "DISABLED" ? { status: input.body.role } : input.body.role ? { role: input.body.role } : input.body.status ? { status: input.body.status } : {}; return api.updateAccount(input.account.id, body, input.account.version); }, onSuccess: (_value, input) => { queryClient.invalidateQueries({ queryKey: ["adminAccounts"] }); toast.success(`${input.account.username} updated.`); } });
  const reset = useMutation({ mutationFn: (input: { account: AccountSummary; password: string }) => api.resetAccountPassword(input.account.id, input.password, input.account.version), onSuccess: () => { setResetTarget(null); queryClient.invalidateQueries({ queryKey: ["adminAccounts"] }); toast.success("Password reset. Share it securely."); } });
  const remove = useMutation({ mutationFn: (input: { account: AccountSummary; confirmationUsername: string; currentPassword: string }) => api.deleteAccount(input.account.id, input.confirmationUsername, input.currentPassword, input.account.version), onSuccess: () => { setDeleteTarget(null); queryClient.invalidateQueries({ queryKey: ["adminAccounts"] }); toast.success("Account and workspace deleted."); } });
  const createValid = username.trim().length > 0 && password.length >= 8 && password === passwordConfirmation && online;
  const openDelete = async (account: AccountSummary) => { setPreviewingId(account.id); try { setDeleteTarget({ account, preview: await api.accountDeletionPreview(account.id) }); } catch (reason) { toast.error(errorMessage(reason)); } finally { setPreviewingId(null); } };
  const accounts = accountsQuery.data ?? [];
  return <div className="space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm text-[var(--muted)]">Super Admin area</p><h2 className="display text-4xl">Manage access.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Create isolated workspaces for Queue Masters and other Super Admins. Passwords are shared manually; no email service is required.</p></div><Badge tone={online ? "teal" : "orange"}>{online ? "Online" : "Online required"}</Badge></div>{!online && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">Account administration is unavailable offline. Existing queue data remains available according to the normal offline rules.</p>}<Card><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-[var(--teal)]" /><h3 className="font-semibold">Create account</h3></div><form className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end" onSubmit={(event) => { event.preventDefault(); if (createValid) create.mutate(); }}><label className="block text-sm font-semibold">Username<Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" maxLength={80} required /></label><label className="block text-sm font-semibold">Password (8+ characters)<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label><label className="block text-sm font-semibold">Role<Select value={role} onChange={(event) => setRole(event.target.value as AccountRole)}><option value="QUEUE_MASTER">Queue Master</option><option value="SUPER_ADMIN">Super Admin</option></Select></label><Button type="submit" loading={create.isPending} disabled={!createValid}>Create account</Button></form><label className="mt-3 block text-sm font-semibold">Confirm password<Input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required /></label>{passwordConfirmation && password !== passwordConfirmation && <p role="alert" className="mt-2 text-sm text-[#8d4824]">Passwords do not match.</p>}{create.isError && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(create.error)}</p>}</Card><Card className="overflow-hidden p-0"><div className="border-b border-[var(--line)] px-5 py-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Accounts</h3><p className="mt-1 text-xs text-[var(--muted)]">{accounts.length} account{accounts.length === 1 ? "" : "s"}. Each workspace is isolated.</p></div><Badge tone="gray">{user.username}</Badge></div></div>{accountsQuery.isPending ? <LoadingState label="Loading accounts" /> : accountsQuery.isError ? <p role="alert" className="p-5 text-sm text-[#8d4824]">{errorMessage(accountsQuery.error)}{!online ? " Connect to the internet and retry." : ""}</p> : accounts.length === 0 ? <p className="p-5 text-sm text-[var(--muted)]">No accounts found.</p> : <div>{accounts.map((account) => { const self = account.id === user.id; const accountUpdating = update.isPending && update.variables?.account.id === account.id; return <div key={account.id} className="border-b border-[var(--line)] p-5 last:border-0"><div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{account.username}</p><Badge tone={account.role === "SUPER_ADMIN" ? "teal" : "gray"}>{accountRoleLabel(account.role)}</Badge><Badge tone={account.status === "ACTIVE" ? "teal" : "orange"}>{account.status === "ACTIVE" ? "Active" : "Disabled"}</Badge>{self && <Badge tone="gray">You</Badge>}</div><p className="mt-2 text-xs text-[var(--muted)]">{account.playerCount} players · {account.sessionCount} sessions · last login {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : "never"}</p></div><div className="flex flex-wrap gap-2"><Button variant="quiet" className="px-3 py-1.5 text-xs" loading={accountUpdating} disabled={self || update.isPending || !online} onClick={() => { const nextRole: AccountRole = account.role === "SUPER_ADMIN" ? "QUEUE_MASTER" : "SUPER_ADMIN"; if (window.confirm(`Change ${account.username} to ${accountRoleLabel(nextRole)}?`)) update.mutate({ account, body: { role: nextRole } }); }}>{account.role === "SUPER_ADMIN" ? "Make Queue Master" : "Make Super Admin"}</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" loading={accountUpdating} disabled={self || update.isPending || !online} onClick={() => { const nextStatus = account.status === "ACTIVE" ? "DISABLED" : "ACTIVE"; if (window.confirm(`${nextStatus === "DISABLED" ? "Disable" : "Enable"} ${account.username}?`)) update.mutate({ account, body: { role: nextStatus } }); }}>{account.status === "ACTIVE" ? "Disable" : "Enable"}</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" loading={reset.isPending && reset.variables?.account.id === account.id} disabled={self || reset.isPending || !online} onClick={() => setResetTarget(account)}><KeyRound size={14} /> Reset password</Button><Button variant="danger" className="px-3 py-1.5 text-xs" loading={previewingId === account.id} disabled={self || account.status !== "DISABLED" || previewingId === account.id || !online} onClick={() => void openDelete(account)}>Delete</Button></div></div></div>; })}</div>}</Card>{resetTarget && <AccountResetDialog account={resetTarget} pending={reset.isPending} error={reset.isError ? reset.error : undefined} onConfirm={(nextPassword) => reset.mutate({ account: resetTarget, password: nextPassword })} onClose={() => { if (!reset.isPending) { setResetTarget(null); reset.reset(); } }} />}{deleteTarget && <AccountDeleteDialog account={deleteTarget.account} preview={deleteTarget.preview} pending={remove.isPending} error={remove.isError ? remove.error : undefined} onConfirm={(confirmationUsername, currentPassword) => remove.mutate({ account: deleteTarget.account, confirmationUsername, currentPassword })} onClose={() => { if (!remove.isPending) { setDeleteTarget(null); remove.reset(); } }} />}</div>;
}

function LiveDuration({ startedAt }: { startedAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const started = startedAt ? new Date(startedAt).getTime() : NaN;
  if (!Number.isFinite(started)) return <span>Just started</span>;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return <span data-testid="live-duration">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

function CourtStatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  const dotClass = tone === "orange" ? "bg-[#a85b2b]" : tone === "teal" ? "bg-[var(--teal)]" : "bg-[var(--muted)]";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone === "orange" ? "bg-[#fff0e4] text-[#a85b2b]" : tone === "teal" ? "bg-[#d8f1eb] text-[var(--teal-dark)]" : "bg-[#edf2f0] text-[var(--muted)]"}`}><span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden="true" />{liveCourtStatusLabel(status)}</span>;
}

function CourtActionsMenu({ court, occupied, onRename, onDelete }: { court: Court; occupied: boolean; onRename: (court: Court) => void; onDelete: (court: Court) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  return <div ref={menuRef} className="relative"><Button variant="quiet" className="size-11 p-0" aria-label={`More actions for ${court.name}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((current) => !current)}><MoreVertical size={17} aria-hidden="true" /></Button>{open && <div role="menu" aria-label={`Actions for ${court.name}`} className="absolute right-0 top-full z-20 mt-2 w-48 rounded-2xl border border-[var(--line)] bg-white p-1.5 shadow-xl"><button type="button" role="menuitem" className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-[var(--ink)] hover:bg-[#edf8f4] disabled:cursor-not-allowed disabled:opacity-50" disabled={occupied} title={occupied ? "Finish the active match before renaming this court" : undefined} onClick={() => { setOpen(false); onRename(court); }}><Pencil size={15} aria-hidden="true" /> Rename court</button><button type="button" role="menuitem" className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-[#a74646] hover:bg-[#fff4ec] disabled:cursor-not-allowed disabled:opacity-50" disabled={occupied} title={occupied ? "Finish the active match before deleting this court" : undefined} onClick={() => { setOpen(false); onDelete(court); }}><Trash2 size={15} aria-hidden="true" /> Delete court</button></div>}</div>;
}

function LiveTeam({ label, participants, tone }: { label: string; participants: Match["participants"]; tone: "teal" | "orange" }) {
  const toneClass = tone === "teal" ? "text-[var(--teal)]" : "text-[#a85b2b]";
  return <div className="live-team-panel min-w-0 rounded-2xl bg-white/80 p-3 text-left"><p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${toneClass}`}>{label}</p><div className="mt-2 divide-y divide-[var(--line)]">{participants.length ? participants.map((participant) => { const genderLabel = playerGenderLabel(participant.gender); return <div key={participant.id ?? participant.queuePlayerId} className="live-team-player grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-start gap-2 py-2 first:pt-0 last:pb-0"><span className="live-team-avatar grid size-8 shrink-0 place-items-center rounded-full bg-[#d8f1eb] text-[var(--teal-dark)]" role="img" aria-label={genderLabel} title={genderLabel}><PlayerGenderIcon gender={participant.gender} size={20} /></span><div className="min-w-0"><p className="live-team-player-name break-words text-sm font-semibold leading-5" title={participant.displayName ?? "Player"}>{participant.displayName ?? "Player"}</p><p className="live-team-player-skill text-xs leading-4 text-[var(--muted)]">{participantSkillLabel(participant.skillLevel)}</p></div></div>; }) : <p className="text-sm font-semibold text-[var(--muted)]">No player</p>}</div></div>;
}

function CourtCard({ court, match, onScore, onCancel, onEdit, onRename, onDelete, disabled = false }: { court: Court; match: Match | undefined; onScore: (match: Match) => void; onCancel: (match: Match) => void; onEdit: (match: Match) => void; onRename: (court: Court) => void; onDelete: (court: Court) => void; disabled?: boolean }) {
  const playing = court.status === "OCCUPIED" && match;
  const teamA = match?.participants.filter((participant) => participant.team === "A").sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)) ?? [];
  const teamB = match?.participants.filter((participant) => participant.team === "B").sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)) ?? [];
  const occupied = court.status === "OCCUPIED" || Boolean(court.currentMatchId);
  return <Card data-testid="live-court-card" data-court-id={court.id} aria-labelledby={`court-${court.id}`} className={`live-court-card relative overflow-visible ${playing ? "border-[var(--teal)]" : ""}`}>
    <div className="live-court-header flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2.5"><MapPinned size={18} className="mt-0.5 shrink-0 text-[var(--teal)]" aria-hidden="true" /><h3 id={`court-${court.id}`} className="live-court-name min-w-0 break-words text-base font-bold leading-5" title={court.name}>{court.name}</h3></div><div className="live-court-status-group flex shrink-0 items-center gap-2"><CourtStatusPill status={court.status} /><CourtActionsMenu court={court} occupied={occupied} onRename={onRename} onDelete={onDelete} /></div></div>
    {playing ? <div className="live-court-playing mt-4">
      <div className="live-court-matchup-panel rounded-2xl bg-[#edf8f4] p-3"><div className="live-court-matchup grid items-start gap-2"><LiveTeam label="Team A" participants={teamA} tone="teal" /><span className="mt-3 self-start justify-self-center rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]" aria-hidden="true">VS</span><LiveTeam label="Team B" participants={teamB} tone="orange" /></div><div className="live-court-meta mt-3 flex items-center justify-center gap-2 border-t border-white/80 pt-3 text-xs font-medium text-[var(--muted)]"><span className="inline-flex items-center gap-2"><Clock3 size={14} aria-hidden="true" /> <LiveDuration startedAt={match.startedAt ?? null} /> elapsed</span>{match.matchmakingMode === "UNDEFEATED_CHALLENGE" && <span className="live-court-challenge-compact rounded-full bg-[#fff0e4] px-2 py-0.5 text-[10px] font-semibold text-[#a85b2b]">Challenge</span>}</div>{match.matchmakingMode === "UNDEFEATED_CHALLENGE" && <div className="live-court-challenge-desktop mt-2 flex justify-center"><Badge tone="orange">Undefeated challenge</Badge></div>}</div>
      <div className="live-court-actions mt-4 grid gap-2"><Button className="w-full min-w-0 px-3" aria-label="Enter final score" disabled={disabled} onClick={() => onScore(match)}><Check size={16} aria-hidden="true" /><span className="live-action-label-full">Enter final score</span><span className="live-action-label-compact">Score</span></Button><Button variant="quiet" className="w-full min-w-0 px-3" aria-label="Edit match" disabled={disabled} onClick={() => onEdit(match)}><Pencil size={16} aria-hidden="true" /><span className="live-action-label-full">Edit match</span><span className="live-action-label-compact">Edit</span></Button><Button variant="quiet" className="w-full min-w-0 border-transparent bg-transparent px-3 text-[#a74646] hover:border-[#f1c5b5] hover:bg-[#fff4ec]" aria-label="Cancel match" disabled={disabled} onClick={() => onCancel(match)}><span className="live-action-label-full">Cancel match</span><span className="live-action-label-compact">Cancel</span></Button></div>
    </div> : <div className="mt-7"><p className="text-sm text-[var(--muted)]">{court.status === "CLOSED" ? "This court is closed." : "Ready for the next match."}</p><div className="mt-4 h-2 rounded-full bg-[#edf2f0]"><div className={`h-full rounded-full ${court.status === "AVAILABLE" ? "w-full bg-[var(--teal)]" : "w-1/4 bg-[#c5d1cc]"}`} /></div></div>}
  </Card>;
}

function ScoreModal({ match, session, onClose, onComplete }: { match: Match; session: SessionSummary; onClose: () => void; onComplete: (games: { teamAScore: number; teamBScore: number }[]) => Promise<void> }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [games, setGames] = useState([{ teamAScore: "", teamBScore: "" }]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const bestOf = session.scoring.bestOf;
  const maximumScore = session.scoring.scoreCap ?? session.scoring.pointsToWin;
  const teamA = match.participants.filter((participant) => participant.team === "A").map((participant) => participant.displayName ?? "Player").join(" & ") || "Team A";
  const teamB = match.participants.filter((participant) => participant.team === "B").map((participant) => participant.displayName ?? "Player").join(" & ") || "Team B";
  useEffect(() => {
    dialogRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
  const winnerPreview = useMemo(() => { let a = 0; let b = 0; games.forEach((game) => { const left = Number(game.teamAScore); const right = Number(game.teamBScore); if (Number.isFinite(left) && Number.isFinite(right) && left !== right) left > right ? a++ : b++; }); return a === b ? "Winner will appear after valid scores" : `${a > b ? teamA : teamB} leads ${Math.max(a, b)}–${Math.min(a, b)}`; }, [games, teamA, teamB]);
  const updateGame = (index: number, field: "teamAScore" | "teamBScore", value: string) => setGames((current) => current.map((game, gameIndex) => gameIndex === index ? { ...game, [field]: value.replace(/[^0-9]/g, "").slice(0, 2) } : game));
  const submit = async () => {
    setError("");
    const parsed = games.map((game) => ({ teamAScore: Number(game.teamAScore), teamBScore: Number(game.teamBScore) }));
    if (parsed.some((game) => !Number.isInteger(game.teamAScore) || !Number.isInteger(game.teamBScore) || game.teamAScore < 0 || game.teamBScore < 0)) { setError("Enter a non-negative score for both teams."); return; }
    if (parsed.some((game) => game.teamAScore === game.teamBScore)) { setError("A game cannot end in a tie."); return; }
    if (parsed.some((game) => game.teamAScore > maximumScore || game.teamBScore > maximumScore)) { setError(`Scores cannot exceed ${maximumScore}.`); return; }
    let aWins = 0; let bWins = 0; for (const game of parsed) game.teamAScore > game.teamBScore ? aWins++ : bWins++;
    const requiredWins = Math.floor(bestOf / 2) + 1;
    if (aWins < requiredWins && bWins < requiredWins) { setError(`Complete the ${bestOf === 3 ? "best-of-3 series" : "match"} before saving.`); return; }
    if (parsed.some((game) => Math.max(game.teamAScore, game.teamBScore) < session.scoring.pointsToWin && Math.max(game.teamAScore, game.teamBScore) !== maximumScore)) { setError(`Scores must reach ${session.scoring.pointsToWin} and win by ${session.scoring.winBy}.`); return; }
    setPending(true); try { await onComplete(parsed); } catch (completionError) { setError(errorMessage(completionError)); } finally { setPending(false); }
  };
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5" role="presentation"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="score-dialog-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:mx-auto sm:max-w-lg sm:rounded-3xl sm:p-7">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--teal)]">Final result</p><h2 id="score-dialog-title" className="display mt-1 text-3xl">Record the score</h2></div><Button variant="quiet" className="px-3" aria-label="Close score dialog" onClick={onClose}><X size={18} /></Button></div>
    <div className="mt-5 rounded-2xl bg-[#edf8f4] p-4"><div className="flex items-center justify-between text-sm font-semibold"><span>{teamA}</span><span className="text-xs text-[var(--muted)]">vs</span><span className="text-right">{teamB}</span></div><p className="mt-2 text-xs text-[var(--muted)]">Race to {session.scoring.pointsToWin}, win by {session.scoring.winBy}, maximum {maximumScore}, best of {bestOf}</p></div>
    <div className="mt-5 space-y-3">{games.map((game, index) => <div key={index} className="rounded-2xl border border-[var(--line)] p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Game {index + 1}</span>{bestOf === 3 && <span className="text-xs text-[var(--muted)]">{index === 0 ? "Required" : "Optional"}</span>}</div><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><Input inputMode="numeric" max={maximumScore} aria-label={`${teamA} game ${index + 1} score`} placeholder="0" value={game.teamAScore} onChange={(event) => updateGame(index, "teamAScore", event.target.value)} /><span className="text-sm text-[var(--muted)]">–</span><Input inputMode="numeric" max={maximumScore} aria-label={`${teamB} game ${index + 1} score`} placeholder="0" value={game.teamBScore} onChange={(event) => updateGame(index, "teamBScore", event.target.value)} /></div></div>)}</div>
    {bestOf === 3 && games.length < 3 && <Button variant="quiet" className="mt-3 w-full" onClick={() => setGames((current) => [...current, { teamAScore: "", teamBScore: "" }])}><Plus size={16} /> Add game</Button>}
    <p className="mt-4 rounded-2xl bg-[#f7faf8] px-4 py-3 text-sm text-[var(--muted)]">{winnerPreview}</p>{error && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{error}</p>}
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="quiet" onClick={onClose}>Keep playing</Button><Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Confirm final score"}</Button></div>
  </div></div>;
}

function RenameCourtDialog({ court, pending, error, onConfirm, onClose }: { court: Court; pending: boolean; error?: unknown; onConfirm: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(court.name);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);
  const valid = name.trim().length > 0 && name.trim().length <= 60 && name.trim() !== court.name;
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="rename-court-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl outline-none sm:mx-auto sm:max-w-md sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Court setup</p><h2 id="rename-court-title" className="display mt-1 text-3xl">Rename court</h2></div><Button variant="quiet" className="px-3" aria-label="Close rename court dialog" onClick={onClose} disabled={pending}><X size={18} /></Button></div><form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) onConfirm(name.trim()); }}><label className="block text-sm font-semibold">Court name<Input aria-label="Court name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus /></label>{name.trim().length > 60 && <p role="alert" className="text-sm text-[#8d4824]">Court names must be 60 characters or fewer.</p>}{error !== undefined && error !== null && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(error)}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="quiet" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={!valid || pending} loading={pending}>Save name</Button></div></form></div></div>;
}

function CourtManagement({ sessionId, courts, onChanged, onRename, onDelete, onBulkDelete }: { sessionId: string; courts: Court[]; onChanged: () => void; onRename: (court: Court) => void; onDelete: (court: Court) => void; onBulkDelete: (statuses: Array<"AVAILABLE" | "CLOSED">) => void }) {
  const [name, setName] = useState("");
  const create = useMutation({ mutationFn: () => api.createCourt(sessionId, name.trim()), onSuccess: () => { setName(""); onChanged(); toast.success("Court added."); } });
  const update = useMutation({ mutationFn: ({ court, status }: { court: Court; status: "AVAILABLE" | "CLOSED" }) => api.updateCourt(sessionId, court, { status }), onSuccess: () => { onChanged(); toast.success("Court updated."); } });
  const openCourts = courts.filter((court) => court.status === "AVAILABLE");
  const closedCourts = courts.filter((court) => court.status === "CLOSED");
  return <Card className="border-dashed"><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">Manage courts</h3><p className="mt-1 text-sm text-[var(--muted)]">Add, rename, or remove courts. Closed courts stay out of matchmaking.</p></div><MapPinned size={20} className="text-[var(--teal)]" /></div><div className="mt-5 flex flex-col gap-2 sm:flex-row"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Court name" aria-label="New court name" /><Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}><Plus size={16} /> Add court</Button></div>{create.isError && <p className="mt-3 text-sm text-[#8d4824]">{errorMessage(create.error)}</p>}<div className="mt-4 grid gap-2 sm:grid-cols-3"><Button variant="danger" className="text-xs" disabled={!openCourts.length} onClick={() => onBulkDelete(["AVAILABLE"])}>Delete all open ({openCourts.length})</Button><Button variant="danger" className="text-xs" disabled={!closedCourts.length} onClick={() => onBulkDelete(["CLOSED"])}>Delete all closed ({closedCourts.length})</Button><Button variant="danger" className="text-xs" disabled={!openCourts.length && !closedCourts.length} onClick={() => onBulkDelete(["AVAILABLE", "CLOSED"])}>Delete open and closed ({openCourts.length + closedCourts.length})</Button></div><div className="mt-4 space-y-2">{courts.map((court) => { const updating = update.isPending && update.variables?.court.id === court.id; const occupied = court.status === "OCCUPIED" || Boolean(court.currentMatchId); return <div key={court.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] px-3 py-2"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold">{court.name}</span><Badge tone={court.status === "CLOSED" ? "gray" : court.status === "OCCUPIED" ? "orange" : "teal"}>{pretty(court.status)}</Badge></div><div className="flex shrink-0 items-center gap-1"><Button variant="quiet" className="px-2 py-1.5" aria-label={`Rename ${court.name}`} title={occupied ? "Finish the active match before editing this court" : `Rename ${court.name}`} disabled={occupied} onClick={() => onRename(court)}><Pencil size={14} /></Button><Button variant="danger" className="px-2 py-1.5" aria-label={`Delete ${court.name}`} title={occupied ? "Finish the active match before deleting this court" : `Delete ${court.name}`} disabled={occupied} onClick={() => onDelete(court)}><Trash2 size={14} /></Button>{!occupied && <Button variant="quiet" className="px-3 py-1.5 text-xs" loading={updating} disabled={update.isPending} onClick={() => update.mutate({ court, status: court.status === "CLOSED" ? "AVAILABLE" : "CLOSED" })}>{court.status === "CLOSED" ? "Open" : "Close"}</Button>}</div></div>; })}</div></Card>;
}

function lockedPartner(players: SessionPlayer[], playerId: string) {
  const player = players.find((candidate) => candidate.id === playerId);
  return player?.synergyTeamId ? players.find((candidate) => candidate.synergyTeamId === player.synergyTeamId && candidate.id !== player.id) : undefined;
}

function replaceLockedSelection(current: string[], index: number, value: string, players: SessionPlayer[]) {
  const selected = players.find((player) => player.id === value);
  const previous = players.find((player) => player.id === current[index]);
  const otherIndex = index === 0 ? 1 : 0;
  const previousPartner = previous ? lockedPartner(players, previous.id) : undefined;
  const selectedPartner = selected ? lockedPartner(players, selected.id) : undefined;
  if (previous?.synergyTeamId && !selected?.synergyTeamId) return current;
  if (selected?.synergyTeamId) {
    const otherTeamId = current[otherIndex] ? players.find((player) => player.id === current[otherIndex])?.synergyTeamId : undefined;
    if (!selectedPartner || (otherTeamId && otherTeamId !== selected.synergyTeamId && otherTeamId !== previous?.synergyTeamId)) return current;
    const next = [...current];
    next[index] = selected.id;
    next[otherIndex] = selectedPartner.id;
    return next;
  }
  if (previousPartner && current[otherIndex] !== previousPartner.id) return current;
  const next = [...current];
  next[index] = value;
  return next;
}

function hasCompleteLockedSelection(teamA: string[], teamB: string[], players: SessionPlayer[]) {
  const selected = new Set([...teamA, ...teamB]);
  return [...selected].every((id) => {
    const partner = lockedPartner(players, id);
    return !partner || (selected.has(partner.id) && (teamA.includes(id) === teamA.includes(partner.id)));
  });
}

function QueuedMatchEditDialog({ match, players, pending, error, onConfirm, onClose }: { match: Match; players: SessionPlayer[]; pending: boolean; error?: unknown; onConfirm: (teamA: string[], teamB: string[]) => void; onClose: () => void }) {
  const [teamA, setTeamA] = useState<string[]>(() => match.participants.filter((participant) => participant.team === "A" && participant.queuePlayerId).sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)).map((participant) => participant.queuePlayerId!));
  const [teamB, setTeamB] = useState<string[]>(() => match.participants.filter((participant) => participant.team === "B" && participant.queuePlayerId).sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)).map((participant) => participant.queuePlayerId!));
  const eligible = players.filter((player) => ["WAITING", "QUEUED", "PLAYING"].includes(player.status) || [...teamA, ...teamB].includes(player.id));
  const selected = new Set([...teamA, ...teamB]);
  const labelFor = (id: string) => players.find((player) => player.id === id)?.displayName ?? "Select player";
  const replace = (team: "A" | "B", index: number, value: string) => (team === "A" ? setTeamA : setTeamB)((current) => replaceLockedSelection(current, index, value, players));
  const swapTeams = () => { setTeamA(teamB); setTeamB(teamA); };
  const valid = teamA.length === teamB.length && [1, 2].includes(teamA.length) && new Set([...teamA, ...teamB]).size === teamA.length + teamB.length && hasCompleteLockedSelection(teamA, teamB, players);
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div role="dialog" aria-modal="true" aria-labelledby="edit-lineup-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl sm:mx-auto sm:max-w-lg sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Queued matchup</p><h2 id="edit-lineup-title" className="display mt-1 text-3xl">Edit lineup</h2></div><Button variant="quiet" className="px-3" aria-label="Close edit lineup dialog" onClick={onClose} disabled={pending}><X size={18} /></Button></div><p className="mt-2 text-sm text-[var(--muted)]">Replace players, swap slots, or move a player between teams while preserving this queue position.</p><div className="mt-5 grid grid-cols-2 gap-3">{([['A', teamA], ['B', teamB]] as const).map(([team, ids]) => <div key={team} className={`rounded-2xl p-3 ${team === "A" ? "bg-[#edf8f4]" : "bg-[#fff4ec]"}`}><p className="text-xs font-bold uppercase tracking-[0.12em]">Team {team}</p><div className="mt-3 space-y-2">{ids.map((id, index) => <label key={`${team}-${index}`} className="block text-xs font-semibold">Slot {index + 1}<Select value={id} onChange={(event) => replace(team, index, event.target.value)}>{eligible.map((player) => <option key={player.id} value={player.id} disabled={selected.has(player.id) && player.id !== id}>{labelFor(player.id)} · {pretty(player.status)}</option>)}</Select></label>)}</div></div>)}</div>{!valid && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">Choose unique players with equal team sizes for singles or doubles.</p>}{error !== undefined && error !== null && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(error)}</p>}<div className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr]"><Button variant="quiet" className="w-full" onClick={swapTeams} disabled={pending}>Swap teams</Button><Button variant="quiet" className="w-full" onClick={onClose} disabled={pending}>Cancel</Button><Button className="w-full" onClick={() => onConfirm(teamA, teamB)} disabled={!valid || pending} loading={pending}>Save lineup</Button></div></div></div>;
}

function LiveMatchEditDialog({ match, players, courts, matches, pending, error, onConfirm, onClose }: { match: Match; players: SessionPlayer[]; courts: Court[]; matches: Match[]; pending: boolean; error?: unknown; onConfirm: (teamA: string[], teamB: string[], courtId?: string, swapWithMatchId?: string) => void; onClose: () => void }) {
  const [teamA, setTeamA] = useState<string[]>(() => match.participants.filter((participant) => participant.team === "A" && participant.queuePlayerId).sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)).map((participant) => participant.queuePlayerId!));
  const [teamB, setTeamB] = useState<string[]>(() => match.participants.filter((participant) => participant.team === "B" && participant.queuePlayerId).sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)).map((participant) => participant.queuePlayerId!));
  const [courtId, setCourtId] = useState(match.courtId ?? "");
  const [swapConfirmed, setSwapConfirmed] = useState(false);
  const currentIds = new Set(match.participants.map((participant) => participant.queuePlayerId).filter((id): id is string => Boolean(id)));
  const eligible = players.filter((player) => currentIds.has(player.id) || player.status === "WAITING");
  const courtOptions = courts.filter((court) => court.id === match.courtId || court.status === "AVAILABLE" || (court.status === "OCCUPIED" && court.currentMatchId && court.currentMatchId !== match.id && matches.some((item) => item.id === court.currentMatchId && item.status === "IN_PROGRESS")));
  const targetCourt = courtOptions.find((court) => court.id === courtId);
  const targetMatch = targetCourt?.id !== match.courtId ? matches.find((item) => item.id === targetCourt?.currentMatchId && item.status === "IN_PROGRESS") : undefined;
  const selected = new Set([...teamA, ...teamB]);
  const replace = (team: "A" | "B", index: number, value: string) => (team === "A" ? setTeamA : setTeamB)((current) => replaceLockedSelection(current, index, value, players));
  const swapTeams = () => { setTeamA(teamB); setTeamB(teamA); };
  const valid = teamA.length === teamB.length && [1, 2].includes(teamA.length) && new Set([...teamA, ...teamB]).size === teamA.length + teamB.length && hasCompleteLockedSelection(teamA, teamB, players);
  const labelFor = (id: string) => players.find((player) => player.id === id)?.displayName ?? "Select player";
  const submit = () => {
    if (targetMatch && !swapConfirmed) { setSwapConfirmed(true); return; }
    onConfirm(teamA, teamB, courtId || undefined, targetMatch?.id);
  };
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5">
    <div role="dialog" aria-modal="true" aria-labelledby="edit-live-match-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:mx-auto sm:max-w-lg sm:rounded-3xl">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Live match</p><h2 id="edit-live-match-title" className="display mt-1 text-3xl">Edit live match</h2></div><Button variant="quiet" className="px-3" aria-label="Close edit live match dialog" onClick={onClose} disabled={pending}><X size={18} /></Button></div>
      <p className="mt-2 text-sm text-[var(--muted)]">Swap teammates, move players between teams, replace a player, or move this match to another court.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">{([['A', teamA], ['B', teamB]] as const).map(([team, ids]) => <div key={team} className={`rounded-2xl p-3 ${team === "A" ? "bg-[#edf8f4]" : "bg-[#fff4ec]"}`}><p className="text-xs font-bold uppercase tracking-[0.12em]">Team {team}</p><div className="mt-3 space-y-2">{ids.map((id, index) => <label key={`${team}-${index}`} className="block text-xs font-semibold">Slot {index + 1}<Select value={id} onChange={(event) => replace(team, index, event.target.value)}>{eligible.map((player) => <option key={player.id} value={player.id} disabled={selected.has(player.id) && player.id !== id}>{labelFor(player.id)} · {pretty(player.status)}</option>)}</Select></label>)}</div></div>)}</div>
      <label className="mt-4 block text-sm font-semibold">Live court<Select aria-label="Live court" value={courtId} onChange={(event) => { setCourtId(event.target.value); setSwapConfirmed(false); }}><option value="">Keep current court</option>{courtOptions.map((court) => { const occupiedMatch = matches.find((item) => item.id === court.currentMatchId && item.status === "IN_PROGRESS"); const label = occupiedMatch ? ` · Playing — ${occupiedMatch.participants.filter((participant) => participant.team === "A").map((participant) => participant.displayName ?? "Player").join(" & ")} vs ${occupiedMatch.participants.filter((participant) => participant.team === "B").map((participant) => participant.displayName ?? "Player").join(" & ")}` : court.id === match.courtId ? " · Current" : " · Available"; return <option value={court.id} key={court.id}>{court.name}{label}</option>; })}</Select></label>
      {targetMatch && <div className={`mt-3 rounded-2xl px-4 py-3 text-sm ${swapConfirmed ? "bg-[#edf8f4] text-[#245c4e]" : "bg-[#fff4ec] text-[#8d4824]"}`} role="alert"><p className="font-semibold">{swapConfirmed ? "Court swap ready to confirm" : "This court is occupied by another live match."}</p><p className="mt-1">{swapConfirmed ? "Save to exchange the two court assignments. Players, scores, and match status will not change." : "Review the court swap before saving. The other match will move to your current court."}</p></div>}
      {!valid && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">Choose unique players with equal team sizes for singles or doubles.</p>}
      {courtOptions.length === 0 && <p className="mt-3 rounded-2xl bg-[#fff4ec] px-3 py-2 text-sm text-[#8d4824]">No alternate available court is currently open. You can still save lineup changes.</p>}
      {error !== undefined && error !== null && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(error)}</p>}
      <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr]"><Button variant="quiet" className="w-full" onClick={swapTeams} disabled={pending}>Swap teams</Button><Button variant="quiet" className="w-full" onClick={onClose} disabled={pending}>Cancel</Button><Button className="w-full" onClick={submit} disabled={!valid || pending} loading={pending}>{targetMatch && !swapConfirmed ? "Review court swap" : targetMatch ? "Confirm court swap" : "Save live match"}</Button></div>
    </div>
  </div>;
}

function QueuedMatchCard({ match, courts, onChanged, onCancel, onEdit, disabled = false }: { match: Match; courts: Court[]; onChanged: () => void; onCancel: (match: Match) => void; onEdit: (match: Match) => void; disabled?: boolean }) {
  const [courtId, setCourtId] = useState("");
  const [advisoryOpen, setAdvisoryOpen] = useState(false);
  const advisory = match.matchupAdvisory ?? null;
  const blockedPlayers = match.participants.filter((participant) => participant.playerStatus !== "WAITING" && participant.playerStatus !== "QUEUED").map((participant) => participant.displayName ?? "Player");
  const ready = blockedPlayers.length === 0;
  const start = useMutation<Match, Error, boolean>({ mutationFn: (playerPreferenceConfirmed = false) => { if (!courtId) throw new Error("Select an available court first."); if (!ready) throw new Error("This matchup is waiting for a player to finish their current match."); return api.startMatch(match.id, courtId, playerPreferenceConfirmed); }, onSuccess: () => { setAdvisoryOpen(false); onChanged(); toast.success("Queued match started."); } });
  const availableCourts = courts.filter((court) => court.status === "AVAILABLE");
  const renderTeam = (side: "A" | "B") => <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">{match.participants.filter((participant) => participant.team === side).map((participant) => <span key={participant.id ?? participant.queuePlayerId} className="inline-flex min-w-0 items-center gap-1 break-words font-semibold">{participant.displayName ?? "Player"}{advisory && advisory.queuePlayerId === participant.queuePlayerId && <LoneFemaleWarningIcon advisory={advisory} />}</span>)}</div>;
  const teamA = match.participants.filter((participant) => participant.team === "A").map((participant) => participant.displayName ?? "Player").join(" & ") || "Team A";
  const teamB = match.participants.filter((participant) => participant.team === "B").map((participant) => participant.displayName ?? "Player").join(" & ") || "Team B";
  return <><div className={`min-w-0 rounded-2xl border px-4 py-4 text-sm ${advisory ? "border-[#e9b27f] bg-[#fffdfa]" : "border-[var(--line)] bg-white"}`}><div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3"><div className="min-w-0">{renderTeam("A")}</div><span className="pt-0.5 text-xs text-[var(--muted)]">vs</span><div className="min-w-0 text-right">{renderTeam("B")}</div></div>{match.matchmakingMode === "UNDEFEATED_CHALLENGE" && <Badge tone="orange">Undefeated challenge</Badge>}{blockedPlayers.length > 0 && <p className="mt-3 rounded-xl bg-[#fff4ec] px-3 py-2 text-xs text-[#8d4824]">Waiting for {blockedPlayers.join(", ")} to finish their current match.</p>}<div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"><label className="sr-only" htmlFor={`queued-court-${match.id}`}>Court for queued matchup</label><Select id={`queued-court-${match.id}`} value={courtId} onChange={(event) => setCourtId(event.target.value)} disabled={disabled}><option value="">Select court to start</option>{availableCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</Select><Button className="min-h-11 px-3" loading={start.isPending} disabled={disabled || !courtId || !ready || start.isPending} onClick={() => advisory ? setAdvisoryOpen(true) : start.mutate(false)}>Start match</Button><Button variant="quiet" className="min-h-11 px-3" disabled={disabled} onClick={() => onEdit(match)}><Pencil size={14} /> Edit lineup</Button><Button variant="quiet" className="min-h-11 px-3" disabled={disabled} onClick={() => onCancel(match)}>Discard matchup</Button></div>{availableCourts.length === 0 && <p className="mt-2 text-xs text-[#8d4824]">No available courts right now. Finish a match or add a court first.</p>}{start.isError && <p role="alert" className="mt-2 rounded-xl bg-[#fff0e4] px-3 py-2 text-xs text-[#8d4824]">{errorMessage(start.error)}</p>}</div>{advisoryOpen && advisory && <MatchupAdvisoryDialog advisory={advisory} teamA={teamA} teamB={teamB} queued pending={start.isPending} error={start.isError ? start.error : undefined} onConfirm={() => start.mutate(true)} onEdit={() => { setAdvisoryOpen(false); onEdit(match); }} onAlternative={() => setAdvisoryOpen(false)} onDiscard={() => { setAdvisoryOpen(false); onCancel(match); }} onClose={() => { if (!start.isPending) setAdvisoryOpen(false); }} />}</>;
}
function QueuedMatchCardLegacy({ match, courts, onChanged, onCancel, onEdit, disabled = false }: { match: Match; courts: Court[]; onChanged: () => void; onCancel: (match: Match) => void; onEdit: (match: Match) => void; disabled?: boolean }) {
  const [courtId, setCourtId] = useState("");
  const [advisoryOpen, setAdvisoryOpen] = useState(false);
  const advisory = match.matchupAdvisory ?? null;
  const blockedPlayers = match.participants.filter((participant) => participant.playerStatus !== "WAITING" && participant.playerStatus !== "QUEUED").map((participant) => participant.displayName ?? "Player");
  const ready = blockedPlayers.length === 0;
  const start = useMutation<Match, Error, boolean>({ mutationFn: (playerPreferenceConfirmed = false) => { if (!courtId) throw new Error("Select an available court first."); if (!ready) throw new Error("This matchup is waiting for a player to finish their current match."); return api.startMatch(match.id, courtId, playerPreferenceConfirmed); }, onSuccess: () => { setAdvisoryOpen(false); onChanged(); toast.success("Queued match started."); } });
  const availableCourts = courts.filter((court) => court.status === "AVAILABLE");
  const teamA = match.participants.filter((participant) => participant.team === "A").map((participant) => participant.displayName ?? "Player").join(" & ") || "Team A";
  const teamB = match.participants.filter((participant) => participant.team === "B").map((participant) => participant.displayName ?? "Player").join(" & ") || "Team B";
  if (advisory) return <><div className="min-w-0 rounded-2xl border border-[#e9b27f] border-l-4 bg-[#fffdfa] px-4 py-3 text-sm"><div className="flex items-center justify-between gap-3"><span className="min-w-0 break-words font-semibold">{teamA}</span><span className="shrink-0 text-xs text-[var(--muted)]">vs</span><span className="min-w-0 break-words text-right font-semibold">{teamB}</span></div>{match.matchmakingMode === "UNDEFEATED_CHALLENGE" && <Badge tone="orange">Undefeated challenge</Badge>}<div className="mt-3"></div>{blockedPlayers.length > 0 && <p className="mt-2 rounded-xl bg-[#fff4ec] px-3 py-2 text-xs text-[#8d4824]">Waiting for {blockedPlayers.join(", ")} to finish their current match.</p>}<div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"><label className="sr-only" htmlFor={`queued-court-${match.id}`}>Court for {teamA} versus {teamB}</label><Select id={`queued-court-${match.id}`} value={courtId} onChange={(event) => setCourtId(event.target.value)} disabled={disabled}><option value="">Select court to start</option>{availableCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</Select><Button className="min-h-11 px-3" disabled={disabled || !courtId || !ready || start.isPending} onClick={() => setAdvisoryOpen(true)}>Start match</Button><Button variant="quiet" className="min-h-11 px-3" disabled={disabled} onClick={() => onEdit(match)}><Pencil size={14} /> Edit lineup</Button><Button variant="quiet" className="min-h-11 px-3" disabled={disabled} onClick={() => onCancel(match)}>Discard matchup</Button></div>{availableCourts.length === 0 && <p className="mt-2 text-xs text-[#8d4824]">No available courts right now. Finish a match or add a court first.</p>}{start.isError && <p role="alert" className="mt-2 rounded-xl bg-[#fff0e4] px-3 py-2 text-xs text-[#8d4824]">{errorMessage(start.error)}</p>}</div>{advisoryOpen && <MatchupAdvisoryDialog advisory={advisory} teamA={teamA} teamB={teamB} queued pending={start.isPending} error={start.isError ? start.error : undefined} onConfirm={() => start.mutate(true)} onEdit={() => { setAdvisoryOpen(false); onEdit(match); }} onAlternative={() => setAdvisoryOpen(false)} onDiscard={() => { setAdvisoryOpen(false); onCancel(match); }} onClose={() => { if (!start.isPending) setAdvisoryOpen(false); }} />}</>;
   return <div className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-semibold">{teamA}</span><span className="text-xs text-[var(--muted)]">vs</span><span className="text-right font-semibold">{teamB}</span></div>{match.matchmakingMode === "UNDEFEATED_CHALLENGE" && <Badge tone="orange">Undefeated challenge</Badge>}{blockedPlayers.length > 0 && <p className="mt-2 rounded-xl bg-[#fff4ec] px-3 py-2 text-xs text-[#8d4824]">Waiting for {blockedPlayers.join(", ")} to finish their current match.</p>}<div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"><label className="sr-only" htmlFor={`queued-court-${match.id}`}>Court for {teamA} versus {teamB}</label><Select id={`queued-court-${match.id}`} value={courtId} onChange={(event) => setCourtId(event.target.value)} disabled={disabled}><option value="">Select court to start</option>{availableCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</Select><Button className="px-3" disabled={disabled || !courtId || !ready || start.isPending} onClick={() => start.mutate(false)}>{start.isPending ? "Starting…" : "Start match"}</Button><Button variant="quiet" className="px-3" disabled={disabled} onClick={() => onEdit(match)}><Pencil size={14} /> Edit lineup</Button><Button variant="quiet" className="px-3" disabled={disabled} onClick={() => onCancel(match)}>Discard matchup</Button></div>{availableCourts.length === 0 && <p className="mt-2 text-xs text-[#8d4824]">No available courts right now. Finish a match or add a court first.</p>}{start.isError && <p role="alert" className="mt-2 rounded-xl bg-[#fff0e4] px-3 py-2 text-xs text-[#8d4824]">{errorMessage(start.error)}</p>}</div>;
}

function LiveView({ session, sessionId, onStartSession }: { session: SessionSummary; sessionId: string; onStartSession: () => void }) {
  const queryClient = useQueryClient();
  const [showCourts, setShowCourts] = useState(false);
  const [scoreMatch, setScoreMatch] = useState<Match | null>(null);
  const [editMatch, setEditMatch] = useState<Match | null>(null);
  const [discardMatch, setDiscardMatch] = useState<Match | null>(null);
  const [renameCourt, setRenameCourt] = useState<Court | null>(null);
  const [courtToDelete, setCourtToDelete] = useState<Court | null>(null);
  const [bulkDeleteStatuses, setBulkDeleteStatuses] = useState<Array<"AVAILABLE" | "CLOSED"> | null>(null);
  const courtsQuery = useQuery({ queryKey: ["courts", sessionId], queryFn: () => api.courts(sessionId), refetchInterval: useRefreshInterval(session.status === "ACTIVE") });
  const matchesQuery = useQuery({ queryKey: ["matches", sessionId], queryFn: () => api.matches(sessionId), refetchInterval: useRefreshInterval(session.status === "ACTIVE") });
  const queueQuery = useQuery({ queryKey: ["queue", sessionId], queryFn: () => api.queue(sessionId), refetchInterval: useRefreshInterval(session.status === "ACTIVE") });
  const invalidateOperations = () => { ["courts", "matches", "queue", "rankings", "history"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key, sessionId] })); queryClient.invalidateQueries({ queryKey: ["playerHistory", sessionId] }); queryClient.invalidateQueries({ queryKey: ["sessions"] }); };
  const complete = async (games: { teamAScore: number; teamBScore: number }[]) => { if (!scoreMatch) return; const completed = await api.completeMatch(scoreMatch.id, games); for (const player of completed.notifications ?? []) toast.success(`${player.displayName} is now undefeated after four matches. Try Undefeated challenge mode.`); setScoreMatch(null); invalidateOperations(); toast.success("Result saved. Court is available again."); };
  const discard = useMutation({ mutationFn: () => { if (!discardMatch) throw new Error("Select a match to discard."); return api.cancelMatch(discardMatch.id); }, onSuccess: () => { setDiscardMatch(null); invalidateOperations(); toast.success("Matchup discarded."); } });
  const edit = useMutation({ mutationFn: (body: { teamA: string[]; teamB: string[]; courtId?: string; swapWithMatchId?: string }) => { if (!editMatch) throw new Error("Select a match."); return api.updateMatch(editMatch, body); }, onSuccess: (_updated, variables) => { const transferred = editMatch?.status === "IN_PROGRESS" && Boolean(variables.courtId) && variables.courtId !== editMatch.courtId; const swapped = Boolean(variables.swapWithMatchId); setEditMatch(null); invalidateOperations(); toast.success(swapped ? "Live matches swapped between courts." : transferred ? "Live match updated and transferred." : editMatch?.status === "IN_PROGRESS" ? "Live lineup updated." : "Queued lineup updated."); } });
  const rename = useMutation({ mutationFn: (name: string) => { if (!renameCourt) throw new Error("Select a court to rename."); return api.updateCourt(sessionId, renameCourt, { name }); }, onSuccess: () => { setRenameCourt(null); invalidateOperations(); toast.success("Court renamed."); } });
  const removeCourt = useMutation({ mutationFn: () => { if (!courtToDelete) throw new Error("Select a court to delete."); return api.deleteCourt(sessionId, courtToDelete); }, onSuccess: (result) => { setCourtToDelete(null); invalidateOperations(); toast.success(`${result.deletedCount} court${result.deletedCount === 1 ? "" : "s"} deleted.`); } });
  const removeCourts = useMutation({ mutationFn: (statuses: Array<"AVAILABLE" | "CLOSED">) => api.deleteCourts(sessionId, statuses), onSuccess: (result) => { setBulkDeleteStatuses(null); invalidateOperations(); toast.success(`${result.deletedCount} court${result.deletedCount === 1 ? "" : "s"} deleted.`); } });
  const requestDiscard = (match: Match) => { discard.reset(); setDiscardMatch(match); };
  const courts = courtsQuery.data ?? [];
  const matches = matchesQuery.data ?? [];
  const activeMatches = matches.filter((match) => match.status === "IN_PROGRESS");
  const queuedMatches = matches.filter((match) => match.status === "QUEUED");
  const error = courtsQuery.error ?? matchesQuery.error ?? queueQuery.error;
  const editablePlayers = [...(queueQuery.data?.waiting ?? []), ...(queueQuery.data?.resting ?? []), ...(queueQuery.data?.inactive ?? []), ...(queueQuery.data?.queued ?? []), ...(queueQuery.data?.playing ?? [])];
  if (courtsQuery.isPending || matchesQuery.isPending || queueQuery.isPending) return <LoadingState label="Loading live courts" />;
  const deleteDescription = bulkDeleteStatuses ? `This permanently deletes ${bulkDeleteStatuses.length === 2 ? "all open and closed" : bulkDeleteStatuses[0] === "AVAILABLE" ? "all open" : "all closed"} courts. Occupied courts are protected. Match results remain in history.` : courtToDelete ? `This permanently deletes ${courtToDelete.name}. Match results using this court remain in history with the original court name.` : "";
  return <div className="live-view space-y-5"><span className="sr-only">Queued matchups</span>
    <div className="live-view-summary flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div className="live-view-summary-heading"><p className="text-sm text-[var(--muted)]">Live operations</p><h2 className="display text-4xl">Courts at a glance.</h2></div><div className="live-view-statuses flex flex-wrap gap-2"><Badge tone="teal">{courts.filter((court) => court.status === "AVAILABLE").length} available</Badge><Badge tone="orange">{activeMatches.length} playing</Badge><Badge tone="gray">{courts.filter((court) => court.status === "CLOSED").length} closed</Badge><Button variant="quiet" className="px-3" title="Refresh live data" aria-label="Refresh live data" onClick={() => invalidateOperations()}><RefreshCw size={16} /></Button></div></div>
    {session.status === "DRAFT" && <Card className="border-[#f6c49f] bg-[#fffaf5]"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Draft session</p><p className="mt-1 text-sm text-[var(--muted)]">Add at least one court, then start the session to enable matchmaking.</p></div><Button onClick={onStartSession} disabled={courts.length === 0}><Play size={16} /> Start session</Button></div></Card>}
    {error && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{errorMessage(error)}</p>}
    {courtsQuery.isPending ? <div className="live-courts-grid"><div className="h-56 animate-pulse rounded-3xl bg-white" /><div className="h-56 animate-pulse rounded-3xl bg-white" /></div> : courts.length === 0 ? <EmptyState icon={MapPinned} title="No courts yet" body="Create your first court to make the live board useful." action={<Button onClick={() => setShowCourts(true)} disabled={session.status === "ENDED"}><Plus size={16} /> Manage courts</Button>} /> : <div className="live-courts-grid">{courts.map((court) => <CourtCard key={court.id} court={court} match={matches.find((match) => match.id === court.currentMatchId)} disabled={session.status === "ENDED"} onScore={setScoreMatch} onCancel={requestDiscard} onEdit={setEditMatch} onRename={(value) => { rename.reset(); setRenameCourt(value); }} onDelete={(value) => { removeCourt.reset(); setCourtToDelete(value); }} />)}</div>}
    {session.status === "ENDED" && <Card className="border-[#f6c49f] bg-[#fffaf5]"><p className="font-semibold">Session ended</p><p className="mt-1 text-sm text-[var(--muted)]">Live operations are locked. Review finalized fees in the Fees tab or start a fresh queue from Settings.</p></Card>}
    {queuedMatches.length > 0 && <Card><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Queued matchups</h3><p className="mt-1 text-sm text-[var(--muted)]">Choose an available court when every participant is free, or edit a reservation before starting it.</p></div><Badge tone="orange">{queuedMatches.length}</Badge></div><div className="mt-4 grid gap-2">{queuedMatches.map((match) => <QueuedMatchCard key={match.id} match={match} courts={courts} disabled={session.status === "ENDED"} onChanged={invalidateOperations} onEdit={setEditMatch} onCancel={requestDiscard} />)}</div></Card>}
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Court setup</h3><p className="mt-1 text-sm text-[var(--muted)]">Keep operations focused; management is tucked away until you need it.</p></div><Button variant="quiet" disabled={session.status === "ENDED"} onClick={() => setShowCourts((value) => !value)}><SlidersHorizontal size={16} /> {showCourts ? "Hide management" : "Manage courts"}<ChevronDown className={showCourts ? "rotate-180 transition" : "transition"} size={15} /></Button></div>
    {showCourts && <CourtManagement sessionId={sessionId} courts={courts} onChanged={() => { invalidateOperations(); }} onRename={(value) => { rename.reset(); setRenameCourt(value); }} onDelete={(value) => { removeCourt.reset(); setCourtToDelete(value); }} onBulkDelete={(statuses) => { removeCourts.reset(); setBulkDeleteStatuses(statuses); }} />}
    {scoreMatch && <ScoreModal match={scoreMatch} session={session} onClose={() => setScoreMatch(null)} onComplete={complete} />}
    {editMatch?.status === "IN_PROGRESS" && <LiveMatchEditDialog match={editMatch} players={editablePlayers} courts={courts} matches={matches} pending={edit.isPending} error={edit.isError ? edit.error : undefined} onConfirm={(teamA, teamB, courtId, swapWithMatchId) => edit.mutate({ teamA, teamB, ...(courtId ? { courtId } : {}), ...(swapWithMatchId ? { swapWithMatchId } : {}) })} onClose={() => { if (!edit.isPending) { edit.reset(); setEditMatch(null); } }} />}
    {editMatch?.status === "QUEUED" && <QueuedMatchEditDialog match={editMatch} players={editablePlayers} pending={edit.isPending} error={edit.isError ? edit.error : undefined} onConfirm={(teamA, teamB) => edit.mutate({ teamA, teamB })} onClose={() => { if (!edit.isPending) { edit.reset(); setEditMatch(null); } }} />}
    {discardMatch && <DestructiveConfirmDialog title="Discard this matchup?" body="This cancels the queued or playing reservation without creating a result. Other active matches and future reservations remain in place, and any occupied court is released." confirmLabel="Discard match" pending={discard.isPending} error={discard.error} onConfirm={() => discard.mutate()} onClose={() => { if (!discard.isPending) { discard.reset(); setDiscardMatch(null); } }} />}
    {renameCourt && <RenameCourtDialog court={renameCourt} pending={rename.isPending} error={rename.isError ? rename.error : undefined} onConfirm={(name) => rename.mutate(name)} onClose={() => { if (!rename.isPending) { rename.reset(); setRenameCourt(null); } }} />}
    {(courtToDelete || bulkDeleteStatuses) && <DestructiveConfirmDialog title={bulkDeleteStatuses ? "Delete selected courts?" : `Delete ${courtToDelete?.name}?`} body={deleteDescription} confirmLabel="Delete courts" pending={removeCourt.isPending || removeCourts.isPending} error={removeCourt.isError ? removeCourt.error : removeCourts.isError ? removeCourts.error : undefined} onConfirm={() => bulkDeleteStatuses ? removeCourts.mutate(bulkDeleteStatuses) : removeCourt.mutate()} onClose={() => { if (!removeCourt.isPending && !removeCourts.isPending) { removeCourt.reset(); removeCourts.reset(); setCourtToDelete(null); setBulkDeleteStatuses(null); } }} />}
  </div>;
}

function waitMinutes(player: SessionPlayer, serverTime?: string) {
  if (!player.queueEnteredAt) return "—";
  const end = serverTime ? new Date(serverTime).getTime() : Date.now();
  return `${Math.max(0, Math.floor((end - new Date(player.queueEnteredAt).getTime()) / 60000))}m`;
}
function restMessage(player: SessionPlayer) { if (!player.restEligibleAt || !player.lastMatchEndedAt) return null; const readyAt = new Date(player.restEligibleAt); if (readyAt.getTime() <= Date.now()) return "Rest ready"; return `Rest until ${readyAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`; }

type BulkQueueAction = "CHECK_IN" | "REST" | "CHECK_OUT";
const canSelectQueuePlayer = (player: SessionPlayer) => ["INACTIVE", "CHECKED_OUT", "WAITING", "RESTING"].includes(player.status);
const canBulkQueueAction = (player: SessionPlayer, action: BulkQueueAction) => action === "CHECK_IN" ? ["INACTIVE", "CHECKED_OUT"].includes(player.status) : action === "REST" ? player.status === "WAITING" : ["WAITING", "RESTING"].includes(player.status);

function PlayerQueueRow({ player, sessionId, onChanged, onRemove, canRemove = true, removePending = false, disabled = false, selected = false, onToggle, bulkPending = false }: { player: SessionPlayer; sessionId: string; onChanged: () => void; onRemove: (player: SessionPlayer) => void; canRemove?: boolean; removePending?: boolean; disabled?: boolean; selected?: boolean; onToggle?: (checked: boolean) => void; bulkPending?: boolean }) {
  const mutation = useMutation({ mutationFn: async (action: "checkIn" | "checkOut" | "rest" | "resume") => { if (action === "checkIn") return api.checkIn(sessionId, player.id); if (action === "checkOut") return api.checkOut(sessionId, player.id); if (action === "rest") return api.restPlayer(sessionId, player.id); return api.resumePlayer(sessionId, player.id); }, onSuccess: () => { onChanged(); } });
  const waive = useMutation({ mutationFn: () => api.waiveLatePenalty(sessionId, player.id, player.version), onSuccess: () => { onChanged(); toast.success(`${player.displayName}'s late penalty was waived.`); } });
  const action = player.status === "INACTIVE" || player.status === "CHECKED_OUT" ? { label: "Check in", intent: "checkIn" as const } : player.status === "WAITING" ? { label: "Rest", intent: "rest" as const } : player.status === "RESTING" ? { label: "Resume", intent: "resume" as const } : null;
  const canCheckOut = player.status === "WAITING" || player.status === "RESTING";
  return <div className={`grid ${QUEUE_TABLE_GRID_COLUMNS} items-center gap-2 border-b border-[var(--line)] px-3 py-3 text-sm last:border-0 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-2`}><div className="flex min-w-0 items-start gap-2"><div className="shrink-0 pt-1"><input type="checkbox" aria-label={`Select ${player.displayName}`} checked={selected} disabled={disabled || bulkPending || !canSelectQueuePlayer(player)} onChange={(event) => onToggle?.(event.target.checked)} /></div><div className="min-w-0"><p className="truncate font-semibold">{player.displayName}</p><p className="text-xs text-[var(--muted)]">{player.gender === "MALE" ? "Male" : "Female"}</p>{player.synergyTeamId && <p className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[#edf8f4] px-2 py-0.5 text-[11px] font-semibold text-[var(--teal)]" title="Locked Synergy Team">Synergy · {player.synergyPartnerName ?? "locked partner"} · {pretty(player.effectiveSkillLevel ?? player.skillLevel)} ({player.effectiveSkillWeight ?? player.skillWeight})</p>}<div className="mt-1"><LatePenaltyBadge state={player.latePenaltyState} />{restMessage(player) && <p className="mt-1 text-xs text-[#8d4824]">{restMessage(player)}</p>}</div></div></div><span className="text-xs text-[var(--muted)] max-md:hidden">{pretty(player.skillLevel)}</span><span className="text-xs text-[var(--muted)] max-md:hidden">{player.matchesPlayed}</span><span className="text-xs text-[var(--muted)] max-md:hidden">{waitMinutes(player)}</span><span className="max-md:justify-self-end"><StatusBadge status={player.status} /></span><span className="text-xs text-[var(--muted)] max-md:hidden">{player.wins}W / {player.losses}L</span><div className="flex flex-wrap justify-end gap-2 max-md:col-span-2 max-md:col-start-1 max-md:row-start-2 max-md:w-full max-md:border-t max-md:border-[var(--line)] max-md:pt-2">{canRemove && (player.status === "INACTIVE" || player.status === "CHECKED_OUT") && <Button variant="quiet" className="whitespace-nowrap px-3 py-1.5 text-xs" loading={removePending} disabled={disabled || bulkPending || removePending || mutation.isPending || waive.isPending} aria-label={`Remove ${player.displayName} from queue`} title={`Remove ${player.displayName} from queue`} onClick={() => onRemove(player)}>Remove</Button>}{action && <Button variant="quiet" className="whitespace-nowrap px-3 py-1.5 text-xs" loading={mutation.isPending} disabled={disabled || bulkPending || removePending || waive.isPending} onClick={() => mutation.mutate(action.intent)}>{action.label}</Button>}{canCheckOut && <Button variant="quiet" className="whitespace-nowrap px-3 py-1.5 text-xs" loading={mutation.isPending} disabled={disabled || bulkPending || removePending || waive.isPending} onClick={() => mutation.mutate("checkOut")}>Check out</Button>}{player.latePenaltyState === "PENDING" && <Button variant="quiet" className="whitespace-nowrap px-3 py-1.5 text-xs" loading={waive.isPending} disabled={disabled || bulkPending || removePending || mutation.isPending} onClick={() => { if (window.confirm(`Waive ${player.displayName}'s one-time late penalty?`)) waive.mutate(); }}>Waive</Button>}{(mutation.isError || waive.isError) && <p className="mt-1 w-full text-xs text-[#8d4824]">{errorMessage(mutation.error ?? waive.error)}</p>}</div></div>;
}

function SynergyTeamsCard({ sessionId, queue, ended, onChanged }: { sessionId: string; queue: QueueState; ended: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<SynergyTeam | null | undefined>(undefined);
  const [dissolveTarget, setDissolveTarget] = useState<SynergyTeam | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const allPlayers = useMemo(() => [...queue.waiting, ...queue.resting, ...queue.inactive, ...queue.queued, ...queue.playing], [queue]);
  const byId = useMemo(() => new Map(allPlayers.map((player) => [player.id, player])), [allPlayers]);
  const teams = useMemo(() => queue.synergyTeams ?? [], [queue.synergyTeams]);
  const paired = useMemo(() => new Set(teams.flatMap((team) => team.queuePlayerIds)), [teams]);
  const candidates = useMemo(() => { const needle = search.trim().toLowerCase(); return allPlayers.filter((player) => !needle || `${player.displayName} ${player.skillLevel} ${player.status}`.toLowerCase().includes(needle)); }, [allPlayers, search]);
  const create = useMutation({ mutationFn: () => { if (selected.length !== 2) throw new Error("Choose two queue players."); return api.createSynergyTeam(sessionId, selected as [string, string]); }, onSuccess: () => { setEditing(undefined); setSelected([]); setSearch(""); onChanged(); toast.success("Synergy Team created."); } });
  const update = useMutation({ mutationFn: () => { if (!editing || selected.length !== 2) throw new Error("Choose two queue players."); return api.updateSynergyTeam(sessionId, editing, selected as [string, string]); }, onSuccess: () => { setEditing(undefined); setSelected([]); setSearch(""); onChanged(); toast.success("Synergy Team updated."); } });
  const dissolve = useMutation({ mutationFn: (team: SynergyTeam) => api.deleteSynergyTeam(sessionId, team), onSuccess: () => { setDissolveTarget(null); onChanged(); toast.success("Synergy Team dissolved."); } });
  const pending = create.isPending || update.isPending;
  useEffect(() => {
    if (editing === undefined) return undefined;
    dialogRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (!pending) { setEditing(undefined); setSelected([]); } return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [editing, pending]);
  const closeEditor = () => { if (!pending) { setEditing(undefined); setSelected([]); setSearch(""); create.reset(); update.reset(); } };
  const openCreate = () => { create.reset(); update.reset(); setEditing(null); setSelected([]); setSearch(""); };
  const openEdit = (team: SynergyTeam) => { create.reset(); update.reset(); setEditing(team); setSelected([...team.queuePlayerIds]); setSearch(""); };
  const toggle = (player: SessionPlayer) => { if (player.status === "QUEUED" || player.status === "PLAYING") return; setSelected((current) => current.includes(player.id) ? current.filter((id) => id !== player.id) : current.length < 2 ? [...current, player.id] : [current[1]!, player.id]); };
  const effectiveWeight = selected.reduce((max, id) => Math.max(max, byId.get(id)?.skillWeight ?? 0), 0);
  const effectiveLevel = Object.entries({ NEWBIE: 1, BEGINNER: 2, UPPER_BEGINNER: 3, INTERMEDIATE: 4, UPPER_INTERMEDIATE: 5, ADVANCED: 6 }).find(([, value]) => value === effectiveWeight)?.[0];
  const busy = (team: SynergyTeam) => team.queuePlayerIds.some((id) => { const status = byId.get(id)?.status; return status === "QUEUED" || status === "PLAYING"; });
  return <Card className="synergy-teams-card overflow-hidden p-4 sm:p-5"><div className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Session locks</p><h3 className="display mt-1 text-2xl sm:text-3xl">Synergy Teams</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Lock two players together for every future game. Their original skills stay unchanged; matchmaking uses the higher skill.</p></div><Button className="min-h-11 w-full shrink-0 sm:w-auto" onClick={openCreate} disabled={ended || allPlayers.length < 2}><Plus size={16} /> Add team</Button></div>{teams.length === 0 ? <p className="mt-5 rounded-2xl bg-[#fbfdfb] px-4 py-4 text-sm text-[var(--muted)]">No locked pairs yet. Queue status actions remain individual.</p> : <div className="synergy-teams-grid mt-5">{teams.map((team) => { const first = byId.get(team.queuePlayerIds[0]); const second = byId.get(team.queuePlayerIds[1]); const teamBusy = busy(team); return <article key={team.id} className="synergy-team-card flex min-w-0 flex-col rounded-2xl border border-[var(--line)] bg-[#fbfdfb] p-4 sm:p-5"><div className="space-y-2">{[first, second].map((player, index) => <div key={player?.id ?? `${team.id}-${index}`} className="synergy-team-member flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-3"><div className="min-w-0"><p className="break-words font-semibold">{player?.displayName ?? "Unknown player"}</p><p className="mt-1 text-xs text-[var(--muted)]">Original skill: {player?.skillLevel ? pretty(player.skillLevel) : "Unavailable"}</p></div><div className="shrink-0 text-right"><StatusBadge status={player?.status ?? "UNAVAILABLE"} /><span className="sr-only">{player?.status === "QUEUED" || player?.status === "PLAYING" ? "Busy; finish the current match before editing." : ""}</span></div></div>)}</div><div className="mt-4 rounded-xl bg-[#edf8f4] px-4 py-3"><p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--teal)]">Matchmaking skill</p><p className="mt-1 text-lg font-semibold text-[var(--ink)]">{pretty(team.effectiveSkillLevel)} <span className="text-sm font-normal text-[var(--muted)]">({team.effectiveSkillWeight})</span></p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Uses the higher skill for pairing; profiles and rankings stay individual.</p></div><div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end"><Button variant="quiet" className="min-h-11 w-full px-3 text-xs sm:w-auto" disabled={ended || teamBusy} title={teamBusy ? "Busy players must finish their current match before editing." : undefined} onClick={() => openEdit(team)}><Pencil size={14} /> Edit</Button><Button variant="quiet" className="min-h-11 w-full px-3 text-xs sm:w-auto" disabled={ended || teamBusy || dissolve.isPending} title={teamBusy ? "Busy players must finish their current match before dissolving." : undefined} onClick={() => { dissolve.reset(); setDissolveTarget(team); }}><X size={14} /> Dissolve</Button></div></article>; })}</div>}{editing !== undefined && <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="synergy-dialog-title" className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:mx-auto sm:max-w-xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Synergy Team</p><h2 id="synergy-dialog-title" className="display mt-1 text-3xl">{editing ? "Edit locked pair" : "Create locked pair"}</h2></div><Button variant="quiet" className="min-h-11 min-w-11 px-3" onClick={closeEditor} aria-label="Close Synergy Team dialog" disabled={pending}><X size={18} /></Button></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[0, 1].map((slot) => { const player = selected[slot] ? byId.get(selected[slot]!) : undefined; return <div key={slot} className="min-h-16 rounded-2xl border border-dashed border-[var(--line)] bg-[#fbfdfb] p-3"><p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Member {slot + 1}</p><p className="mt-1 break-words text-sm font-semibold">{player?.displayName ?? "Choose below"}</p>{player && <p className="text-xs text-[var(--muted)]">{pretty(player.skillLevel)} · {player.status}</p>}</div>; })}</div><label className="mt-5 block text-sm font-semibold">Search session players<Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, status, or skill" /></label><div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">{candidates.map((player) => { const isBusy = player.status === "QUEUED" || player.status === "PLAYING"; const alreadyPaired = paired.has(player.id) && !selected.includes(player.id); const disabledReason = isBusy ? "Busy; finish the current match first." : alreadyPaired ? "Already paired in another Synergy Team." : undefined; return <button type="button" key={player.id} onClick={() => toggle(player)} disabled={Boolean(disabledReason)} className={`focus-ring flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left ${selected.includes(player.id) ? "border-[var(--teal)] bg-[#edf8f4]" : "border-[var(--line)] bg-white"} ${disabledReason ? "cursor-not-allowed opacity-55" : "hover:border-[var(--teal)]"}`}><span className="min-w-0"><span className="block break-words text-sm font-semibold">{player.displayName}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{pretty(player.skillLevel)} · {player.status}{disabledReason ? ` · ${disabledReason}` : ""}</span></span>{selected.includes(player.id) && <Check size={16} className="shrink-0 text-[var(--teal)]" />}</button>; })}</div>{selected.length === 2 && <p className="mt-4 rounded-2xl bg-[#edf8f4] px-3 py-3 text-sm">Matchmaking skill preview: <strong>{effectiveLevel ? pretty(effectiveLevel) : "—"} ({effectiveWeight})</strong></p>}{(create.isError || update.isError) && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-3 text-sm text-[#8d4824]">{errorMessage(create.error ?? update.error)}</p>}<div className="mt-6 grid gap-2 sm:flex sm:justify-end"><Button variant="quiet" className="min-h-11 w-full sm:w-auto" onClick={closeEditor} disabled={pending}>Cancel</Button><Button className="min-h-11 w-full sm:w-auto" onClick={() => editing ? update.mutate() : create.mutate()} disabled={selected.length !== 2 || pending}>{pending ? "Saving…" : editing ? "Save pair" : "Create pair"}</Button></div></div></div>}{dissolveTarget && <DestructiveConfirmDialog title="Dissolve this Synergy Team?" body={`This unlocks ${byId.get(dissolveTarget.queuePlayerIds[0])?.displayName ?? "the first player"} and ${byId.get(dissolveTarget.queuePlayerIds[1])?.displayName ?? "the second player"} for future matchmaking. Their original skills and match history will not change.`} confirmLabel="Dissolve team" pending={dissolve.isPending} error={dissolve.isError ? dissolve.error : undefined} onConfirm={() => dissolve.mutate(dissolveTarget)} onClose={() => { if (!dissolve.isPending) { dissolve.reset(); setDissolveTarget(null); } }} />}</Card>;
}
function SynergyTeamsCardLegacy({ sessionId, queue, ended, onChanged }: { sessionId: string; queue: QueueState; ended: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<SynergyTeam | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const allPlayers = useMemo(() => [...queue.waiting, ...queue.resting, ...queue.inactive, ...queue.queued, ...queue.playing], [queue]);
  const byId = useMemo(() => new Map(allPlayers.map((player) => [player.id, player])), [allPlayers]);
  const teams = useMemo(() => queue.synergyTeams ?? [], [queue.synergyTeams]);
  const paired = useMemo(() => new Set(teams.flatMap((team) => team.queuePlayerIds)), [teams]);
  const candidates = useMemo(() => { const needle = search.trim().toLowerCase(); return allPlayers.filter((player) => !needle || `${player.displayName} ${player.skillLevel} ${player.status}`.toLowerCase().includes(needle)); }, [allPlayers, search]);
  const create = useMutation({ mutationFn: () => { if (selected.length !== 2) throw new Error("Choose two queue players."); return api.createSynergyTeam(sessionId, selected as [string, string]); }, onSuccess: () => { setEditing(undefined); setSelected([]); setSearch(""); onChanged(); toast.success("Synergy Team created."); } });
  const update = useMutation({ mutationFn: () => { if (!editing || selected.length !== 2) throw new Error("Choose two queue players."); return api.updateSynergyTeam(sessionId, editing, selected as [string, string]); }, onSuccess: () => { setEditing(undefined); setSelected([]); setSearch(""); onChanged(); toast.success("Synergy Team updated."); } });
  const dissolve = useMutation({ mutationFn: (team: SynergyTeam) => api.deleteSynergyTeam(sessionId, team), onSuccess: () => { onChanged(); toast.success("Synergy Team dissolved."); } });
  const pending = create.isPending || update.isPending;
  useEffect(() => {
    if (editing === undefined) return undefined;
    dialogRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!pending) { setEditing(undefined); setSelected([]); }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [editing, pending]);
  const openCreate = () => { setEditing(null); setSelected([]); setSearch(""); create.reset(); update.reset(); };
  const openEdit = (team: SynergyTeam) => { setEditing(team); setSelected([...team.queuePlayerIds]); setSearch(""); create.reset(); update.reset(); };
  const toggle = (player: SessionPlayer) => { if (player.status === "QUEUED" || player.status === "PLAYING") return; setSelected((current) => current.includes(player.id) ? current.filter((id) => id !== player.id) : current.length < 2 ? [...current, player.id] : [current[1]!, player.id]); };
  const effectiveWeight = selected.reduce((max, id) => Math.max(max, byId.get(id)?.skillWeight ?? 0), 0);
  const effectiveLevel = Object.entries({ NEWBIE: 1, BEGINNER: 2, UPPER_BEGINNER: 3, INTERMEDIATE: 4, UPPER_INTERMEDIATE: 5, ADVANCED: 6 }).find(([, value]) => value === effectiveWeight)?.[0];
  return <Card className="synergy-teams-card"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Session locks</p><h3 className="display mt-1 text-2xl">Synergy Teams</h3><p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Lock two players together for every future game. Their original skills stay unchanged; matchmaking uses the higher skill.</p></div><Button onClick={openCreate} disabled={ended || allPlayers.length < 2}><Plus size={16} /> Add team</Button></div>{teams.length === 0 ? <p className="mt-4 rounded-2xl bg-[#fbfdfb] px-4 py-3 text-sm text-[var(--muted)]">No locked pairs yet. Queue status actions remain individual.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{teams.map((team) => { const first = byId.get(team.queuePlayerIds[0]); const second = byId.get(team.queuePlayerIds[1]); return <div key={team.id} className="rounded-2xl border border-[var(--line)] bg-[#fbfdfb] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{first?.displayName ?? "Unknown player"} <span className="text-[var(--muted)]">+</span> {second?.displayName ?? "Unknown player"}</p><p className="mt-1 text-xs text-[var(--muted)]">{first?.skillLevel ? pretty(first.skillLevel) : "—"} · {first?.status ?? "Unavailable"} <span className="mx-1">·</span> {second?.skillLevel ? pretty(second.skillLevel) : "—"} · {second?.status ?? "Unavailable"}</p></div><Badge tone="teal">{pretty(team.effectiveSkillLevel)} skill</Badge></div><div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs text-[var(--muted)]">Matchmaking skill <strong className="text-[var(--ink)]">{team.effectiveSkillWeight}</strong></span><div className="flex gap-2"><Button variant="quiet" className="px-3 py-1.5 text-xs" disabled={ended || [first, second].some((player) => player?.status === "QUEUED" || player?.status === "PLAYING")} onClick={() => openEdit(team)}><Pencil size={14} /> Edit</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" disabled={ended || dissolve.isPending || [first, second].some((player) => player?.status === "QUEUED" || player?.status === "PLAYING")} onClick={() => { dissolve.mutate(team); }}><X size={14} /> Dissolve</Button></div></div></div>; })}</div>}
    {editing !== undefined && <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="synergy-dialog-title" className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:mx-auto sm:max-w-xl sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Synergy Team</p><h2 id="synergy-dialog-title" className="display mt-1 text-3xl">{editing ? "Edit locked pair" : "Create locked pair"}</h2></div><Button variant="quiet" className="px-3" onClick={() => { if (!pending) { setEditing(undefined); setSelected([]); } }} aria-label="Close Synergy Team dialog"><X size={18} /></Button></div><div className="mt-5 grid grid-cols-2 gap-2">{[0, 1].map((slot) => { const player = selected[slot] ? byId.get(selected[slot]!) : undefined; return <div key={slot} className="min-h-16 rounded-2xl border border-dashed border-[var(--line)] bg-[#fbfdfb] p-3"><p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Member {slot + 1}</p><p className="mt-1 truncate text-sm font-semibold">{player?.displayName ?? "Choose below"}</p>{player && <p className="text-xs text-[var(--muted)]">{pretty(player.skillLevel)} · {player.status}</p>}</div>; })}</div><label className="mt-4 block text-sm font-semibold">Search session players<Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, status, or skill" /></label><div className="mt-3 max-h-56 space-y-2 overflow-y-auto">{candidates.map((player) => { const busy = player.status === "QUEUED" || player.status === "PLAYING"; const alreadyPaired = paired.has(player.id) && !selected.includes(player.id); return <button type="button" key={player.id} onClick={() => toggle(player)} disabled={busy || alreadyPaired} className={`focus-ring flex min-h-11 w-full items-center justify-between rounded-2xl border px-3 py-2 text-left ${selected.includes(player.id) ? "border-[var(--teal)] bg-[#edf8f4]" : "border-[var(--line)] bg-white"}`}><span className="min-w-0"><span className="block truncate text-sm font-semibold">{player.displayName}</span><span className="block text-xs text-[var(--muted)]">{pretty(player.skillLevel)} · {player.status}{busy ? " · Busy" : alreadyPaired ? " · Already paired" : ""}</span></span>{selected.includes(player.id) && <Check size={16} className="text-[var(--teal)]" />}</button>; })}</div>{selected.length === 2 && <p className="mt-4 rounded-2xl bg-[#edf8f4] px-3 py-2 text-sm">Matchmaking skill preview: <strong>{effectiveLevel ? pretty(effectiveLevel) : "—"} ({effectiveWeight})</strong></p>}{(create.isError || update.isError) && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(create.error ?? update.error)}</p>}<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="quiet" onClick={() => { setEditing(undefined); setSelected([]); }} disabled={pending}>Cancel</Button><Button onClick={() => editing ? update.mutate() : create.mutate()} disabled={selected.length !== 2 || pending}>{pending ? "Saving…" : editing ? "Save pair" : "Create pair"}</Button></div></div></div>}
  </Card>;
}

function ManualPlayerPicker({ team, players, selectedIds, teamSize, onSelect, onClose }: { team: "A" | "B"; players: SessionPlayer[]; selectedIds: Set<string>; teamSize: number; onSelect: (player: SessionPlayer) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const eligible = useMemo(() => { const needle = search.trim().toLowerCase(); return players.filter((player) => !selectedIds.has(player.id) && ["WAITING", "PLAYING", "QUEUED", "RESTING"].includes(player.status) && (!needle || `${player.displayName} ${player.gender} ${player.skillLevel} ${player.status}`.toLowerCase().includes(needle))); }, [players, search, selectedIds]);
  useEffect(() => { dialogRef.current?.focus(); const listener = (event: KeyboardEvent) => { if (event.key === "Escape") { onClose(); return; } if (event.key !== "Tab" || !dialogRef.current) return; const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((element) => !element.hasAttribute("disabled")); if (!focusable.length) return; const first = focusable[0]!; const last = focusable[focusable.length - 1]!; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, [onClose]);
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="stacked-manual-picker-title" className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:mx-auto sm:max-w-lg sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--teal)]">Manual matchup</p><h2 id="stacked-manual-picker-title" className="display mt-1 text-3xl">Choose Team {team} player</h2></div><Button variant="quiet" className="px-3" aria-label="Close player picker" onClick={onClose}><X size={18} /></Button></div><label className="mt-5 block text-sm font-semibold">Search queued players<Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, status, gender, or skill" /></label><div className="mt-4 space-y-2">{eligible.length === 0 ? <EmptyState icon={UsersRound} title="No eligible players" body="Waiting, playing, and queued players can be added once per lineup." /> : eligible.map((player) => { const statusText = player.status === "PLAYING" ? "Playing now · queue for later" : player.status === "QUEUED" ? "Already queued · can be added again" : `${waitMinutes(player)} waiting`; const pairUnavailable = teamSize > 0 && Boolean(player.synergyTeamId); return <button type="button" disabled={pairUnavailable} key={player.id} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[var(--line)] p-3 text-left hover:border-[var(--teal)]" onClick={() => onSelect(player)}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{player.displayName}</span><span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]"><StatusBadge status={player.status} /><span>{player.gender === "MALE" ? "Male" : "Female"} · {pretty(player.skillLevel)} · {player.matchesPlayed} games · {statusText}{pairUnavailable ? " · Needs two open slots" : ""}</span></span></span><Plus size={17} className="shrink-0 text-[var(--teal)]" /></button>; })}</div></div></div>;
}

function suggestionApiMode(mode: string) { return mode.startsWith("BALANCED") ? "BALANCED" : mode; }
function suggestionStrengthGap(mode: string): 1 | 2 | 3 | undefined { return mode === "BALANCED" || mode === "BALANCED_1" ? 1 : mode === "BALANCED_2" ? 2 : mode === "BALANCED_3" ? 3 : undefined; }
function nextTighterMatchMode(mode: string) { return mode === "BALANCED_3" ? "BALANCED_2" : mode === "BALANCED_2" ? "BALANCED_1" : mode === "BALANCED_1" || mode === "BALANCED" ? "SAME_SKILL" : null; }
function matchModeLabel(mode: string) { return mode === "BALANCED_3" ? "Handicap +3 strength" : mode === "BALANCED_2" ? "Handicap +2 strength" : mode === "BALANCED_1" || mode === "BALANCED" ? "Handicap +1 strength" : mode === "SAME_SKILL" ? "Same skill" : mode; }

type SuggestionTeam = "A" | "B";
type SuggestionDraft = { teamA: string[]; teamB: string[] };
type SuggestionPickerTarget = { team: SuggestionTeam; slot: number };
type MatchmakerPersistedState = {
  mode: string;
  strengthGap: 1 | 2 | 3;
  suggestion: Suggestion | null;
  draft: SuggestionDraft | null;
  editing: boolean;
  courtId: string;
  suggestionScope: string;
  suggestionCycle: { scope: string; keys: string[] };
};
const EMPTY_MATCHMAKER_STATE: MatchmakerPersistedState = { mode: "SAME_SKILL", strengthGap: 1, suggestion: null, draft: null, editing: false, courtId: "", suggestionScope: "", suggestionCycle: { scope: "", keys: [] } };
const MatchmakerPersistenceContext = createContext<{ state: MatchmakerPersistedState; onPersist: (state: MatchmakerPersistedState) => void; clear: () => void; version: number }>({ state: EMPTY_MATCHMAKER_STATE, onPersist: () => undefined, clear: () => undefined, version: 0 });

function strengthValue(player: Pick<SessionPlayer, "skillWeight" | "skillLevel">) {
  return player.skillWeight ?? Math.max(0, SKILLS.indexOf(player.skillLevel) + 1);
}

function remainingSuggestionTime(expiresAt: number, now: number) {
  const remaining = Math.max(0, expiresAt - now);
  if (remaining === 0) return "Suggestion expired";
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
  return `Valid for ${minutes}:${seconds}`;
}

function SuggestedPlayerPicker({
  target,
  currentPlayer,
  opponents,
  players,
  selectedIds,
  serverTime,
  onReplace,
  onSwap,
  onClose,
}: {
  target: SuggestionPickerTarget;
  currentPlayer: SessionPlayer | undefined;
  opponents: { player: SessionPlayer | undefined; target: SuggestionPickerTarget }[];
  players: SessionPlayer[];
  selectedIds: Set<string>;
  serverTime: string;
  onReplace: (player: SessionPlayer) => void;
  onSwap: (target: SuggestionPickerTarget) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const eligible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return players.filter((player) => {
      if (player.status !== "WAITING" || selectedIds.has(player.id)) return false;
      if (currentPlayer?.synergyTeamId && !player.synergyTeamId) return false;
      if (player.synergyTeamId) {
        const partner = players.find((candidate) => candidate.synergyTeamId === player.synergyTeamId && candidate.id !== player.id);
        if (!partner || partner.status !== "WAITING" || selectedIds.has(partner.id) || player.id.localeCompare(partner.id) > 0) return false;
      }
      return !needle || `${player.displayName} ${player.gender} ${player.skillLevel}`.toLowerCase().includes(needle);
    });
  }, [currentPlayer?.synergyTeamId, players, search, selectedIds]);
  useEffect(() => {
    dialogRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="suggestion-picker-title" className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none sm:mx-auto sm:max-w-lg sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--teal)]">Edit suggested lineup</p><h2 id="suggestion-picker-title" className="display mt-1 text-3xl">Team {target.team} player {target.slot + 1}</h2><p className="mt-1 text-sm text-[var(--muted)]">{currentPlayer?.displayName ?? "Unavailable player"}</p></div><Button variant="quiet" className="px-3" aria-label="Close lineup editor" onClick={onClose}><X size={18} /></Button></div>{opponents.length > 0 && <div className="mt-5"><p className="text-sm font-semibold">Swap with an opposing player</p><div className="mt-2 space-y-2">{opponents.map(({ player, target: opponentTarget }) => <button type="button" key={`${opponentTarget.team}-${opponentTarget.slot}`} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[var(--line)] p-3 text-left hover:border-[var(--teal)] disabled:cursor-not-allowed disabled:opacity-50" disabled={!player} onClick={() => onSwap(opponentTarget)}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{player?.displayName ?? "Unavailable player"}</span><span className="block text-xs text-[var(--muted)]">{player ? `${playerDetails(player)} · ${player.matchesPlayed} games` : "No longer waiting"}</span></span><Zap size={16} className="shrink-0 text-[var(--orange)]" /></button>)}</div></div>}<label className="mt-5 block text-sm font-semibold">Replace with another waiting player<Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, gender, or skill" /></label><div className="mt-3 space-y-2">{eligible.length === 0 ? <EmptyState icon={UsersRound} title="No eligible players" body="Only waiting players not already in this lineup can replace the slot." /> : eligible.map((player) => <button type="button" key={player.id} className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-[var(--line)] p-3 text-left hover:border-[var(--teal)]" onClick={() => onReplace(player)}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{player.displayName}</span><span className="block text-xs text-[var(--muted)]">{playerDetails(player)} · {player.matchesPlayed} games · {waitMinutes(player, serverTime)} waiting</span></span><Plus size={17} className="shrink-0 text-[var(--teal)]" /></button>)}</div></div></div>;
}

function MatchmakerPanel({ sessionId, queue, courts, onChanged }: { sessionId: string; queue: QueueState; courts: Court[]; onChanged: () => void }) {
  const { state: persisted, onPersist, version: persistenceVersion } = useContext(MatchmakerPersistenceContext);
  const [panelMode, setPanelMode] = useState<"suggested" | "manual">("suggested");
  const [mode, setMode] = useState(persisted.mode);
  const strengthGap = suggestionStrengthGap(mode) ?? persisted.strengthGap;
  const [suggestion, setSuggestion] = useState<Suggestion | null>(persisted.suggestion);
  const [draft, setDraft] = useState<SuggestionDraft | null>(persisted.draft);
  const [editing, setEditing] = useState(persisted.editing);
  const [courtId, setCourtIdRaw] = useState(persisted.courtId);
  const [manualTeamA, setManualTeamARaw] = useState<string[]>([]);
  const [manualTeamB, setManualTeamBRaw] = useState<string[]>([]);
  const [pickerTarget, setPickerTarget] = useState<SuggestionPickerTarget | null>(null);
  const [advisoryOpen, setAdvisoryOpen] = useState(false);
  const [suggestionScope, setSuggestionScope] = useState(persisted.suggestionScope);
  const [suggestionCycle, setSuggestionCycle] = useState<{ scope: string; keys: string[] }>(persisted.suggestionCycle);
  const [noMatch, setNoMatch] = useState<{ code: SuggestionNoMatchCode; message: string; nextEligibleAt?: string | null; readyMaleCount?: number; readyFemaleCount?: number; waitingMaleCount?: number; waitingFemaleCount?: number } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const previousPersistenceVersion = useRef(persistenceVersion);
  const manualPlayers = useMemo(() => [...queue.waiting, ...queue.playing, ...queue.queued, ...queue.resting], [queue.playing, queue.queued, queue.resting, queue.waiting]);
  const challengePlayers = queue.undefeatedChallenge?.players ?? [];
  const readyChallengePlayers = challengePlayers.filter((player) => player.ready);
  const waitingFingerprint = useMemo(() => matchmakingWaitingFingerprint(queue), [queue]);
  const mixedCounts = useMemo(() => {
    const waiting = queue.waiting;
    const ready = waiting.filter((player) => isQueuePlayerReady(player, queue.serverTime));
    return {
      waitingMale: waiting.filter((player) => player.gender === "MALE").length,
      waitingFemale: waiting.filter((player) => player.gender === "FEMALE").length,
      readyMale: ready.filter((player) => player.gender === "MALE").length,
      readyFemale: ready.filter((player) => player.gender === "FEMALE").length,
    };
  }, [queue.serverTime, queue.waiting]);
  const cycleScope = `${mode}|${strengthGap}|${waitingFingerprint}`;
  const excludedSuggestionKeys = suggestionCycle.scope === cycleScope ? suggestionCycle.keys : [];
  const waitingById = useMemo(() => new Map(queue.waiting.map((player) => [player.id, player])), [queue.waiting]);
  const manualById = useMemo(() => new Map(manualPlayers.map((player) => [player.id, player])), [manualPlayers]);
  const suggestionById = useMemo(() => new Map((suggestion ? [...suggestion.teamA, ...suggestion.teamB] : []).map((player) => [player.id, player])), [suggestion]);
  const getPlayer = (id: string | undefined) => id ? waitingById.get(id) ?? suggestionById.get(id) : undefined;
  const getManualPlayer = (id: string | undefined) => { const player = id ? manualById.get(id) : undefined; if (!player) return undefined; const suffix = player.status === "WAITING" ? "" : ` · ${pretty(player.status)}`; return { ...player, displayName: `${player.displayName}${suffix}` }; };
  const draftIds = draft ? [...draft.teamA, ...draft.teamB] : [];
  const selectedIds = new Set(draftIds);
  const unavailableIds = draftIds.filter((id) => !waitingById.has(id));
  const draftTeamAPlayers = draft?.teamA.map((id) => getPlayer(id)).filter((player): player is SessionPlayer => Boolean(player)) ?? [];
  const draftTeamBPlayers = draft?.teamB.map((id) => getPlayer(id)).filter((player): player is SessionPlayer => Boolean(player)) ?? [];
  const draftMixedError = mode === "MIXED_DOUBLES" ? validateMixedDoublesLineup(draftTeamAPlayers, draftTeamBPlayers) : null;
  const draftGenderError = prohibitedGeneratedGenderLineup(draftTeamAPlayers, draftTeamBPlayers) ? "Generated matchups cannot place two female players against two male players." : null;
  const draftBalanceError = suggestionApiMode(mode) === "BALANCED" ? balancedLineupError(draftTeamAPlayers, draftTeamBPlayers, strengthGap ?? 1) : null;
  const draftConstraintError = draftMixedError ?? draftGenderError ?? draftBalanceError;
  const draftReady = Boolean(draft && draft.teamA.length === 2 && draft.teamB.length === 2 && new Set(draftIds).size === 4 && unavailableIds.length === 0 && !draftConstraintError);
  const matchupAdvisory = draft ? lowSkillLoneFemaleAdvisory(draftTeamAPlayers, draftTeamBPlayers) : null;
  const advisoryTeamA = draftTeamAPlayers.map((player) => player.displayName).join(" & ") || "Team A";
  const advisoryTeamB = draftTeamBPlayers.map((player) => player.displayName).join(" & ") || "Team B";
  const isAdjusted = Boolean(suggestion && draft && (suggestion.teamA.some((player, index) => draft.teamA[index] !== player.id) || suggestion.teamB.some((player, index) => draft.teamB[index] !== player.id)));
  const expired = Boolean(suggestion && suggestion.expiresAt <= clock);
  const availableCourts = courts.filter((court) => court.status === "AVAILABLE");
  const teamPlayers = (ids: string[]) => ids.map(getManualPlayer).filter((player): player is SessionPlayer => Boolean(player)).map((player) => player.latePenaltyState === "PENDING" ? { ...player, displayName: `${player.displayName} · Late priority pending` } : player);
  const teamTotal = (ids: string[]) => teamPlayers(ids).reduce((total, player) => total + strengthValue(player), 0);
  const originalDraft: SuggestionDraft | null = suggestion ? { teamA: suggestion.teamA.map((player) => player.id), teamB: suggestion.teamB.map((player) => player.id) } : null;
  useEffect(() => {
    if (previousPersistenceVersion.current === persistenceVersion) return;
    previousPersistenceVersion.current = persistenceVersion;
    setMode("SAME_SKILL"); setSuggestion(null); setDraft(null); setEditing(false); setCourtIdRaw(""); setSuggestionScope(""); setSuggestionCycle({ scope: "", keys: [] });
  }, [persistenceVersion]);
  useEffect(() => { onPersist({ mode, strengthGap, suggestion, draft, editing, courtId, suggestionScope, suggestionCycle }); }, [courtId, draft, editing, mode, onPersist, suggestion, suggestionCycle, suggestionScope, strengthGap]);
  useEffect(() => {
    if (!suggestion) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [suggestion]);
  useEffect(() => {
    if (!suggestion || !suggestionScope || suggestionScope === cycleScope) return;
    const timer = window.setTimeout(() => {
      setSuggestion(null);
      setDraft(null);
      setEditing(false);
      setPickerTarget(null);
      setSuggestionCycle({ scope: "", keys: [] });
      setCourtIdRaw("");
      toast.message("The queue changed, so this suggestion was refreshed. Generate a new lineup.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cycleScope, suggestion, suggestionScope]);
  useEffect(() => { if (draftConstraintError) toast.message(draftConstraintError); }, [draftConstraintError]);
  const suggest = useMutation({ mutationFn: () => api.suggestions(sessionId, suggestionApiMode(mode), suggestionStrengthGap(mode), excludedSuggestionKeys), onSuccess: (result) => { if (!result.suggestion) { setNoMatch(result.noMatch ?? null); const fallbackMode = result.noMatch?.code === "NO_EXACT_STRENGTH_GAP" ? nextTighterMatchMode(mode) : null; if (fallbackMode) { setMode(fallbackMode); setSuggestion(null); setDraft(null); setEditing(false); setSuggestionScope(""); setSuggestionCycle({ scope: "", keys: [] }); setPickerTarget(null); setCourtIdRaw(""); toast.message(`${result.noMatch?.message ?? "No exact handicap lineup is available."} ${matchModeLabel(fallbackMode)} is selected; generate again to try it.`); } else toast.message(result.noMatch?.message ?? "No valid group is available yet."); return; } setNoMatch(null); const nextSuggestion = result.suggestion; setSuggestion(nextSuggestion); setDraft({ teamA: nextSuggestion.teamA.map((player) => player.id), teamB: nextSuggestion.teamB.map((player) => player.id) }); setSuggestionScope(cycleScope); setEditing(false); setPickerTarget(null); setCourtIdRaw(availableCourts[0]?.id ?? ""); setSuggestionCycle((current) => { const keys = result.cycleRestarted || current.scope !== cycleScope ? [] : current.keys; return { scope: cycleScope, keys: [...new Set([...keys, nextSuggestion.key])].slice(-50) }; }); }, onError: (error) => toast.error(errorMessage(error)) });
  const createSuggested = useMutation({ mutationFn: ({ startNow, playerPreferenceConfirmed = false }: { startNow: boolean; playerPreferenceConfirmed?: boolean }) => { if (!suggestion || !draft || !draftReady) throw new Error(draftConstraintError ?? "Every selected player must still be waiting."); if (expired) throw new Error("This suggestion expired. Generate a new suggestion or continue in Manual mode."); if (startNow && !courtId) throw new Error("Select an available court first."); return api.createSuggestedMatch(sessionId, { teamA: draft.teamA, teamB: draft.teamB, suggestionToken: suggestion.token, suggestionAdjusted: isAdjusted, ...(playerPreferenceConfirmed ? { playerPreferenceConfirmed: true } : {}), ...(startNow ? { courtId } : {}) }); }, onSuccess: (_match, variables) => { setAdvisoryOpen(false); setSuggestion(null); setDraft(null); setSuggestionScope(""); setSuggestionCycle({ scope: "", keys: [] }); setEditing(false); setPickerTarget(null); setCourtId(""); onChanged(); toast.success(variables.startNow ? "Match started." : "Match queued."); }, onError: (error) => toast.error(errorMessage(error)) });
  const [manualPickerTeam, setManualPickerTeam] = useState<SuggestionTeam | null>(null);
  const expandManualPair = (ids: string[]) => {
    const result = [...new Set(ids)];
    for (const queuePlayerId of result.slice()) {
      const team = (queue.synergyTeams ?? []).find((candidate) => candidate.queuePlayerIds.includes(queuePlayerId));
      const partner = team?.queuePlayerIds.find((id) => id !== queuePlayerId);
      if (partner && !result.includes(partner)) result.push(partner);
    }
    // A locked pair consumes two slots. Keep the prior selection if adding a
    // pair would overflow a two-player side instead of creating a split pair.
    return result;
  };
  const setManualTeamA = (next: string[] | ((current: string[]) => string[])) => setManualTeamARaw((current) => { const candidate = typeof next === "function" ? next(current) : next; if (typeof next === "function" && current.length === 2 && candidate.length === 1) return []; const expanded = expandManualPair(candidate); return expanded.length <= 2 ? expanded : current; });
  const setManualTeamB = (next: string[] | ((current: string[]) => string[])) => setManualTeamBRaw((current) => { const candidate = typeof next === "function" ? next(current) : next; if (typeof next === "function" && current.length === 2 && candidate.length === 1) return []; const expanded = expandManualPair(candidate); return expanded.length <= 2 ? expanded : current; });
  const selectedManualIds = useMemo(() => new Set([...manualTeamA, ...manualTeamB]), [manualTeamA, manualTeamB]);
  const manualReady = manualTeamA.length > 0 && manualTeamA.length === manualTeamB.length && [1, 2].includes(manualTeamA.length) && new Set([...manualTeamA, ...manualTeamB]).size === manualTeamA.length + manualTeamB.length && [...manualTeamA, ...manualTeamB].every((id) => ["WAITING", "PLAYING", "QUEUED", "RESTING"].includes(manualById.get(id)?.status ?? ""));
  const manualCanStart = manualReady && [...manualTeamA, ...manualTeamB].every((id) => { const player = manualById.get(id); return player?.status === "WAITING" && (!player.restEligibleAt || Date.parse(player.restEligibleAt) <= clock); });
  const manualTeamAPlayers = manualTeamA.map((id) => manualById.get(id)).filter((player): player is SessionPlayer => Boolean(player));
  const manualTeamBPlayers = manualTeamB.map((id) => manualById.get(id)).filter((player): player is SessionPlayer => Boolean(player));
  const cleanManualPlayer = (player: SessionPlayer) => player;
  const manualMatchupAdvisory = lowSkillLoneFemaleAdvisory(manualTeamAPlayers.map(cleanManualPlayer), manualTeamBPlayers.map(cleanManualPlayer));
  const setCourtId = (next: string) => { if (panelMode === "manual" && !manualCanStart) { setCourtIdRaw(""); return; } setCourtIdRaw(next); };
  useEffect(() => { if (panelMode !== "manual" || manualCanStart || !courtId) return; const timer = window.setTimeout(() => setCourtIdRaw(""), 0); return () => window.clearTimeout(timer); }, [panelMode, manualCanStart, courtId]);
  const manualCreate = useMutation({ mutationFn: ({ startNow, playerPreferenceConfirmed = false }: { startNow: boolean; playerPreferenceConfirmed?: boolean }) => { if (!manualReady) throw new Error("Choose eligible players for a valid lineup."); if (startNow && manualMatchupAdvisory && !playerPreferenceConfirmed) { window.dispatchEvent(new CustomEvent<ManualAdvisoryRequest>("queue-manual-advisory", { detail: { advisory: manualMatchupAdvisory, teamA: manualTeamAPlayers.map((player) => cleanManualPlayer(player).displayName).join(" & "), teamB: manualTeamBPlayers.map((player) => cleanManualPlayer(player).displayName).join(" & "), confirm: () => manualCreate.mutate({ startNow: true, playerPreferenceConfirmed: true }) } })); queueMicrotask(() => manualCreate.reset()); throw new Error("Player preference confirmation required."); } if (startNow && !manualCanStart) throw new Error("Playing or queued players must be queued before they can start."); if (startNow && !courtId) throw new Error("Select an available court first."); return startNow ? api.startManualMatch(sessionId, manualTeamA, manualTeamB, courtId, playerPreferenceConfirmed) : api.queueManualMatch(sessionId, manualTeamA, manualTeamB); }, onSuccess: (_match, variables) => { setManualTeamA([]); setManualTeamB([]); setCourtId(""); onChanged(); toast.success(variables.startNow ? "Match started." : "Match queued."); } });
  const changeMode = (nextMode: string) => { if (nextMode === mode) return; if (isAdjusted && !window.confirm("Discard your edited lineup and generate in the new mode?")) return; setMode(nextMode); setNoMatch(null); setSuggestion(null); setDraft(null); setSuggestionScope(""); setSuggestionCycle({ scope: "", keys: [] }); setEditing(false); setPickerTarget(null); setCourtId(""); };
  const requestSuggestion = () => { if (isAdjusted && !window.confirm("Discard this edited lineup and generate another suggestion?")) return; suggest.mutate(); };
  const resetDraft = () => { if (!originalDraft) return; setDraft({ teamA: [...originalDraft.teamA], teamB: [...originalDraft.teamB] }); setNoMatch(null); setEditing(false); setPickerTarget(null); };
  const replaceSlot = (player: SessionPlayer) => {
    if (!pickerTarget || !draft) return;
    setDraft((current) => {
      if (!current) return current;
      const sourceKey = pickerTarget.team === "A" ? "teamA" : "teamB";
      const sourceId = current[sourceKey][pickerTarget.slot];
      const next = { teamA: [...current.teamA], teamB: [...current.teamB] };
      const sourcePlayer = sourceId ? getPlayer(sourceId) : undefined;
      const sourceTeamId = sourcePlayer?.synergyTeamId;
      const replacementPair = player.synergyTeamId
        ? manualPlayers.filter((candidate) => candidate.synergyTeamId === player.synergyTeamId && candidate.status === "WAITING").map((candidate) => candidate.id)
        : [];
      if (sourceTeamId) {
        if (replacementPair.length !== 2) { toast.message("Both members of the replacement pair must be waiting."); return current; }
        const sourcePair = current[sourceKey].filter((id) => getPlayer(id)?.synergyTeamId === sourceTeamId);
        if (sourcePair.length !== 2) { toast.message("Locked partners must stay together."); return current; }
        next[sourceKey] = pickerTarget.slot === 0 ? replacementPair : [replacementPair[1]!, replacementPair[0]!];
      } else if (player.synergyTeamId) {
        if (replacementPair.length !== 2 || current[sourceKey].length !== 2) { toast.message("Both team slots must be available for a locked pair."); return current; }
        const otherSlot = pickerTarget.slot === 0 ? 1 : 0;
        const otherId = current[sourceKey][otherSlot];
        if (otherId && getPlayer(otherId)?.synergyTeamId) { toast.message("Locked partners must stay together."); return current; }
        next[sourceKey] = pickerTarget.slot === 0 ? replacementPair : [replacementPair[1]!, replacementPair[0]!];
      } else {
        next[sourceKey][pickerTarget.slot] = player.id;
      }
      return next;
    });
    setPickerTarget(null);
  };
  const swapSlots = (target: SuggestionPickerTarget) => {
    if (!pickerTarget || !draft) return;
    setDraft((current) => {
      if (!current) return current;
      const sourceKey = pickerTarget.team === "A" ? "teamA" : "teamB";
      const targetKey = target.team === "A" ? "teamA" : "teamB";
      const sourceId = current[sourceKey][pickerTarget.slot];
      const targetId = current[targetKey][target.slot];
      if (!sourceId || !targetId) return current;
      if (getPlayer(sourceId)?.synergyTeamId || getPlayer(targetId)?.synergyTeamId) {
        toast.message("Locked partners cannot be split. Change the pair in the Synergy Teams card.");
        return current;
      }
      const next = { teamA: [...current.teamA], teamB: [...current.teamB] };
      next[sourceKey][pickerTarget.slot] = targetId;
      next[targetKey][target.slot] = sourceId;
      return next;
    });
    setPickerTarget(null);
  };
  const transferToManual = () => { if (!draft || unavailableIds.length > 0) { toast.error("Replace unavailable players before continuing in Manual mode."); return; } setManualTeamA([...draft.teamA]); setManualTeamB([...draft.teamB]); setPanelMode("manual"); setSuggestion(null); setDraft(null); setEditing(false); setPickerTarget(null); setCourtId(""); };
  const renderSlot = (team: SuggestionTeam, slot: number) => {
    const id = draft?.[team === "A" ? "teamA" : "teamB"][slot];
    const player = id ? getPlayer(id) : undefined;
    const unavailable = Boolean(id && !waitingById.has(id));
    const highlighted = Boolean(id && matchupAdvisory?.queuePlayerId === id);
    const borderClass = highlighted ? "border-[#e9b27f] bg-[#fff8f1]" : unavailable ? "border-[#d98964] bg-[#fffaf5]" : "border-[var(--line)] bg-white";
    const pairAwareContent = <><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate font-semibold">{player?.displayName ?? "Player unavailable"}</span>{highlighted && matchupAdvisory && <LoneFemaleWarningIcon advisory={matchupAdvisory} />}</span><span className="block truncate text-xs text-[var(--muted)]">{player ? `${playerDetails(player)} · ${player.matchesPlayed} games` : "No longer waiting"}</span></span>{editing && <ChevronDown size={15} className="shrink-0 text-[var(--muted)]" />} </>;
    const slotElement = editing ? <button type="button" className={`focus-ring flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left ${borderClass}`} onClick={() => setPickerTarget({ team, slot })}>{pairAwareContent}</button> : <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${borderClass}`}>{pairAwareContent}</div>;
    return <Fragment key={`${team}-${slot}`}><div className="space-y-2">{slotElement}</div>{team === "A" && slot === 0 && matchupAdvisory && advisoryOpen && <MatchupAdvisoryDialog advisory={matchupAdvisory} teamA={advisoryTeamA} teamB={advisoryTeamB} queued={false} pending={createSuggested.isPending} error={createSuggested.isError ? createSuggested.error : undefined} onConfirm={() => createSuggested.mutate({ startNow: true, playerPreferenceConfirmed: true })} onEdit={() => { setAdvisoryOpen(false); setEditing(true); }} onAlternative={() => { setAdvisoryOpen(false); requestSuggestion(); }} onDiscard={() => { setAdvisoryOpen(false); requestSuggestion(); }} onClose={() => { if (!createSuggested.isPending) setAdvisoryOpen(false); }} />}</Fragment>;
  };
  const showSuggested = Boolean(suggestion && draft);
  return <Card className="h-fit lg:sticky lg:top-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Matchmaker</p><h3 className="display mt-1 text-3xl">Make the next match.</h3></div><Sparkles className="text-[var(--orange)]" size={22} /></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Use a fair suggestion or choose a singles/doubles lineup yourself. A saved lineup can wait for a court.</p><div className="mt-5 grid grid-cols-2 rounded-2xl bg-[#f1f5f2] p-1"><button type="button" className={`focus-ring rounded-xl px-3 py-2 text-sm font-semibold ${panelMode === "suggested" ? "bg-white text-[var(--teal-dark)] shadow-sm" : "text-[var(--muted)]"}`} onClick={() => setPanelMode("suggested")}>Suggested</button><button type="button" className={`focus-ring rounded-xl px-3 py-2 text-sm font-semibold ${panelMode === "manual" ? "bg-white text-[var(--teal-dark)] shadow-sm" : "text-[var(--muted)]"}`} onClick={() => setPanelMode("manual")}>Manual</button></div>
    {panelMode === "suggested" ? <><label className="mt-5 block text-sm font-semibold">Match mode<Select value={mode} onChange={(event) => changeMode(event.target.value)}><option value="BALANCED">Balanced</option><option value="MIXED_DOUBLES">Mixed doubles</option><option value="SAME_GENDER">Same gender</option><option value="SAME_SKILL">Same skill</option><option value="OPEN">Open</option><option value="UNDEFEATED_CHALLENGE">Undefeated challenge</option></Select></label>{mode === "MIXED_DOUBLES" && <div role="status" className="mt-2 rounded-2xl border border-[#b8ded1] bg-[#edf8f4] px-3 py-2 text-xs text-[var(--teal-dark)]"><p className="font-semibold">Mixed doubles requires 2 ready male + 2 ready female players, with one of each on every team.</p><p className="mt-1">Ready: {mixedCounts.readyMale} male / {mixedCounts.readyFemale} female · Waiting: {mixedCounts.waitingMale} male / {mixedCounts.waitingFemale} female</p></div>}<p className="mt-2 text-xs text-[var(--muted)]">Undefeated challenge changes lineup difficulty only; scoring stays the same.</p>{challengePlayers.length > 0 && <div className="mt-4 rounded-2xl border border-[#f6c49f] bg-[#fffaf5] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Undefeated challenge</p><p className="mt-1 text-xs text-[var(--muted)]">Current top-three qualifiers stay visible while playing or resting.</p></div><Badge tone="orange">{readyChallengePlayers.length} ready</Badge></div><div className="mt-2 space-y-1 text-xs">{challengePlayers.map((player) => <p key={player.queuePlayerId}><span className="font-semibold">#{player.rank} {player.displayName}</span> · {player.wins}-{player.losses} ({player.matchesPlayed} matches) · {player.ready ? "ready" : "not ready"}</p>)}</div><Button variant="quiet" className="mt-3 w-full px-3 py-1.5 text-xs" onClick={() => changeMode("UNDEFEATED_CHALLENGE")} disabled={mode === "UNDEFEATED_CHALLENGE"}>Use Undefeated challenge mode</Button></div>}{noMatch && <div role="status" className="mt-3 rounded-2xl border border-[#f6c49f] bg-[#fffaf5] px-3 py-2 text-sm text-[#8d4824]"><p>{noMatch.message}</p>{mode === "MIXED_DOUBLES" && <p className="mt-1 text-xs">Ready: {noMatch.readyMaleCount ?? mixedCounts.readyMale} male / {noMatch.readyFemaleCount ?? mixedCounts.readyFemale} female · Waiting: {noMatch.waitingMaleCount ?? mixedCounts.waitingMale} male / {noMatch.waitingFemaleCount ?? mixedCounts.waitingFemale}</p>}</div>}<Button className="mt-3 w-full" onClick={requestSuggestion} disabled={suggest.isPending || queue.waiting.length < 4}>{suggest.isPending ? "Finding a fair group…" : showSuggested ? "Try another lineup" : "Suggest lineup"}</Button>{queue.waiting.length < 4 && <p className="mt-2 text-xs text-[var(--muted)]">Need four waiting players. There are {mixedCounts.readyMale + mixedCounts.readyFemale} ready.</p>}{showSuggested && draft && suggestion && <div className="mt-5 space-y-4 border-t border-[var(--line)] pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><Badge tone={isAdjusted ? "orange" : "teal"}>{isAdjusted ? "Queue Master adjusted" : "Suggested"}</Badge>{mode === "UNDEFEATED_CHALLENGE" && !isAdjusted && <Badge tone="orange">Challenge</Badge>}<span className={`text-xs ${expired ? "text-[#a74646]" : "text-[var(--muted)]"}`}>{remainingSuggestionTime(suggestion.expiresAt, clock)}</span></div><div className="flex gap-2"><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => editing ? setEditing(false) : setEditing(true)}>{editing ? "Done editing" : "Edit lineup"}</Button>{isAdjusted && <Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={resetDraft}>Reset lineup</Button>}</div></div><div className="grid grid-cols-2 gap-2"><div className="rounded-2xl bg-[#edf8f4] p-3"><p className="text-xs font-bold uppercase text-[var(--teal)]">Team A</p><div className="mt-2 space-y-2 text-sm">{[0, 1].map((slot) => renderSlot("A", slot))}</div><p className="mt-2 text-xs text-[var(--muted)]">{teamTotal(draft.teamA)} strength</p></div><div className="rounded-2xl bg-[#fff4ec] p-3"><p className="text-xs font-bold uppercase text-[#a85b2b]">Team B</p><div className="mt-2 space-y-2 text-sm">{[0, 1].map((slot) => renderSlot("B", slot))}</div><p className="mt-2 text-xs text-[var(--muted)]">{teamTotal(draft.teamB)} strength</p></div></div>{mode.startsWith("BALANCED") && handicapAdvantageLabel(teamTotal(draft.teamA), teamTotal(draft.teamB)) && <Badge tone="orange">{handicapAdvantageLabel(teamTotal(draft.teamA), teamTotal(draft.teamB))}</Badge>}{isAdjusted ? <p className="rounded-2xl bg-[#fff4ec] px-3 py-2 text-xs leading-5 text-[#8d4824]">This is a Queue Master override. The selected mode’s automatic balance and rotation guarantees may no longer apply.</p> : <>{mode === "UNDEFEATED_CHALLENGE" && <p className="rounded-2xl bg-[#fffaf5] px-3 py-2 text-xs text-[#8d4824]">Challenge policy: qualified players oppose whenever the lineup permits it; supporting players are selected for fair queue rotation. Scoring is unchanged.</p>}<p className="text-xs text-[var(--muted)]">{rotationMessage(suggestion)}</p></>}{draftConstraintError && isAdjusted && <div role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]"><p>{draftConstraintError}</p><Button variant="quiet" className="mt-2 px-3 py-1.5 text-xs" onClick={transferToManual}>Continue in Manual mode</Button></div>}{unavailableIds.length > 0 && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">A selected player is no longer waiting. Replace that slot before starting or queueing.</p>}{expired && <div className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]"><p>This suggestion has expired.</p><div className="mt-2 flex flex-wrap gap-2"><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={requestSuggestion}>Generate fresh suggestion</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={transferToManual}>Continue in Manual mode</Button></div></div>}<label className="block text-sm font-semibold">Court for immediate start<Select value={courtId} onChange={(event) => setCourtId(event.target.value)}><option value="">No court selected</option>{availableCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</Select></label>{availableCourts.length === 0 && <p className="text-xs text-[#8d4824]">No available courts. You can still queue this adjusted matchup.</p>}{availableCourts.length > 0 && !courtId && <p className="text-xs text-[var(--muted)]">Choose an available court above to enable Start match.</p>}{createSuggested.isError && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(createSuggested.error)}</p>}<div className="flex flex-col gap-2 sm:flex-row"><Button className="flex-1" onClick={() => matchupAdvisory ? setAdvisoryOpen(true) : createSuggested.mutate({ startNow: true })} disabled={!draftReady || expired || !courtId || createSuggested.isPending}>{createSuggested.isPending ? "Starting…" : "Start match"}</Button><Button variant="quiet" className="flex-1" onClick={() => createSuggested.mutate({ startNow: false })} disabled={!draftReady || expired || createSuggested.isPending}>{createSuggested.isPending ? "Saving…" : "Queue matchup"}</Button></div></div>}</> : <div className="mt-5 space-y-4 border-t border-[var(--line)] pt-5"><div className="grid grid-cols-2 gap-2"><div className="rounded-2xl border border-[var(--line)] bg-[#edf8f4] p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase text-[var(--teal)]">Team A</p><Badge tone="teal">{manualTeamA.length}/2</Badge></div><div className="mt-3 space-y-2">{teamPlayers(manualTeamA).map((player) => <div key={player.id} className="flex items-center gap-1 rounded-xl bg-white px-2 py-2 text-sm"><span className="flex min-w-0 flex-1 items-center gap-1"><span className="min-w-0 truncate">{player.displayName}</span>{manualMatchupAdvisory && manualMatchupAdvisory.queuePlayerId === player.id && <LoneFemaleWarningIcon advisory={manualMatchupAdvisory} />}</span><button type="button" className="focus-ring rounded-full p-1 text-[var(--muted)] hover:text-[#a74646]" aria-label={`Remove ${player.displayName} from Team A`} onClick={() => setManualTeamA((current) => current.filter((playerId) => playerId !== player.id))}><X size={14} /></button></div>)}{manualTeamA.length < 2 && <Button variant="quiet" className="w-full px-2 py-1.5 text-xs" onClick={() => setManualPickerTeam("A")}><Plus size={14} /> Add player</Button>}</div></div><div className="rounded-2xl border border-[var(--line)] bg-[#fff4ec] p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase text-[#a85b2b]">Team B</p><Badge tone="orange">{manualTeamB.length}/2</Badge></div><div className="mt-3 space-y-2">{teamPlayers(manualTeamB).map((player) => <div key={player.id} className="flex items-center gap-1 rounded-xl bg-white px-2 py-2 text-sm"><span className="flex min-w-0 flex-1 items-center gap-1"><span className="min-w-0 truncate">{player.displayName}</span>{manualMatchupAdvisory && manualMatchupAdvisory.queuePlayerId === player.id && <LoneFemaleWarningIcon advisory={manualMatchupAdvisory} />}</span><button type="button" className="focus-ring rounded-full p-1 text-[var(--muted)] hover:text-[#a74646]" aria-label={`Remove ${player.displayName} from Team B`} onClick={() => setManualTeamB((current) => current.filter((playerId) => playerId !== player.id))}><X size={14} /></button></div>)}{manualTeamB.length < 2 && <Button variant="quiet" className="w-full px-2 py-1.5 text-xs" onClick={() => setManualPickerTeam("B")}><Plus size={14} /> Add player</Button>}</div></div></div><p className="text-xs text-[var(--muted)]">Choose one player per team for singles, or two per team for doubles.</p><label className="block text-sm font-semibold">Court for immediate start<Select value={courtId} onChange={(event) => setCourtId(event.target.value)}><option value="">No court selected</option>{availableCourts.map((court) => <option value={court.id} key={court.id}>{court.name}</option>)}</Select></label>{availableCourts.length === 0 && <p className="text-xs text-[#8d4824]">No available courts. You can still queue this matchup.</p>}{manualCreate.isError && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(manualCreate.error)}</p>}<div className="flex flex-col gap-2"><Button onClick={() => manualCreate.mutate({ startNow: true })} disabled={!manualReady || !courtId || manualCreate.isPending}>{manualCreate.isPending ? "Starting…" : "Start match"}</Button><Button variant="quiet" onClick={() => manualCreate.mutate({ startNow: false })} disabled={!manualReady || manualCreate.isPending}>Queue matchup</Button></div></div>}
    {manualPickerTeam && <ManualPlayerPicker team={manualPickerTeam} players={manualPlayers} selectedIds={selectedManualIds} teamSize={manualPickerTeam === "A" ? manualTeamA.length : manualTeamB.length} onSelect={(player) => { if (manualPickerTeam === "A") setManualTeamA((current) => [...current, player.id]); else setManualTeamB((current) => [...current, player.id]); setManualPickerTeam(null); }} onClose={() => setManualPickerTeam(null)} />}
    {pickerTarget && draft && suggestion && <SuggestedPlayerPicker target={pickerTarget} currentPlayer={getPlayer(draft[pickerTarget.team === "A" ? "teamA" : "teamB"][pickerTarget.slot])} opponents={(pickerTarget.team === "A" ? draft.teamB : draft.teamA).map((id, slot) => ({ player: getPlayer(id), target: { team: pickerTarget.team === "A" ? "B" : "A", slot } }))} players={manualPlayers} selectedIds={selectedIds} serverTime={queue.serverTime} onReplace={replaceSlot} onSwap={swapSlots} onClose={() => setPickerTarget(null)} />}
  </Card>;
}

function QueueViewContent({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<QueueFilter>("WAITING");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [removeCandidate, setRemoveCandidate] = useState<SessionPlayer | null>(null);
  const queueQuery = useQuery({ queryKey: ["queue", sessionId], queryFn: () => api.queue(sessionId), refetchInterval: 8000 });
  const courtsQuery = useQuery({ queryKey: ["courts", sessionId], queryFn: () => api.courts(sessionId), refetchInterval: 8000 });
  const workspaceQuery = useQuery({ queryKey: ["workspace", sessionId], queryFn: api.workspace });
  const ended = workspaceQuery.data?.status === "ENDED";
  const queue = queueQuery.data;
  const allPlayers = useMemo(() => { if (!queue) return []; return [...queue.waiting, ...queue.resting, ...queue.inactive, ...queue.queued, ...queue.playing]; }, [queue]);
  const filtered = useMemo(() => { const needle = search.trim().toLowerCase(); return allPlayers.filter((player) => (filter === "ALL" || (filter === "INACTIVE" ? ["INACTIVE", "CHECKED_OUT"].includes(player.status) : player.status === filter)) && (!needle || player.displayName.toLowerCase().includes(needle))); }, [allPlayers, filter, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ["queue", sessionId] }); queryClient.invalidateQueries({ queryKey: ["courts", sessionId] }); queryClient.invalidateQueries({ queryKey: ["matches", sessionId] }); queryClient.invalidateQueries({ queryKey: ["sessionPlayers", sessionId] }); queryClient.invalidateQueries({ queryKey: ["fees", sessionId] }); queryClient.invalidateQueries({ queryKey: ["workspace"] }); queryClient.invalidateQueries({ queryKey: ["sessions"] }); };
  const remove = useMutation({ mutationFn: (queuePlayerId: string) => api.removeSessionPlayer(sessionId, queuePlayerId), onSuccess: () => { setRemoveCandidate(null); invalidate(); toast.success("Player removed from queue."); } });
  const requestRemove = (candidate: SessionPlayer) => { remove.reset(); setRemoveCandidate(candidate); };
  const selectedPlayers = useMemo(() => allPlayers.filter((player) => selectedIds.includes(player.id)), [allPlayers, selectedIds]);
  const selectableVisible = visible.filter(canSelectQueuePlayer);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((player) => selectedIds.includes(player.id));
  const toggleVisibleSelection = () => setSelectedIds((current) => {
    const visibleIds = new Set(selectableVisible.map((player) => player.id));
    return allVisibleSelected ? current.filter((id) => !visibleIds.has(id)) : [...new Set([...current, ...visibleIds])].slice(0, 100);
  });
  const toggleSelection = (playerId: string, checked: boolean) => setSelectedIds((current) => checked ? [...new Set([...current, playerId])].slice(0, 100) : current.filter((id) => id !== playerId));
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { const validIds = new Set(allPlayers.map((player) => player.id)); setSelectedIds((current) => { const next = current.filter((id) => validIds.has(id)); return next.length === current.length ? current : next; }); }, [allPlayers]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const bulkAction = useMutation({ mutationFn: (action: BulkQueueAction) => { if (!selectedPlayers.length || !selectedPlayers.every((player) => canBulkQueueAction(player, action))) throw new Error("Selected players are not all eligible for this action."); return api.bulkQueueAction(sessionId, selectedIds, action); }, onSuccess: (players, action) => { setSelectedIds([]); invalidate(); const label = action === "CHECK_IN" ? "checked in" : action === "REST" ? "moved to rest" : "checked out"; toast.success(`${players.length} player${players.length === 1 ? "" : "s"} ${label}.`); }, onError: (error) => { invalidate(); toast.error(errorMessage(error)); } });
  const actionEnabled = (action: BulkQueueAction) => Boolean(selectedPlayers.length && selectedPlayers.every((player) => canBulkQueueAction(player, action)));
  const counts: Record<Exclude<QueueFilter, "ALL">, number> = queue ? { WAITING: queue.waiting.length, RESTING: queue.resting.length, INACTIVE: queue.inactive.length, QUEUED: queue.queued.length, PLAYING: queue.playing.length } : { WAITING: 0, RESTING: 0, INACTIVE: 0, QUEUED: 0, PLAYING: 0 };
  const labels: { key: QueueFilter; label: string }[] = [{ key: "WAITING", label: "Waiting" }, { key: "RESTING", label: "Resting" }, { key: "INACTIVE", label: "Not checked in" }, { key: "QUEUED", label: "Queued" }, { key: "PLAYING", label: "Playing" }];
  const changeFilter = (next: QueueFilter) => { setPage(1); setFilter(next); };
  const changeSearch = (next: string) => { setPage(1); setSearch(next); };
  if (queueQuery.isPending || courtsQuery.isPending || workspaceQuery.isPending) return <LoadingState label="Loading queue" />;
  return <div className="space-y-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-[var(--muted)]">Queue operations</p><h2 className="display text-4xl">Build the next matchup.</h2></div><div className="flex items-center gap-2 text-sm text-[var(--muted)]"><UsersRound size={17} className="text-[var(--teal)]" /> {allPlayers.length} rostered players</div></div>{ended && <Card className="border-[#f6c49f] bg-[#fffaf5]"><p className="font-semibold">Session ended</p><p className="mt-1 text-sm text-[var(--muted)]">Check-in, matchmaking, and queue actions are locked. Review finalized fees in the Fees tab.</p></Card>}<div className="flex gap-2 overflow-x-auto pb-1">{labels.map(({ key, label }) => <button key={key} className={`focus-ring shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition ${filter === key ? "border-[var(--teal)] bg-[var(--teal)] text-white" : "border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--teal)]"}`} onClick={() => changeFilter(key)}>{label} <span className="ml-1 opacity-75">{counts[key as Exclude<QueueFilter, "ALL">]}</span></button>)}</div>{queueQuery.error && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{errorMessage(queueQuery.error)}</p>}<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0"><Card className="p-0"><div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row"><label className="relative block flex-1"><Search size={16} className="absolute left-3 top-3 text-[var(--muted)]" /><Input className="pl-9" value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Search players" aria-label="Search players" /></label><div className="flex items-center gap-2 text-xs text-[var(--muted)]"><Filter size={15} /> {filtered.length} shown</div></div>{selectedIds.length > 0 || selectableVisible.length > 0 ? <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-[#fbfdfb] p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{selectedIds.length} selected</span><Button variant="quiet" className="px-3 py-1.5 text-xs" aria-pressed={allVisibleSelected} onClick={toggleVisibleSelection} disabled={ended || bulkAction.isPending || !selectableVisible.length}>{allVisibleSelected ? "Unselect all visible" : "Select all visible"}</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => setSelectedIds([])} disabled={!selectedIds.length || bulkAction.isPending}>Clear</Button></div><div className="flex flex-wrap gap-2"><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => bulkAction.mutate("CHECK_IN")} disabled={ended || bulkAction.isPending || !actionEnabled("CHECK_IN")}>Check in</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => bulkAction.mutate("REST")} disabled={ended || bulkAction.isPending || !actionEnabled("REST")}>Rest</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => bulkAction.mutate("CHECK_OUT")} disabled={ended || bulkAction.isPending || !actionEnabled("CHECK_OUT")}>Check out</Button></div></div> : null}<div className="hidden grid-cols-[28px_minmax(140px,1.4fr)_70px_112px_56px_56px_92px_auto] gap-3 border-b border-[var(--line)] bg-[#fbfdfb] px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)] md:grid"><span aria-hidden="true" /><span>Player</span><span>Skill</span><span>Games</span><span>Wait</span><span>Status</span><span>Record</span><span>Action</span></div>{queueQuery.isPending ? <div className="space-y-2 p-4"><div className="h-12 animate-pulse rounded-2xl bg-[#f1f5f2]" /><div className="h-12 animate-pulse rounded-2xl bg-[#f1f5f2]" /></div> : visible.length === 0 ? <div className="p-4"><EmptyState icon={UsersRound} title="No players here" body={search ? "Try a different search or clear the filter." : "Players will appear as they check in."} /></div> : <div>{visible.map((player) => <PlayerQueueRow key={player.id} player={player} sessionId={sessionId} canRemove={filter === "INACTIVE"} removePending={remove.isPending} onRemove={requestRemove} selected={selectedIds.includes(player.id)} onToggle={(checked) => toggleSelection(player.id, checked)} bulkPending={bulkAction.isPending} disabled={ended} onChanged={invalidate} />)}</div>}<div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-3"><p className="text-xs text-[var(--muted)]">Page {Math.min(page, pageCount)} of {pageCount} · 15 per page</p><div className="flex gap-2"><Button variant="quiet" className="px-3" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ArrowLeft size={15} /></Button><Button variant="quiet" className="px-3" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ArrowRight size={15} /></Button></div></div>{removeCandidate && <DestructiveConfirmDialog title={`Remove ${removeCandidate.displayName} from queue?`} body="This removes the player from the current queue only. Their reusable directory profile will remain available in Players." confirmLabel="Remove" pending={remove.isPending} error={remove.isError ? remove.error : undefined} onConfirm={() => remove.mutate(removeCandidate.id)} onClose={() => { if (!remove.isPending) { remove.reset(); setRemoveCandidate(null); } }} />}</Card></div>{ended ? <Card><p className="font-semibold">Matchmaking is unavailable</p><p className="mt-1 text-sm text-[var(--muted)]">Start a fresh queue from Settings to resume operations.</p></Card> : <MatchmakerPanel key={sessionId} sessionId={sessionId} queue={queue ?? { waiting: [], resting: [], inactive: [], queued: [], playing: [], serverTime: new Date().toISOString() }} courts={courtsQuery.data ?? []} onChanged={invalidate} />}</div></div>;
}

function QueueView({ sessionId }: { sessionId: string }) {
  const workspaceQuery = useQuery({ queryKey: ["workspace", sessionId], queryFn: api.workspace });
  const queueQuery = useQuery({ queryKey: ["queue", sessionId], queryFn: () => api.queue(sessionId), refetchInterval: 8000 });
  return <div className="space-y-5"><QueueViewContent sessionId={sessionId} />{queueQuery.data && <SynergyTeamsCard sessionId={sessionId} queue={queueQuery.data} ended={workspaceQuery.data?.status === "ENDED"} onChanged={() => { void queueQuery.refetch(); }} />}{workspaceQuery.data && <EndSessionControl session={workspaceQuery.data} />}<ManualAdvisoryHost /></div>;
}

function EditPlayerDialog({ player, pending, error, onConfirm, onClose }: { player: Player; pending: boolean; error?: unknown; onConfirm: (body: { displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string }) => void; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(player.displayName);
  const [gender, setGender] = useState<"MALE" | "FEMALE">(player.gender);
  const [skillLevel, setSkillLevel] = useState(player.skillLevel);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, pending]);
  const normalizedDisplayName = displayName.normalize("NFKC").trim().replace(/\s+/g, " ");
  const changed = normalizedDisplayName !== player.displayName || gender !== player.gender || skillLevel !== player.skillLevel;
  const valid = normalizedDisplayName.length > 0 && normalizedDisplayName.length <= 80 && changed;
  return <div className="fixed inset-0 z-50 grid items-end bg-[#102a2d]/45 p-0 sm:items-center sm:p-5"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="edit-player-title" className="w-full rounded-t-3xl bg-white p-6 shadow-2xl outline-none sm:mx-auto sm:max-w-md sm:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Player profile</p><h2 id="edit-player-title" className="display mt-1 text-3xl">Edit player</h2></div><Button variant="quiet" className="px-3" aria-label="Close edit player dialog" onClick={onClose} disabled={pending}><X size={18} /></Button></div><form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) onConfirm({ displayName: normalizedDisplayName, gender, skillLevel }); }}><label className="block text-sm font-semibold">Display name<Input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} autoFocus required /></label><label className="block text-sm font-semibold">Gender<Select value={gender} onChange={(event) => setGender(event.target.value as "MALE" | "FEMALE")}><option value="MALE">Male</option><option value="FEMALE">Female</option></Select></label><label className="block text-sm font-semibold">Skill level<Select value={skillLevel} onChange={(event) => setSkillLevel(event.target.value)}>{SKILLS.map((option) => <option key={option} value={option}>{pretty(option)}</option>)}</Select></label>{error !== undefined && error !== null && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(error)}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="quiet" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={!valid || pending} loading={pending}>Save changes</Button></div></form></div></div>;
}

function PlayersDirectoryView({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [directorySearch, setDirectorySearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelected, setDeleteSelected] = useState<string[]>([]);
  const [deletePreview, setDeletePreview] = useState<PlayerDeletionPreview | null>(null);
  const [editPlayer, setEditPlayer] = useState<Player | null>(null);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"MALE" | "FEMALE">("MALE");
  const [skill, setSkill] = useState("NEWBIE");
  const playersQuery = useQuery({ queryKey: ["players"], queryFn: api.players });
  const sessionPlayersQuery = useQuery({ queryKey: ["sessionPlayers", sessionId], queryFn: () => api.sessionPlayers(sessionId) });
  const add = useMutation({ mutationFn: () => api.addPlayers(sessionId, selected), onSuccess: () => { setSelected([]); queryClient.invalidateQueries({ queryKey: ["sessionPlayers", sessionId] }); queryClient.invalidateQueries({ queryKey: ["queue", sessionId] }); queryClient.invalidateQueries({ queryKey: ["sessions"] }); toast.success("Players added to the session."); } });
  const create = useMutation({ mutationFn: () => api.createPlayer({ displayName: name.trim(), gender, skillLevel: skill }), onSuccess: (player) => { setName(""); queryClient.setQueryData<Player[]>(["players"], (current = []) => [...current, player].sort((a, b) => a.displayName.localeCompare(b.displayName))); toast.success("Player created."); }, onError: (reason) => toast.error(errorMessage(reason)) });
  const edit = useMutation({ mutationFn: (input: { player: Player; body: { displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string } }) => api.updatePlayer(input.player, input.body), onSuccess: (updated) => { queryClient.setQueryData<Player[]>(["players"], (current = []) => current.map((player) => player.id === updated.id ? updated : player).sort((a, b) => a.displayName.localeCompare(b.displayName))); queryClient.invalidateQueries({ queryKey: ["workspace"] }); queryClient.invalidateQueries({ queryKey: ["sessions"] }); for (const key of ["sessionPlayers", "queue", "matches", "history", "playerHistory", "rankings", "fees"]) queryClient.invalidateQueries({ queryKey: [key, sessionId] }); queryClient.invalidateQueries({ queryKey: ["rankings", "career"] }); setEditPlayer(null); toast.success("Player updated."); }, onError: (reason) => toast.error(errorMessage(reason)) });
  const preview = useMutation({ mutationFn: (playerIds: string[]) => api.playerDeletionPreview(playerIds), onSuccess: setDeletePreview });
  const remove = useMutation({ mutationFn: (playerIds: string[]) => api.deletePlayers(playerIds), onSuccess: (result) => { setDeleteSelected([]); setDeletePreview(null); setDeleteMode(false); setSelected([]); queryClient.invalidateQueries({ queryKey: ["players"] }); queryClient.invalidateQueries({ queryKey: ["workspace"] }); queryClient.invalidateQueries({ queryKey: ["sessions"] }); for (const key of ["sessionPlayers", "queue", "courts", "matches", "history", "playerHistory", "rankings", "fees", "payments"]) queryClient.invalidateQueries({ queryKey: [key, sessionId] }); queryClient.invalidateQueries({ queryKey: ["rankings", "career"] }); toast.success(`${result.deletedPlayerIds.length} player${result.deletedPlayerIds.length === 1 ? "" : "s"} deleted.`); } });
  const allPlayers = playersQuery.data ?? EMPTY_PLAYERS;
  const players = useMemo(() => { const needle = directorySearch.trim().toLowerCase(); return needle ? allPlayers.filter((player) => `${player.displayName} ${player.gender} ${player.skillLevel}`.toLowerCase().includes(needle)) : allPlayers; }, [allPlayers, directorySearch]);
  const sessionPlayers = useMemo(() => sessionPlayersQuery.data ?? [], [sessionPlayersQuery.data]);
  const addedIds = useMemo(() => new Set(sessionPlayers.map((player) => player.playerId).filter((id): id is string => Boolean(id))), [sessionPlayers]);
  const availablePlayerIds = useMemo(() => players.filter((player) => !addedIds.has(player.id)).map((player) => player.id), [players, addedIds]);
  const selectedLimitExceeded = selected.length > MAX_PLAYER_ADD_BATCH;
  const bulkAvailableIds = availablePlayerIds.slice(0, MAX_PLAYER_ADD_BATCH);
  const allAvailableSelected = bulkAvailableIds.length > 0 && bulkAvailableIds.every((id) => selected.includes(id));
  const toggleSelectAllAvailable = () => setSelected((current) => allAvailableSelected ? current.filter((id) => !bulkAvailableIds.includes(id)) : [...new Set([...current, ...bulkAvailableIds])]);
  const allVisibleSelected = players.length > 0 && players.every((player) => deleteSelected.includes(player.id));
  const toggleDeleteVisible = () => setDeleteSelected((current) => allVisibleSelected ? current.filter((id) => !players.some((player) => player.id === id)) : [...new Set([...current, ...players.map((player) => player.id)])]);
  const selectAllAvailable = toggleSelectAllAvailable;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    const update = (button: HTMLButtonElement | undefined, pressed: boolean, label: string) => {
      if (!button) return;
      button.setAttribute("aria-pressed", String(pressed));
      button.setAttribute("aria-label", label);
      const textNode = [...button.childNodes].find((node): node is Text => node.nodeType === Node.TEXT_NODE && node.textContent?.trim().length !== 0);
      if (textNode) textNode.textContent = ` ${label}`;
    };
    const available = buttons.find((button) => button.textContent?.includes("Select all available") || button.textContent?.includes("Unselect all available") || button.textContent?.includes("Select next"));
    update(available, allAvailableSelected, allAvailableSelected ? "Unselect all available" : availablePlayerIds.length > MAX_PLAYER_ADD_BATCH ? `Select next ${MAX_PLAYER_ADD_BATCH}` : "Select all available");
    const visible = buttons.find((button) => button.textContent?.includes("Select all visible") || button.textContent?.includes("Unselect all visible"));
    update(visible, allVisibleSelected, allVisibleSelected ? "Unselect all visible" : "Select all visible");
  }, [allAvailableSelected, allVisibleSelected, availablePlayerIds.length]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const heading = [...document.querySelectorAll("h3")].find((element) => element.textContent === "Player directory");
    const card = heading?.closest("section");
    if (!card) return;
    const existingLabel = card.querySelector<HTMLLabelElement>("[data-player-directory-search]");
    let field = existingLabel?.querySelector<HTMLInputElement>("input") ?? null;
    let insertedLabel: HTMLLabelElement | null = null;
    if (!field) {
      const label = document.createElement("label");
      label.dataset.playerDirectorySearch = "true";
      label.className = "relative mt-4 block";
      label.textContent = "Search player directory";
      field = document.createElement("input");
      field.type = "search";
      field.className = "focus-ring mt-1 w-full rounded-2xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-[var(--teal)] focus:ring-2 focus:ring-[#d8f1eb]";
      field.placeholder = "Search by player name, gender, or skill";
      field.setAttribute("aria-label", "Search player directory");
      field.addEventListener("input", () => setDirectorySearch(field?.value ?? ""));
      label.appendChild(field);
      const header = card.querySelector("h3")?.parentElement?.parentElement;
      header?.insertAdjacentElement("afterend", label);
      insertedLabel = label;
    }
    field.value = "";
    return () => { insertedLabel?.remove(); };
  }, [playersQuery.isSuccess, sessionId, sessionPlayersQuery.isSuccess]);
  const rosterReady = sessionPlayersQuery.isSuccess;
  if (playersQuery.isPending || sessionPlayersQuery.isPending) return <LoadingState label="Loading players" />;
  const hasDuplicateName = (displayName: string, excludedPlayerId?: string) => hasPlayerNameConflict(allPlayers, sessionPlayers, displayName, excludedPlayerId);
  const submitCreate = () => { if (hasDuplicateName(name)) { toast.error(PLAYER_NAME_CONFLICT_MESSAGE); return; } create.reset(); create.mutate(); };
  const submitEdit = (body: { displayName: string; gender: "MALE" | "FEMALE"; skillLevel: string }) => { if (!editPlayer) return; if (hasDuplicateName(body.displayName, editPlayer.id)) { toast.error(PLAYER_NAME_CONFLICT_MESSAGE); return; } edit.reset(); edit.mutate({ player: editPlayer, body }); };
  const requestDelete = (playerIds: string[]) => { if (!playerIds.length) return; setDeleteSelected(playerIds); preview.mutate(playerIds); };
  const previewBody = deletePreview?.busyPlayers.length
    ? `Deletion is blocked because ${deletePreview.busyPlayers.map((player) => `${player.displayName} is ${pretty(player.status).toLowerCase()}`).join(", ")}. Finish or discard those matches first.`
    : `This permanently deletes ${deletePreview?.playerNames.join(", ") ?? "the selected players"}, their roster entries, complete matches, scores, payments, history, and statistics. ${deletePreview?.affectedMatchIds.length ?? 0} match(es) and ${deletePreview?.affectedPaymentIds.length ?? 0} payment(s) in the current queue are affected; other participants' derived statistics will be rebuilt.`;
  return <div className="space-y-5"><div><p className="text-sm text-[var(--muted)]">Roster</p><h2 className="display text-4xl">Players and check-in.</h2></div><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Player directory</h3><p className="mt-1 text-sm text-[var(--muted)]">{deleteMode ? "Choose profiles for permanent account-wide deletion." : "Players already added to this session cannot be selected again."}</p></div><div className="flex flex-wrap items-center justify-end gap-2">{deleteMode ? <><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => setDeleteSelected(players.map((player) => player.id))}>Select all visible</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => setDeleteSelected([])}>Clear</Button><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => { setDeleteMode(false); setDeleteSelected([]); }}>Cancel</Button></> : <>{availablePlayerIds.length > 0 && <Button variant="quiet" className="px-3 py-1.5 text-xs" disabled={!rosterReady || add.isPending} onClick={selectAllAvailable}><Check size={14} /> {availablePlayerIds.length > MAX_PLAYER_ADD_BATCH ? `Select next ${MAX_PLAYER_ADD_BATCH}` : "Select all available"}</Button>}<Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => setDeleteMode(true)}><Trash2 size={14} /> Delete players</Button></>}<Badge tone={deleteMode ? "orange" : "teal"}>{deleteMode ? `${deleteSelected.length} to delete` : `${selected.length} selected`}</Badge></div></div><div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">{players.map((player) => { const added = addedIds.has(player.id); const checked = selected.includes(player.id); const deleting = deleteSelected.includes(player.id); const unavailable = added || !rosterReady; if (deleteMode) return <div key={player.id} className={`flex items-center gap-3 rounded-2xl border border-[var(--line)] p-3 ${deleting ? "border-[#d98964] bg-[#fffaf5]" : "hover:border-[var(--teal)]"}`}><input type="checkbox" aria-label={`Select ${player.displayName} for deletion`} checked={deleting} onChange={(event) => setDeleteSelected((current) => event.target.checked ? [...current, player.id] : current.filter((id) => id !== player.id))} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{player.displayName}</span><span className="text-xs text-[var(--muted)]">{player.gender === "MALE" ? "Male" : "Female"} · {pretty(player.skillLevel)}{added ? " · Added to session" : ""}</span></span><Badge tone={deleting ? "orange" : "teal"}>{deleting ? "Selected" : "Available"}</Badge></div>; return <div key={player.id} className={`flex items-center gap-3 rounded-2xl border border-[var(--line)] p-3 ${unavailable ? "bg-[#f7faf8] opacity-65" : "hover:border-[var(--teal)]"}`}><label className={`flex min-w-0 flex-1 items-center gap-3 ${unavailable ? "cursor-not-allowed" : "cursor-pointer"}`}><input type="checkbox" checked={checked || added} disabled={unavailable || add.isPending} onChange={(event) => setSelected((current) => event.target.checked ? [...current, player.id] : current.filter((id) => id !== player.id))} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{player.displayName}</span><span className="text-xs text-[var(--muted)]">{player.gender === "MALE" ? "Male" : "Female"} · {pretty(player.skillLevel)}</span></span>{!rosterReady ? <Badge tone="gray">Checking…</Badge> : added ? <Badge tone="gray">Added to session</Badge> : checked ? <Badge tone="orange">Selected</Badge> : <Badge tone="teal">Available</Badge>}</label><div className="flex shrink-0 items-center gap-1"><Button variant="quiet" className="px-2 py-1.5" aria-label={`Edit ${player.displayName}`} title={`Edit ${player.displayName}`} onClick={() => { edit.reset(); setEditPlayer(player); }}><Pencil size={15} /></Button><Button variant="quiet" className="px-2 py-1.5" aria-label={`Delete ${player.displayName}`} title={`Delete ${player.displayName}`} onClick={() => requestDelete([player.id])}><Trash2 size={15} /></Button></div></div>; })}</div>{(playersQuery.error || sessionPlayersQuery.error || preview.isError) && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(playersQuery.error ?? sessionPlayersQuery.error ?? preview.error)}</p>}{availablePlayerIds.length > MAX_PLAYER_ADD_BATCH && <p role="status" className="mt-3 text-xs text-[var(--muted)]">Only {MAX_PLAYER_ADD_BATCH} players can be added at a time. Add this batch, then select the next batch.</p>}{selectedLimitExceeded && <p role="alert" className="mt-3 text-xs text-[#8d4824]">Select {MAX_PLAYER_ADD_BATCH} or fewer players before adding them.</p>}<Button className="mt-4 w-full" disabled={!selected.length || !rosterReady || add.isPending || selectedLimitExceeded} onClick={() => add.mutate()}>{add.isPending ? "Adding…" : "Add selected to session"}</Button>{deleteMode && <Button variant="danger" className="mt-2 w-full" disabled={!deleteSelected.length || preview.isPending || remove.isPending} onClick={() => requestDelete(deleteSelected)}>{preview.isPending ? "Checking impact…" : `Delete ${deleteSelected.length || "selected"} player${deleteSelected.length === 1 ? "" : "s"}`}</Button>}{add.isError && <p className="mt-2 text-sm text-[#8d4824]">{errorMessage(add.error)}</p>}</Card><Card><div className="flex items-center gap-2"><Plus size={17} className="text-[var(--teal)]" /><h3 className="font-semibold">Create player</h3></div><form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); submitCreate(); }}><label className="block text-sm font-semibold">Display name<Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required /></label><label className="block text-sm font-semibold">Gender<Select value={gender} onChange={(event) => setGender(event.target.value as "MALE" | "FEMALE")}><option value="MALE">Male</option><option value="FEMALE">Female</option></Select></label><label className="block text-sm font-semibold">Skill level<Select value={skill} onChange={(event) => setSkill(event.target.value)}>{SKILLS.map((option) => <option key={option} value={option}>{pretty(option)}</option>)}</Select></label><Button className="w-full" disabled={create.isPending || !name.trim()}>{create.isPending ? "Creating…" : "Create player"}</Button></form>{create.isError && <p className="mt-2 text-sm text-[#8d4824]">{errorMessage(create.error)}</p>}</Card></div>{deletePreview && <DestructiveConfirmDialog title="Permanently delete players?" body={previewBody} confirmLabel="Delete permanently" pending={remove.isPending} error={remove.isError ? remove.error : undefined} onConfirm={() => { if (!deletePreview.busyPlayers.length) remove.mutate(deletePreview.playerIds); }} onClose={() => { if (!remove.isPending) setDeletePreview(null); }} />}{editPlayer && <EditPlayerDialog player={editPlayer} pending={edit.isPending} error={edit.isError ? edit.error : undefined} onConfirm={submitEdit} onClose={() => { if (!edit.isPending) { setEditPlayer(null); edit.reset(); } }} />}</div>;
}

function PlayersView({ sessionId }: { sessionId: string }) {
  return <PlayersDirectoryView sessionId={sessionId} />;
}

function OfflineSyncPanel({ accountId: providedAccountId }: { accountId: string | undefined }) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState(providedAccountId ?? "");
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof getMeta>>>(undefined);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "remove" | "download" | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const refresh = useCallback(async () => { if (!accountId) return; setMeta(await getMeta(accountId)); setStorage(await storageEstimate()); }, [accountId]);
  useEffect(() => { void (async () => { const profile = providedAccountId ? null : await retainedProfile(); if (profile) setAccountId(profile.accountId); })(); const onStatus = () => { setOnline(navigator.onLine); void refresh(); }; window.addEventListener("online", onStatus); window.addEventListener("offline", onStatus); window.addEventListener("shuttle-queue-offline-change", onStatus); return () => { window.removeEventListener("online", onStatus); window.removeEventListener("offline", onStatus); window.removeEventListener("shuttle-queue-offline-change", onStatus); }; }, [providedAccountId, refresh]);
  const runSync = async () => { if (!accountId) return; setBusy(true); setError(null); try { const result = await syncAccount(accountId, "manual"); await queryClient.invalidateQueries(); toast.success(result.state === "uploaded" ? "Changes merged across devices." : result.state === "downloaded" ? "Downloaded the cloud copy." : "All devices are up to date."); await refresh(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  const replaceCloud = async () => { if (!accountId || !preview) return; setBusy(true); setError(null); try { const result = await confirmLocalReplacement(accountId, preview.cloudRevision); setConfirm(null); setPreview(null); toast.success(`Changes merged at cloud revision ${result.cloudRevision}.`); await refresh(); } catch (reason) { setError(errorMessage(reason)); await refresh(); } finally { setBusy(false); } };
  const download = async () => { if (!accountId) return; setBusy(true); setError(null); try { await downloadFromCloud(accountId, false); toast.success("Downloaded the cloud copy."); await refresh(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } };
  const remove = async () => { if (!accountId) return; setBusy(true); try { await clearAccountData(accountId); setConfirm(null); window.location.reload(); } catch (reason) { setError(errorMessage(reason)); setBusy(false); } };
  const used = storage?.usage ? `${Math.round(storage.usage / 1024 / 1024)} MB` : "—"; const quota = storage?.quota ? `${Math.round(storage.quota / 1024 / 1024)} MB` : "—";
  const statusLabel = busy ? "Merging changes" : meta?.dirty ? "Pending changes" : "Up to date";
  const previewBody = "The server will merge this device's changes with newer cloud transactions. No payment, score, or player record will be discarded.";
  return <Card><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Device storage</p><h3 className="display mt-1 text-3xl">Offline workspace</h3></div><Badge tone={online ? "teal" : "orange"}>{online ? "Online" : "Offline"}</Badge></div><p className="mt-3 text-sm leading-6 text-[var(--muted)]">All current queue operations are stored on this device first. Anyone with access to this browser profile can open the downloaded account.</p><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-[#f7faf8] p-3"><p className="text-xs text-[var(--muted)]">Local status</p><p className="mt-1 font-semibold">{statusLabel}</p></div><div className="rounded-2xl bg-[#f7faf8] p-3"><p className="text-xs text-[var(--muted)]">Cloud revision</p><p className="mt-1 font-semibold">{meta?.baseCloudRevision ?? "—"}</p></div><div className="rounded-2xl bg-[#f7faf8] p-3"><p className="text-xs text-[var(--muted)]">Storage</p><p className="mt-1 font-semibold">{used} / {quota}</p></div></div>{meta?.syncAttention && <p className="mt-3 text-xs text-[#8d4824]">Review the local changes before they replace newer cloud data.</p>}{meta?.lastSyncAt && <p className="mt-3 text-xs text-[var(--muted)]">Last sync {new Date(meta.lastSyncAt).toLocaleString()}</p>}{error && <p role="alert" className="mt-4 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{error}</p>}<div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button disabled={!online || busy} onClick={() => void runSync()}><RefreshCw size={15} /> {busy ? "Syncing…" : "Sync now"}</Button><Button variant="quiet" disabled={!online || busy} onClick={() => meta?.dirty ? setConfirm("download") : void download()}>Download from cloud</Button><Button variant="quiet" disabled={busy} onClick={() => setConfirm("remove")}>Remove downloaded data</Button></div>{confirm === "replace" && <DestructiveConfirmDialog title="Replace cloud data?" body={previewBody} confirmLabel="Replace cloud" pending={busy} onConfirm={() => void replaceCloud()} onClose={() => { if (!busy) { setConfirm(null); setPreview(null); } }} />}{confirm === "download" && <DestructiveConfirmDialog title="Download and discard local changes?" body="This device has pending work. Downloading now will permanently discard those local changes. You can sync this device first, or cancel." confirmLabel="Discard and download" secondaryLabel="Sync this device first" pending={busy} onSecondary={() => { setConfirm(null); void runSync(); }} onConfirm={() => { setConfirm(null); setBusy(true); void downloadFromCloud(accountId, true).then(() => refresh()).catch((reason) => setError(errorMessage(reason))).finally(() => setBusy(false)); }} onClose={() => setConfirm(null)} />}{confirm === "remove" && <DestructiveConfirmDialog title="Remove downloaded data?" body="This deletes this account’s offline copy and any pending work from this browser. The installed app remains, and the cloud account is unchanged." confirmLabel="Remove local data" pending={busy} onConfirm={() => void remove()} onClose={() => setConfirm(null)} />}</Card>;
}

function LateArrivalSettingsCard({ session, sessionId }: { session: SessionSummary; sessionId: string }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const settings = settingsQuery.data;
  const [graceMinutesOverride, setGraceMinutesOverride] = useState<string | undefined>(undefined);
  const savedGraceMinutes = settings?.lateArrivalGraceMinutes ?? 10;
  const graceMinutes = graceMinutesOverride ?? String(savedGraceMinutes);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const refresh = (updated?: SessionSummary) => { if (updated) queryClient.setQueryData<SessionSummary>(["workspace"], (current) => current ? { ...current, ...updated } : updated); queryClient.invalidateQueries({ queryKey: ["settings"] }); queryClient.invalidateQueries({ queryKey: ["workspace"] }); queryClient.invalidateQueries({ queryKey: ["queue", sessionId] }); };
  const updatePolicy = useMutation({ mutationFn: (body: { mode: "SET_NOW" | "START_GRACE" | "APPLY_ACCOUNT_DEFAULT" | "DISABLED" | "SET_CUSTOM"; localDateTime?: string; graceMinutes?: number; settingsVersion?: number }) => { if (body.mode === "START_GRACE" && (!Number.isInteger(body.graceMinutes) || body.graceMinutes! < 1 || body.graceMinutes! > 60)) throw new Error("Late-arrival grace must be a whole number from 1 to 60 minutes."); return api.updateLateArrivalPolicy(sessionId, body, session.version); }, onSuccess: (updated, variables) => { if (variables.mode === "START_GRACE" && variables.graceMinutes !== undefined) setGraceMinutesOverride(String(variables.graceMinutes)); refresh(updated); const corrected = updated.reclassifiedPlayerCount ?? 0; const graceEndsAt = updated.lateArrivalCutoffAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium", timeZone: settings?.timeZone ?? "Asia/Manila" }).format(new Date(updated.lateArrivalCutoffAt)) : null; const detail = corrected ? `; ${corrected} pending tag${corrected === 1 ? "" : "s"} cleared.` : "."; toast.success(variables.mode === "START_GRACE" ? `Check-in window ends ${graceEndsAt ?? "soon"}${detail}` : variables.mode === "DISABLED" ? `Late-arrival rule turned off${detail}` : `Late-arrival rule updated${detail}`); } });
  const disabled = session.status !== "ACTIVE";
  const cutoffMs = session.lateArrivalCutoffAt ? Date.parse(session.lateArrivalCutoffAt) : NaN;
  const hasCutoff = Number.isFinite(cutoffMs);
  const windowOpen = hasCutoff && cutoffMs > now;
  const cutoffLabel = hasCutoff ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: settings?.timeZone ?? "Asia/Manila" }).format(new Date(cutoffMs)) : "Off";
  const statusLabel = windowOpen ? "Window open" : hasCutoff ? "Late checks active" : "Off";
  const statusTone = windowOpen ? "teal" : hasCutoff ? "orange" : "gray";
  const actionLabel = updatePolicy.isPending ? "Updating…" : hasCutoff ? "Restart check-in window" : "Start check-in window";
  if (settingsQuery.isPending) return <LoadingState label="Loading session settings" />;
  return <Card>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Arrival policy</p><h3 className="display mt-1 text-3xl">Late check-in rules.</h3></div>
      <Badge tone={statusTone}>{statusLabel}</Badge>
    </div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Players checking in within the grace window are on time. Their first check-in after the window is marked late, and matchmaking keeps its normal fairness rules.</p>
    <div className="mt-5 rounded-2xl bg-[#f7faf8] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h4 className="font-semibold">On-time check-in window</h4><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Set the number of minutes after you open arrivals. Account timezone: {settings?.timeZone ?? "Asia/Manila"}.</p></div>
        <div className="text-right text-xs text-[var(--muted)]"><span className="block">{hasCutoff ? windowOpen ? "Window ends" : "Window ended" : "Current rule"}</span><span className="mt-1 block font-semibold text-[var(--ink)]">{cutoffLabel}</span></div>
      </div>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); const minutes = Number(graceMinutes); updatePolicy.mutate({ mode: "START_GRACE", graceMinutes: minutes, ...(settings ? { settingsVersion: settings.version } : {}) }); }}>
        <label className="block flex-1 text-sm font-semibold">Minutes<Input type="number" min={1} max={60} step={1} value={graceMinutes} onChange={(event) => setGraceMinutesOverride(event.target.value)} disabled={disabled || updatePolicy.isPending} aria-describedby="late-arrival-help" /></label>
        <Button type="submit" disabled={disabled || updatePolicy.isPending}>{actionLabel}</Button>
      </form>
      <p id="late-arrival-help" className="mt-2 text-xs leading-5 text-[var(--muted)]">Starting or restarting begins a new server-timed window now. The saved duration will be used the next time you start one.</p>
      {hasCutoff && <Button type="button" variant="quiet" className="mt-3" onClick={() => updatePolicy.mutate({ mode: "DISABLED" })} disabled={disabled || updatePolicy.isPending}>Turn off late-arrival rule</Button>}
      {disabled && <p className="mt-2 text-xs text-[var(--muted)]">Ended or draft sessions cannot change arrival rules.</p>}
      {updatePolicy.isError && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(updatePolicy.error)}</p>}
    </div>
  </Card>;
}

function MinimumRestSettingsCard() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [value, setValue] = useState<string | undefined>(undefined);
  const current = value ?? String(settingsQuery.data?.minimumRestMinutes ?? 0);
  const save = useMutation({ mutationFn: () => { const minutes = Number(current); if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) throw new Error("Minimum rest must be a whole number from 0 to 60 minutes."); return api.updateSettings({ minimumRestMinutes: minutes }, settingsQuery.data?.version); }, onSuccess: (updated) => { setValue(String(updated.minimumRestMinutes)); queryClient.setQueryData(["settings"], updated); queryClient.invalidateQueries({ queryKey: ["queue"] }); toast.success("Minimum rest updated."); } });
  if (settingsQuery.isPending) return <LoadingState label="Loading rest settings" />;
  return <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Player recovery</p><h3 className="display mt-1 text-3xl">Minimum rest time.</h3></div><Badge tone={Number(current) > 0 ? "teal" : "gray"}>{Number(current) > 0 ? `${current} min` : "No delay"}</Badge></div><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Players become eligible exactly after this many minutes from the end of their last match. Queued matchups may wait, but an immediate start is blocked until everyone is ready.</p><div className="mt-4 flex max-w-sm items-end gap-3"><label className="block flex-1 text-sm font-semibold">Rest minutes<Input type="number" min={0} max={60} step={1} value={current} onChange={(event) => setValue(event.target.value)} /></label><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button></div>{save.isError && <p role="alert" className="mt-3 text-xs text-[#8d4824]">{errorMessage(save.error)}</p>}</Card>;
}

function NoShowPenaltyControl({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [value, setValue] = useState<string | undefined>(undefined);
  const current = value ?? String((settingsQuery.data?.noShowPenaltyMinor ?? 0) / 100);
  const save = useMutation({ mutationFn: () => { const amountMinor = Math.round(Number(current) * 100); if (!Number.isFinite(amountMinor) || amountMinor < 0 || amountMinor > 2_000_000_000) throw new Error("No-show penalty must be a valid non-negative amount."); return api.updateSettings({ noShowPenaltyMinor: amountMinor }, settingsQuery.data?.version); }, onSuccess: (updated) => { setValue(String(updated.noShowPenaltyMinor / 100)); queryClient.setQueryData(["settings"], updated); queryClient.invalidateQueries({ queryKey: ["fees", sessionId] }); queryClient.invalidateQueries({ queryKey: ["workspace", sessionId] }); queryClient.invalidateQueries({ queryKey: ["workspace"] }); toast.success("No-show penalty updated."); } });
  return <div data-testid="no-show-penalty-control" className="mt-7 border-t border-[var(--line)] pt-5">
    {settingsQuery.isPending ? <p className="text-sm text-[var(--muted)]">Loading no-show penalty settings…</p> : <>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Attendance fees</p><h4 className="display mt-1 text-2xl">No-show penalty.</h4></div><Badge tone={Number(current) > 0 ? "orange" : "gray"}>{Number(current) > 0 ? current : "Disabled"}</Badge></div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">At session end, every rostered player with zero completed matches is marked “Did not play” and owes this amount instead of the normal fee. Enter 0 to disable the charge. Ended-session charges remain frozen.</p>
      <div className="mt-4 flex max-w-sm items-end gap-3"><label className="block flex-1 text-sm font-semibold">Penalty amount ({settingsQuery.data?.currencyCode ?? "PHP"})<Input type="number" min={0} step="0.01" inputMode="decimal" value={current} onChange={(event) => setValue(event.target.value)} placeholder="0.00" /></label><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button></div>
      {save.isError && <p role="alert" className="mt-3 text-xs text-[#8d4824]">{errorMessage(save.error)}</p>}
    </>}
  </div>;
}

function SessionSettingsControls({ session, sessionId, accountId, onReset, onDeleted }: { session: SessionSummary; sessionId: string; accountId?: string; onReset: (session: SessionSummary) => void; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<"reset" | "delete" | null>(null);
  const [disposition, setDisposition] = useState<"KEEP" | "DELETE_ALL">("KEEP");
  const [deletionPreview, setDeletionPreview] = useState<PlayerDeletionPreview | null>(null);
  const sessionPlayersQuery = useQuery({ queryKey: ["sessionPlayers", sessionId], queryFn: () => api.sessionPlayers(sessionId) });
  const reset = useMutation({ mutationFn: () => api.resetSession(sessionId, session.version), onSuccess: (updated) => { setConfirmAction(null); onReset(updated); toast.success("Session reset to a fresh draft."); } });
  const preview = useMutation({ mutationFn: (playerIds: string[]) => api.playerDeletionPreview(playerIds), onSuccess: setDeletionPreview });
  const remove = useMutation({ mutationFn: () => api.deleteSession(sessionId, session.version, disposition), onSuccess: () => { setConfirmAction(null); setDeletionPreview(null); queryClient.invalidateQueries({ queryKey: ["players"] }); onDeleted(); toast.success("Session deleted."); } });
  const pending = reset.isPending || remove.isPending || preview.isPending;
  if (sessionPlayersQuery.isPending) return <LoadingState label="Loading session roster" />;
  const openDelete = () => { setDeletionPreview(disposition === "KEEP" ? null : deletionPreview); setConfirmAction("delete"); };
  const changeDisposition = (next: "KEEP" | "DELETE_ALL") => { setDisposition(next); setDeletionPreview(null); if (next === "DELETE_ALL") { const ids = (sessionPlayersQuery.data ?? []).map((player) => player.playerId).filter((id): id is string => Boolean(id)); if (ids.length) preview.mutate(ids); else setDeletionPreview({ playerIds: [], playerNames: [], busyPlayers: [], affectedMatchIds: [], affectedPaymentIds: [], otherParticipantPlayerIds: [] }); } };
  const confirm = () => { if (confirmAction === "reset") reset.mutate(); else if (confirmAction === "delete" && (disposition === "KEEP" || (deletionPreview && !deletionPreview.busyPlayers.length))) remove.mutate(); else if (confirmAction === "delete") toast.error(deletionPreview?.busyPlayers.length ? "Busy rostered players must finish or be discarded before deletion." : "The deletion impact is still loading."); };
  const deleteBody = disposition === "KEEP"
    ? `The ${session.name} session, roster entries, courts, payments, and all related history will be permanently deleted. Global player profiles will be kept for other sessions.`
    : deletionPreview
      ? `This removes the ${session.name} session and permanently deletes ${deletionPreview.playerNames.join(", ") || "all rostered player profiles"} across the account. ${deletionPreview.affectedMatchIds.length} match(es) and ${deletionPreview.affectedPaymentIds.length} payment(s) will be removed; other participants’ derived statistics will be rebuilt.`
      : "Reviewing deletion impact";
  return <div className="space-y-5"><div><p className="text-sm text-[var(--muted)]">Session settings</p><h2 className="display text-4xl">Keep the day tidy.</h2></div><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]"><Card><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">{session.name}</p><h3 className="display mt-1 text-3xl">Session overview</h3></div><StatusBadge status={session.status} /></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-[#f7faf8] p-4"><p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">Scoring</p><p className="mt-2 font-semibold">Race to {session.scoring.pointsToWin}</p><p className="mt-1 text-sm text-[var(--muted)]">Win by {session.scoring.winBy} · cap {session.scoring.scoreCap ?? "none"} · best of {session.scoring.bestOf}</p></div><div className="rounded-2xl bg-[#f7faf8] p-4"><p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">Setup</p><p className="mt-2 font-semibold">{session.playerCount ?? 0} rostered players</p><p className="mt-1 text-sm text-[var(--muted)]">{session.courtCount ?? 0} courts configured</p></div></div><p className="mt-5 text-sm leading-6 text-[var(--muted)]">Resetting keeps this session’s name, roster, courts, and scoring rules, but removes gameplay activity so you can run it again from a clean draft.</p></Card><Card className="border-[#f1c5b5]"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-2xl bg-[#fff0e4] text-[#a74646]"><Settings2 size={19} /></div><div><h3 className="font-semibold">Danger zone</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">These actions permanently change this session. A confirmation dialog appears before anything is sent.</p></div></div><div className="mt-6 space-y-3"><div className="rounded-2xl border border-[var(--line)] p-4"><div className="flex items-start gap-3"><RotateCcw className="mt-0.5 shrink-0 text-[var(--orange)]" size={18} /><div className="min-w-0 flex-1"><p className="font-semibold">Reset current session</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Delete matches, scores, payments, and session stats. Keep the roster and setup.</p><Button variant="quiet" className="mt-3 w-full" disabled={pending} onClick={() => setConfirmAction("reset")}>Reset to draft</Button></div></div></div><div className="rounded-2xl border border-[#f1c5b5] bg-[#fffaf7] p-4"><div className="flex items-start gap-3"><Trash2 className="mt-0.5 shrink-0 text-[#a74646]" size={18} /><div className="min-w-0 flex-1"><p className="font-semibold">Delete this session</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Choose whether global player profiles should remain reusable after this session is removed.</p><label className="mt-3 block text-sm font-semibold">Player profiles after deletion<Select value={disposition} onChange={(event) => changeDisposition(event.target.value as "KEEP" | "DELETE_ALL")}><option value="KEEP">Keep player profiles</option><option value="DELETE_ALL">Delete all rostered players</option></Select></label><Button variant="danger" className="mt-3 w-full" disabled={pending} onClick={openDelete}>Delete session</Button></div></div></div></div>{(reset.isError || remove.isError || preview.isError) && <p role="alert" className="mt-4 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(reset.error ?? remove.error ?? preview.error)}</p>}</Card></div>{confirmAction === "reset" && <DestructiveConfirmDialog title="Reset this session?" body={`Matches, scores, payments, and session statistics for ${session.name} will be permanently deleted. The roster and setup will remain.`} confirmLabel="Reset session" pending={reset.isPending} onConfirm={confirm} onClose={() => setConfirmAction(null)} />}{confirmAction === "delete" && <DestructiveConfirmDialog title={disposition === "DELETE_ALL" ? "Delete session and rostered players?" : "Delete this session?"} body={deleteBody} confirmLabel="Delete session" pending={remove.isPending || preview.isPending} error={remove.isError ? remove.error : preview.isError ? preview.error : undefined} onConfirm={confirm} onClose={() => { if (!remove.isPending) setConfirmAction(null); }} />}</div>;
}

function QueueSettingsControls({ session, onReset }: { session: SessionSummary; onReset: (session: SessionSummary) => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reset = useMutation({ mutationFn: () => api.startFreshQueue(session.version), onSuccess: (updated) => { setConfirmOpen(false); onReset(updated); toast.success("Queue cleared. Ready for a fresh match."); } });
  return <Card className="border-[#f1c5b5]"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-2xl bg-[#fff0e4] text-[#a74646]"><Trash2 size={19} /></div><div><h3 className="font-semibold">Start fresh queue</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">This permanently clears players in the queue, courts, matches, scores, payments, rankings, and history. Reusable player profiles and account defaults stay available.</p><Button variant="danger" className="mt-4" disabled={reset.isPending} onClick={() => setConfirmOpen(true)}>Start fresh queue</Button></div></div>{reset.isError && <p role="alert" className="mt-4 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(reset.error)}</p>}{confirmOpen && <DestructiveConfirmDialog title="Start fresh queue?" body="All current queue activity, including open matches, completed scores, payments, rankings, and history, will be permanently deleted. Player profiles and account defaults will remain." confirmLabel="Start fresh queue" pending={reset.isPending} onConfirm={() => reset.mutate()} onClose={() => { if (!reset.isPending) setConfirmOpen(false); }} />}</Card>;
}

function EndSessionControl({ session, onEnded }: { session: SessionSummary; onEnded?: (session: SessionSummary) => void }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const end = useMutation({ mutationFn: () => api.endQueue(session.version), onSuccess: (updated) => { setConfirmOpen(false); queryClient.setQueryData(["workspace", session.id], updated); queryClient.invalidateQueries({ queryKey: ["sessions"] }); queryClient.invalidateQueries({ queryKey: ["queue", session.id] }); queryClient.invalidateQueries({ queryKey: ["matches", session.id] }); queryClient.invalidateQueries({ queryKey: ["fees", session.id] }); queryClient.invalidateQueries({ queryKey: ["payments", session.id] }); onEnded?.(updated); toast.success("Session ended. Fees are finalized."); } });
  if (session.status === "ENDED") return <div className="rounded-2xl bg-[#fffaf5] p-4"><p className="font-semibold">Session ended</p><p className="mt-1 text-sm text-[var(--muted)]">Queued matches were cancelled, checked-in players were checked out, and fees were finalized.</p></div>;
  return <div className="rounded-2xl border border-[#f1c5b5] bg-[#fffaf7] p-4"><p className="font-semibold">End this session</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Queued matches will be cancelled and checked-in players checked out. A playing match must be finished first.</p><Button variant="danger" className="mt-3" disabled={end.isPending} onClick={() => setConfirmOpen(true)}>End session</Button>{end.isError && <p role="alert" className="mt-3 rounded-xl bg-[#fff0e4] px-3 py-2 text-xs text-[#8d4824]">{errorMessage(end.error)}</p>}{confirmOpen && <DestructiveConfirmDialog title="End this session?" body="Queued matches will be cancelled, checked-in players will be checked out, and the current fee allocation will be frozen. A playing match must be finished first." confirmLabel="End session" pending={end.isPending} error={end.isError ? end.error : undefined} onConfirm={() => end.mutate()} onClose={() => { if (!end.isPending) setConfirmOpen(false); }} />}</div>;
}

function AccountSecuritySettings() {
  const [securityOpen, setSecurityOpen] = useState(false);
  return <><Card><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#edf8f4] text-[var(--teal)]"><KeyRound size={19} /></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Account security</p><h3 className="display mt-1 text-3xl">Protect your sign-in.</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Change your password when you need to keep your account secure.</p></div></div><Button variant="quiet" className="mt-4" onClick={() => setSecurityOpen(true)}><KeyRound size={15} /> Change password</Button></Card>{securityOpen && <ChangePasswordDialog onClose={() => setSecurityOpen(false)} />}</>;
}

function SuperAdminSettings({ user }: { user: AuthUser }) {
  return <><Card><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#edf8f4] text-[var(--teal)]"><ShieldCheck size={19} /></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Administration</p><h3 className="display mt-1 text-3xl">Shuttle Queue administration</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Manage your sign-in and the Queue Master and Super Admin accounts that use this queue.</p></div></div></Card><AccountManagementView user={user} /></>;
}

function SettingsView(props: { session: SessionSummary; sessionId: string; user: AuthUser; onReset: (session: SessionSummary) => void; onDeleted: () => void }) {
  return <div className="space-y-5"><h2 className="sr-only">Offline settings</h2><OfflineSyncPanel accountId={props.user.id} /><AccountSecuritySettings />{props.user.role === "SUPER_ADMIN" && <SuperAdminSettings user={props.user} />}<MinimumRestSettingsCard /><LateArrivalSettingsCard session={props.session} sessionId={props.sessionId} /><EndSessionControl session={props.session} /><QueueSettingsControls session={props.session} onReset={props.onReset} /></div>;
}

function formatHistoryDuration(seconds: number | null) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "Duration unavailable";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function historyTeamPlayers(match: HistoryMatch, team: "A" | "B") {
  return match.participants.filter((participant) => participant.team === team).sort((a, b) => a.teamSlot - b.teamSlot);
}

function historyScoreLabel(match: HistoryMatch) {
  if (!match.score?.games.length) return "Score unavailable";
  return match.score.games.map((game) => `${game.teamAScore}–${game.teamBScore}`).join(" · ");
}

function HistoryMatchCard({ match, selectedPlayerId }: { match: HistoryMatch; selectedPlayerId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const teamA = historyTeamPlayers(match, "A");
  const teamB = historyTeamPlayers(match, "B");
  const winner = match.winnerTeam ? `Team ${match.winnerTeam} won` : "Winner unavailable";
  return <article className="border-b border-[var(--line)] p-4 last:border-0"><button type="button" className="focus-ring flex w-full items-start gap-3 rounded-2xl text-left" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[#edf8f4] text-[var(--teal)]"><HistoryIcon size={16} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]"><span>{match.completedAt ? new Date(match.completedAt).toLocaleString() : "Completion time unavailable"}</span><span>·</span><span>{formatHistoryDuration(match.durationSeconds)}</span>{match.matchmakingMode === "UNDEFEATED_CHALLENGE" && <><span>·</span><Badge tone="orange">Undefeated challenge</Badge></>}{match.court && <><span>·</span><span>{match.court.name}</span></>}</span><span className="mt-2 block text-sm font-semibold"><span className={match.winnerTeam === "A" ? "text-[var(--teal)]" : ""}>{teamA.map((player) => player.displayName).join(" + ") || "Team A"}</span><span className="mx-2 text-[var(--muted)]">vs</span><span className={match.winnerTeam === "B" ? "text-[var(--teal)]" : ""}>{teamB.map((player) => player.displayName).join(" + ") || "Team B"}</span></span><span className="mt-1 block text-xs text-[var(--muted)]">{historyScoreLabel(match)} · {winner}</span></span><ChevronDown size={18} className={`mt-1 shrink-0 text-[var(--muted)] transition ${expanded ? "rotate-180" : ""}`} /></button>{expanded && <div className="mt-4 space-y-4 rounded-2xl bg-[#f7faf8] p-4"><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--teal)]">Team A</p><div className="mt-2 space-y-2">{teamA.map((player) => <div key={player.sessionPlayerId} className={`rounded-xl border px-3 py-2 ${selectedPlayerId === player.sessionPlayerId ? "border-[var(--teal)] bg-[#edf8f4]" : "border-[var(--line)] bg-white"}`}><p className="text-sm font-semibold">{player.displayName}</p><p className="text-xs text-[var(--muted)]">{player.gender === "MALE" ? "Male" : player.gender === "FEMALE" ? "Female" : "Gender unavailable"} · {player.skillLevel ? pretty(player.skillLevel) : "Skill unavailable"}</p></div>)}</div></div><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#a85b2b]">Team B</p><div className="mt-2 space-y-2">{teamB.map((player) => <div key={player.sessionPlayerId} className={`rounded-xl border px-3 py-2 ${selectedPlayerId === player.sessionPlayerId ? "border-[var(--teal)] bg-[#edf8f4]" : "border-[var(--line)] bg-white"}`}><p className="text-sm font-semibold">{player.displayName}</p><p className="text-xs text-[var(--muted)]">{player.gender === "MALE" ? "Male" : player.gender === "FEMALE" ? "Female" : "Gender unavailable"} · {player.skillLevel ? pretty(player.skillLevel) : "Skill unavailable"}</p></div>)}</div></div></div>{match.score?.games.length ? <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Game scores</p><div className="mt-2 overflow-hidden rounded-xl border border-[var(--line)] bg-white">{match.score.games.map((game) => <div key={game.gameNumber} className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2 text-sm last:border-0"><span>Game {game.gameNumber}</span><span className="font-semibold">{game.teamAScore} – {game.teamBScore}</span><span className="text-xs text-[var(--muted)]">Team {game.winnerTeam}</span></div>)}</div></div> : <p className="text-xs text-[var(--muted)]">No score revision is available for this match.</p>}</div>}</article>;
}

function PaginationControls({ pagination, onPage }: { pagination: { page: number; totalPages: number; total: number }; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-3"><p className="text-xs text-[var(--muted)]">Page {pagination.page} of {pagination.totalPages} · {pagination.total} matches</p><div className="flex gap-2"><Button variant="quiet" className="px-3" aria-label="Previous page" disabled={pagination.page <= 1} onClick={() => onPage(Math.max(1, pagination.page - 1))}><ArrowLeft size={15} /></Button><Button variant="quiet" className="px-3" aria-label="Next page" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(Math.min(pagination.totalPages, pagination.page + 1))}><ArrowRight size={15} /></Button></div></div>;
}

function FeesView({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const feeQuery = useQuery({ queryKey: ["fees", sessionId], queryFn: () => api.fees(sessionId) });
  const paymentsQuery = useQuery({ queryKey: ["payments", sessionId], queryFn: () => api.payments(sessionId) });
  const sessionPlayersQuery = useQuery({ queryKey: ["sessionPlayers", sessionId], queryFn: () => api.sessionPlayers(sessionId) });
  const [mode, setMode] = useState<"FIXED_PER_PLAYER" | "EQUAL_SPLIT">("FIXED_PER_PLAYER");
  const [configAmount, setConfigAmount] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [paymentKind, setPaymentKind] = useState<"COLLECTION" | "WAIVER">("COLLECTION");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "EWALLET" | "OTHER">("CASH");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<FeePaymentFilter>("ALL");
  const fee = feeQuery.data;
  const payments = paymentsQuery.data ?? EMPTY_PAYMENTS;
  const currency = fee?.config?.currencyCode ?? "PHP";
  const checkedInIds = useMemo(() => new Set((sessionPlayersQuery.data ?? []).filter((player) => Boolean(player.checkedInAt)).map((player) => player.id)), [sessionPlayersQuery.data]);
  const payablePlayers = useMemo(() => (fee?.players ?? []).filter((player) => (player.isNoShow || checkedInIds.has(feePlayerId(player))) && player.outstandingMinor > 0), [fee, checkedInIds]);
  const noShowPlayers = useMemo(() => (fee?.players ?? []).filter((player) => player.isNoShow), [fee]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!fee) return;
    const nextMode = fee.config?.mode ?? "FIXED_PER_PLAYER";
    setMode(nextMode);
    setConfigAmount(String(((nextMode === "EQUAL_SPLIT" ? fee.config?.expectedSessionCostMinor ?? fee.config?.expectedQueueCostMinor : fee.config?.fixedAmountPerPlayerMinor) ?? 0) / 100));
    if (!payablePlayers.some((player) => feePlayerId(player) === selectedPlayerId)) {
      const next = payablePlayers[0];
      setSelectedPlayerId(next ? feePlayerId(next) : "");
      setPaymentAmount(next ? String(next.outstandingMinor / 100) : "");
    }
  }, [fee, payablePlayers, selectedPlayerId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const player = payablePlayers.find((item) => feePlayerId(item) === selectedPlayerId);
    if (player) setPaymentAmount(String(player.outstandingMinor / 100));
  }, [payablePlayers, selectedPlayerId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["fees", sessionId] }); queryClient.invalidateQueries({ queryKey: ["payments", sessionId] }); queryClient.invalidateQueries({ queryKey: ["sessionPlayers", sessionId] }); };
  const configure = useMutation({ mutationFn: () => { const amountMinor = Math.round(Number(configAmount) * 100); if (!Number.isFinite(amountMinor) || amountMinor < 0) throw new Error("Enter a valid non-negative amount."); return api.updateFeeConfig(sessionId, mode === "FIXED_PER_PLAYER" ? { mode, fixedAmountPerPlayerMinor: amountMinor } : { mode, expectedSessionCostMinor: amountMinor }); }, onSuccess: (result) => { queryClient.setQueryData(["fees", sessionId], result.summary); refresh(); toast.success("Fee allocation updated."); } });
  const collect = useMutation({ mutationFn: () => { const amountMinor = Math.round(Number(paymentAmount) * 100); if (!selectedPlayerId) throw new Error("Select a player."); if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw new Error("Enter a positive amount."); return api.createPayment(sessionId, { sessionPlayerId: selectedPlayerId, kind: paymentKind, amountMinor, ...(paymentKind === "COLLECTION" ? { method: paymentMethod } : {}) }); }, onSuccess: () => { setPaymentAmount(""); refresh(); toast.success(paymentKind === "COLLECTION" ? "Payment recorded." : "Waiver recorded."); } });
  const collectionByMethod = (method: Payment["method"]) => payments.filter((payment) => payment.kind === "COLLECTION" && payment.method === method).reduce((sum, payment) => sum + payment.amountMinor, 0);
  const collectionTotal = useCallback((player: NonNullable<typeof fee>["players"][number]) => Object.values(player.collectionByMethodMinor).reduce((sum, amount) => sum + amount, 0), []);
  const filteredPlayers = useMemo(() => (fee?.players ?? []).filter((player) => paymentFilter === "ALL" ? collectionTotal(player) > 0 : player.collectionByMethodMinor[paymentFilter as PaymentMethod] > 0), [fee, paymentFilter, collectionTotal]);
  const filteredPayments = useMemo(() => payments.filter((payment) => paymentFilter === "ALL" || (payment.kind === "COLLECTION" && payment.method === paymentFilter)), [payments, paymentFilter]);
  const filterLabel = paymentFilter === "ALL" ? "all payment methods" : paymentFilterLabel(paymentFilter);
  if (feeQuery.isPending || paymentsQuery.isPending || sessionPlayersQuery.isPending) return <LoadingState label="Loading fees and payments" />;
  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm text-[var(--muted)]">Cash and e-wallet reconciliation</p><h2 className="display text-4xl">Keep fees accounted for.</h2></div>
      {fee && <Badge tone={fee.outstandingMinor === 0 ? "teal" : "orange"}>{formatMoney(fee.outstandingMinor, currency)} outstanding</Badge>}
    </div>
    {feeQuery.isError || paymentsQuery.isError || sessionPlayersQuery.isError ? <p role="alert" className="rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{errorMessage(feeQuery.error ?? paymentsQuery.error ?? sessionPlayersQuery.error)}</p> : <>
      <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card data-testid="log-payment-card"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--orange)]">Record</p><h3 className="display mt-1 text-3xl">Log a payment.</h3><div className="mt-5 space-y-3"><label className="block text-sm font-semibold">Player<Select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}><option value="">Select player</option>{payablePlayers.map((player) => <option key={feePlayerId(player)} value={feePlayerId(player)}>{player.displayName} · due {formatMoney(player.outstandingMinor, currency)}</option>)}</Select></label><label className="block text-sm font-semibold">Entry type<Select value={paymentKind} onChange={(event) => setPaymentKind(event.target.value as typeof paymentKind)}><option value="COLLECTION">Collection</option><option value="WAIVER">Waiver</option></Select></label>{paymentKind === "COLLECTION" && <label className="block text-sm font-semibold">Method<Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="CASH">Cash</option><option value="EWALLET">E-wallet</option><option value="OTHER">Other</option></Select></label>}<label className="block text-sm font-semibold">Amount<Input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label>{collect.isError && <p role="alert" className="rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(collect.error)}</p>}<Button className="w-full" onClick={() => collect.mutate()} disabled={collect.isPending || !payablePlayers.length}>{collect.isPending ? "Recording…" : paymentKind === "COLLECTION" ? "Record collection" : "Record waiver"}</Button></div></Card>
        <Card data-testid="fee-allocation-card"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--teal)]">Allocation</p><h3 className="display mt-1 text-3xl">Set the current queue fee.</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Active-session amounts are stored in minor currency units and allocated only to checked-in players. Finalization adds the configured no-show penalty for every rostered player who did not play.</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold">Fee mode<Select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="FIXED_PER_PLAYER">Fixed per player</option><option value="EQUAL_SPLIT">Equal split</option></Select></label><label className="block text-sm font-semibold">{mode === "EQUAL_SPLIT" ? "Expected queue total" : "Amount per player"}<Input inputMode="decimal" value={configAmount} onChange={(event) => setConfigAmount(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label></div>{configure.isError && <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e4] px-3 py-2 text-sm text-[#8d4824]">{errorMessage(configure.error)}</p>}<Button className="mt-4" onClick={() => configure.mutate()} disabled={configure.isPending}>{configure.isPending ? "Saving…" : "Save allocation"}</Button><NoShowPenaltyControl sessionId={sessionId} /><div className="mt-7 border-t border-[var(--line)] pt-5"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">By method</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{([["Cash", "CASH"], ["E-wallet", "EWALLET"], ["Other", "OTHER"]] as const).map(([label, method]) => <div key={method} className="rounded-2xl bg-[#f7faf8] p-3"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 font-semibold">{formatMoney(collectionByMethod(method), currency)}</p></div>)}</div></div></Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-5">{[["Expected", fee?.expectedMinor ?? 0], ["Collected", fee?.collectedMinor ?? 0], ["Outstanding", fee?.outstandingMinor ?? 0], ["Credit", fee?.creditMinor ?? 0], ["Payments", fee?.paymentCount ?? 0]].map(([label, value]) => <Card key={String(label)} className="p-4"><p className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p><p className="mt-2 text-xl font-semibold">{label === "Payments" ? value : formatMoney(Number(value), currency)}</p></Card>)}</div>
      <Card className="p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--teal)]">Payment method filter</p><p className="mt-1 text-sm text-[var(--muted)]">Filter the player summary and ledger together.</p></div><div className="flex flex-wrap gap-2" role="group" aria-label="Filter payments by method">{FEE_PAYMENT_FILTERS.map(([label, value]) => <button key={value} type="button" aria-pressed={paymentFilter === value} className={"focus-ring rounded-full border px-3 py-2 text-sm font-semibold transition " + (paymentFilter === value ? "border-[var(--teal)] bg-[var(--teal)] text-white" : "border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--teal)] hover:text-[var(--ink)]")} onClick={() => setPaymentFilter(value)}>{label}</button>)}</div></div></Card>
      <Card className="overflow-hidden p-0"><div className="border-b border-[var(--line)] px-4 py-3"><p className="font-semibold">Players by payment method</p><p className="mt-1 text-xs text-[var(--muted)]">{filteredPlayers.length} player{filteredPlayers.length === 1 ? "" : "s"} with {filterLabel}</p></div>{filteredPlayers.length === 0 ? <p className="p-4 text-sm text-[var(--muted)]">No players have a matching collection yet.</p> : <div>{filteredPlayers.map((player) => { const total = collectionTotal(player); const amount = paymentFilter === "ALL" ? total : player.collectionByMethodMinor[paymentFilter as PaymentMethod]; return <div key={feePlayerId(player)} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0"><div><p className="font-semibold">{player.displayName}</p><p className="text-xs text-[var(--muted)]">{formatMoney(amount, currency)} collected{paymentFilter !== "ALL" ? " via " + paymentFilterLabel(paymentFilter) : ""}</p></div><div className="flex flex-wrap justify-end gap-1.5">{paymentFilter === "ALL" ? FEE_PAYMENT_FILTERS.slice(1).map(([label, method]) => player.collectionByMethodMinor[method as PaymentMethod] > 0 ? <Badge key={method} tone="gray">{label}: {formatMoney(player.collectionByMethodMinor[method as PaymentMethod], currency)}</Badge> : null) : <Badge tone="teal">{paymentFilterLabel(paymentFilter)}</Badge>}</div></div>; })}</div>}</Card>
      {noShowPlayers.length > 0 && <Card className="overflow-hidden border-[#f1c5b5] p-0"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[#fffaf7] px-4 py-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#a85b2b]">Attendance charges</p><p className="font-semibold">Did not play / No-show penalties</p><p className="mt-1 text-xs text-[var(--muted)]">{fee?.noShowCount ?? noShowPlayers.length} rostered player{noShowPlayers.length === 1 ? "" : "s"} finished with no completed matches.</p></div><Badge tone="orange">{noShowPlayers.length}</Badge></div><div>{noShowPlayers.map((player) => <div key={feePlayerId(player)} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0"><div><p className="font-semibold">{player.displayName}</p><p className="text-xs text-[var(--muted)]">Penalty {formatMoney(player.dueMinor, currency)} · Collected {formatMoney(player.collectedMinor, currency)} · Outstanding {formatMoney(player.outstandingMinor, currency)} · Credit {formatMoney(player.creditMinor, currency)}</p><p className="mt-1 text-xs font-semibold text-[var(--muted)]">Payment status: {player.dueMinor === 0 ? "No charge" : pretty(player.status)}</p></div></div>)}</div></Card>}
      <Card className="overflow-hidden p-0"><div className="border-b border-[var(--line)] px-4 py-3"><p className="font-semibold">Recent ledger entries</p><p className="mt-1 text-xs text-[var(--muted)]">{filteredPayments.length} entr{filteredPayments.length === 1 ? "y" : "ies"} for {filterLabel}. Each collection request uses an idempotency key so a retry cannot double-count it.</p></div>{filteredPayments.length === 0 ? <p className="p-4 text-sm text-[var(--muted)]">{paymentFilter === "ALL" ? "No payments recorded yet." : "No " + paymentFilterLabel(paymentFilter).toLowerCase() + " payments recorded yet."}</p> : <div>{filteredPayments.slice(0, 50).map((payment) => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0"><div><p className="font-semibold">{fee?.players.find((player) => player.sessionPlayerId === payment.sessionPlayerId)?.displayName ?? "Player"}</p><p className="text-xs text-[var(--muted)]">{pretty(payment.kind)}{payment.method ? " · " + paymentFilterLabel(payment.method) : ""} · {new Date(payment.occurredAt).toLocaleString()}</p></div><p className="font-semibold">{formatMoney(payment.amountMinor, currency)}</p></div>)}</div>}</Card>
    </>}
  </div>;
}

function HistoryView({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState(1); const [search, setSearch] = useState("");
  const historyQuery = useQuery({ queryKey: ["history", sessionId, page, search], queryFn: () => api.history(sessionId, page, 15, search) }); const history = historyQuery.data;
  if (historyQuery.isPending) return <LoadingState label="Loading match history" />;
  return <div className="space-y-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-[var(--muted)]">Finished games</p><h2 className="display text-4xl">The queue log.</h2></div>{history?.pagination && <Badge tone="teal">{history.pagination.total} completed</Badge>}</div><Card className="overflow-hidden p-0"><div className="border-b border-[var(--line)] p-4"><label className="relative block"><Search size={16} className="absolute left-3 top-3 text-[var(--muted)]" /><Input className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by player name" aria-label="Search history by player name" /></label></div>{historyQuery.isPending ? <div className="space-y-3 p-4"><div className="h-24 animate-pulse rounded-2xl bg-[#f1f5f2]" /><div className="h-24 animate-pulse rounded-2xl bg-[#f1f5f2]" /></div> : historyQuery.isError ? <p role="alert" className="p-4 text-sm text-[#8d4824]">{errorMessage(historyQuery.error)}</p> : !history?.items.length ? <div className="p-4"><EmptyState icon={HistoryIcon} title={search ? "No matching games" : "No finished games yet"} body={search ? "Try another player name or clear the search." : "Completed matches will appear here after score entry."} /></div> : <div>{history.items.map((match) => <HistoryMatchCard key={match.id} match={match} />)}</div>}{history?.pagination && history.pagination.total > 0 && <PaginationControls pagination={history.pagination} onPage={setPage} />}</Card></div>;
}

function PlayerHistoryDetails({ sessionId, ranking }: { sessionId: string; ranking: Ranking }) {
  const playerId = ranking.queuePlayerId ?? ranking.sessionPlayerId;
  const [page, setPage] = useState(1); const playerQuery = useQuery({ queryKey: ["playerHistory", sessionId, playerId, page], queryFn: () => api.playerHistory(sessionId, playerId, page, 15) }); const data = playerQuery.data as PlayerHistoryResponse | undefined;
  if (playerQuery.isPending) return <LoadingState label={`Loading ${ranking.player} history`} className="border-t border-[var(--line)] bg-[#fbfdfb]" />;
  if (playerQuery.isError) return <p role="alert" className="border-t border-[var(--line)] bg-[#fff0e4] p-4 text-sm text-[#8d4824]">{errorMessage(playerQuery.error)}</p>;
  if (!data) return null;
  const stats = data.stats;
  return <div className="border-t border-[var(--line)] bg-[#fbfdfb] p-4"><div className="flex flex-wrap items-center gap-2"><Badge tone="teal">{data.player.gender === "MALE" ? "Male" : "Female"}</Badge><Badge tone="gray">{pretty(data.player.skillLevel)}</Badge></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Matches</p><p className="mt-1 font-semibold">{stats.matchesPlayed}</p></div><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Record</p><p className="mt-1 font-semibold">{stats.wins}W / {stats.losses}L</p></div><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Win rate</p><p className="mt-1 font-semibold">{(stats.winRateBasisPoints / 100).toFixed(0)}%</p></div><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Points</p><p className="mt-1 font-semibold">{stats.pointsFor}–{stats.pointsAgainst}</p></div><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Differential</p><p className="mt-1 font-semibold">{stats.pointDifferential > 0 ? "+" : ""}{stats.pointDifferential}</p></div><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Avg duration</p><p className="mt-1 font-semibold">{formatHistoryDuration(stats.averageDurationSeconds)}</p></div><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Top partner</p><p className="mt-1 break-words font-semibold" title={stats.mostPlayedPartner?.displayName}>{stats.mostPlayedPartner ? `${stats.mostPlayedPartner.displayName} (${stats.mostPlayedPartner.count})` : "—"}</p></div><div className="min-w-0 rounded-xl bg-white p-3"><p className="text-xs text-[var(--muted)]">Top opponent</p><p className="mt-1 break-words font-semibold" title={stats.mostPlayedOpponent?.displayName}>{stats.mostPlayedOpponent ? `${stats.mostPlayedOpponent.displayName} (${stats.mostPlayedOpponent.count})` : "—"}</p></div></div><div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">{data.items.length ? data.items.map((match) => <HistoryMatchCard key={match.id} match={match} selectedPlayerId={playerId} />) : <p className="p-4 text-sm text-[var(--muted)]">No completed games for this player yet.</p>}{data.pagination.total > 0 && <PaginationControls pagination={data.pagination} onPage={setPage} />}</div></div>;
}

function publicRankingUrl(publication: PublicRankingPublication) {
  if (!publication.token || typeof window === "undefined") return "";
  return `${window.location.origin}/rankings/shared/${publication.token}`;
}

function publicRankingDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function RankingsSharingControls({ session }: { session: SessionSummary }) {
  const queryClient = useQueryClient();
  const [optimisticPublication, setOptimisticPublication] = useState<PublicRankingPublication | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PublicRankingPublication | null>(null);
  const publicationsQuery = useQuery({ queryKey: ["publicRankingPublications"], queryFn: api.publicRankingPublications, retry: false, refetchInterval: 30_000 });
  useEffect(() => { if (publicationsQuery.isSuccess) setPublicSharingActive(Boolean(visiblePublicRankingPublication(publicationsQuery.data, optimisticPublication))); }, [publicationsQuery.data, publicationsQuery.isSuccess, optimisticPublication]);
  const refreshAfterPublishError = () => { void queryClient.invalidateQueries({ queryKey: ["workspace"] }); void queryClient.invalidateQueries({ queryKey: ["rankings"] }); void queryClient.invalidateQueries({ queryKey: ["publicRankingPublications"] }); };
  const publish = useMutation({
    mutationFn: async () => {
      await syncAccount(await currentAccountId(), "manual");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const cloudWorkspace = await api.cloudWorkspace();
        if (cloudWorkspace.startedAt !== session.startedAt) throw new Error("This queue session changed on another device. Refresh the page before publishing rankings.");
        if (!Number.isInteger(cloudWorkspace.version)) throw new Error("The current queue version could not be verified. Refresh the page and try again.");
        try {
          return await api.publishPublicRankings(cloudWorkspace.version);
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== "VERSION_CONFLICT" || attempt === 1) throw error;
        }
      }
      throw new Error("The current queue version could not be verified. Refresh the page and try again.");
    },
    onSuccess: (publication) => { setOptimisticPublication(publication); setPublicSharingActive(true); queryClient.setQueryData<PublicRankingPublicationResponse>(["publicRankingPublications"], (previous) => publishedPublicRankingState(previous, publication)); window.dispatchEvent(new Event("shuttle-queue-public-sharing")); void queryClient.invalidateQueries({ queryKey: ["publicRankingPublications"] }); void queryClient.invalidateQueries({ queryKey: ["workspace"] }); toast.success("Public rankings link is ready."); },
    onError: (error) => { if (error instanceof ApiError && (error.code === "VERSION_CONFLICT" || error.code === "VERSION_REQUIRED")) refreshAfterPublishError(); else if (error instanceof Error && error.message.startsWith("This queue session changed")) refreshAfterPublishError(); toast.error(errorMessage(error)); },
  });
  const revoke = useMutation({
    mutationFn: (publication: PublicRankingPublication) => api.revokePublicRankings(publication),
    onSuccess: (publication) => {
      const previousOptimistic = optimisticPublication;
      const nextOptimistic = previousOptimistic?.id === publication.id ? null : previousOptimistic;
      const next = revokedPublicRankingState(queryClient.getQueryData<PublicRankingPublicationResponse>(["publicRankingPublications"]), publication);
      setOptimisticPublication(nextOptimistic);
      setPublicSharingActive(Boolean(visiblePublicRankingPublication(next, nextOptimistic)));
      setRevokeTarget(null);
      queryClient.setQueryData<PublicRankingPublicationResponse>(["publicRankingPublications"], next);
      window.dispatchEvent(new Event("shuttle-queue-public-sharing"));
      void queryClient.invalidateQueries({ queryKey: ["publicRankingPublications"] });
      toast.success("Public rankings link revoked.");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
        setRevokeTarget(null);
        void queryClient.invalidateQueries({ queryKey: ["publicRankingPublications"] });
        toast.error("This public rankings link changed on another device. Review the refreshed sharing controls before revoking it again.");
      }
    },
  });
  const current = visiblePublicRankingPublication(publicationsQuery.data, optimisticPublication);
  const archives = publicationsQuery.data?.archives ?? [];
  const copy = async (publication: PublicRankingPublication) => { const url = publicRankingUrl(publication); if (!url) return; try { await navigator.clipboard.writeText(url); toast.success("Public rankings link copied."); } catch { toast.error("Copy failed. Open the link and copy it from the address bar."); } };
  const share = async (publication: PublicRankingPublication) => { const url = publicRankingUrl(publication); if (!url) return; if (navigator.share) { try { await navigator.share({ title: "Shuttle Queue rankings", text: "View the live queue rankings.", url }); } catch { /* cancelled share */ } } else await copy(publication); };
  const revokeBody = revokeTarget?.id === current?.id
    ? "Anyone using this live link will immediately lose access. Your rankings and session history will remain unchanged, and you can publish a new link later."
    : "Anyone using this archived link will immediately lose access. The archived rankings and session history will remain unchanged.";
  return <><Card className="border-[#b9e2d6] bg-[#f7fcfa]"><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#dff4eb] text-[var(--teal)]"><Share2 size={19} /></div><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Public rankings</p><h3 className="display mt-1 text-3xl">Let players follow along.</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Publish a read-only link for this queue. It shows names and ranking stats only, updates about every 8 seconds, and works without a sign-in.</p>{publicationsQuery.isError && <p className="mt-3 text-xs text-[#8d4824]">Public sharing controls require an internet connection.</p>}{current?.token && <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white p-3"><p className="text-xs font-semibold text-[var(--muted)]">{current.state === "FINAL" ? "Final public link" : "Live public link"}</p><div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs font-semibold text-[var(--muted)]">Shareable rankings link<Input aria-label="Shareable rankings link" type="url" readOnly value={publicRankingUrl(current)} onFocus={(event) => event.currentTarget.select()} /></label><Button variant="quiet" className="px-3 py-2.5 text-xs" onClick={() => void copy(current)}><Copy size={14} /> Copy link</Button></div><div className="mt-3 flex flex-wrap gap-2"><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => void share(current)}><Share2 size={14} /> Share</Button><a className="focus-ring inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--teal)] hover:bg-[#edf8f4]" href={publicRankingUrl(current)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a><Button variant="danger" className="px-3 py-1.5 text-xs" loading={revoke.isPending && revoke.variables?.id === current.id} disabled={revoke.isPending} onClick={() => { revoke.reset(); setRevokeTarget(current); }}>Revoke</Button></div></div>}{!current && <Button className="mt-4" loading={publish.isPending} onClick={() => publish.mutate()}><Share2 size={15} /> Publish this session</Button>}{publish.isError && <p role="alert" className="mt-3 text-sm text-[#8d4824]">{errorMessage(publish.error)}</p>}</div></div>{archives.length > 0 && <div className="mt-5 border-t border-[#d5ebe3] pt-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--teal)]">Past shared sessions</p><div className="mt-3 space-y-2">{archives.map((publication) => <div key={publication.id} className="flex flex-col justify-between gap-2 rounded-2xl border border-[var(--line)] bg-white p-3 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">{publication.state === "FINAL" ? "Final standings" : "Live standings"}</p><p className="text-xs text-[var(--muted)]">Started {publicRankingDate(publication.sessionStartedAt)}{publication.finalizedAt ? ` · finalized ${publicRankingDate(publication.finalizedAt)}` : ""}</p></div><div className="flex flex-wrap gap-2"><Button variant="quiet" className="px-3 py-1.5 text-xs" onClick={() => void copy(publication)}><Copy size={14} /> Copy</Button><a className="focus-ring inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--teal)] hover:bg-[#edf8f4]" href={publicRankingUrl(publication)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a><Button variant="danger" className="px-3 py-1.5 text-xs" loading={revoke.isPending && revoke.variables?.id === publication.id} disabled={revoke.isPending} onClick={() => { revoke.reset(); setRevokeTarget(publication); }}>Revoke</Button></div></div>)}</div></div>}{revokeTarget && <DestructiveConfirmDialog title={revokeTarget.id === current?.id ? "Revoke this public rankings link?" : "Revoke this archived public rankings link?"} body={revokeBody} confirmLabel="Revoke link" pending={revoke.isPending} error={revoke.isError ? revoke.error : undefined} onConfirm={() => revoke.mutate(revokeTarget)} onClose={() => { if (!revoke.isPending) { revoke.reset(); setRevokeTarget(null); } }} />}</Card></>;
}

function RankingsView({ sessionId, session }: { sessionId: string; session?: SessionSummary }) {
  const workspaceQuery = useQuery({ queryKey: ["workspace", sessionId], queryFn: api.workspace, enabled: !session });
  const sessionForSharing = session ?? workspaceQuery.data;
  const rankingsQuery = useQuery({ queryKey: ["rankings", sessionId], queryFn: () => api.rankings(sessionId), refetchInterval: useRefreshInterval(sessionForSharing?.status === "ACTIVE") });
  const rankings = rankingsQuery.data?.rankings ?? [];
  const { ranked, didNotPlay } = partitionRankingRows(rankings);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (rankingsQuery.isPending) return <LoadingState label="Loading rankings" />;
  const save = async () => { if (!rankings.length || saving) return; setSaving(true); try { await saveRankingsToDevice(rankings); toast.success("Rankings saved to your device."); } catch (reason) { toast.error(errorMessage(reason)); } finally { setSaving(false); } };
  return <div className="space-y-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-[var(--muted)]">Current queue rankings</p><h2 className="display text-4xl">LineDrive Afternoon Queue</h2></div><Button variant="quiet" className="self-start px-3 sm:self-auto" disabled={!rankings.length || saving || rankingsQuery.isError} loading={saving} onClick={() => void save()}><Download size={16} /> {saving ? "Saving…" : "Save to device"}</Button></div>{sessionForSharing && <RankingsSharingControls session={sessionForSharing} />}<Card className="overflow-hidden p-0"><div className="border-b border-[var(--line)] bg-[#fbfdfb] px-4 py-3 text-xs leading-5 text-[var(--muted)]">Live rankings use a confidence-adjusted win score after each completed game. Players become prize-eligible after 5 completed games; the top 3 eligible players are prize positions.</div>{rankingsQuery.isPending ? <div className="p-6 text-sm text-[var(--muted)]">Loading rankings…</div> : rankingsQuery.isError ? <p role="alert" className="p-4 text-sm text-[#8d4824]">{errorMessage(rankingsQuery.error)}</p> : rankings.length === 0 ? <div className="p-4"><EmptyState icon={Trophy} title="No results yet" body="Finish a match and the leaderboard will appear here." /></div> : <><div>{ranked.map((row) => { const rankingId = row.queuePlayerId ?? row.sessionPlayerId; const provisional = row.matchesPlayed < 5 || row.eligible === false; return <div key={rankingId} className="border-b border-[var(--line)] last:border-0"><button data-testid={`ranking-row-${rankingId}`} type="button" className={`focus-ring flex w-full items-center gap-4 px-4 py-4 text-left ${row.isPrizePosition ? "bg-[#fffaf0]" : ""}`} aria-expanded={expandedId === rankingId} onClick={() => setExpandedId((current) => current === rankingId ? null : rankingId)}><span className="grid size-9 place-items-center rounded-full bg-[#edf8f4] text-sm font-bold text-[var(--teal)]">{row.rank}</span><div className="min-w-0 flex-1"><p className="truncate font-semibold">{row.player}{provisional ? <span className="ml-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Provisional</span> : row.isPrizePosition ? <span className="ml-2 text-xs font-bold uppercase tracking-[0.1em] text-[#a85b2b]">Prize</span> : null}</p><p className="text-xs text-[var(--muted)]">{row.gender === "MALE" ? "Male" : "Female"} · {pretty(row.skillLevel)} · {row.matchesPlayed} games · {row.wins}W / {row.losses}L{provisional ? " / " + (row.gamesNeeded ?? Math.max(0, 5 - row.matchesPlayed)) + " games to prize" : ""}{row.seededDrawUsed ? " seeded draw tiebreak" : ""}</p></div><div className="text-right"><p className="font-semibold">{(row.winRateBasisPoints / 100).toFixed(0)}%</p><p className="text-xs text-[var(--muted)]">win rate · score {(row.rankingScoreBasisPoints ?? 0) / 100}%</p></div><ChevronDown size={18} className={`shrink-0 text-[var(--muted)] transition ${expandedId === rankingId ? "rotate-180" : ""}`} /></button>{expandedId === rankingId && <PlayerHistoryDetails sessionId={sessionId} ranking={row} />}</div>; })}</div><DidNotPlaySection players={didNotPlay} /></>}</Card></div>;
}

function SessionSwitcher({ sessions, active, onChange, onCreate }: { sessions: SessionSummary[]; active: SessionSummary | undefined; onChange: (id: string) => void; onCreate: () => void }) {
  return <div className="flex min-w-0 items-center gap-2"><div className="relative min-w-0"><select aria-label="Active session" className="focus-ring max-w-[220px] appearance-none rounded-2xl border border-[var(--line)] bg-white py-2 pl-3 pr-8 text-sm font-semibold outline-none" value={active?.id ?? ""} onChange={(event) => onChange(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2 top-2.5 text-[var(--muted)]" size={15} /></div><Button variant="quiet" className="px-3" title="Create session" aria-label="Create session" onClick={onCreate}><Plus size={16} /></Button></div>;
}

function QueueWorkspaceShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [tab, setTab] = useState<Tab>("live");
  const sessionsQuery = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const [newSessionName, setNewSessionName] = useState("");
  const sessions = sessionsQuery.data ?? [];
  const active = sessions.find((session) => session.id === sessionId) ?? sessions[0];
  const create = useMutation({ mutationFn: () => api.createSession({ name: newSessionName.trim() }), onSuccess: (session) => { setNewSessionName(""); setSessionId(session.id); queryClient.invalidateQueries({ queryKey: ["sessions"] }); toast.success("Draft session created."); } });
  const start = useMutation({ mutationFn: () => active ? api.startSession(active.id, active.version) : Promise.reject(new Error("Select a session.")), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["sessions"] }); toast.success("Session started."); } });
  if (sessionsQuery.isPending) return <LoadingState variant="fullPage" label="Loading your sessions" />;
  const refreshSessionData = () => { queryClient.invalidateQueries({ queryKey: ["sessions"] }); queryClient.invalidateQueries({ queryKey: ["sessionPlayers", active?.id] }); queryClient.invalidateQueries({ queryKey: ["queue", active?.id] }); queryClient.invalidateQueries({ queryKey: ["courts", active?.id] }); queryClient.invalidateQueries({ queryKey: ["matches", active?.id] }); queryClient.invalidateQueries({ queryKey: ["history", active?.id] }); queryClient.invalidateQueries({ queryKey: ["playerHistory", active?.id] }); queryClient.invalidateQueries({ queryKey: ["rankings", active?.id] }); queryClient.invalidateQueries({ queryKey: ["rankings", "career"] }); };
  return <main className="min-h-screen"><header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--teal)] text-white"><Activity size={20} /></div><div className="hidden min-w-0 sm:block"><p className="truncate text-sm font-bold">Shuttle Queue</p><p className="truncate text-xs text-[var(--muted)]">{user.username}</p></div></div><SessionSwitcher sessions={sessions} active={active} onChange={setSessionId} onCreate={() => { const value = window.prompt("Name this session"); if (value?.trim()) { setNewSessionName(value.trim()); setTimeout(() => create.mutate(), 0); } }} /><Button variant="quiet" className="px-3" title="Sign out" aria-label="Sign out" onClick={onLogout}><LogOut size={16} /></Button></div><div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6">{(Object.keys(tabLabels) as Tab[]).map((key) => <button key={key} className={`focus-ring flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${tab === key ? "bg-[var(--teal)] text-white" : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"}`} onClick={() => setTab(key)}>{key === "live" ? <Activity size={15} /> : key === "queue" ? <UsersRound size={15} /> : key === "players" ? <UsersRound size={15} /> : key === "settings" ? <Settings2 size={15} /> : key === "history" ? <HistoryIcon size={15} /> : key === "fees" ? <Wallet size={15} /> : <Trophy size={15} />}{tabLabels[key]}</button>)}</div></header><div className={`live-workspace-content mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-10 ${tab === "live" ? "live-workspace-content-active" : ""}`}>{!active ? <EmptyState icon={Sparkles} title="Create your first session" body="Sessions hold the courts, queue, and rankings for one day." action={<Button onClick={() => { const value = window.prompt("Name this session"); if (value?.trim()) { setNewSessionName(value.trim()); setTimeout(() => create.mutate(), 0); } }}><Plus size={16} /> New session</Button>} /> : tab === "live" ? <LiveView session={active} sessionId={active.id} onStartSession={() => start.mutate()} /> : tab === "queue" ? <QueueView sessionId={active.id} /> : tab === "players" ? <PlayersView key={active.id} sessionId={active.id} /> : tab === "history" ? <HistoryView sessionId={active.id} /> : tab === "fees" ? <FeesView key={active.id} sessionId={active.id} /> : tab === "settings" ? <SettingsView session={active} sessionId={active.id} user={user} onReset={(updated) => { queryClient.setQueryData<SessionSummary[]>(["sessions"], (current = []) => current.map((item) => item.id === updated.id ? updated : item)); refreshSessionData(); setTab("live"); }} onDeleted={() => { queryClient.setQueryData<SessionSummary[]>(["sessions"], (current = []) => current.filter((item) => item.id !== active.id)); setSessionId(""); setTab("live"); queryClient.removeQueries({ queryKey: ["sessionPlayers", active.id] }); queryClient.removeQueries({ queryKey: ["queue", active.id] }); queryClient.removeQueries({ queryKey: ["courts", active.id] }); queryClient.removeQueries({ queryKey: ["matches", active.id] }); queryClient.removeQueries({ queryKey: ["history", active.id] }); queryClient.removeQueries({ queryKey: ["playerHistory", active.id] }); queryClient.removeQueries({ queryKey: ["rankings", active.id] }); queryClient.invalidateQueries({ queryKey: ["sessions"] }); }} /> : <RankingsView sessionId={active.id} />}{start.isError && <p role="alert" className="mt-4 rounded-2xl bg-[#fff0e4] px-4 py-3 text-sm text-[#8d4824]">{errorMessage(start.error)}</p>}</div></main>;
}

function QueueWorkspaceShellV2({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const { clear: clearMatchmaker } = useContext(MatchmakerPersistenceContext);
  const [tab, setTab] = useState<Tab>("live");
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: api.workspace });
  const active = workspaceQuery.data;
  const workspaceId = "workspace";
  const previousWorkspaceKey = useRef<string | null>(null);
  useEffect(() => {
    const workspaceKey = active?.startedAt ?? null;
    if (!workspaceKey) return;
    if (previousWorkspaceKey.current && previousWorkspaceKey.current !== workspaceKey) clearMatchmaker();
    previousWorkspaceKey.current = workspaceKey;
  }, [active?.startedAt, clearMatchmaker]);
  if (workspaceQuery.isPending) return <LoadingState variant="fullPage" label="Loading your queue" />;
  if (!active) return <main className="grid min-h-screen place-items-center text-sm text-[#8d4824]">The current queue could not be loaded.</main>;
  const refreshQueueData = () => { queryClient.invalidateQueries({ queryKey: ["workspace"] }); for (const key of ["sessionPlayers", "queue", "courts", "matches", "history", "playerHistory", "rankings", "fees", "payments"]) queryClient.invalidateQueries({ queryKey: [key, workspaceId] }); };
  return <main className="min-h-screen"><h1 className="sr-only">Shuttle Queue</h1><header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--paper)]/95 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--teal)] text-white"><Activity size={20} /></div><div className="hidden min-w-0 sm:block"><p className="truncate text-sm font-bold">Shuttle Queue</p><p className="truncate text-xs text-[var(--muted)]">{user.username}</p></div></div><Button variant="quiet" className="px-3" title="Sign out" aria-label="Sign out" onClick={onLogout}><LogOut size={16} /></Button></div><div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6">{(Object.keys(tabLabels) as Tab[]).map((key) => <button key={key} className={`focus-ring flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${tab === key ? "bg-[var(--teal)] text-white" : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"}`} onClick={() => setTab(key)}>{key === "live" ? <Activity size={15} /> : key === "queue" ? <UsersRound size={15} /> : key === "players" ? <UsersRound size={15} /> : key === "settings" ? <Settings2 size={15} /> : key === "history" ? <HistoryIcon size={15} /> : key === "fees" ? <Wallet size={15} /> : <Trophy size={15} />}{tabLabels[key]}</button>)}</div></header><div className={`live-workspace-content mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-10 ${tab === "live" ? "live-workspace-content-active" : ""}`}>{tab === "live" ? <LiveView session={active} sessionId={workspaceId} onStartSession={() => undefined} /> : tab === "queue" ? <QueueView sessionId={workspaceId} /> : tab === "players" ? <PlayersView key={workspaceId} sessionId={workspaceId} /> : tab === "history" ? <HistoryView sessionId={workspaceId} /> : tab === "fees" ? <FeesView key={workspaceId} sessionId={workspaceId} /> : tab === "settings" ? <SettingsView session={active} sessionId={workspaceId} user={user} onReset={() => { refreshQueueData(); setTab("live"); }} onDeleted={() => { refreshQueueData(); setTab("live"); }} /> : <RankingsView sessionId={workspaceId} />}</div></main>;
}

function SuperAdminShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return <QueueWorkspaceShellV2 user={user} onLogout={onLogout} />;
}

function MatchmakerPersistenceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MatchmakerPersistedState>(EMPTY_MATCHMAKER_STATE);
  const [version, setVersion] = useState(0);
  const clear = useCallback(() => { setState(EMPTY_MATCHMAKER_STATE); setVersion((current) => current + 1); }, []);
  return <MatchmakerPersistenceContext.Provider value={{ state, onPersist: setState, clear, version }}>{children}</MatchmakerPersistenceContext.Provider>;
}

function AppShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return <MatchmakerPersistenceProvider>{user.role === "SUPER_ADMIN" ? <SuperAdminShell user={user} onLogout={onLogout} /> : <QueueMasterShell user={user} onLogout={onLogout} />}</MatchmakerPersistenceProvider>;
}

function QueueMasterShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return <div><header className="sticky top-0 z-40 flex items-center gap-3 border-b border-[var(--line)] bg-white px-4 py-2 sm:px-6"><div className="flex items-center gap-2 text-sm"><Badge tone="gray">Queue Master</Badge><span className="hidden text-[var(--muted)] sm:inline">{user.username}</span></div></header><QueueWorkspaceShellV2 user={user} onLogout={onLogout} /></div>;
}

export default function HomePage() {
  type AuthPhase = "checking" | "ready" | "signedOut";
  const [authPhase, setAuthPhase] = useState<AuthPhase>("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [retainedUser, setRetainedUser] = useState<AuthUser | null>(null);
  const [sessionRequired, setSessionRequired] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      let signedOut = false;
      try { signedOut = window.sessionStorage.getItem("shuttle-queue-offline-signed-out") === "1"; } catch { /* ignore storage access failures */ }
      setAuthPhase(signedOut ? "signedOut" : "ready");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, enabled: authPhase === "ready" && !authUser });
  useEffect(() => {
    if (authPhase !== "ready" || authUser || !me.isError) return;
    if (!isOfflineFallbackError(me.error)) return;
    let cancelled = false;
    void retainedProfile().then((profile) => {
      if (!cancelled && profile) setRetainedUser({ id: profile.accountId, username: profile.username, role: profile.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "QUEUE_MASTER" });
    });
    return () => { cancelled = true; };
  }, [authPhase, authUser, me.isError, me.error]);
  const offlineUser = isOfflineFallbackError(me.error) ? retainedUser : null;
  const verifiedUser = me.isError ? null : me.data?.user;
  const user = authPhase === "signedOut" ? null : authUser ?? verifiedUser ?? offlineUser;
  const handleSessionRequired = useCallback(() => setSessionRequired(true), []);
  const handleReauthenticated = useCallback((nextUser: AuthUser) => {
    setSessionRequired(false);
    setAuthUser(nextUser);
    setRetainedUser(null);
    void queryClient.invalidateQueries();
  }, [queryClient]);
  const handleLogout = async (remove: boolean) => {
    if (!user) return;
    setLoggingOut(true);
    const currentUser = user;
    try {
      try { window.sessionStorage.setItem("shuttle-queue-offline-signed-out", "1"); } catch { /* ignore storage access failures */ }
      setAuthPhase("signedOut");
      setAuthUser(null);
      setRetainedUser(null);
      setSessionRequired(false);
      await queryClient.cancelQueries().catch(() => undefined);
      if (remove) await clearAccountData(currentUser.id).catch(() => undefined);
      try { await api.logout(); } catch { /* offline sign-out is local until reconnect */ }
      queryClient.clear();
    } finally {
      setLogoutOpen(false);
      setLoggingOut(false);
    }
  };
  if (authPhase === "checking") return <LoadingState variant="fullPage" label="Loading Shuttle Queue" />;
  if (authPhase === "ready" && !user && me.isPending && !me.isFetched) return <LoadingState variant="fullPage" label="Loading Shuttle Queue" />;
  if (!user) return <LoginScreen onLoggedIn={(nextUser) => { setAuthPhase("ready"); setAuthUser(nextUser); setRetainedUser(null); setSessionRequired(false); }} />;
  return <><OfflineBootstrap user={user} onLogout={() => setLogoutOpen(true)} onSessionRequired={handleSessionRequired} />{sessionRequired && <SessionReauthenticationGate user={user} onAuthenticated={handleReauthenticated} onSignOut={() => setLogoutOpen(true)} />}{logoutOpen && <LogoutDialog pending={loggingOut} onKeep={() => void handleLogout(false)} onRemove={() => void handleLogout(true)} onClose={() => { if (!loggingOut) setLogoutOpen(false); }} />}</>;
}
