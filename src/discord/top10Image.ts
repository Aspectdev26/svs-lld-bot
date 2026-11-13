import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { LadderRow } from "../types.js";

const WIDTH = 640;
const HEADER_HEIGHT = 80;
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

/** Renders a PNG leaderboard graphic for the given (already top-N-sliced) ladder rows. */
export async function renderTop10Image(rows: LadderRow[]): Promise<Buffer> {
  const height = HEADER_HEIGHT + Math.max(rows.length, 1) * ROW_HEIGHT + PADDING;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, WIDTH, height);

  // Header
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Top 10 Ladder", PADDING, 44);
  ctx.strokeStyle = "#43444b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PADDING, HEADER_HEIGHT - 10);
  ctx.lineTo(WIDTH - PADDING, HEADER_HEIGHT - 10);
  ctx.stroke();

  if (rows.length === 0) {
    ctx.fillStyle = "#b5b6bc";
    ctx.font = "20px sans-serif";
    ctx.fillText("Nobody's signed up yet — check #register!", PADDING, HEADER_HEIGHT + 30);
    return canvas.encode("png");
  }

  rows.forEach((row, i) => {
    const y = HEADER_HEIGHT + i * ROW_HEIGHT;

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

    // Player name (+ Vacation tag), vertically centered in the row
    const textX = PADDING + badgeSize + 16;
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
