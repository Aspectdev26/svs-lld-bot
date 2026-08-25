import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow, SignupRequestRow } from "../src/types.js";

vi.mock("../src/sheets/ladderRepo.js", () => ({
  findEntry: vi.fn(),
  findByCharacterNameElementBuild: vi.fn(),
  getLadder: vi.fn(),
  addLadderEntry: vi.fn(),
}));
vi.mock("../src/sheets/rank1Repo.js", () => ({
  crownHolder: vi.fn(),
}));
vi.mock("../src/sheets/signupRequestsRepo.js", () => ({
  getPendingRequestForUserElement: vi.fn(),
  findPendingByCharacterNameElementBuild: vi.fn(),
  getRequestById: vi.fn(),
  addRequest: vi.fn(),
  updateRequest: vi.fn(),
}));
vi.mock("../src/sheets/bannedRepo.js", () => ({
  isBanned: vi.fn(),
}));

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as rank1Repo from "../src/sheets/rank1Repo.js";
import * as signupRequestsRepo from "../src/sheets/signupRequestsRepo.js";
import * as bannedRepo from "../src/sheets/bannedRepo.js";
import { createSignupRequest, approveSignup, denySignup } from "../src/domain/signupService.js";

function ladderRow(overrides: Partial<LadderRow> = {}): LadderRow {
  return {
    sheetRow: 2,
    rank: 3,
    element: "Cold",
    build: "Vita",
    characterName: "Frosty",
    discordName: "user#1234",
    discordUserId: "u1",
    status: "Available",
    joinedAt: "2026-01-01T00:00:00.000Z",
    challengeDate: "",
    opponentRank: "",
    notes: "",
    dodgeWins: 0,
    ...overrides,
  };
}

function requestRow(overrides: Partial<SignupRequestRow> = {}): SignupRequestRow {
  return {
    sheetRow: 2,
    requestId: "req1",
    discordUserId: "u1",
    discordName: "user#1234",
    characterName: "Frosty",
    element: "Cold",
    build: "Vita",
    status: "Pending",
    requestedAt: "2026-01-01T00:00:00.000Z",
    resolvedByUserId: "",
    resolvedAt: "",
    denyReason: "",
    leagueManagerMessageUrl: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(ladderRepo.findEntry).mockReset();
  vi.mocked(ladderRepo.findByCharacterNameElementBuild).mockReset().mockResolvedValue(undefined);
  vi.mocked(ladderRepo.getLadder).mockReset();
  vi.mocked(ladderRepo.addLadderEntry).mockReset();
  vi.mocked(rank1Repo.crownHolder).mockReset();
  vi.mocked(signupRequestsRepo.getPendingRequestForUserElement).mockReset();
  vi.mocked(signupRequestsRepo.findPendingByCharacterNameElementBuild).mockReset().mockResolvedValue(undefined);
  vi.mocked(signupRequestsRepo.getRequestById).mockReset();
  vi.mocked(signupRequestsRepo.addRequest).mockReset();
  vi.mocked(signupRequestsRepo.updateRequest).mockReset();
  vi.mocked(bannedRepo.isBanned).mockReset().mockResolvedValue(undefined);
});

describe("createSignupRequest", () => {
  it("rejects when the player is banned for that element", async () => {
    vi.mocked(bannedRepo.isBanned).mockResolvedValue({
      sheetRow: 2,
      discordUserId: "u1",
      discordName: "user#1234",
      element: "Cold",
      reason: "toxic behavior",
      bannedAt: "2026-01-01T00:00:00.000Z",
      bannedByUserId: "admin1",
    });

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/banned/);
    expect(signupRequestsRepo.addRequest).not.toHaveBeenCalled();
  });

  it("rejects when the player already has that element on the ladder", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(ladderRow());

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already on the ladder/);
    expect(signupRequestsRepo.addRequest).not.toHaveBeenCalled();
  });

  it("rejects when a pending request already exists for that element", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);
    vi.mocked(signupRequestsRepo.getPendingRequestForUserElement).mockResolvedValue(requestRow());

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pending/);
    expect(signupRequestsRepo.addRequest).not.toHaveBeenCalled();
  });

  it("creates a pending request when there's no conflict", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);
    vi.mocked(signupRequestsRepo.getPendingRequestForUserElement).mockResolvedValue(undefined);
    vi.mocked(signupRequestsRepo.getRequestById).mockResolvedValue(requestRow());

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(true);
    expect(signupRequestsRepo.addRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects a character name already on the ladder for that element+build, owned by someone else", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);
    vi.mocked(ladderRepo.findByCharacterNameElementBuild).mockResolvedValue(
      ladderRow({ discordUserId: "someone-else", characterName: "Frosty" }),
    );

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already taken/);
    expect(signupRequestsRepo.addRequest).not.toHaveBeenCalled();
  });

  it("allows reclaiming your own former name+element+build combo", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);
    vi.mocked(ladderRepo.findByCharacterNameElementBuild).mockResolvedValue(
      ladderRow({ discordUserId: "u1", characterName: "Frosty" }),
    );
    vi.mocked(signupRequestsRepo.getRequestById).mockResolvedValue(requestRow());

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(true);
  });

  it("rejects a character name already pending review for that element+build, owned by someone else", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);
    vi.mocked(signupRequestsRepo.findPendingByCharacterNameElementBuild).mockResolvedValue(
      requestRow({ discordUserId: "someone-else", characterName: "Frosty" }),
    );

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already pending review/);
    expect(signupRequestsRepo.addRequest).not.toHaveBeenCalled();
  });

  it("does not block on a different element or build sharing the same name", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);
    vi.mocked(ladderRepo.findByCharacterNameElementBuild).mockResolvedValue(undefined); // repo itself scopes by element+build
    vi.mocked(signupRequestsRepo.getRequestById).mockResolvedValue(requestRow());

    const result = await createSignupRequest("u1", "user#1234", "Frosty", "Cold", "Vita");

    expect(result.ok).toBe(true);
  });
});

describe("approveSignup", () => {
  it("places the new entry at the bottom of the ladder", async () => {
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([ladderRow({ rank: 1 }), ladderRow({ rank: 2 })]);

    const { entry } = await approveSignup(requestRow(), "admin1");

    expect(entry.rank).toBe(3);
    expect(entry.characterName).toBe("Frosty");
    expect(ladderRepo.addLadderEntry).toHaveBeenCalledTimes(1);
    expect(rank1Repo.crownHolder).not.toHaveBeenCalled();
    expect(signupRequestsRepo.updateRequest).toHaveBeenCalledWith(expect.objectContaining({ status: "Approved" }));
  });

  it("seeds the rank-1 tracker when the ladder was empty", async () => {
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([]);

    const { entry } = await approveSignup(requestRow(), "admin1");

    expect(entry.rank).toBe(1);
    expect(rank1Repo.crownHolder).toHaveBeenCalledTimes(1);
  });
});

describe("denySignup", () => {
  it("marks the request Denied with a reason", async () => {
    const request = requestRow();
    await denySignup(request, "admin1", "no valid character screenshot");

    expect(signupRequestsRepo.updateRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Denied", resolvedByUserId: "admin1", denyReason: "no valid character screenshot" }),
    );
  });
});
