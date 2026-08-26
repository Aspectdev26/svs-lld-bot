import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "points.json");

interface PlayerPoints {
  discordName: string;
  points: number;
}

interface PointsData {
  seasonName: string;
  seasonStartedAt: string;
  players: Record<string, PlayerPoints>;
}

export interface StandingsEntry {
  discordUserId: string;
  discordName: string;
  points: number;
}

const EMPTY_DATA: PointsData = { seasonName: "", seasonStartedAt: "", players: {} };

async function load(): Promise<PointsData> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as PointsData;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_DATA, players: {} };
    throw err;
  }
}

/** Writes via a temp file + rename so a crash mid-write can't leave a truncated/corrupt file. */
async function save(data: PointsData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.tmp`;
  await writeFile(tmpFile, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpFile, DATA_FILE);
}

/** Adds (or subtracts) points for one player this season, upserting their record and refreshing their display name. */
export async function addPoints(discordUserId: string, discordName: string, delta: number): Promise<void> {
  const data = await load();
  const existing = data.players[discordUserId];
  data.players[discordUserId] = {
    discordName,
    points: (existing?.points ?? 0) + delta,
  };
  await save(data);
}

/** Current season's standings, sorted highest points first. */
export async function getStandings(): Promise<StandingsEntry[]> {
  const data = await load();
  return Object.entries(data.players)
    .map(([discordUserId, p]) => ({ discordUserId, discordName: p.discordName, points: p.points }))
    .sort((a, b) => b.points - a.points);
}

/** Wipes all standings and starts tracking a new season, mirroring the SeasonStats tab reset. */
export async function resetForNewSeason(seasonName: string, seasonStartedAt: string): Promise<void> {
  await save({ seasonName, seasonStartedAt, players: {} });
}

/** Zeroes one player's current-season points (e.g. full removal after an unreturned Extended Vacation). No-op if they have no record. */
export async function resetPlayer(discordUserId: string): Promise<void> {
  const data = await load();
  const existing = data.players[discordUserId];
  if (!existing) return;
  data.players[discordUserId] = { ...existing, points: 0 };
  await save(data);
}
