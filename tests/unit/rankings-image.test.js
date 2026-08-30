import assert from "node:assert/strict";
import test from "node:test";
import { createRankingExportCanvas, formatRankingExportDate, rankingExportFilename, rankingExportRows, saveRankingsToDevice } from "../../src/lib/rankings-image.ts";

const ranking = (overrides = {}) => ({ rank: 1, queuePlayerId: "queue-1", sessionPlayerId: "queue-1", player: "Alice Santos", playerId: "player-1", gender: "FEMALE", skillLevel: "BEGINNER", matchesPlayed: 5, wins: 3, losses: 2, winRateBasisPoints: 6000, pointsFor: 84, pointsAgainst: 60, pointDifferential: 24, ...overrides });

test("ranking export formats the requested long date and stable filename", () => {
  const date = new Date(2026, 7, 15);
  assert.equal(formatRankingExportDate(date), "August 15, 2026");
  assert.equal(rankingExportFilename(date), "linedrive-rankings-2026-08-15.png");
});

test("export rows put ranked players first and retain zero-game players for the separate section", () => {
  const rows = rankingExportRows([
    ranking({ rank: 2, player: "Bob", matchesPlayed: 0, wins: 0, losses: 0, winRateBasisPoints: 0 }),
    ranking({ rank: 1, player: "Alice", matchesPlayed: 8, wins: 8, losses: 0, winRateBasisPoints: 10000 }),
  ]);
  assert.deepEqual(rows.map((row) => row.player), ["Alice", "Bob"]);
  assert.deepEqual(rows.map((row) => ({ rank: row.rank, section: row.section })), [
    { rank: 1, section: "RANKED" },
    { rank: null, section: "DID_NOT_PLAY" },
  ]);
  assert.deepEqual(rows.map((row) => ({ games: row.games, record: row.record, winRate: row.winRate })), [
    { games: 8, record: "8W / 0L", winRate: "100%" },
    { games: 0, record: "0W / 0L", winRate: "0%" },
  ]);
  assert.deepEqual(rows.map((row) => row.rankingScore), ["—", "—"]);
});

test("export rows accept public ranking data without signed-in identifiers", () => {
  const rows = rankingExportRows([{
    rank: null,
    player: "Public Player",
    matchesPlayed: 5,
    wins: 4,
    losses: 1,
    winRateBasisPoints: 8000,
    eligible: true,
    rankingScoreBasisPoints: 8125,
    seededDrawUsed: false,
  }]);
  assert.deepEqual(rows, [{
    rank: 1,
    player: "Public Player",
    games: 5,
    record: "4W / 1L",
    winRate: "80%",
    rankingScore: "81.3%",
    section: "RANKED",
  }]);
});

test("private export keeps provisional players in the ranked table", () => {
  const rows = rankingExportRows([
    ranking({ player: "Provisional Player", matchesPlayed: 2, wins: 2, losses: 0, winRateBasisPoints: 10000, eligible: false, gamesNeeded: 3, rankingScoreBasisPoints: 4125 }),
    ranking({ player: "Qualified Player", matchesPlayed: 5, wins: 3, losses: 2, winRateBasisPoints: 6000, eligible: true, rank: 2 }),
  ]);
  assert.deepEqual(rows.map(({ player, rank, section }) => ({ player, rank, section })), [
    { player: "Provisional Player (Provisional)", rank: 1, section: "RANKED" },
    { player: "Qualified Player", rank: 2, section: "RANKED" },
  ]);
});

test("public export ranks under-five players and omits score and eligibility sections", () => {
  const rows = rankingExportRows([
    ranking({ player: "Short Sample", matchesPlayed: 2, wins: 2, losses: 0, winRateBasisPoints: 10000, eligible: false, gamesNeeded: 3 }),
    ranking({ player: "Qualified Sample", matchesPlayed: 5, wins: 3, losses: 2, winRateBasisPoints: 6000 }),
    ranking({ player: "No Games", matchesPlayed: 0, wins: 0, losses: 0, winRateBasisPoints: 0 }),
  ], { variant: "public" });
  assert.deepEqual(rows.map(({ player, rank, section }) => ({ player, rank, section })), [
    { player: "Short Sample (Provisional)", rank: 1, section: "RANKED" },
    { player: "Qualified Sample", rank: 2, section: "RANKED" },
    { player: "No Games", rank: null, section: "DID_NOT_PLAY" },
  ]);
  assert.equal(rows.some((row) => row.rankingScore !== undefined), false);
});

