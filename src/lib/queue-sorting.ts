import type { QueuePlayer } from "./api";

export type QueueSortKey = "PLAYER" | "SKILL" | "GAMES" | "WAIT" | "RECORD";
export type QueueSortDirection = "asc" | "desc";
export type QueueSort = { key: QueueSortKey; direction: QueueSortDirection };

export const DEFAULT_QUEUE_SORT: QueueSort = { key: "WAIT", direction: "desc" };
export const LONG_WAIT_MINUTES = 20;
export const VERY_LONG_WAIT_MINUTES = 30;

const SKILL_ORDER: Record<string, number> = {
  NEWBIE: 0,
  BEGINNER: 1,
  UPPER_BEGINNER: 2,
  INTERMEDIATE: 3,
  UPPER_INTERMEDIATE: 4,
  ADVANCED: 5,
};

const naturalName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Time a waiting player has been eligible to play, excluding required rest. */
export function eligibleWaitMilliseconds(
  player: Pick<QueuePlayer, "status" | "queueEnteredAt" | "lastMatchEndedAt" | "currentMatchId">,
  serverTime: string,
  minimumRestMinutes: number,
) {
  if (player.status !== "WAITING" || player.currentMatchId) return null;
  const enteredAt = parseTime(player.queueEnteredAt);
  const now = parseTime(serverTime);
  if (enteredAt === null || now === null) return null;
  const restAt = player.lastMatchEndedAt ? parseTime(player.lastMatchEndedAt) : null;
  if (player.lastMatchEndedAt && restAt === null) return null;
  const eligibleSince = Math.max(enteredAt, restAt === null ? enteredAt : restAt + Math.max(0, minimumRestMinutes) * 60_000);
  return Math.max(0, now - eligibleSince);
}

export function waitMinutes(
  player: Pick<QueuePlayer, "status" | "queueEnteredAt" | "lastMatchEndedAt" | "currentMatchId">,
  serverTime: string,
  minimumRestMinutes: number,
) {
  const elapsed = eligibleWaitMilliseconds(player, serverTime, minimumRestMinutes);
  return elapsed === null ? null : Math.floor(elapsed / 60_000);
}

export function waitAttention(minutes: number | null) {
  if (minutes === null || minutes < LONG_WAIT_MINUTES) return null;
  return minutes >= VERY_LONG_WAIT_MINUTES ? "VERY_LONG" as const : "LONG" as const;
}

function compareNullableNumber(left: number | null, right: number | null, direction: QueueSortDirection) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const result = left - right;
  return direction === "asc" ? result : -result;
}

function compareNames(left: QueuePlayer, right: QueuePlayer, direction: QueueSortDirection = "asc") {
  const leftName = typeof left.displayName === "string" && left.displayName.trim() ? left.displayName : null;
  const rightName = typeof right.displayName === "string" && right.displayName.trim() ? right.displayName : null;
  if (leftName === null && rightName !== null) return 1;
  if (leftName !== null && rightName === null) return -1;
  const result = leftName === null || rightName === null ? 0 : naturalName.compare(leftName, rightName);
  if (result) return direction === "asc" ? result : -result;
  return String(left.id).localeCompare(String(right.id));
}

function comparePlayers(left: QueuePlayer, right: QueuePlayer, sort: QueueSort, serverTime: string, minimumRestMinutes: number) {
  let result = 0;
  if (sort.key === "PLAYER") {
    return compareNames(left, right, sort.direction);
  } else if (sort.key === "SKILL") {
    result = compareNullableNumber(SKILL_ORDER[left.skillLevel] ?? null, SKILL_ORDER[right.skillLevel] ?? null, sort.direction);
  } else if (sort.key === "GAMES") {
    result = compareNullableNumber(Number.isFinite(left.matchesPlayed) ? left.matchesPlayed : null, Number.isFinite(right.matchesPlayed) ? right.matchesPlayed : null, sort.direction);
  } else if (sort.key === "WAIT") {
    // Sort by the precise elapsed value; only the cell/badge presentation is rounded to minutes.
    result = compareNullableNumber(eligibleWaitMilliseconds(left, serverTime, minimumRestMinutes), eligibleWaitMilliseconds(right, serverTime, minimumRestMinutes), sort.direction);
  } else if (sort.key === "RECORD") {
    const leftWins = Number.isFinite(left.wins) ? left.wins : null;
    const rightWins = Number.isFinite(right.wins) ? right.wins : null;
    result = compareNullableNumber(leftWins, rightWins, sort.direction);
    if (!result) {
      const leftLosses = Number.isFinite(left.losses) ? left.losses : null;
      const rightLosses = Number.isFinite(right.losses) ? right.losses : null;
      result = compareNullableNumber(leftLosses, rightLosses, sort.direction === "desc" ? "asc" : "desc");
    }
  }
  return result || compareNames(left, right);
}

export function sortQueuePlayers(players: readonly QueuePlayer[], sort: QueueSort, serverTime: string, minimumRestMinutes: number) {
  return [...players].sort((left, right) => comparePlayers(left, right, sort, serverTime, minimumRestMinutes));
}
