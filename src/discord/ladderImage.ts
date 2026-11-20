import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { LadderRow } from "../types.js";

const WIDTH = 640;
const HEADER_HEIGHT = 80;
const LEGEND_HEIGHT = 40;
const ROW_HEIGHT = 52;
const PADDING = 20;

const RANK_COLORS: Record<number, string> = { 1: "#f1c40f", 2: "#bdc3c7", 3: "#cd7f32" };
const DEFAULT_RANK_COLOR = "#4a4a52";

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ICON_SIZE = 26;

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

/**
 * Renders a PNG leaderboard graphic of the given ladder rows (one page of the panel), with a ✅ next
 * to Available players and a ❌ next to players currently in a challenge (Vacation players get
 * neither, just the tag). The ✅/❌ legend is drawn only when `showLegend` is set (the first page).
 */
export async function renderLadderImage(rows: LadderRow[], title: string, showLegend: boolean): Promise<Buffer> {
  const legendHeight = showLegend ? LEGEND_HEIGHT : 0;
  const height = HEADER_HEIGHT + legendHeight + Math.max(rows.length, 1) * ROW_HEIGHT + PADDING;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, WIDTH, height);

  // Header
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, PADDING, 44);
  ctx.strokeStyle = "#43444b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PADDING, HEADER_HEIGHT - 10);
  ctx.lineTo(WIDTH - PADDING, HEADER_HEIGHT - 10);
  ctx.stroke();

  // Legend
  if (showLegend) {
    const legendIcon = 18;
    const legendY = HEADER_HEIGHT + (LEGEND_HEIGHT - legendIcon) / 2 - 6;
    ctx.font = "15px sans-serif";
    drawCheckIcon(ctx, PADDING, legendY, legendIcon);
    ctx.fillStyle = "#b5b6bc";
    ctx.fillText("Available", PADDING + legendIcon + 8, legendY + 14);
    const crossX = PADDING + legendIcon + 8 + ctx.measureText("Available").width + 24;
    drawCrossIcon(ctx, crossX, legendY, legendIcon);
    ctx.fillStyle = "#b5b6bc";
    ctx.fillText("In a challenge", crossX + legendIcon + 8, legendY + 14);
  }

  const rowsTop = HEADER_HEIGHT + legendHeight;

  if (rows.length === 0) {
    ctx.fillStyle = "#b5b6bc";
    ctx.font = "20px sans-serif";
    ctx.fillText("Nobody's signed up yet — check #register!", PADDING, rowsTop + 30);
    return canvas.encode("png");
  }

  rows.forEach((row, i) => {
    const y = rowsTop + i * ROW_HEIGHT;

    // Alternating row stripe
    ctx.fillStyle = i % 2 === 0 ? "#313338" : "#2b2d31";
    ctx.fillRect(0, y, WIDTH, ROW_HEIGHT);

    // Rank badge
    const badgeSize = 38;
    const badgeY = y + (ROW_HEIGHT - badgeSize) / 2;
    ctx.fillStyle = RANK_COLORS[row.rank] ?? DEFAULT_RANK_COLOR;
    roundedRect(ctx, PADDING, badgeY, badgeSize, badgeSize, 8);
    ctx.fill();
    ctx.fillStyle = row.rank <= 3 ? "#1e1f22" : "#ffffff";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(row.rank), PADDING + badgeSize / 2, badgeY + badgeSize / 2 + 6);
    ctx.textAlign = "left";

    // Status icon: ✅ available, ❌ in a challenge, nothing on vacation
    const iconX = PADDING + badgeSize + 14;
    const iconY = y + (ROW_HEIGHT - ICON_SIZE) / 2;
    if (row.status === "Challenge") drawCrossIcon(ctx, iconX, iconY, ICON_SIZE);
    else if (row.status === "Available") drawCheckIcon(ctx, iconX, iconY, ICON_SIZE);

    // Player name (+ Vacation tag), vertically centered in the row
    const textX = iconX + ICON_SIZE + 12;
    const textY = y + ROW_HEIGHT / 2 + 7;
    const name = row.discordName || "(unknown)";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 19px sans-serif";
    ctx.fillText(name, textX, textY);
    if (row.status === "Vacation") {
      const nameWidth = ctx.measureText(name).width;
      ctx.fillStyle = "#888990";
      ctx.font = "15px sans-serif";
      ctx.fillText("  (Vacation)", textX + nameWidth, textY);
    }
  });

  return canvas.encode("png");
}