function canvasEnvironment() {
  const drawnText = [];
  const context = {
    measureText: (value) => ({ width: String(value).length * 14 }),
    fillText: (value) => drawnText.push(String(value)),
    fillRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    fill() {},
    stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  const anchors = [];
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback) => callback(new Blob(["png"], { type: "image/png" })) };
  const document = { createElement: (tag) => tag === "canvas" ? canvas : (() => { const anchor = { href: "", download: "", click: () => anchors.push(anchor) }; return anchor; })() };
  return { canvas, document, drawnText, anchors };
}

test("canvas export includes every player and adapts for long names", () => {
  const environment = canvasEnvironment();
  const previousDocument = globalThis.document;
  globalThis.document = environment.document;
  try {
    const canvas = createRankingExportCanvas([
      ranking({ rank: 1, player: "A very long player name that should wrap across the export row" }),
      ranking({ rank: 2, player: "Bob" }),
      ranking({ rank: 3, player: "Carol" }),
    ], new Date(2026, 7, 15));
    assert.ok(canvas.height > 208 + 64 + 3 * 76);
    assert.ok(environment.drawnText.includes("A very long player name that should"));
    assert.ok(environment.drawnText.includes("Bob"));
    assert.ok(environment.drawnText.includes("Carol"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("canvas export renders zero-game players only in the Did not play section", () => {
  const environment = canvasEnvironment();
  const previousDocument = globalThis.document;
  globalThis.document = environment.document;
  try {
    createRankingExportCanvas([
      ranking({ rank: 1, player: "Alice" }),
      ranking({ rank: 2, player: "Bob", matchesPlayed: 0, wins: 0, losses: 0, winRateBasisPoints: 0 }),
    ], new Date(2026, 7, 15));
    assert.ok(environment.drawnText.includes("Did not play"));
    assert.ok(environment.drawnText.includes("Bob"));
    assert.equal(environment.drawnText.filter((value) => value === "0W / 0L").length, 0);
    assert.equal(environment.drawnText.filter((value) => value === "0%").length, 0);
    assert.equal(environment.drawnText.filter((value) => value === "0").length, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("public canvas export uses the aligned five-column layout and compact no-game chips", () => {
  const environment = canvasEnvironment();
  const previousDocument = globalThis.document;
  globalThis.document = environment.document;
  try {
    const canvas = createRankingExportCanvas([
      ranking({ player: "Short Sample", matchesPlayed: 2, wins: 2, losses: 0, winRateBasisPoints: 10000 }),
      ranking({ player: "Qualified Sample", matchesPlayed: 5, wins: 3, losses: 2, winRateBasisPoints: 6000 }),
      ranking({ player: "No Games", matchesPlayed: 0, wins: 0, losses: 0, winRateBasisPoints: 0 }),
      ranking({ player: "Another No Games", matchesPlayed: 0, wins: 0, losses: 0, winRateBasisPoints: 0 }),
    ], new Date(2026, 7, 15), { variant: "public" });
    assert.ok(canvas.height > 208 + 64 + 2 * 76);
    assert.ok(environment.drawnText.includes("WIN RATE"));
    assert.ok(environment.drawnText.includes("Did not play"));
    assert.ok(environment.drawnText.includes("2 players"));
    assert.ok(environment.drawnText.includes("No Games"));
    assert.ok(environment.drawnText.includes("Another No Games"));
    assert.equal(environment.drawnText.includes("SCORE"), false);
    assert.equal(environment.drawnText.includes("Not yet eligible (5 games required)"), false);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("save downloads one PNG with the expected filename", async () => {
  const environment = canvasEnvironment();
  const previousDocument = globalThis.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  globalThis.document = environment.document;
  URL.createObjectURL = () => "blob:ranking";
  URL.revokeObjectURL = () => {};
  try {
    await saveRankingsToDevice([ranking()], new Date(2026, 7, 15));
    assert.equal(environment.anchors.length, 1);
    assert.equal(environment.anchors[0].href, "blob:ranking");
    assert.equal(environment.anchors[0].download, "linedrive-rankings-2026-08-15.png");
  } finally {
    globalThis.document = previousDocument;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});

test("empty rankings fail before creating a download", async () => {
  await assert.rejects(() => saveRankingsToDevice([]), /no rankings/i);
});

test("canvas failures reject without producing a download", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  try {
    await assert.rejects(() => saveRankingsToDevice([ranking()]), /could not create an image canvas/i);
  } finally {
    globalThis.document = previousDocument;
  }
});
