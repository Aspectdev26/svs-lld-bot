import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { LadderRow } from "../types.js";

/*
 * Discord fits embed images into a fixed-size box, so a tall image is scaled down until its text is
 * tiny. The layout is therefore wide and short — two columns (ranks 1–5 left, 6–10 right) — with
 * large type, so it fills that box and still reads at its displayed size.
 */
const WIDTH = 1000;
const PADDING = 24;
const COLUMN_GAP = 16;
const COLUMNS = 2;
const HEADER_HEIGHT = 88;
const ROW_HEIGHT = 84;
const ROW_GAP = 8;
const BADGE_SIZE = 60;
const ICON_SIZE = 42;
const NAME_FONT_MAX = 38;
const NAME_FONT_MIN = 24;

const RANK_COLORS: Record<number, string> = { 1: "#f1c40f", 2: "#bdc3c7", 3: "#cd7f32" };
const DEFAULT_RANK_COLOR = "#4a4a52";
const TEXT_MUTED = "#b5b6bc";

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Green rounded square with a white check mark (mirrors the ✅ emoji). */
function drawCheckIcon(ctx: SKRSContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = "#2ecc71";
  roundedRect(ctx, x, y, size, size, size * 0.22);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.14;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.25, y + size * 0.52);
  ctx.lineTo(x + size * 0.43, y + size * 0.7);
  ctx.lineTo(x + size * 0.76, y + size * 0.32);
  ctx.stroke();
}

/** Bold red X (mirrors the ❌ emoji). */
function drawCrossIcon(ctx: SKRSContext2D, x: number, y: number, size: number): void {
  const inset = size * 0.18;
  ctx.strokeStyle = "#e74c3c";
  ctx.lineWidth = size * 0.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + inset, y + inset);
  ctx.lineTo(x + size - inset, y + size - inset);
  ctx.moveTo(x + size - inset, y + inset);
  ctx.lineTo(x + inset, y + size - inset);
  ctx.stroke();
}

/** Draws `text` at the largest bold size (down to NAME_FONT_MIN) that fits `maxWidth`, then ellipsizes if still too long. */
function drawFittedName(ctx: SKRSContext2D, text: string, x: number, y: number, maxWidth: number): void {
  let size = NAME_FONT_MAX;
  ctx.font = `bold ${size}px sans-serif`;
  while (size > NAME_FONT_MIN && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `bold ${size}px sans-serif`;
  }
  let shown = text;
  if (ctx.measureText(shown).width > maxWidth) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > maxWidth) shown = shown.slice(0, -1);
    shown = `${shown}…`;
  }
  ctx.fillText(shown, x, y);
}

/**
 * Renders the Top 10 leaderboard PNG, with a ✅ next to Available players and a ❌ next to players
 * currently in a challenge (Vacation players get a grey "VACATION" label under their name instead).
 */
export async function renderLadderImage(rows: LadderRow[], title: string): Promise<Buffer> {
  const rowsPerColumn = Math.max(1, Math.ceil(rows.length / COLUMNS));
  const height = HEADER_HEIGHT + rowsPerColumn * (ROW_HEIGHT + ROW_GAP) - ROW_GAP + PADDING;
  const columnWidth = (WIDTH - PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";

  // Background
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, WIDTH, height);

  // Header: title on the left, ✅/❌ legend on the right
  const headerMid = HEADER_HEIGHT / 2 - 4;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 46px sans-serif";
  ctx.fillText(title, PADDING, headerMid);

  ctx.font = "bold 26px sans-serif";
  const legendIcon = 32;
  const availableText = "Available";
  const challengeText = "In a challenge";
  const legendWidth =
    legendIcon + 10 + ctx.measureText(availableText).width + 28 + legendIcon + 10 + ctx.measureText(challengeText).width;
  let lx = WIDTH - PADDING - legendWidth;
  drawCheckIcon(ctx, lx, headerMid - legendIcon / 2, legendIcon);
  lx += legendIcon + 10;
  ctx.fillStyle = TEXT_MUTED;
  ctx.fillText(availableText, lx, headerMid);
  lx += ctx.measureText(availableText).width + 28;
  drawCrossIcon(ctx, lx, headerMid - legendIcon / 2, legendIcon);
  lx += legendIcon + 10;
  ctx.fillStyle = TEXT_MUTED;
  ctx.fillText(challengeText, lx, headerMid);

  if (rows.length === 0) {
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = "32px sans-serif";
    ctx.fillText("Nobody's signed up yet — check #register!", PADDING, HEADER_HEIGHT + ROW_HEIGHT / 2);
    return canvas.encode("png");
  }

  rows.forEach((row, i) => {
    const col = Math.floor(i / rowsPerColumn);
    const rowInCol = i % rowsPerColumn;
    const x = PADDING + col * (columnWidth + COLUMN_GAP);
    const y = HEADER_HEIGHT + rowInCol * (ROW_HEIGHT + ROW_GAP);
    const midY = y + ROW_HEIGHT / 2;

    // Row card
    ctx.fillStyle = "#383a40";
    roundedRect(ctx, x, y, columnWidth, ROW_HEIGHT, 12);
    ctx.fill();

    // Rank badge
    const badgeX = x + 12;
    const badgeY = midY - BADGE_SIZE / 2;
    ctx.fillStyle = RANK_COLORS[row.rank] ?? DEFAULT_RANK_COLOR;
    roundedRect(ctx, badgeX, badgeY, BADGE_SIZE, BADGE_SIZE, 12);
    ctx.fill();
    ctx.fillStyle = row.rank <= 3 ? "#1e1f22" : "#ffffff";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(row.rank), badgeX + BADGE_SIZE / 2, midY + 1);
    ctx.textAlign = "left";

    // Status icon: ✅ available, ❌ in a challenge, nothing on vacation
    const iconX = badgeX + BADGE_SIZE + 14;
    if (row.status === "Challenge") drawCrossIcon(ctx, iconX, midY - ICON_SIZE / 2, ICON_SIZE);
    else if (row.status === "Available") drawCheckIcon(ctx, iconX, midY - ICON_SIZE / 2, ICON_SIZE);

    // Player name, shrunk only as far as needed to fit the card
    const textX = iconX + ICON_SIZE + 14;
    const maxNameWidth = x + columnWidth - 14 - textX;
    const name = row.discordName || "(unknown)";
    ctx.fillStyle = "#ffffff";
    if (row.status === "Vacation") {
      drawFittedName(ctx, name, textX, midY - 12, maxNameWidth);
      ctx.fillStyle = "#949ba4";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText("VACATION", textX, midY + 22);
    } else {
      drawFittedName(ctx, name, textX, midY + 1, maxNameWidth);
    }
  });

  return canvas.encode("png");
}
