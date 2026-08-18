import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverHearthstoneLogs,
  findBestLogFile,
  getHearthstoneLogCandidates,
  isRootLevelPlayerOnlySession,
  resolveBestLogTarget
} from "../src/main/logDiscovery.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("log discovery", () => {
  it("does not classify a root-level Player.log session with Power.log as player-only", () => {
    expect(isRootLevelPlayerOnlySession({
      root: "/logs",
      sessionDir: "/logs",
      playerLogPath: "/logs/Player.log",
      powerLogPath: "/logs/Power.log",
      modifiedAtMs: 1
    })).toBe(false);
  });

  it("finds a readable Hearthstone session under candidate roots", async () => {
    const logs = await discoverHearthstoneLogs({
      extraCandidates: [resolve("fixtures/logs/session-2026-07-10")],
      homeDir: resolve("fixtures/missing-home"),
      env: {},
      includeDefaultCandidates: false
    });

    expect(logs).toEqual(
      expect.objectContaining({
        sessionDir: resolve("fixtures/logs/session-2026-07-10"),
        powerLogPath: resolve("fixtures/logs/session-2026-07-10/Power.log"),
        playerLogPath: resolve("fixtures/logs/session-2026-07-10/Player.log")
      })
    );

    const arenaLogs = await discoverHearthstoneLogs({
      extraCandidates: [resolve("fixtures/logs/arena-session")],
      homeDir: resolve("fixtures/missing-home"),
      env: {},
      includeDefaultCandidates: false
    });

    expect(arenaLogs).toEqual(
      expect.objectContaining({
        arenaLogPath: resolve("fixtures/logs/arena-session/Arena.log"),
        loadingScreenLogPath: undefined
      })
    );
  });

  it("includes explicit env path before default macOS locations", () => {
    const candidates = getHearthstoneLogCandidates({
      homeDir: "/Users/example",
      env: { HEARTHSTONE_LOG_DIR: "/tmp/hearthstone-logs" }
    });

    expect(candidates[0]).toBe(resolve("/tmp/hearthstone-logs"));
    expect(candidates).toContain(resolve("/Users/example/Library/Logs/Blizzard Entertainment/Hearthstone"));
    expect(candidates).toContain(resolve("/Applications/Hearthstone/Logs"));
    expect(candidates).toContain(resolve("/Users/example/Library/Logs/Hearthstone"));
    expect(candidates.indexOf(resolve("/Users/example/Library/Logs/Blizzard Entertainment/Hearthstone"))).toBeLessThan(
      candidates.indexOf(resolve("/Users/example/Library/Logs/Blizzard/Hearthstone"))
    );
  });

  it("uses sibling Power.log when a selected Player.log is in the same session", async () => {
    const sessionDir = await mkdtemp(join(os.tmpdir(), "hearthstone-log-discovery-"));
    tempDirs.push(sessionDir);
    const playerLog = join(sessionDir, "Player.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(playerLog, "PlayerID=1\n", "utf8");
    await writeFile(powerLog, "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");

    await expect(findBestLogFile(playerLog)).resolves.toBe(powerLog);
  });

  it("prefers the current Arena draft session even when that session has no Power.log", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-log-arena-only-"));
    tempDirs.push(root);
    const staleSession = join(root, "Hearthstone_2026_07_11_12_18_34");
    const currentArenaSession = join(root, "Hearthstone_2026_07_11_15_56_57");
    await Promise.all([mkdir(staleSession), mkdir(currentArenaSession)]);
    const stalePowerLog = join(staleSession, "Power.log");
    const currentArenaLog = join(currentArenaSession, "Arena.log");
    await writeFile(stalePowerLog, "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");
    await writeFile(
      currentArenaLog,
      [
        "D 15:58:16.7116490 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 15:58:16.7116490 SetDraftMode - DRAFTING"
      ].join("\n"),
      "utf8"
    );
    const staleTime = new Date("2026-07-11T12:18:34.000Z");
    const currentTime = new Date("2026-07-11T15:56:57.000Z");
    await Promise.all([
      utimes(stalePowerLog, staleTime, staleTime),
      utimes(staleSession, staleTime, staleTime),
      utimes(currentArenaLog, currentTime, currentTime),
      utimes(currentArenaSession, currentTime, currentTime)
    ]);

    await expect(resolveBestLogTarget(root)).resolves.toEqual(
      expect.objectContaining({
        sessionDir: currentArenaSession,
        arenaLogPath: currentArenaLog,
        powerLogPath: undefined
      })
    );
  });

  it("prefers a newer Hearthstone session without Power.log over stale card-tracking logs", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-log-current-session-"));
    tempDirs.push(root);
    const staleSession = join(root, "Hearthstone_2026_07_11_12_18_34");
    const currentSession = join(root, "Hearthstone_2026_07_11_15_56_57");
    await Promise.all([mkdir(staleSession), mkdir(currentSession)]);
    const stalePowerLog = join(staleSession, "Power.log");
    const currentDecksLog = join(currentSession, "Decks.log");
    await writeFile(stalePowerLog, "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");
    await writeFile(currentDecksLog, "I 17:29:00.000 Deck Contents Received:\n", "utf8");
    const staleTime = new Date("2026-07-11T12:18:34.000Z");
    const currentTime = new Date("2026-07-11T17:29:00.000Z");
    await Promise.all([
      utimes(stalePowerLog, staleTime, staleTime),
      utimes(staleSession, staleTime, staleTime),
      utimes(currentDecksLog, currentTime, currentTime),
      utimes(currentSession, currentTime, currentTime)
    ]);

    await expect(resolveBestLogTarget(root)).resolves.toEqual(
      expect.objectContaining({
        sessionDir: currentSession,
        decksLogPath: currentDecksLog,
        powerLogPath: undefined
      })
    );
  });

  it("does not fall back to stale Power.log when the newest session only has Player.log", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-log-player-only-session-"));
    tempDirs.push(root);
    const staleSession = join(root, "Hearthstone_2026_07_11_12_18_34");
    const currentSession = join(root, "Hearthstone_2026_07_11_17_38_00");
    await Promise.all([mkdir(staleSession), mkdir(currentSession)]);
    const stalePowerLog = join(staleSession, "Power.log");
    const currentPlayerLog = join(currentSession, "Player.log");
    await writeFile(stalePowerLog, "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");
    await writeFile(currentPlayerLog, "PlayerID=1\n", "utf8");
    const staleTime = new Date("2026-07-11T12:49:45.000Z");
    const currentTime = new Date("2026-07-11T17:38:00.000Z");
    await Promise.all([
      utimes(stalePowerLog, staleTime, staleTime),
      utimes(staleSession, staleTime, staleTime),
      utimes(currentPlayerLog, currentTime, currentTime),
      utimes(currentSession, currentTime, currentTime)
    ]);

    await expect(resolveBestLogTarget(root)).resolves.toEqual(
      expect.objectContaining({
        sessionDir: currentSession,
        playerLogPath: currentPlayerLog,
        powerLogPath: undefined
      })
    );
  });

  it("does not let a root-level Player.log override a readable Power.log session", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-log-root-player-"));
    tempDirs.push(root);
    const powerSession = join(root, "Hearthstone_2026_07_11_17_42_48");
    await mkdir(powerSession);
    const powerLog = join(powerSession, "Power.log");
    const rootPlayerLog = join(root, "Player.log");
    await writeFile(powerLog, "D 18:30:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");
    await writeFile(rootPlayerLog, "PlayerID=1\n", "utf8");
    const powerTime = new Date("2026-07-11T18:33:22.000Z");
    const playerTime = new Date("2026-07-11T18:37:42.000Z");
    await Promise.all([
      utimes(powerLog, powerTime, powerTime),
      utimes(powerSession, powerTime, powerTime),
      utimes(rootPlayerLog, playerTime, playerTime),
      utimes(root, playerTime, playerTime)
    ]);

    await expect(resolveBestLogTarget(root)).resolves.toEqual(
      expect.objectContaining({
        sessionDir: powerSession,
        powerLogPath: powerLog,
        playerLogPath: rootPlayerLog
      })
    );
  });

  it("prefers a usable completed Arena session over newer Player.log-only and stale Power.log sessions", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-log-current-arena-session-"));
    tempDirs.push(root);
    const staleSession = join(root, "Hearthstone_2026_07_11_12_18_34");
    const arenaSession = join(root, "Hearthstone_2026_07_11_15_56_57");
    const playerOnlySession = join(root, "Hearthstone_2026_07_11_17_43_00");
    await Promise.all([mkdir(staleSession), mkdir(arenaSession), mkdir(playerOnlySession)]);
    const stalePowerLog = join(staleSession, "Power.log");
    const arenaLog = join(arenaSession, "Arena.log");
    const playerLog = join(playerOnlySession, "Player.log");
    await writeFile(stalePowerLog, "D 12:49:45.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");
    await writeFile(
      arenaLog,
      [
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001",
        "D 17:39:59.6202750 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );
    await writeFile(playerLog, "PlayerID=1\n", "utf8");
    const staleTime = new Date("2026-07-11T12:49:45.000Z");
    const arenaTime = new Date("2026-07-11T17:39:59.000Z");
    const playerTime = new Date("2026-07-11T17:43:00.000Z");
    await Promise.all([
      utimes(stalePowerLog, staleTime, staleTime),
      utimes(staleSession, staleTime, staleTime),
      utimes(arenaLog, arenaTime, arenaTime),
      utimes(arenaSession, arenaTime, arenaTime),
      utimes(playerLog, playerTime, playerTime),
      utimes(playerOnlySession, playerTime, playerTime)
    ]);

    await expect(resolveBestLogTarget(root)).resolves.toEqual(
      expect.objectContaining({
        sessionDir: arenaSession,
        arenaLogPath: arenaLog,
        powerLogPath: undefined
      })
    );
  });
});
