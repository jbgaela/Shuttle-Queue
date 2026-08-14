import assert from "node:assert/strict";
import test from "node:test";
import { createRankingExportCanvas, formatRankingExportDate, rankingExportFilename, rankingExportRows, saveRankingsToDevice } from "../../src/lib/rankings-image.ts";

const ranking = (overrides = {}) => ({ rank: 1, queuePlayerId: "queue-1", sessionPlayerId: "queue-1", player: "Alice Santos", playerId: "player-1", gender: "FEMALE", skillLevel: "BEGINNER", matchesPlayed: 4, wins: 3, losses: 1, winRateBasisPoints: 7500, pointsFor: 84, pointsAgainst: 60, pointDifferential: 24, ...overrides });

test("ranking export formats the requested long date and stable filename", () => {
  const date = new Date(2026, 7, 15);
  assert.equal(formatRankingExportDate(date), "August 15, 2026");
  assert.equal(rankingExportFilename(date), "linedrive-rankings-2026-08-15.png");
});

test("export rows preserve ranking order and compact record fields", () => {
  const rows = rankingExportRows([
    ranking({ rank: 2, player: "Bob", matchesPlayed: 0, wins: 0, losses: 0, winRateBasisPoints: 0 }),
    ranking({ rank: 1, player: "Alice", matchesPlayed: 8, wins: 8, losses: 0, winRateBasisPoints: 10000 }),
  ]);
  assert.deepEqual(rows.map((row) => row.player), ["Bob", "Alice"]);
  assert.deepEqual(rows.map((row) => ({ games: row.games, record: row.record, winRate: row.winRate })), [
    { games: 0, record: "0W / 0L", winRate: "0%" },
    { games: 8, record: "8W / 0L", winRate: "100%" },
  ]);
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
