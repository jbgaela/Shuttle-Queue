// @ts-expect-error Node's direct TypeScript unit runner requires the explicit extension.
import { partitionRankingRows } from "./ranking-presentation.ts";

export type RankingExportSourceRow = {
  rank: number | null;
  player: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRateBasisPoints: number;
  eligible?: boolean;
  gamesNeeded?: number;
  rankingScoreBasisPoints?: number | null;
  seededDrawUsed?: boolean;
};

export type RankingExportRow = {
  rank: number | null;
  player: string;
  games: number;
  record: string;
  winRate: string;
  rankingScore: string;
  section: "RANKED" | "NOT_YET_ELIGIBLE" | "DID_NOT_PLAY";
};

const IMAGE_WIDTH = 1200;
const HORIZONTAL_MARGIN = 64;
const HEADER_HEIGHT = 208;
const TABLE_HEADER_HEIGHT = 64;
const ROW_PADDING = 22;
const MIN_ROW_HEIGHT = 76;
const NAME_FONT = "700 26px Arial";

export function formatRankingExportDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

export function rankingExportFilename(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `linedrive-rankings-${year}-${month}-${day}.png`;
}

export function rankingExportRows(rankings: RankingExportSourceRow[]): RankingExportRow[] {
  const { ranked, notYetEligible, didNotPlay } = partitionRankingRows(rankings);
  return [
    ...ranked.map((ranking) => ({
      rank: ranking.rank,
      player: ranking.player,
      games: ranking.matchesPlayed,
      record: `${ranking.wins}W / ${ranking.losses}L`,
      winRate: `${(ranking.winRateBasisPoints / 100).toFixed(0)}%`,
      rankingScore: ranking.rankingScoreBasisPoints === null || ranking.rankingScoreBasisPoints === undefined ? "—" : `${(ranking.rankingScoreBasisPoints / 100).toFixed(1)}%${ranking.seededDrawUsed ? " (draw)" : ""}`,
      section: "RANKED" as const,
    })),
    ...notYetEligible.map((ranking) => ({
      rank: null,
      player: ranking.player,
      games: ranking.matchesPlayed,
      record: `${ranking.wins}W / ${ranking.losses}L`,
      winRate: `${(ranking.winRateBasisPoints / 100).toFixed(0)}%`,
      rankingScore: ranking.rankingScoreBasisPoints === null || ranking.rankingScoreBasisPoints === undefined ? "—" : `${(ranking.rankingScoreBasisPoints / 100).toFixed(1)}%${ranking.seededDrawUsed ? " (draw)" : ""}`,
      section: "NOT_YET_ELIGIBLE" as const,
    })),
    ...didNotPlay.map((ranking) => ({
      rank: null,
      player: ranking.player,
      games: ranking.matchesPlayed,
      record: `${ranking.wins}W / ${ranking.losses}L`,
      winRate: `${(ranking.winRateBasisPoints / 100).toFixed(0)}%`,
      rankingScore: ranking.rankingScoreBasisPoints === null || ranking.rankingScoreBasisPoints === undefined ? "—" : `${(ranking.rankingScoreBasisPoints / 100).toFixed(1)}%${ranking.seededDrawUsed ? " (draw)" : ""}`,
      section: "DID_NOT_PLAY" as const,
    })),
  ];
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && context.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawCentered(context: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, color: string, font: string) {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(value, x + width / 2, y);
  context.textAlign = "left";
}

export function createRankingExportCanvas(rankings: RankingExportSourceRow[], date: Date): HTMLCanvasElement {
  if (typeof document === "undefined") throw new Error("Ranking images can only be created in a browser.");
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_WIDTH;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create an image canvas.");
  const rows = rankingExportRows(rankings);
  const rankedRows = rows.filter((row) => row.section === "RANKED");
  const notYetEligibleRows = rows.filter((row) => row.section === "NOT_YET_ELIGIBLE");
  const didNotPlayRows = rows.filter((row) => row.section === "DID_NOT_PLAY");
  const nameColumnWidth = 570;
  context.font = NAME_FONT;
  const rowHeights = rankedRows.map((row) => Math.max(MIN_ROW_HEIGHT, wrapText(context, row.player, nameColumnWidth).length * 32 + ROW_PADDING * 2));
  const footerHeight = 72;
  const notYetEligibleSectionHeight = notYetEligibleRows.length ? 40 + notYetEligibleRows.length * 56 : 0;
  const didNotPlaySectionHeight = didNotPlayRows.length ? 40 + didNotPlayRows.length * 56 : 0;
  const rankedSectionHeight = rankedRows.length ? TABLE_HEADER_HEIGHT + rowHeights.reduce((total, height) => total + height, 0) : 90;
  canvas.height = HEADER_HEIGHT + rankedSectionHeight + notYetEligibleSectionHeight + didNotPlaySectionHeight + footerHeight;

  context.fillStyle = "#f5f7f3";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const headerGradient = context.createLinearGradient(0, 0, IMAGE_WIDTH, HEADER_HEIGHT);
  headerGradient.addColorStop(0, "#075d5b");
  headerGradient.addColorStop(1, "#0b9688");
  context.fillStyle = headerGradient;
  context.fillRect(0, 0, IMAGE_WIDTH, HEADER_HEIGHT);
  context.globalAlpha = 0.16;
  context.fillStyle = "#f6b667";
  context.beginPath();
  context.arc(IMAGE_WIDTH - 70, 28, 160, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(IMAGE_WIDTH - 185, 190, 74, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.fillStyle = "#ffffff";
  context.font = "700 48px Georgia";
  context.fillText("LineDrive Queueing", HORIZONTAL_MARGIN, 86);
  context.font = "600 25px Arial";
  context.fillStyle = "#d8f1eb";
  context.fillText("Rankings leaderboard", HORIZONTAL_MARGIN, 132);
  context.font = "500 22px Arial";
  context.fillStyle = "#ffffff";
  context.fillText(formatRankingExportDate(date), HORIZONTAL_MARGIN, 174);

  const tableX = HORIZONTAL_MARGIN;
  const tableWidth = IMAGE_WIDTH - HORIZONTAL_MARGIN * 2;
  const tableY = HEADER_HEIGHT;
  const columns = { rank: 96, player: nameColumnWidth, games: 130, record: 170, winRate: 123, rankingScore: tableWidth - 96 - nameColumnWidth - 130 - 170 - 123 };
  let rowY = tableY;
  if (rankedRows.length) {
    context.fillStyle = "#102a2d";
    roundedRect(context, tableX, rowY, tableWidth, TABLE_HEADER_HEIGHT, 16);
    context.fill();
    const headerColor = "#ffffff";
    drawCentered(context, "RANK", tableX, rowY + TABLE_HEADER_HEIGHT / 2, columns.rank, headerColor, "700 18px Arial");
    context.textAlign = "left";
    context.font = "700 18px Arial";
    context.fillStyle = headerColor;
    context.fillText("PLAYER", tableX + columns.rank + 18, rowY + TABLE_HEADER_HEIGHT / 2 + 1);
    drawCentered(context, "GAMES", tableX + columns.rank + columns.player, rowY + TABLE_HEADER_HEIGHT / 2, columns.games, headerColor, "700 18px Arial");
    drawCentered(context, "RECORD", tableX + columns.rank + columns.player + columns.games, rowY + TABLE_HEADER_HEIGHT / 2, columns.record, headerColor, "700 18px Arial");
    drawCentered(context, "WIN RATE", tableX + columns.rank + columns.player + columns.games + columns.record, rowY + TABLE_HEADER_HEIGHT / 2, columns.winRate, headerColor, "700 18px Arial");
    drawCentered(context, "SCORE", tableX + columns.rank + columns.player + columns.games + columns.record + columns.winRate, rowY + TABLE_HEADER_HEIGHT / 2, columns.rankingScore, headerColor, "700 18px Arial");
    rowY += TABLE_HEADER_HEIGHT;
    rankedRows.forEach((row, index) => {
      const rowHeight = rowHeights[index]!;
      context.fillStyle = index % 2 === 0 ? "#ffffff" : "#edf8f4";
      context.fillRect(tableX, rowY, tableWidth, rowHeight);
      const rankColor = row.rank === 1 ? "#f6b667" : row.rank === 2 ? "#c9d9dc" : row.rank === 3 ? "#e9bd91" : "#d8f1eb";
      context.fillStyle = rankColor;
      context.beginPath();
      context.arc(tableX + columns.rank / 2, rowY + rowHeight / 2, 25, 0, Math.PI * 2);
      context.fill();
      drawCentered(context, String(row.rank), tableX + 2, rowY + rowHeight / 2, columns.rank - 4, "#102a2d", "700 21px Arial");
      context.font = NAME_FONT;
      context.fillStyle = "#102a2d";
      context.textBaseline = "top";
      wrapText(context, row.player, columns.player - 36).forEach((line, lineIndex) => context.fillText(line, tableX + columns.rank + 18, rowY + ROW_PADDING + lineIndex * 32));
      drawCentered(context, String(row.games), tableX + columns.rank + columns.player, rowY + rowHeight / 2, columns.games, "#102a2d", "600 23px Arial");
      drawCentered(context, row.record, tableX + columns.rank + columns.player + columns.games, rowY + rowHeight / 2, columns.record, "#102a2d", "600 22px Arial");
      drawCentered(context, row.winRate, tableX + columns.rank + columns.player + columns.games + columns.record, rowY + rowHeight / 2, columns.winRate, "#087a72", "700 24px Arial");
      drawCentered(context, row.rankingScore, tableX + columns.rank + columns.player + columns.games + columns.record + columns.winRate, rowY + rowHeight / 2, columns.rankingScore, "#536a6d", "600 20px Arial");
      context.strokeStyle = "#dce8e2";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(tableX, rowY + rowHeight);
      context.lineTo(tableX + tableWidth, rowY + rowHeight);
      context.stroke();
      rowY += rowHeight;
    });
  } else {
    context.fillStyle = "#ffffff";
    roundedRect(context, tableX, rowY, tableWidth, 76, 16);
    context.fill();
    context.font = "600 22px Arial";
    context.fillStyle = "#536a6d";
    context.textBaseline = "middle";
    context.fillText("No ranked players yet", tableX + 24, rowY + 38);
    rowY += 90;
  }

  if (notYetEligibleRows.length) {
    context.font = "700 24px Arial";
    context.fillStyle = "#102a2d";
    context.textBaseline = "top";
    context.fillText("Not yet eligible (5 games required)", tableX, rowY + 4);
    rowY += 40;
    notYetEligibleRows.forEach((row, index) => {
      const rowHeight = 56;
      context.fillStyle = index % 2 === 0 ? "#ffffff" : "#edf8f4";
      context.fillRect(tableX, rowY, tableWidth, rowHeight);
      context.font = NAME_FONT;
      context.fillStyle = "#102a2d";
      context.textBaseline = "middle";
      context.fillText(row.player, tableX + 24, rowY + rowHeight / 2);
      context.font = "500 18px Arial";
      context.fillStyle = "#536a6d";
      context.fillText(`${row.games}/5 games`, tableX + tableWidth - 170, rowY + rowHeight / 2);
      rowY += rowHeight;
    });
  }

  if (didNotPlayRows.length) {
    context.font = "700 24px Arial";
    context.fillStyle = "#102a2d";
    context.textBaseline = "top";
    context.fillText("Did not play", tableX, rowY + 4);
    rowY += 40;
    didNotPlayRows.forEach((row, index) => {
      const rowHeight = 56;
      context.fillStyle = index % 2 === 0 ? "#ffffff" : "#edf8f4";
      context.fillRect(tableX, rowY, tableWidth, rowHeight);
      context.font = NAME_FONT;
      context.fillStyle = "#102a2d";
      context.textBaseline = "middle";
      context.fillText(row.player, tableX + 24, rowY + rowHeight / 2);
      rowY += rowHeight;
    });
  }

  context.fillStyle = "#536a6d";
  context.font = "500 18px Arial";
  const rankedLabel = `${rankedRows.length} ranked player${rankedRows.length === 1 ? "" : "s"}`;
  const didNotPlayLabel = `${didNotPlayRows.length} did not play`;
  context.fillText(`${rankedLabel} · ${didNotPlayLabel}`, tableX, canvas.height - 28);
  return canvas;
}

export async function saveRankingsToDevice(rankings: RankingExportSourceRow[], date = new Date()) {
  if (!rankings.length) throw new Error("There are no rankings to save yet.");
  const canvas = createRankingExportCanvas(rankings, date);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The ranking image could not be created.")), "image/png"));
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = rankingExportFilename(date);
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
