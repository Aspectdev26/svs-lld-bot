export const ELEMENTS = ["Cold", "Light", "Fire"] as const;
export type Element = (typeof ELEMENTS)[number];

export const BUILDS = ["Vita", "ES"] as const;
export type Build = (typeof BUILDS)[number];

export const PLAYER_STATUSES = ["Available", "Vacation"] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/** What the Ladder sheet's Status column can show — Challenge is a display-only overlay while a match is active. */
export const LADDER_DISPLAY_STATUSES = ["Available", "Vacation", "Challenge"] as const;
export type LadderDisplayStatus = (typeof LADDER_DISPLAY_STATUSES)[number];

export interface LadderRow {
  /** 1-indexed position in the Ladder sheet (row number, not rank) — used for targeted updates. */
  sheetRow: number;
  rank: number;
  element: Element;
  build: Build;
  /** In-game character name for this element/build entry — the primary display identity on the ladder. */
  characterName: string;
  discordName: string;
  discordUserId: string;
  status: LadderDisplayStatus;
  joinedAt: string;
  /** Human-readable timestamp of when the active challenge was issued (e.g. "8/22, 9:57 PM EDT"); blank if none. */
  challengeDate: string;
  /** The opponent's rank at the moment the active challenge was issued; blank if none. */
  opponentRank: string;
  /** Free-text field for League Managers — the bot never writes to this column. */
  notes: string;
  /** Running count of matches this entry has won via an approved dodge. */
  dodgeWins: number;
}

export const MATCH_STATUSES = [
  "Pending",
  "Reported",
  "Expired",
  "DodgeApproved",
  "DodgeDenied",
  "Cancelled",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export interface MatchRow {
  sheetRow: number;
  matchId: string;
  challengerUserId: string;
  challengerElement: Element;
  challengerRank: number;
  defenderUserId: string;
  defenderElement: Element;
  defenderRank: number;
  status: MatchStatus;
  createdAt: string;
  expiresAt: string;
  warningSentAt: string;
  winnerUserId: string;
  resolvedAt: string;
  /** ID of the private per-match Discord channel under "Current Challenges", if one was created. */
  channelId: string;
  /** True while an extension request for this match is awaiting League Manager approval. */
  extensionPending: boolean;
}

export const DODGE_STATUSES = ["Pending", "Approved", "Denied"] as const;
export type DodgeStatus = (typeof DODGE_STATUSES)[number];

export interface DodgeRow {
  sheetRow: number;
  dodgeId: string;
  matchId: string;
  requestedByUserId: string;
  requestedAt: string;
  leagueManagerMessageUrl: string;
  status: DodgeStatus;
  resolvedByUserId: string;
  resolvedAt: string;
  denyReason: string;
}

/** Tracks the current rank-1 holder and how many consecutive successful title defenses they have. */
export interface Rank1Row {
  sheetRow: number;
  discordUserId: string;
  discordName: string;
  characterName: string;
  element: Element;
  build: Build;
  defends: number;
  holderSince: string;
}

export const SIGNUP_STATUSES = ["Pending", "Approved", "Denied"] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

/** A pending (or resolved) request from #register awaiting League Manager approval. */
export interface SignupRequestRow {
  sheetRow: number;
  requestId: string;
  discordUserId: string;
  discordName: string;
  characterName: string;
  element: Element;
  build: Build;
  status: SignupStatus;
  requestedAt: string;
  resolvedByUserId: string;
  resolvedAt: string;
  denyReason: string;
  leagueManagerMessageUrl: string;
}

/** A ban record — `element` is either one Element or the "ALL" sentinel (see bannedRepo.ALL_ELEMENTS). */
export interface BanRow {
  sheetRow: number;
  discordUserId: string;
  discordName: string;
  element: string;
  reason: string;
  bannedAt: string;
  bannedByUserId: string;
}
