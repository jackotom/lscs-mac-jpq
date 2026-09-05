import fs from "node:fs";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatchHistoryStore } from "../src/main/matchHistoryStore";
import { parseMatchResultLine } from "../src/shared/powerLogParser";
import type { MatchRecord } from "../src/shared/types";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: class BrowserWindow {}
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseMatchResultLine", () => {
  it.each([
    ["WON", "win"],
    ["LOST", "loss"],
    ["CONCEDED", "loss"],
    ["TIED", "tie"]
  ] as const)("maps local PLAYSTATE %s to %s", (playState, result) => {
    const line = `D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=${playState}`;

    expect(parseMatchResultLine(line, 1)).toBe(result);
  });

  it("ignores an opponent PLAYSTATE", () => {
    const line = "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Opponent id=3 zone=PLAY zonePos=0 cardId= player=2] tag=PLAYSTATE value=WON";

    expect(parseMatchResultLine(line, 1)).toBeUndefined();
  });

  it("ignores PLAYSTATE when the local controller is unknown", () => {
    const line = "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=WON";

    expect(parseMatchResultLine(line, undefined)).toBeUndefined();
  });

  it("ignores FINAL_GAMEOVER", () => {
    const line = "D 12:05:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER";

    expect(parseMatchResultLine(line, 1)).toBeUndefined();
  });

  it("matches a real bare-name result only when the local name is confirmed", () => {
    const local = "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=Alice#1111 tag=PLAYSTATE value=LOST";
    const opponent = "D 12:05:00.001 GameState.DebugPrintPower() - TAG_CHANGE Entity=Bob#2222 tag=PLAYSTATE value=WON";

    expect(parseMatchResultLine(local, 1, "Alice#1111")).toBe("loss");
    expect(parseMatchResultLine(opponent, 1, "Alice#1111")).toBeUndefined();
    expect(parseMatchResultLine(local, 1)).toBeUndefined();
  });
});

describe("MatchHistoryStore", () => {
  it("treats a missing file as an empty history", async () => {
    const store = await createStore();

    await expect(store.getHistory()).resolves.toEqual({
      status: "ok",
      matches: [],
      summary: { total: 0, wins: 0, losses: 0, ties: 0, winRate: 0 }
    });
  });

  it("deduplicates replayed matches by stable id", async () => {
    const store = await createStore();
    const match = createMatch(1, "win");

    await store.add(match);
    await store.add(match);

    await expect(store.getHistory()).resolves.toMatchObject({
      status: "ok",
      matches: [match],
      summary: { total: 1, wins: 1, losses: 0, ties: 0, winRate: 1 }
    });
  });

  it("keeps the original record and order when an older match is replayed", async () => {
    const store = await createStore();
    const originalA = createMatch(1, "win");
    const matchB = createMatch(2, "loss");
    const replayedA = { ...originalA, endedAt: "2026-07-22T12:00:00.000Z" };

    await store.add(originalA);
    await store.add(matchB);
    await store.add(replayedA);

    await expect(store.getHistory()).resolves.toMatchObject({
      status: "ok",
      matches: [matchB, originalA]
    });
  });

  it("keeps only the latest 100 matches", async () => {
    const store = await createStore();
    for (let index = 0; index < 101; index += 1) {
      await store.add(createMatch(index, index % 2 === 0 ? "win" : "loss"));
    }

    const history = await store.getHistory();

    expect(history.status).toBe("ok");
    if (history.status === "ok") {
      expect(history.matches).toHaveLength(100);
      expect(history.matches[0]?.id).toBe("match-100");
      expect(history.matches.at(-1)?.id).toBe("match-1");
    }
  });

  it("filters completed matches using the configured retention period", async () => {
    const store = await createStore();
    const recent = { ...createMatch(1, "win"), endedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString() };
    const expired = { ...createMatch(2, "loss"), endedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() };
    await store.add(expired);
    await store.add(recent);

    store.setRetentionDays(30);

    await expect(store.getHistory()).resolves.toMatchObject({
      status: "ok",
      matches: [recent],
      summary: { total: 1, wins: 1, losses: 0 }
    });
  });

  it("sorts out-of-order inserts by endedAt and keeps the true latest 100", async () => {
    const store = await createStore();
    await store.add(createMatch(100, "win"));
    for (let index = 0; index < 100; index += 1) {
      await store.add(createMatch(index, index % 2 === 0 ? "win" : "loss"));
    }

    const history = await store.getHistory();

    expect(history.status).toBe("ok");
    if (history.status === "ok") {
      expect(history.matches).toHaveLength(100);
      expect(history.matches[0]?.id).toBe("match-100");
      expect(history.matches.at(-1)?.id).toBe("match-1");
      expect(history.matches.some((match) => match.id === "match-0")).toBe(false);
    }
  });

  it("returns a clear error for a corrupt history file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-"));
    tempDirs.push(root);
    const databasePath = path.join(root, "match-history.json");
    await writeFile(databasePath, "{broken", "utf8");
    const store = new MatchHistoryStore(databasePath);

    await expect(store.getHistory()).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("读取对局历史失败")
    });
  });

  it("reports a previous write failure through getHistory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-"));
    tempDirs.push(root);
    const blockedParent = path.join(root, "blocked");
    await writeFile(blockedParent, "not a directory", "utf8");
    const store = new MatchHistoryStore(path.join(blockedParent, "match-history.json"));

    await expect(store.add(createMatch(1, "tie"))).rejects.toThrow();
    await expect(store.getHistory()).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("写入对局历史失败")
    });
  });
});

describe("TrackerService match history", () => {
  it("does not guess the local player when Power.log names two real players", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-ambiguous-player-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Alice#1111",
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=Bob#2222",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Bob id=3 zone=PLAY zonePos=0 cardId= player=2] tag=PLAYSTATE value=WON",
      "D 12:05:00.001 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Alice id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=LOST"
    ].join("\n"), "utf8");
    const store = new MatchHistoryStore(path.join(root, "match-history.json"));
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      store
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [],
      summary: { total: 0, wins: 0, losses: 0 }
    });
  });

  it("does not apply a single ordinary Power.log name before a second player arrives", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-split-player-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(
      powerLog,
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED\n",
      "utf8"
    );
    const deck = {
      id: "ordinary-name-safety-deck",
      name: "Identity Safety Deck",
      cards: [{ name: "Fireball", count: 1, cardId: "CS2_029" }],
      rawText: "1x Fireball",
      sourcePath: path.join(root, "Decks.log"),
      updatedAt: "2026-07-21T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [deck], activeDeck: deck }))
    };
    const service = new TrackerService(
      scanner,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );
    await service.start({ logPath: powerLog });
    expect(service.getState().summary).toMatchObject({ totalCards: 1, remainingCards: 1, drawnCards: 0 });

    await appendFile(powerLog, [
      "D 12:00:02.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Alice#1111",
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND",
      ""
    ].join("\n"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(service.getState().summary).toMatchObject({ totalCards: 1, remainingCards: 1, drawnCards: 0 });
    await appendFile(powerLog, [
      "D 12:00:04.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=Bob#2222",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Bob id=3 zone=PLAY zonePos=0 cardId= player=2] tag=PLAYSTATE value=WON",
      ""
    ].join("\n"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 300));

    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [],
      summary: { total: 0, wins: 0, losses: 0 }
    });
    expect(service.getState().summary.drawnCards).toBe(0);
  });

  it("keeps an explicit Player.log controller authoritative across split Power.log identities", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-split-explicit-local-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    const playerLog = path.join(root, "Player.log");
    await writeFile(
      playerLog,
      "D 11:59:59.000 GameState.DebugPrintGame() - LocalPlayer PlayerID=1, PlayerName=Alice#1111\n",
      "utf8"
    );
    await writeFile(
      powerLog,
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED\n",
      "utf8"
    );
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );
    await service.start({ logPath: powerLog });

    await appendFile(
      powerLog,
      "D 12:00:02.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Alice#1111\n",
      "utf8"
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await appendFile(powerLog, [
      "D 12:00:03.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=Bob#2222",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Bob id=3 zone=PLAY zonePos=0 cardId= player=2] tag=PLAYSTATE value=WON",
      "D 12:05:00.001 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Alice id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=LOST",
      ""
    ].join("\n"), "utf8");
    await vi.waitFor(async () => {
      await expect(service.getMatchHistory()).resolves.toMatchObject({
        status: "ok",
        matches: [{ result: "loss" }],
        summary: { total: 1, wins: 0, losses: 1 }
      });
    });

    await service.dispose();
  });

  it("keeps an explicit Player.log local marker authoritative with two named Power.log players", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-explicit-local-player-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    const playerLog = path.join(root, "Player.log");
    await writeFile(
      playerLog,
      "D 11:59:59.000 GameState.DebugPrintGame() - LocalPlayer PlayerID=1, PlayerName=Alice#1111\n",
      "utf8"
    );
    await writeFile(powerLog, [
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Alice#1111",
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=Bob#2222",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=Bob#2222 tag=PLAYSTATE value=WON",
      "D 12:05:00.001 GameState.DebugPrintPower() - TAG_CHANGE Entity=Alice#1111 tag=PLAYSTATE value=LOST"
    ].join("\n"), "utf8");
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ result: "loss" }],
      summary: { total: 1, wins: 0, losses: 1 }
    });
  });

  it("uses the old Power.log result time instead of the import time", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-old-log-time-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, completedPowerLog("12:00:01", "WON"), "utf8");
    const fileModifiedAt = new Date(2024, 4, 10, 12, 5, 30, 0);
    await utimes(powerLog, fileModifiedAt, fileModifiedAt);
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ endedAt: new Date(2024, 4, 10, 12, 5, 0, 0).toISOString() }]
    });
  });

  it("moves a late-night result to the previous day when file mtime is just after midnight", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-midnight-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 23:58:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
      "D 23:58:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 23:59:59.500 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=WON"
    ].join("\n"), "utf8");
    const fileModifiedAt = new Date(2024, 4, 11, 0, 0, 30, 0);
    await utimes(powerLog, fileModifiedAt, fileModifiedAt);
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ endedAt: new Date(2024, 4, 10, 23, 59, 59, 500).toISOString() }]
    });
  });

  it("falls back to Power.log mtime when a result line has no safe timestamp", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-mtime-fallback-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=WON"
    ].join("\n"), "utf8");
    const fileModifiedAt = new Date(2024, 4, 10, 12, 5, 30, 0);
    await utimes(powerLog, fileModifiedAt, fileModifiedAt);
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ endedAt: fileModifiedAt.toISOString() }]
    });
  });

  it("persists one local result with the active deck and mode across replay", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-service-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=WON"
    ].join("\n"), "utf8");
    const deck = {
      id: "deck-1",
      name: "Test Standard Deck",
      format: "standard",
      cards: [{ name: "Fireball", count: 30 }],
      rawText: "",
      sourcePath: path.join(root, "Decks.log"),
      updatedAt: "2026-07-21T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [deck], activeDeck: deck }))
    };
    const store = new MatchHistoryStore(path.join(root, "match-history.json"));
    const service = new TrackerService(
      scanner,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      store
    );

    await service.start({ logPath: powerLog });
    await service.dispose();
    const replayService = new TrackerService(
      scanner,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );
    await replayService.start({ logPath: powerLog });
    const history = await replayService.getMatchHistory();
    await replayService.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ result: "win", mode: "standard", deckName: "Test Standard Deck" }],
      summary: { total: 1, wins: 1 }
    });
  });

  it("keeps a deck name auto-matched earlier in the same completed log chunk", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-auto-deck-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 12:01:00.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND",
      "D 12:01:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Frostbolt id=65 zone=DECK zonePos=2 cardId=CS2_024 player=1] tag=ZONE value=HAND",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=WON"
    ].join("\n"), "utf8");
    const deck = {
      id: "auto-deck-1",
      name: "Auto Matched Deck",
      format: "wild",
      cards: [
        { name: "Fireball", count: 1, cardId: "CS2_029" },
        { name: "Frostbolt", count: 1, cardId: "CS2_024" }
      ],
      rawText: "",
      sourcePath: path.join(root, "Decks.log"),
      updatedAt: "2026-07-21T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [deck] }))
    };
    const store = new MatchHistoryStore(path.join(root, "match-history.json"));
    const service = new TrackerService(
      scanner,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      store
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ result: "win", mode: "wild", deckName: "Auto Matched Deck" }]
    });
  });

  it("records a casual game as casual even when its selected deck is Standard", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-casual-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_CASUAL",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=WON"
    ].join("\n"), "utf8");
    const deck = {
      id: "casual-standard-deck",
      name: "Casual Standard Deck",
      format: "standard",
      cards: [{ name: "Fireball", count: 30 }],
      rawText: "",
      sourcePath: path.join(root, "Decks.log"),
      updatedAt: "2026-09-05T00:00:00.000Z",
      warnings: []
    };
    const service = new TrackerService(
      { scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [deck], activeDeck: deck })) },
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(path.join(root, "match-history.json"))
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ result: "win", mode: "casual", deckName: "Casual Standard Deck" }]
    });
  });

  it("records a confirmed Arena result even though Arena games bypass the constructed engine", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-arena-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_ARENA",
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=TIED"
    ].join("\n"), "utf8");
    const store = new MatchHistoryStore(path.join(root, "match-history.json"));
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      store
    );

    await service.start({ logPath: powerLog });
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(history).toMatchObject({
      status: "ok",
      matches: [{ result: "tie", mode: "arena" }]
    });
  });

  it("retries a failed match write and keeps its error visible across another successful match", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-retry-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    const records: MatchRecord[] = [];
    let rejectFirstWrite = true;
    const store = {
      add: vi.fn(async (match: MatchRecord) => {
        if (rejectFirstWrite) {
          rejectFirstWrite = false;
          throw new Error("disk unavailable");
        }
        if (!records.some((entry) => entry.id === match.id)) records.unshift(match);
      }),
      getHistory: vi.fn(async () => ({
        status: "ok" as const,
        matches: records,
        summary: { total: records.length, wins: 0, losses: 0, ties: 0, winRate: 0 }
      }))
    } as unknown as MatchHistoryStore;
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      store
    );
    const firstGame = completedPowerLog("12:00:01", "WON");
    await writeFile(powerLog, firstGame, "utf8");

    await service.start({ logPath: powerLog });
    await expect(service.getMatchHistory()).resolves.toMatchObject({ status: "error" });

    await writeFile(powerLog, completedPowerLog("13:00:01", "LOST"), "utf8");
    await service.start({ logPath: powerLog });
    await expect(service.getMatchHistory()).resolves.toMatchObject({ status: "error" });

    await writeFile(powerLog, firstGame, "utf8");
    await service.start({ logPath: powerLog });
    const recovered = await service.getMatchHistory();
    await service.dispose();

    expect(store.add).toHaveBeenCalledTimes(3);
    expect(recovered).toMatchObject({ status: "ok", summary: { total: 2 } });
  });

  it("waits for a pending history write before dispose resolves", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-dispose-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, completedPowerLog("14:00:01", "WON"), "utf8");
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const store = {
      add: vi.fn(async () => writeGate),
      getHistory: vi.fn(async () => ({
        status: "ok" as const,
        matches: [],
        summary: { total: 0, wins: 0, losses: 0, ties: 0, winRate: 0 }
      }))
    } as unknown as MatchHistoryStore;
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      store
    );
    await service.start({ logPath: powerLog });

    let disposed = false;
    const disposal = service.dispose().then(() => { disposed = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.add).toHaveBeenCalledOnce();
    expect(disposed).toBe(false);

    releaseWrite?.();
    await disposal;
    expect(disposed).toBe(true);
  });

  it("keeps a completed match when a new session starts before its history write finishes", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-session-switch-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    const records: MatchRecord[] = [];
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const store = {
      add: vi.fn(async (match: MatchRecord) => {
        await writeGate;
        if (!records.some((entry) => entry.id === match.id)) records.unshift(match);
      }),
      getHistory: vi.fn(async () => ({
        status: "ok" as const,
        matches: records,
        summary: { total: records.length, wins: records.length, losses: 0, ties: 0, winRate: records.length ? 100 : 0 }
      }))
    } as unknown as MatchHistoryStore;
    await writeFile(powerLog, completedPowerLog("14:30:01", "WON"), "utf8");
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      store
    );

    await service.start({ logPath: powerLog });
    expect(store.add).toHaveBeenCalledTimes(1);
    const nextStart = service.start({ logPath: powerLog });
    releaseWrite?.();
    await nextStart;
    const history = await service.getMatchHistory();
    await service.dispose();

    expect(store.add).toHaveBeenCalledTimes(1);
    expect(history).toMatchObject({ status: "ok", summary: { total: 1 }, matches: [{ result: "win" }] });
  });

  it("performs a final Power.log read before dispose when the watcher has not delivered the result", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "match-history-final-read-"));
    tempDirs.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 15:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
      "D 15:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      ""
    ].join("\n"), "utf8");
    const historyPath = path.join(root, "match-history.json");
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      new MatchHistoryStore(historyPath)
    );
    await service.start({ logPath: powerLog });

    await appendFile(
      powerLog,
      "D 15:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=WON\n",
      "utf8"
    );
    await service.dispose();

    await expect(new MatchHistoryStore(historyPath).getHistory()).resolves.toMatchObject({
      status: "ok",
      matches: [{ result: "win" }],
      summary: { total: 1, wins: 1 }
    });
  });
});

describe("match history IPC boundary", () => {
  it("exposes history to the main window only through trusted IPC", () => {
    const preload = fs.readFileSync(path.resolve(import.meta.dirname, "../src/main/preload.cts"), "utf8");
    const main = fs.readFileSync(path.resolve(import.meta.dirname, "../src/main/main.ts"), "utf8");
    const stateDisplayApi = preload.slice(preload.indexOf("const stateDisplayApi"), preload.indexOf("const cardPreviewSourceApi"));
    const mainApi = preload.slice(preload.indexOf("const mainApi"), preload.indexOf("const capability"));

    expect(main).toContain('secureHandle("tracker:get-match-history"');
    expect(mainApi).toContain("getMatchHistory:");
    expect(stateDisplayApi).not.toContain("getMatchHistory:");
  });
});

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), "match-history-"));
  tempDirs.push(root);
  await mkdir(root, { recursive: true });
  return new MatchHistoryStore(path.join(root, "match-history.json"));
}

function createMatch(index: number, result: MatchRecord["result"]): MatchRecord {
  return {
    id: `match-${index}`,
    result,
    mode: "standard",
    deckName: "Test Deck",
    endedAt: new Date(Date.UTC(2026, 6, 21, 0, index)).toISOString()
  };
}

function completedPowerLog(startTime: string, result: "WON" | "LOST") {
  return [
    "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=Local",
    `D ${startTime}.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED`,
    `D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Local id=2 zone=PLAY zonePos=0 cardId= player=1] tag=PLAYSTATE value=${result}`
  ].join("\n");
}
