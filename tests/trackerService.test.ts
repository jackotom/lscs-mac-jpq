import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { promises as nodeFs } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HearthstoneLogFiles } from "../src/main/logDiscovery.js";

vi.mock("electron", () => ({
  app: {
    getPath: () => os.tmpdir()
  },
  BrowserWindow: class BrowserWindow {}
}));

const tempDirs: string[] = [];

beforeEach(() => {
  vi.doMock("../src/main/cardDataService.js", () => ({
    CardDataService: class CardDataService {
      async loadCardDatabase() {
        return { warnings: [] };
      }
    }
  }));
  vi.doMock("../src/main/arenaRatingService.js", () => ({
    ArenaRatingService: class ArenaRatingService {
      async loadRatings() {
        return { warnings: [] };
      }
    }
  }));
  vi.doMock("../src/main/arenaScreenRecognition.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/main/arenaScreenRecognition.js")>();
    return {
      ...actual,
      ArenaScreenRecognizer: class ArenaScreenRecognizer {
        async recognize() {
          return { status: "ok" as const, texts: [] };
        }
      }
    };
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock("../src/main/logDiscovery.js");
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("TrackerService log selection", () => {
  it("keeps reading until the complete appended log range is consumed", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService { async loadCardDatabase() { return { warnings: [] }; } }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(powerLog, "D 09:59:59 initial\n", "utf8");
    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: powerLog });

    const originalOpen = nodeFs.open.bind(nodeFs);
    const openSpy = vi.spyOn(nodeFs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      return {
        stat: handle.stat.bind(handle),
        close: handle.close.bind(handle),
        read: (buffer: Buffer, targetOffset: number, length: number, position: number) =>
          handle.read(buffer, targetOffset, Math.min(length, 7), position)
      } as Awaited<ReturnType<typeof nodeFs.open>>;
    });

    await appendFile(
      powerLog,
      "D 10:00:00 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED\n",
      "utf8"
    );
    await vi.waitFor(() => expect(service.getState().gameActive).toBe(true));

    openSpy.mockRestore();
    await service.dispose();
  });

  it("returns to watching after a transient appended-log read error", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({ CardDataService: class { async loadCardDatabase() { return { warnings: [] }; } } }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(powerLog, "D 10:00:00 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED\n", "utf8");
    const service = new TrackerService(undefined, { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) });
    await service.start({ logPath: powerLog });
    const originalOpen = nodeFs.open.bind(nodeFs);
    const openSpy = vi.spyOn(nodeFs, "open").mockRejectedValueOnce(new Error("temporary read failure"));
    await appendFile(powerLog, "D 10:00:01 transient\n", "utf8");
    await vi.waitFor(() => expect(service.getState().status).toBe("error"));
    openSpy.mockImplementation(originalOpen);
    await appendFile(powerLog, "D 10:00:02 recovered\n", "utf8");
    await vi.waitFor(() => expect(service.getState().status).toBe("watching"));
    openSpy.mockRestore();
    await service.dispose();
  });

  it("retries an uncommitted appended chunk without requiring more bytes", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({ CardDataService: class { async loadCardDatabase() { return { warnings: [] }; } } }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(powerLog, "D 10:00:00 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED\n", "utf8");
    await writeFile(decksLog, "initial\n", "utf8");
    const recoveredDeck = {
      id: "recovered-deck",
      name: "重试恢复牌组",
      format: "标准",
      cards: [{ name: "Recovered Card", count: 30 }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-08-08T00:00:00.000Z",
      warnings: []
    };
    let calls = 0;
    let recoveredScans = 0;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => {
        calls += 1;
        if (calls === 2 || calls === 3) {
          throw new Error("temporary Decks.log processing failure");
        }
        if (calls >= 4) {
          recoveredScans += 1;
          return { status: "ok" as const, decks: [recoveredDeck], activeDeck: recoveredDeck };
        }
        return { status: "ok" as const, decks: [] };
      })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: powerLog });
    expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(1);

    await appendFile(decksLog, "appended once\n", "utf8");
    await vi.waitFor(() => expect(service.getState().status).toBe("error"));
    await vi.waitFor(() => expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(4), {
      timeout: 1_000,
      interval: 25
    });
    await vi.waitFor(() => expect(service.getState()).toMatchObject({
      status: "watching",
      deckName: "重试恢复牌组"
    }));
    await service.dispose();

    expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(4);
    expect(recoveredScans).toBe(1);
  });

  it("serializes overlapping updates from the same log path", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService { async loadCardDatabase() { return { warnings: [] }; } }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(powerLog, "D 10:00:00 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED\n", "utf8");
    await writeFile(decksLog, "initial\n", "utf8");
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scanner = {
      scanAndImportDecks: vi.fn(async () => {
        calls += 1;
        if (calls > 1) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gate;
          active -= 1;
        }
        return { status: "ok" as const, decks: [] };
      })
    };
    const service = new TrackerService(scanner, { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) });
    await service.start({ logPath: powerLog });

    await appendFile(decksLog, "first\n", "utf8");
    await vi.waitFor(() => expect(calls).toBe(2));
    await appendFile(decksLog, "second\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 250));
    release?.();
    await vi.waitFor(() => expect(calls).toBe(3));
    await service.dispose();

    expect(maxActive).toBe(1);
  });

  it("keeps the active Arena deck when Decks.log refreshes a constructed deck", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { database: { "1001": { dbfId: 1001, name: "Arena Card", cardId: "ARENA_001" } }, warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService { async loadRatings() { return { warnings: [] }; } }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 10:00:00 DraftManager.OnChoicesAndContents - Draft Deck ID: 1, Hero Card = HERO_08",
      "D 10:00:00 DraftManager.OnChoicesAndContents - Draft deck contains card ARENA_001",
      "D 10:00:01 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(decksLog, "initial\n", "utf8");
    const constructedDeck = {
      id: "constructed", name: "Standard Deck", format: "标准",
      cards: [{ name: "Constructed Card", count: 30, cardId: "STANDARD_001" }],
      rawText: "", sourcePath: decksLog, updatedAt: new Date().toISOString(), warnings: []
    };
    const scanner = { scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [constructedDeck], activeDeck: constructedDeck })) };
    const service = new TrackerService(scanner, { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) });

    await service.start({ logPath: arenaLog });
    expect(service.getState().deckName).toBe("竞技场牌库");
    await appendFile(decksLog, "changed\n", "utf8");
    await vi.waitFor(() => expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2));

    expect(service.getState().deckName).toBe("竞技场牌库");
    expect(service.getState().arena?.status).toBe("complete");
    expect(service.getState().trackerMode).toBe("arena");
    await service.dispose();
  });

  it("keeps the overlay context alive when Player.log starts a game but Power.log stalls", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const { resolveAutomaticOverlayContext } = await import("../src/main/automaticOverlayController.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const playerLog = join(sessionDir, "Player.log");
    await writeFile(
      powerLog,
      [
        "D 16:28:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
        "D 16:29:00.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Old Card id=64 zone=DECK cardId=OLD_001 player=1] tag=ZONE value=HAND"
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(playerLog, "D 16:29:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家#1234\n", "utf8");
    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    await service.start({ logPath: powerLog, deckText: "1x Old Card" });
    await appendFile(playerLog, "I 16:52:02.000 Network.GameHandle - SERVER_GAME_STARTED\n", "utf8");
    await vi.waitFor(() => expect(service.getState().error).toContain("对局已开始"));
    const state = service.getState();
    await service.dispose();

    expect(resolveAutomaticOverlayContext(state)).toBe("constructed-game:waiting");
    expect(state.trackerMode).toBe("ladder");
    expect(state.error).toContain("对局已开始");
    expect(state.error).toContain("Power.log");
    expect(state.deck).toEqual([
      expect.objectContaining({ name: "Old Card", count: 1, remaining: 1, drawn: 0 })
    ]);
    expect(state.friendlyHand).toEqual([]);
    expect(state.friendlyOther).toEqual([]);
  });

  it("restores the waiting overlay after restart when Player.log is newer than stalled Power.log", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const playerLog = join(sessionDir, "Player.log");
    await writeFile(powerLog, "D 16:29:00.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER\n", "utf8");
    await writeFile(playerLog, "I 16:52:02.000 Network.GameHandle - SERVER_GAME_STARTED\n", "utf8");
    const oldTime = new Date("2026-07-12T16:29:00+08:00");
    const newTime = new Date("2026-07-12T16:52:02+08:00");
    await utimes(powerLog, oldTime, oldTime);
    await utimes(playerLog, newTime, newTime);
    const service = new TrackerService();

    const state = await service.start({ logPath: powerLog, deckText: "1x Old Card" });
    await service.dispose();

    expect(state.gameActive).toBe(true);
    expect(state.deckName).toBeUndefined();
    expect(state.deck).toEqual([
      expect.objectContaining({ name: "Old Card", count: 1, remaining: 1, drawn: 0 })
    ]);
    expect(state.friendlyHand).toEqual([]);
    expect(state.friendlyOther).toEqual([]);
  });

  it("recovers from a missing game-end log after the constructed deck screen is confirmed twice", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const selectedDeck = {
      id: "selected-wild",
      name: "巨像",
      format: "狂野",
      cards: [{ name: "Wild Card", count: 30 }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-12T00:00:00.000Z",
      warnings: []
    };
    await writeFile(
      powerLog,
      [
        "D 16:15:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
        "D 16:16:00.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Old Card id=64 zone=DECK cardId=OLD_001 player=1] tag=ZONE value=HAND"
      ].join("\n") + "\n",
      "utf8"
    );
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [selectedDeck] }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "狂野对战", confidence: 1, x: 0.35, y: 0.89, width: 0.06, height: 0.02 },
          { text: "巨像", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
        ]
      }))
    };
    const service = new TrackerService(scanner, recognizer);

    const initialState = await service.start({ logPath: powerLog });
    expect(initialState.gameActive).toBe(true);

    await vi.waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(2), { timeout: 2_000, interval: 50 });
    const recoveredState = service.getState();
    await service.dispose();

    expect(recoveredState).toMatchObject({
      gameActive: false,
      constructedScreenMode: "wild",
      deckName: "巨像",
      autoMatchedDeckId: "selected-wild",
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0, opponentPlayedCount: 0 }
    });
    expect(recoveredState.friendlyHand).toEqual([]);
    expect(recoveredState.friendlyOther).toEqual([]);
  });

  it("recognizes Standard on first launch even before collection decks are available", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(decksLog, "I 10:49:48.000 Deck Contents Received:\n", "utf8");
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [] }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 }
        ]
      }))
    };
    const service = new TrackerService(scanner, recognizer);

    const state = await service.start({ logPath: decksLog });
    await service.dispose();

    expect(recognizer.recognize).toHaveBeenCalledWith({
      requireHearthstoneFrontmost: true,
      profile: "constructed"
    });
    expect(state.constructedScreenMode).toBe("standard");
  });

  it("enriches a recognized collection deck with cached card details before Power.log exists", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1": {
                dbfId: 1,
                name: "暴风雪",
                cardId: "CS2_028",
                manaCost: 6,
                cardTypeId: 5,
                cardType: "法术",
                imageUrl: "https://example.test/cards/CS2_028.png"
              }
            },
            warnings: []
          };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const decksLog = join(sessionDir, "Decks.log");
    const loadingScreenLog = join(sessionDir, "LoadingScreen.log");
    await writeFile(decksLog, "I 10:49:48.000 Deck Contents Received:\n", "utf8");
    await writeFile(
      loadingScreenLog,
      "D 10:49:49.000 LoadingScreen.OnSceneLoaded() - currMode=TOURNAMENT\n",
      "utf8"
    );
    const selectedDeck = {
      id: "selected-standard-with-details",
      name: "冰霜法师",
      format: "标准",
      cards: [{ name: "暴风雪", cardId: "CS2_028", count: 2 }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-24T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [selectedDeck]
      }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
          { text: "冰霜法师", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
        ]
      }))
    };
    const service = new TrackerService(scanner, recognizer);

    const state = await service.start({ logPath: sessionDir });
    await service.dispose();

    expect(state).toMatchObject({
      status: "watching",
      constructedScreenMode: "standard",
      deckName: "冰霜法师"
    });
    expect(state.deck).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "暴风雪",
        cardId: "CS2_028",
        details: expect.objectContaining({
          manaCost: 6,
          imageUrl: "https://example.test/cards/CS2_028.png"
        })
      })
    ]));
  });

  it("does not publish the same public state twice", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    const send = vi.fn();
    service.attachWindow({
      on: vi.fn(),
      isDestroyed: () => false,
      webContents: { send }
    } as unknown as Parameters<typeof service.attachWindow>[0]);

    service.setCollectionDecks([]);
    service.setCollectionDecks([]);
    await service.dispose();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not repeat an unchanged state when a renderer update throws", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    const send = vi.fn()
      .mockImplementationOnce(() => { throw new Error("renderer closed during update"); })
      .mockImplementation(() => undefined);
    service.attachWindow({
      on: vi.fn(),
      isDestroyed: () => false,
      webContents: { send }
    } as unknown as Parameters<typeof service.attachWindow>[0]);

    expect(() => service.setCollectionDecks([])).not.toThrow();
    service.setCollectionDecks([]);
    await service.dispose();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("publishes a constructed mode when the already-previewed deck stays selected", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, "D 18:00:00.000 SetDraftMode - ACTIVE_DRAFT_DECK\n", "utf8");
    const selectedDeck = {
      id: "selected-standard",
      name: "已选标准牌组",
      format: "标准",
      cards: [{ name: "Standard Card", count: 30 }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [selectedDeck],
        activeDeck: selectedDeck
      }))
    };
    let recognitionCount = 0;
    const recognizer = {
      recognize: vi.fn(async () => {
        recognitionCount += 1;
        return recognitionCount === 1
          ? { status: "ok" as const, texts: [] }
          : {
              status: "ok" as const,
              texts: [
                { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
                { text: "已选标准牌组", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
              ]
            };
      })
    };
    const service = new TrackerService(scanner, recognizer);
    const send = vi.fn();
    service.attachWindow({
      on: vi.fn(),
      isDestroyed: () => false,
      webContents: { send }
    } as unknown as Parameters<typeof service.attachWindow>[0]);

    await service.start({ logPath: arenaLog });
    await vi.waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(2), { timeout: 2_000, interval: 50 });
    const lastPublishedState = send.mock.calls.at(-1)?.[1];
    await service.dispose();

    expect(service.getState().constructedScreenMode).toBeUndefined();
    expect(lastPublishedState?.constructedScreenMode).toBe("standard");
  });

  it("tracks sibling Power.log when the selected path is Player.log", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const playerLog = join(sessionDir, "Player.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(playerLog, "PlayerID=1\n", "utf8");
    await writeFile(
      powerLog,
      "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND\n",
      "utf8"
    );

    const service = new TrackerService();
    const state = await service.start({ logPath: playerLog, deckText: "1x Fireball" });
    await service.dispose();

    expect(state.status).toBe("watching");
    expect(state.logPath).toBe(powerLog);
    expect(state.summary.drawnCards).toBe(1);
  });

  it("keeps all three opening cards when mulligan replacement logs split a line", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME"
      ].join("\n") + "\n",
      "utf8"
    );

    const service = new TrackerService();
    await service.start({
      logPath: powerLog,
      deckText: [
        "1x Opening A",
        "1x Opening B",
        "1x Opening C",
        "1x Replacement D",
        "1x Replacement E",
        "25x Filler"
      ].join("\n")
    });

    const mulligan =
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Opening A id=10 zone=DECK zonePos=0 cardId= player=1] tag=ZONE value=HAND\n" +
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Opening B id=11 zone=DECK zonePos=0 cardId= player=1] tag=ZONE value=HAND\n" +
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Opening C id=12 zone=DECK zonePos=0 cardId= player=1] tag=ZONE value=HAND\n" +
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Opening A id=10 zone=HAND zonePos=1 cardId= player=1] tag=ZONE value=DECK\n" +
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     SHOW_ENTITY - Updating Entity=[entityName=Replacement D id=13 zone=DECK zonePos=0 cardId= player=1] CardID=TEST_D\n" +
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=1\n" +
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND\n" +
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Opening C id=12 zone=HAND zonePos=3 cardId= player=1] tag=ZONE value=DECK\n" +
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     SHOW_ENTITY - Updating Entity=[entityName=Replacement E id=14 zone=DECK zonePos=0 cardId= player=1] CardID=TEST_E\n" +
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=1\n" +
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND\n";
    const splitAt = mulligan.indexOf("CardID=TEST_D") + 8;
    await appendFile(powerLog, mulligan.slice(0, splitAt), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(service.getState().summary).toMatchObject({ remainingCards: 28, drawnCards: 2 });

    await appendFile(powerLog, mulligan.slice(splitAt), "utf8");
    await vi.waitFor(
      () => expect(service.getState().summary).toMatchObject({ totalCards: 30, remainingCards: 27, drawnCards: 3 }),
      { timeout: 2_000, interval: 25 }
    );
    await service.dispose();
  });

  it("reports that Power.log is required when only Player.log exists", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const playerLog = join(sessionDir, "Player.log");
    await writeFile(playerLog, "PlayerID=1\n", "utf8");

    const service = new TrackerService();
    const state = await service.start({ logPath: playerLog });
    await service.dispose();

    expect(state.status).toBe("error");
    expect(state.logPath).toBe(playerLog);
    expect(state.error).toContain("Player.log");
    expect(state.error).toContain("Power.log");
    expect(state.error).toContain("需要修复日志并重启炉石");
  });

  it("auto matches the local deck from Power.log when Player.log is unavailable", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME",
        "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=2] tag=ZONE value=HAND",
        "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Frostbolt id=65 zone=DECK zonePos=2 cardId=CS2_024 player=2] tag=ZONE value=HAND"
      ].join("\n") + "\n",
      "utf8"
    );

    const service = new TrackerService();
    service.setCollectionDecks([
      {
        id: "power-log-local-deck",
        name: "Power.log 本方套牌",
        cards: [
          { name: "Fireball", count: 1, cardId: "CS2_029" },
          { name: "Frostbolt", count: 1, cardId: "CS2_024" }
        ],
        rawText: "1x Fireball\n1x Frostbolt",
        sourcePath: "/tmp/Decks.log",
        updatedAt: "2026-07-11T00:00:00.000Z",
        warnings: []
      }
    ]);

    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state.autoMatchedDeckId).toBe("power-log-local-deck");
    expect(state.deckName).toBe("Power.log 本方套牌");
    expect(state.summary).toMatchObject({ totalCards: 2, remainingCards: 0, drawnCards: 2 });
  });

  it("restores the real hand from a duplicate CREATE_GAME dump with one privacy-hidden opponent", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "火羽精灵", cardId: "CORE_UNG_809", type: "MINION" },
              "1002": { dbfId: 1002, name: "火球术", cardId: "CS2_029", type: "SPELL" }
            },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 20:00:14.3904530 GameState.DebugPrintPower() - CREATE_GAME",
        "D 20:00:14.3904530 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 20:00:14.3904530 GameState.DebugPrintGame() - PlayerID=2, PlayerName=昏沉的幽灵#511319",
        "D 20:00:14.3904530 PowerTaskList.DebugPrintPower() - CREATE_GAME",
        "D 20:00:17.7867120 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=37 zone=DECK zonePos=0 cardId= player=2] CardID=CORE_UNG_809",
        "D 20:00:17.7867120 PowerTaskList.DebugPrintPower() - tag=CONTROLLER value=2",
        "D 20:00:17.7867120 PowerTaskList.DebugPrintPower() - tag=ZONE value=HAND",
        "D 20:00:18.7867120 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=38 zone=DECK zonePos=0 cardId= player=2] CardID=CS2_029",
        "D 20:00:18.7867120 PowerTaskList.DebugPrintPower() - tag=CONTROLLER value=2",
        "D 20:00:18.7867120 PowerTaskList.DebugPrintPower() - tag=ZONE value=PLAY"
      ].join("\n") + "\n",
      "utf8"
    );

    const service = new TrackerService();
    service.setCollectionDecks([
      {
        id: "real-log-deck",
        name: "法术法师",
        cards: [
          { name: "火羽精灵", count: 1, cardId: "CORE_UNG_809" },
          { name: "火球术", count: 1, cardId: "CS2_029" }
        ],
        rawText: "1x 火羽精灵\n1x 火球术",
        sourcePath: "/tmp/Decks.log",
        updatedAt: "2026-07-21T00:00:00.000Z",
        warnings: []
      }
    ]);

    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state.friendlyHand).toEqual([
      expect.objectContaining({ name: "火羽精灵", count: 1, cardId: "CORE_UNG_809" })
    ]);
    expect(state.deckName).toBe("法术法师");
    expect(state.summary).toMatchObject({ totalCards: 2, remainingCards: 1, drawnCards: 1 });
  });

  it("uses the current game's local player slot when it changes between games", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 11:59:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 11:59:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家#1234",
        "D 11:59:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=2] tag=ZONE value=HAND",
        "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Frostbolt id=65 zone=DECK zonePos=2 cardId=CS2_024 player=2] tag=ZONE value=HAND"
      ].join("\n"),
      "utf8"
    );

    const service = new TrackerService();
    service.setCollectionDecks([
      {
        id: "current-game-player-two",
        name: "当前对局本方套牌",
        cards: [
          { name: "Fireball", count: 1, cardId: "CS2_029" },
          { name: "Frostbolt", count: 1, cardId: "CS2_024" }
        ],
        rawText: "1x Fireball\n1x Frostbolt",
        sourcePath: "/tmp/Decks.log",
        updatedAt: "2026-07-11T00:00:00.000Z",
        warnings: []
      }
    ]);

    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state.autoMatchedDeckId).toBe("current-game-player-two");
    expect(state.deckName).toBe("当前对局本方套牌");
    expect(state.summary).toMatchObject({ totalCards: 2, remainingCards: 0, drawnCards: 2 });
  });

  it("loads Hearthstone's selected collection deck whenever a Power.log session starts", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME",
        "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=2] tag=ZONE value=HAND"
      ].join("\n"),
      "utf8"
    );
    const selectedDeck = {
      id: "selected-deck",
      deckId: "9455681170",
      name: "偷取牌库",
      cards: [{ name: "Fireball", count: 2, cardId: "CS2_029" }],
      rawText: "2x Fireball",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanAndImportDecks = vi.fn(async () => ({
      status: "ok" as const,
      decks: [selectedDeck],
      activeDeck: selectedDeck
    }));

    const service = new TrackerService({ scanAndImportDecks });
    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(scanAndImportDecks).toHaveBeenCalledWith({ logPath: powerLog });
    expect(state).toMatchObject({
      autoMatchedDeckId: "selected-deck",
      deckName: "偷取牌库",
      summary: { totalCards: 2, remainingCards: 1, drawnCards: 1 }
    });
  });

  it("keeps Hearthstone's selected deck visible after the game result is read", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
        "D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=2] tag=ZONE value=HAND",
        "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=3 zone=PLAY player=2] tag=PLAYSTATE value=WON"
      ].join("\n") + "\n",
      "utf8"
    );
    const selectedDeck = {
      id: "selected-after-result",
      deckId: "9455681170",
      name: "局间保留套牌",
      cards: [{ name: "Fireball", count: 2, cardId: "CS2_029" }],
      rawText: "2x Fireball",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-08-13T00:00:00.000Z",
      warnings: []
    };
    const scanAndImportDecks = vi.fn(async () => ({
      status: "ok" as const,
      decks: [selectedDeck],
      activeDeck: selectedDeck
    }));

    const service = new TrackerService({ scanAndImportDecks });
    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state).toMatchObject({
      gameActive: false,
      trackerMode: "ladder",
      autoMatchedDeckId: "selected-after-result",
      deckName: "局间保留套牌",
      friendlyHand: [],
      friendlyOther: [],
      events: [],
      summary: { totalCards: 2, remainingCards: 2, drawnCards: 0 }
    });
  });

  it("keeps the Arena deck visible after the game result is read", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Arena Card", cardId: "ARENA_001" }
            },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(
      arenaLog,
      [
        "D 11:59:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 1, Hero Card = HERO_08",
        "D 11:59:00.000 DraftManager.OnChoicesAndContents - Draft deck contains card ARENA_001",
        "D 11:59:01.000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_ARENA",
        "D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Arena Card id=64 zone=DECK cardId=ARENA_001 player=2] tag=ZONE value=HAND",
        "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=3 zone=PLAY player=2] tag=PLAYSTATE value=LOST"
      ].join("\n") + "\n",
      "utf8"
    );

    const service = new TrackerService();
    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state).toMatchObject({
      gameActive: false,
      trackerMode: "arena",
      deckName: "竞技场牌库",
      friendlyHand: [],
      friendlyOther: [],
      events: [],
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0 }
    });
  });

  it("clears a constructed deck when a later Arena game starts without an Arena deck", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED"
      ].join("\n") + "\n",
      "utf8"
    );
    const selectedDeck = {
      id: "constructed-before-arena",
      deckId: "9455681170",
      name: "旧构筑套牌",
      cards: [{ name: "Constructed Card", count: 30, cardId: "CONSTRUCTED_001" }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-08-13T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [selectedDeck],
        activeDeck: selectedDeck
      }))
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: powerLog });
    expect(service.getState().deckName).toBe("旧构筑套牌");

    await appendFile(
      powerLog,
      "D 12:10:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_ARENA\n",
      "utf8"
    );

    await vi.waitFor(() => {
      expect(service.getState()).toMatchObject({
        gameActive: true,
        trackerMode: "arena",
        deckName: undefined,
        deck: []
      });
    }, { timeout: 3_000, interval: 25 });
    await service.dispose();
  });

  it("keeps a Decks.log-selected preview when screen capture fails before the next game", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(
      powerLog,
      [
        "D 15:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 15:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#0000",
        "D 15:00:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
        "D 15:10:00.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=3 zone=PLAY player=2] tag=PLAYSTATE value=WON"
      ].join("\n") + "\n",
      "utf8"
    );
    await writeFile(decksLog, "I 15:00:00.000 Deck Contents Received:\n", "utf8");

    const selectedDeck = {
      id: "selected-between-games",
      deckId: "selected-deck-id",
      name: "已选套牌",
      format: "标准",
      cards: [
        { name: "Observed Card", count: 1, cardId: "OBSERVED_001" },
        { name: "Selected Filler", count: 29, cardId: "SELECTED_FILLER" }
      ],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-27T00:00:00.000Z",
      warnings: []
    };
    const ambiguousDeck = {
      ...selectedDeck,
      id: "ambiguous-alternative",
      deckId: "alternative-deck-id",
      name: "相似套牌",
      cards: [
        { name: "Observed Card", count: 1, cardId: "OBSERVED_001" },
        { name: "Alternative Filler", count: 29, cardId: "ALTERNATIVE_FILLER" }
      ]
    };
    let scanCount = 0;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => {
        scanCount += 1;
        return {
          status: "ok" as const,
          decks: [selectedDeck, ambiguousDeck],
          activeDeck: scanCount >= 2 ? selectedDeck : undefined
        };
      })
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "window-not-found" as const,
        message: "匿名窗口不可用",
        texts: []
      }))
    };
    const service = new TrackerService(scanner, recognizer);
    await service.start({ logPath: powerLog });

    await appendFile(decksLog, "I 15:39:24.000 Finding Game With Deck:\n", "utf8");
    await vi.waitFor(
      () => {
        expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2);
        expect(recognizer.recognize.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 2_000, interval: 25 }
    );

    await appendFile(
      powerLog,
      [
        "D 15:39:40.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 15:39:40.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#0000",
        "D 15:39:41.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
        "D 15:39:42.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Observed Card id=64 zone=DECK zonePos=1 cardId=OBSERVED_001 player=2] tag=ZONE value=HAND"
      ].join("\n") + "\n",
      "utf8"
    );
    await vi.waitFor(
      () => expect((service.getState().friendlyHand ?? []).reduce((total, card) => total + card.count, 0)).toBe(1),
      { timeout: 2_000, interval: 25 }
    );
    const state = service.getState();
    await service.dispose();

    expect(state).toMatchObject({
      gameActive: true,
      autoMatchedDeckId: "selected-between-games",
      deckName: "已选套牌",
      summary: { totalCards: 30, remainingCards: 29, drawnCards: 1 }
    });
  });

  it("uses Hearthstone's selected deck even when Power.log does not expose the local player name", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 12:00:00.000 GameState.DebugPrintPower() -     Player EntityID=2 PlayerID=1 GameAccountId=[hi=1 lo=1]",
        "D 12:00:00.000 GameState.DebugPrintPower() -     Player EntityID=3 PlayerID=2 GameAccountId=[hi=1 lo=2]"
      ].join("\n"),
      "utf8"
    );
    const selectedDeck = {
      id: "explicit-selected-deck",
      deckId: "9302099347",
      name: "试验套牌",
      format: "标准",
      cards: [{ name: "Sample Singleton", count: 1, cardId: "TEST_001" }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanAndImportDecks = vi.fn(async () => ({
      status: "ok" as const,
      decks: [selectedDeck],
      activeDeck: selectedDeck
    }));

    const service = new TrackerService({ scanAndImportDecks });
    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state).toMatchObject({
      autoMatchedDeckId: "explicit-selected-deck",
      deckName: "试验套牌",
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0 }
    });
    expect(state.deck.find((card) => card.name === "日志缺失的收藏牌")).toMatchObject({ count: 29 });
  });

  it("switches to a newer Power.log session and replays its current game", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-sessions-"));
    tempDirs.push(root);
    const oldSessionDir = join(root, "old-session");
    const newSessionDir = join(root, "new-session");
    await Promise.all([mkdir(oldSessionDir), mkdir(newSessionDir)]);
    const oldPowerLog = join(oldSessionDir, "Power.log");
    const newPowerLog = join(newSessionDir, "Power.log");
    await writeFile(
      oldPowerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      newPowerLog,
      [
        "D 12:01:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:01:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:01:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME",
        "D 12:01:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=2] tag=ZONE value=HAND"
      ].join("\n"),
      "utf8"
    );

    const oldSession = { root, sessionDir: oldSessionDir, powerLogPath: oldPowerLog, modifiedAtMs: 1 };
    const newSession = { root, sessionDir: newSessionDir, powerLogPath: newPowerLog, modifiedAtMs: 2 };
    let rootResolutionCount = 0;
    vi.resetModules();
    vi.doMock("../src/main/logDiscovery.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/main/logDiscovery.js")>();
      return {
        ...actual,
        resolveBestLogTarget: vi.fn(async (providedPath?: string) => {
          if (providedPath === root) {
            rootResolutionCount += 1;
            return rootResolutionCount === 1 ? oldSession : newSession;
          }
          return actual.resolveBestLogTarget(providedPath);
        })
      };
    });

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    await service.start({ logPath: root, deckText: "1x Fireball" });

    await vi.waitFor(
      () => {
        const state = service.getState();
        expect(state.logPath).toBe(newPowerLog);
        expect(state.summary.drawnCards).toBe(1);
      },
      { timeout: 4_000, interval: 50 }
    );
    await service.dispose();
  });

  it("keeps the default discovery root while a new session waits for Power.log", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-startup-race-"));
    tempDirs.push(root);
    const oldSessionDir = join(root, "Hearthstone_2026_08_14_12_36_52");
    const newSessionDir = join(root, "Hearthstone_2026_08_14_16_30_47");
    await Promise.all([mkdir(oldSessionDir), mkdir(newSessionDir)]);
    const oldPowerLog = join(oldSessionDir, "Power.log");
    const newDecksLog = join(newSessionDir, "Decks.log");
    const newLoadingScreenLog = join(newSessionDir, "LoadingScreen.log");
    const newPowerLog = join(newSessionDir, "Power.log");
    await writeFile(
      oldPowerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME"
      ].join("\n"),
      "utf8"
    );
    await writeFile(newDecksLog, "I 16:30:54.000 Deck Contents Received:\n", "utf8");
    await writeFile(
      newLoadingScreenLog,
      "D 16:30:55.000 LoadingScreen.OnSceneLoaded() - currMode=LOGIN\n",
      "utf8"
    );

    const oldSession = {
      root,
      sessionDir: oldSessionDir,
      powerLogPath: oldPowerLog,
      modifiedAtMs: 1
    };
    const waitingSession = {
      root,
      sessionDir: newSessionDir,
      decksLogPath: newDecksLog,
      loadingScreenLogPath: newLoadingScreenLog,
      modifiedAtMs: 2
    };
    const readySession = {
      ...waitingSession,
      powerLogPath: newPowerLog,
      modifiedAtMs: 3
    };
    let rootResolutions: HearthstoneLogFiles[] = [];
    vi.resetModules();
    vi.doMock("../src/main/logDiscovery.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/main/logDiscovery.js")>();
      return {
        ...actual,
        resolveBestLogTarget: vi.fn(async (providedPath?: string) => {
          if (!providedPath) return oldSession;
          if (providedPath === root) return rootResolutions.shift() ?? oldSession;
          return actual.resolveBestLogTarget(providedPath);
        })
      };
    });
    const selectedDeck = {
      id: "startup-race-deck",
      deckId: "startup-race-deck",
      name: "启动竞态套牌",
      format: "标准",
      cards: [{ name: "Fireball", count: 1, cardId: "CS2_029" }],
      rawText: "",
      sourcePath: newDecksLog,
      updatedAt: "2026-08-14T16:30:54.000Z",
      warnings: []
    };
    const scanAndImportDecks = vi.fn(async () => ({
      status: "ok" as const,
      decks: [selectedDeck],
      activeDeck: selectedDeck
    }));

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService({ scanAndImportDecks });
    try {
      await service.start();
      rootResolutions = [waitingSession, waitingSession];
      const internal = service as unknown as {
        sessionContext: object;
        followNewestSession(sessionContext: object): Promise<void>;
      };

      await internal.followNewestSession(internal.sessionContext);

      expect(service.getState().logPath).toBe(newDecksLog);
      expect(service.getState().error).toContain("等待开局");
      await writeFile(
        newPowerLog,
        [
          "D 16:31:24.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
          "D 16:31:24.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
          "D 16:31:25.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME",
          "D 16:31:26.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=2] tag=ZONE value=HAND"
        ].join("\n"),
        "utf8"
      );
      rootResolutions = [readySession, oldSession];

      await internal.followNewestSession(internal.sessionContext);

      expect(service.getState().logPath).toBe(newPowerLog);
      expect(service.getState().summary.drawnCards).toBe(1);
    } finally {
      await service.dispose();
    }
  });

  it("does not restart and replay when the active Power.log mtime increases", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-same-session-"));
    tempDirs.push(root);
    const sessionDir = join(root, "active-session");
    await mkdir(sessionDir);
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 12:00:00.000 GameState.DebugPrintGame() - GameType=GT_RANKED"
      ].join("\n"),
      "utf8"
    );
    let modifiedAtMs = 1;
    vi.resetModules();
    vi.doMock("../src/main/logDiscovery.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/main/logDiscovery.js")>();
      return {
        ...actual,
        resolveBestLogTarget: vi.fn(async () => ({
          root: sessionDir,
          sessionDir,
          powerLogPath: powerLog,
          modifiedAtMs
        }))
      };
    });

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    await service.start({ logPath: powerLog });
    modifiedAtMs = 2;
    const internal = service as unknown as {
      sessionContext: object;
      followNewestSession(sessionContext: object): Promise<void>;
    };
    const originalSessionContext = internal.sessionContext;
    const originalState = service.getState();

    await internal.followNewestSession(originalSessionContext);

    expect(internal.sessionContext).toBe(originalSessionContext);
    expect(service.getState()).toEqual({
      ...originalState,
      lastUpdated: expect.any(String)
    });
    await service.dispose();
  });

  it.each(["TOURNAMENT", "HUB", "DRAFT"])(
    "keeps waiting without a missing-log warning while LoadingScreen is in %s",
    async (mode) => {
      vi.resetModules();
      vi.doMock("../src/main/cardDataService.js", () => ({
        CardDataService: class CardDataService {
          async loadCardDatabase() {
            return { warnings: [] };
          }
        }
      }));
      const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-pregame-"));
      tempDirs.push(root);
      const sessionDir = join(root, "Hearthstone_2026_07_23_20_31_45");
      await mkdir(sessionDir);
      const decksLog = join(sessionDir, "Decks.log");
      const loadingScreenLog = join(sessionDir, "LoadingScreen.log");
      await writeFile(decksLog, "I 20:31:46.000 Deck Contents Received:\n", "utf8");
      await writeFile(
        loadingScreenLog,
        `D 20:32:23.000 LoadingScreen.OnSceneLoaded() - currMode=${mode}\n`,
        "utf8"
      );
      const scanAndImportDecks = vi.fn(async () => ({
        status: "ok" as const,
        decks: []
      }));

      const { TrackerService } = await import("../src/main/trackerService.js");
      const service = new TrackerService(
        { scanAndImportDecks },
        {
          recognize: vi.fn(async () => ({
            status: "window-not-found" as const,
            message: "炉石窗口仍在启动。",
            texts: []
          }))
        }
      );
      const state = await service.start({ logPath: root });

      expect(state.status).toBe("watching");
      expect(state.error).toContain("已识别炉石");
      expect(state.error).toContain("等待开局");
      expect(scanAndImportDecks).toHaveBeenCalledWith({ logPath: decksLog });
      await service.dispose();
    }
  );

  it("keeps waiting when a pregame session has Player.log but no Power.log", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-player-pregame-"));
    tempDirs.push(root);
    const sessionDir = join(root, "Hearthstone_2026_07_23_20_31_45");
    await mkdir(sessionDir);
    const playerLog = join(sessionDir, "Player.log");
    const decksLog = join(sessionDir, "Decks.log");
    const loadingScreenLog = join(sessionDir, "LoadingScreen.log");
    await writeFile(playerLog, "D 20:31:45.000 PlayerManager - initialized\n", "utf8");
    await writeFile(decksLog, "I 20:31:46.000 Deck Contents Received:\n", "utf8");
    await writeFile(
      loadingScreenLog,
      [
        "D 20:32:23.000 LoadingScreen.OnSceneLoaded() - currMode=TOURNAMENT",
        "D 20:32:24.000 LoadingScreen.OnSceneLoaded() - nextMode=GAMEPLAY"
      ].join("\n"),
      "utf8"
    );

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService(
      { scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [] })) },
      {
        recognize: vi.fn(async () => ({
          status: "window-not-found" as const,
          message: "炉石窗口仍在启动。",
          texts: []
        }))
      }
    );
    const state = await service.start({ logPath: root });
    await service.dispose();

    expect(state.status).toBe("watching");
    expect(state.logPath).toBe(playerLog);
    expect(state.error).toContain("已识别炉石");
    expect(state.error).toContain("等待开局");
    expect(state.error).not.toContain("修复日志");
  });

  it("clears stale card state after LoadingScreen enters GAMEPLAY without Power.log", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-current-missing-power-"));
    tempDirs.push(root);
    const staleSessionDir = join(root, "Hearthstone_2026_07_11_12_18_34");
    const currentSessionDir = join(root, "Hearthstone_2026_07_11_15_56_57");
    await Promise.all([mkdir(staleSessionDir), mkdir(currentSessionDir)]);
    const stalePowerLog = join(staleSessionDir, "Power.log");
    const currentDecksLog = join(currentSessionDir, "Decks.log");
    const currentLoadingScreenLog = join(currentSessionDir, "LoadingScreen.log");
    await writeFile(
      stalePowerLog,
      [
        "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME",
        "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND"
      ].join("\n"),
      "utf8"
    );
    await writeFile(currentDecksLog, "I 17:29:00.000 Deck Contents Received:\n", "utf8");
    await writeFile(
      currentLoadingScreenLog,
      "D 17:29:01.000 LoadingScreen.OnSceneLoaded() - currMode=GAMEPLAY\n",
      "utf8"
    );

    const staleTime = new Date("2026-07-11T12:18:34.000Z");
    const currentTime = new Date("2026-07-11T17:29:00.000Z");
    await Promise.all([
      utimes(stalePowerLog, staleTime, staleTime),
      utimes(staleSessionDir, staleTime, staleTime),
      utimes(currentDecksLog, currentTime, currentTime),
      utimes(currentLoadingScreenLog, currentTime, currentTime),
      utimes(currentSessionDir, currentTime, currentTime)
    ]);

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    await service.start({ logPath: stalePowerLog, deckText: "1x Fireball" });
    const state = await service.start({ logPath: root });
    await service.dispose();

    expect(state.status).toBe("missing-log");
    expect(state.logPath).toBe(currentDecksLog);
    expect(state.error).toContain("Power.log");
    expect(state.deck).toEqual([]);
    expect(state.summary).toMatchObject({ totalCards: 0, remainingCards: 0, drawnCards: 0 });
  });

  it("keeps polling from an empty log root and connects when a session appears", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-empty-root-"));
    tempDirs.push(root);
    const sessionDir = join(root, "Hearthstone_2026_07_23_20_31_45");
    const powerLog = join(sessionDir, "Power.log");
    const readySession = { root, sessionDir, powerLogPath: powerLog, modifiedAtMs: 1 };
    let logsAvailable = false;

    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/logDiscovery.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/main/logDiscovery.js")>();
      return {
        ...actual,
        resolveBestLogTarget: vi.fn(async () => logsAvailable ? readySession : undefined)
      };
    });

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    const initial = await service.start({ logPath: root });
    expect(initial.status).toBe("missing-log");

    await mkdir(sessionDir);
    await writeFile(
      powerLog,
      "D 20:35:22.000 GameState.DebugPrintPower() - CREATE_GAME\nD 20:35:22.000 GameState.DebugPrintGame() - GameType=GT_RANKED\n",
      "utf8"
    );
    logsAvailable = true;

    await vi.waitFor(
      () => {
        expect(service.getState().logPath).toBe(powerLog);
        expect(service.getState().gameActive).toBe(true);
      },
      {
        timeout: 3_000,
        interval: 50
      }
    );
    expect(service.getState().status, service.getState().error).toBe("watching");
    await service.dispose();
  });

  it("keeps polling from a root-level Player.log and connects when the game creates Power.log", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-player-first-"));
    tempDirs.push(root);
    const playerLog = join(root, "Player.log");
    const sessionDir = join(root, "Hearthstone_2026_08_17_19_36_19");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(playerLog, "[Hearthstone] waiting for game startup\n", "utf8");

    const playerOnlySession = {
      root,
      sessionDir: root,
      playerLogPath: playerLog,
      modifiedAtMs: 1
    };
    const readySession = {
      root,
      sessionDir,
      powerLogPath: powerLog,
      playerLogPath: playerLog,
      modifiedAtMs: 2
    };
    let gameStarted = false;

    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/logDiscovery.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/main/logDiscovery.js")>();
      return {
        ...actual,
        resolveBestLogTarget: vi.fn(async () => gameStarted ? readySession : playerOnlySession)
      };
    });

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    try {
      const initial = await service.start({ logPath: root });
      expect(initial.logPath).toBe(playerLog);

      await mkdir(sessionDir);
      await writeFile(
        powerLog,
        "D 19:36:22.000 GameState.DebugPrintPower() - CREATE_GAME\nD 19:36:22.000 GameState.DebugPrintGame() - GameType=GT_RANKED\n",
        "utf8"
      );
      gameStarted = true;

      await vi.waitFor(
        () => {
          expect(service.getState().logPath).toBe(powerLog);
          expect(service.getState().gameActive).toBe(true);
        },
        { timeout: 3_000, interval: 50 }
      );
    } finally {
      await service.dispose();
    }
  });

  it("automatically resumes when Power.log appears after selecting a waiting-session log", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-power-appears-"));
    tempDirs.push(root);
    const sessionDir = join(root, "Hearthstone_2026_07_12_10_49_37");
    await mkdir(sessionDir);
    const decksLog = join(sessionDir, "Decks.log");
    const loadingScreenLog = join(sessionDir, "LoadingScreen.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(decksLog, "I 10:49:48.000 Deck Contents Received:\n", "utf8");
    await writeFile(
      loadingScreenLog,
      "D 10:49:49.000 LoadingScreen.OnSceneLoaded() - currMode=TOURNAMENT\n",
      "utf8"
    );

    let powerAvailable = false;
    const missingSession = {
      root: sessionDir,
      sessionDir,
      decksLogPath: decksLog,
      loadingScreenLogPath: loadingScreenLog,
      modifiedAtMs: 1
    };
    const readySession = {
      root: sessionDir,
      sessionDir,
      decksLogPath: decksLog,
      loadingScreenLogPath: loadingScreenLog,
      powerLogPath: powerLog,
      modifiedAtMs: 1
    };
    const globallyDiscoveredReadySession = {
      ...readySession,
      root
    };
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/logDiscovery.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/main/logDiscovery.js")>();
      return {
        ...actual,
        resolveBestLogTarget: vi.fn(async (providedPath?: string) => {
          if (!providedPath) return powerAvailable ? globallyDiscoveredReadySession : { ...missingSession, root };
          if (providedPath === powerLog || providedPath === sessionDir) return powerAvailable ? readySession : missingSession;
          return missingSession;
        })
      };
    });

    const { TrackerService } = await import("../src/main/trackerService.js");
    for (const selectedLog of [decksLog, loadingScreenLog]) {
      await rm(powerLog, { force: true });
      powerAvailable = false;
      const service = new TrackerService();
      try {
        const initial = await service.start({ logPath: selectedLog });
        expect(initial.status).toBe("watching");
        expect(initial.error).toContain("等待开局");

        await writeFile(powerLog, "D 10:55:22.000 GameState.DebugPrintPower() - CREATE_GAME\nD 10:55:22.000 GameState.DebugPrintGame() - GameType=GT_RANKED\n", "utf8");
        powerAvailable = true;

        await vi.waitFor(
          () => {
            expect(service.getState().status).toBe("watching");
            expect(service.getState().logPath).toBe(powerLog);
            expect(service.getState().gameActive).toBe(true);
          },
          {
            timeout: 3_000,
            interval: 50
          }
        );
      } finally {
        await service.dispose();
      }
    }
  });

  it("does not switch after pause when a session refresh resolves late", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-pause-"));
    tempDirs.push(root);
    const oldSessionDir = join(root, "old-session");
    const newSessionDir = join(root, "new-session");
    await Promise.all([mkdir(oldSessionDir), mkdir(newSessionDir)]);
    const oldPowerLog = join(oldSessionDir, "Power.log");
    const newPowerLog = join(newSessionDir, "Power.log");
    await writeFile(oldPowerLog, "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");
    await writeFile(newPowerLog, "D 12:01:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME\n", "utf8");

    const oldSession = { root, sessionDir: oldSessionDir, powerLogPath: oldPowerLog, modifiedAtMs: 1 };
    const newSession = { root, sessionDir: newSessionDir, powerLogPath: newPowerLog, modifiedAtMs: 2 };
    let resolveNewSession: (value: typeof newSession) => void = () => undefined;
    const pendingNewSession = new Promise<typeof newSession>((resolve) => {
      resolveNewSession = resolve;
    });
    let periodicChecks = 0;
    vi.resetModules();
    vi.doMock("../src/main/logDiscovery.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/main/logDiscovery.js")>();
      return {
        ...actual,
        resolveBestLogTarget: vi.fn(async (providedPath?: string) => {
          if (providedPath === oldPowerLog) {
            return oldSession;
          }
          periodicChecks += 1;
          return pendingNewSession;
        })
      };
    });

    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    await service.start({ logPath: oldPowerLog, deckText: "1x Fireball" });
    await vi.waitFor(() => expect(periodicChecks).toBe(1), { timeout: 2_000, interval: 25 });

    const pause = service.pause();
    resolveNewSession(newSession);
    await pause;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const state = service.getState();
    expect(state.status).toBe("paused");
    expect(state.logPath).toBe(oldPowerLog);
    await service.dispose();
  });

  it("starts screen recognition for a current Arena draft session without Power.log", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Sample Singleton", cardId: "TEST_001" },
              "1002": { dbfId: 1002, name: "Sample Pair", cardId: "TEST_002" },
              "1003": { dbfId: 1003, name: "Sample Multi", cardId: "TEST_003" }
            },
            warnings: []
          };
        }
      }
    }));
    const loadRatings = vi.fn(async () => ({
      table: {
        source: "test ratings",
        version: 1,
        fetchedAt: "2026-07-11T00:00:00.000Z",
        ratings: {
          Neutral: { TEST_001: 88, TEST_002: 61, TEST_003: 72 }
        }
      },
      warnings: []
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        loadRatings = loadRatings;
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(
      arenaLog,
      [
        "D 15:58:16.7116490 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 15:58:16.7116490 SetDraftMode - DRAFTING"
      ].join("\n"),
      "utf8"
    );
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "Sample Multi", confidence: 1, x: 0.2, y: 0.6, width: 0.05, height: 0.02 },
          { text: "Sample Singleton", confidence: 1, x: 0.39, y: 0.6, width: 0.05, height: 0.02 },
          { text: "Sample Pair", confidence: 1, x: 0.58, y: 0.6, width: 0.05, height: 0.02 }
        ]
      }))
    };

    const staleConstructedDeck = {
      id: "stale-constructed",
      name: "旧托奇法",
      cards: [{ name: "Sample Singleton", count: 30, cardId: "TEST_001" }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-12T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [staleConstructedDeck],
        activeDeck: staleConstructedDeck
      }))
    };
    const service = new TrackerService(scanner, recognizer);
    const state = await service.start({ logPath: arenaLog });
    expect(loadRatings).toHaveBeenCalledWith("Druid");
    await service.dispose();

    expect(state.status).toBe("watching");
    expect(state.logPath).toBe(arenaLog);
    expect(recognizer.recognize).toHaveBeenCalledTimes(1);
    expect(state.arena?.status).toBe("drafting");
    expect(state.deckName).toBeUndefined();
    expect(state.autoMatchedDeckId).toBeUndefined();
    expect(state.arena?.currentChoices.map((choice) => choice.name)).toEqual([
      "Sample Multi",
      "Sample Singleton",
      "Sample Pair"
    ]);
  });

  it("waits for an in-flight screen recognition before disposal completes", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 15:58:16.7116490 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
      "D 15:58:16.7116490 SetDraftMode - DRAFTING"
    ].join("\n"), "utf8");

    let finishRecognition: ((result: { status: "ok"; texts: [] }) => void) | undefined;
    const pendingRecognition = new Promise<{ status: "ok"; texts: [] }>((resolve) => {
      finishRecognition = resolve;
    });
    const recognizer = {
      recognize: vi.fn()
        .mockResolvedValueOnce({ status: "ok" as const, texts: [] })
        .mockImplementationOnce(() => pendingRecognition)
    };
    const service = new TrackerService(undefined, recognizer);
    await service.start({ logPath: arenaLog });
    await vi.waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(2), {
      timeout: 1_500,
      interval: 25
    });

    let disposed = false;
    const disposal = service.dispose().then(() => { disposed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(disposed).toBe(false);

    finishRecognition?.({ status: "ok", texts: [] });
    await disposal;
    expect(disposed).toBe(true);
  });

  it("publishes appended Arena picks while screen recognition is still pending", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Sample Singleton", cardId: "TEST_001" },
              "1002": { dbfId: 1002, name: "Sample Pair", cardId: "TEST_002" },
              "1003": { dbfId: 1003, name: "Sample Multi", cardId: "TEST_003" }
            },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:24.500 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 2",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_RETAINED`
      )
    ].join("\n") + "\n", "utf8");

    let finishRecognition: ((result: { status: "ok"; texts: [] }) => void) | undefined;
    const pendingRecognition = new Promise<{ status: "ok"; texts: [] }>((resolve) => {
      finishRecognition = resolve;
    });
    const recognizer = {
      recognize: vi.fn()
        .mockResolvedValueOnce({
          status: "ok" as const,
          texts: [
            { text: "Sample Multi", confidence: 1, x: 0.2, y: 0.6, width: 0.05, height: 0.02 },
            { text: "Sample Singleton", confidence: 1, x: 0.39, y: 0.6, width: 0.05, height: 0.02 },
            { text: "Sample Pair", confidence: 1, x: 0.58, y: 0.6, width: 0.05, height: 0.02 }
          ]
        })
        .mockImplementation(() => pendingRecognition)
    };
    const service = new TrackerService(undefined, recognizer);
    await service.start({ logPath: arenaLog });
    expect(service.getState().arena?.currentChoices).toHaveLength(3);

    const publishedStates: Array<ReturnType<typeof service.getState>> = [];
    service.attachWindow({
      on: vi.fn(),
      isDestroyed: () => false,
      webContents: {
        send: vi.fn((channel: string, state: ReturnType<typeof service.getState>) => {
          if (channel === "tracker:update") {
            publishedStates.push(state);
          }
        })
      }
    } as never);

    try {
      await appendFile(arenaLog, "D 16:54:01.000 Client chooses: [TEST_REPLACEMENT_1]\n", "utf8");
      await vi.waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(2), {
        timeout: 1_500,
        interval: 25
      });

      await appendFile(arenaLog, "D 16:54:02.000 Client chooses: [TEST_REPLACEMENT_2]\n", "utf8");
      await vi.waitFor(() => {
        expect(publishedStates.some((state) => {
          const arenaCards = [
            ...(state.arena?.picks.map((pick) => pick.chosen) ?? []),
            ...(state.arena?.deck ?? []),
            ...(state.arena?.redraftPool ?? []),
            ...(state.arena?.pendingRedraftChoices ?? [])
          ];
          return (
            arenaCards.some((card) => card.cardId === "TEST_REPLACEMENT_1")
            && arenaCards.some((card) => card.cardId === "TEST_REPLACEMENT_2")
          );
        })).toBe(true);
      }, {
        timeout: 1_500,
        interval: 25
      });
    } finally {
      finishRecognition?.({ status: "ok", texts: [] });
      await service.dispose();
    }
  });

  it("keeps every redraft pick when completion arrives in the same appended chunk", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      )
    ].join("\n") + "\n", "utf8");

    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: arenaLog });

    await appendFile(arenaLog, [
      "D 16:54:01.000 Client chooses: [TEST_002]",
      "D 16:54:02.000 Client chooses: [TEST_002]",
      "D 16:54:03.000 Client chooses: [TEST_003]",
      "D 16:54:04.000 Client chooses: [TEST_001]",
      "D 16:54:05.000 Client chooses: [TEST_003]",
      "D 16:54:06.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "complete",
        draftCount: 29,
        unresolvedCount: 30,
        awaitingExactDeck: true
      });
    }, { timeout: 4_000, interval: 50 });
    expect(service.getState().arena?.picks).toHaveLength(0);
    expect(service.getState().arena?.pendingRedraftChoices).toHaveLength(5);
    expect(service.getState().arena?.deck).toEqual([]);
    expect(service.getState().summary).toMatchObject({ totalCards: 30, remainingCards: 30 });
    expect(service.getState().deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_001", count: 25 }),
      expect.objectContaining({ cardId: "TEST_002", count: 2 }),
      expect.objectContaining({ cardId: "TEST_003", count: 2 }),
      expect.objectContaining({ name: "待确认重选牌", unresolved: true, count: 1 })
    ]));
    await service.dispose();
  });

  it("adopts an exact Arena deck when Decks.log appears after tracking starts", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 Arena.SetDraftMode - REDRAFTING",
      "D 12:00:00.250 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 12:00:00.500 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 12:00:00.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      ...Array.from(
        { length: 5 },
        (_value, index) => `D 12:00:${String(index + 1).padStart(2, "0")}.000 Client chooses: [TEST_001]`
      ),
      "D 12:01:00.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");

    const exactArenaDeck = {
      id: "late-arena-deck",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Exact Arena Card", count: 30, cardId: "TEST_EXACT" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T09:00:00.000Z",
      warnings: []
    };
    let exactAvailable = false;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => exactAvailable
        ? { status: "ok" as const, decks: [exactArenaDeck], activeDeck: exactArenaDeck }
        : { status: "missing-log" as const, decks: [] })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    const initial = await service.start({ logPath: arenaLog });
    expect(initial.arena).toMatchObject({
      status: "complete",
      draftCount: 29,
      unresolvedCount: 30,
      awaitingExactDeck: true
    });

    exactAvailable = true;
    await writeFile(decksLog, "I 17:00:00.000 Starting Arena Game With Deck\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "complete",
        draftCount: 30,
        unresolvedCount: 0
      });
      expect(service.getState().deck).toEqual([
        expect.objectContaining({ cardId: "TEST_EXACT", count: 30 })
      ]);
    }, { timeout: 2_000, interval: 50 });
    // The periodic Decks.log reconciliation may perform another valid scan
    // while the exact deck is being adopted under a slow or busy test runner.
    expect(scanner.scanAndImportDecks.mock.calls.length).toBeGreaterThanOrEqual(2);
    await service.dispose();
  });

  it("keeps an active Arena game alive when an exact deck arrives", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const powerLog = join(sessionDir, "Power.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 12:00:00.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 12:00:01.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(powerLog, [
      "D 12:01:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 12:01:00.100 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
      "D 12:01:00.200 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 12:01:00.300 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234"
    ].join("\n") + "\n", "utf8");
    const exactArenaDeck = {
      id: "active-exact-arena",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Exact Arena Card", count: 30, cardId: "TEST_EXACT" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T09:00:00.000Z",
      warnings: []
    };
    let exactAvailable = false;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => exactAvailable
        ? { status: "ok" as const, decks: [exactArenaDeck], activeDeck: exactArenaDeck }
        : { status: "missing-log" as const, decks: [] })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    await service.start({ logPath: powerLog });
    expect(service.getState()).toMatchObject({ gameActive: true, arena: { status: "playing" } });

    exactAvailable = true;
    await writeFile(decksLog, "I 12:02:00.000 Starting Arena Game With Deck\n", "utf8");
    await vi.waitFor(() => {
      expect(service.getState().deck).toEqual([
        expect.objectContaining({ cardId: "TEST_EXACT", count: 30 })
      ]);
    }, { timeout: 2_000, interval: 50 });
    expect(service.getState()).toMatchObject({ gameActive: true, arena: { status: "playing" } });
    await service.dispose();
  });

  it("refreshes the active Arena deck from a matching Finished Editing Deck snapshot", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 05:07:31.0726660 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466953270, Hero Card = HERO_09",
      "D 05:07:31.0726660 DraftManager.OnChoicesAndContents - Draft deck contains card REV_015",
      ...Array.from(
        { length: 29 },
        () => "D 05:07:31.0726660 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_KEEP"
      ),
      "D 05:07:31.0726660 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(decksLog, "I 05:07:13.7249790 Deck Contents Received:\n", "utf8");

    const editedDeck = {
      id: "edited-arena-deck",
      deckId: "9466953270",
      cards: [
        { name: "Replacement", count: 1, cardId: "MAW_022" },
        { name: "Kept Card", count: 29, cardId: "TEST_KEEP" }
      ],
      rawText: [
        "I 05:08:02.7521140 Finished Editing Deck:",
        "I 05:08:02.7521140 ### ",
        "I 05:08:02.7521140 # Deck ID: 9466953270",
        "I 05:08:02.7521140 SANITIZED_DECK_STRING"
      ].join("\n"),
      sourcePath: decksLog,
      updatedAt: "2026-07-23T05:08:02.752+08:00",
      warnings: []
    };
    let scanCount = 0;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => {
        scanCount += 1;
        return scanCount === 1
          ? { status: "ok" as const, decks: [] }
          : { status: "ok" as const, decks: [editedDeck] };
      })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    const initial = await service.start({ logPath: arenaLog });
    expect(initial.deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "REV_015", count: 1 })
    ]));

    await appendFile(decksLog, `${editedDeck.rawText}\n`, "utf8");
    await vi.waitFor(() => {
      expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2);
      expect(service.getState().deck).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId: "MAW_022", count: 1 })
      ]));
    }, { timeout: 2_000, interval: 50 });
    expect(service.getState().deck.map((card) => card.cardId)).not.toContain("REV_015");
    await service.dispose();
  });

  it("applies the exact Decks.log snapshot that arrives before redraft completion", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 Arena.SetDraftMode - REDRAFTING",
      "D 12:00:00.250 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 12:00:00.500 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 12:00:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      )
    ].join("\n") + "\n", "utf8");

    const exactArenaDeck = {
      id: "redraft-exact-arena",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Sample Singleton", count: 30, cardId: "TEST_001" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T09:00:00.000Z",
      warnings: []
    };
    let exactAvailable = false;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => exactAvailable
        ? { status: "ok" as const, decks: [exactArenaDeck], activeDeck: exactArenaDeck }
        : { status: "missing-log" as const, decks: [] })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    const initial = await service.start({ logPath: arenaLog });
    expect(initial.arena).toMatchObject({ status: "redrafting", draftCount: 0, unresolvedCount: 30 });

    exactAvailable = true;
    await writeFile(decksLog, "I 12:00:30.000 Starting Arena Game With Deck\n", "utf8");
    await vi.waitFor(
      () => expect(scanner.scanAndImportDecks.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 3_000, interval: 50 }
    );
    expect(service.getState().arena).toMatchObject({ status: "redrafting", draftCount: 0, unresolvedCount: 30 });

    await appendFile(arenaLog, [
      ...Array.from(
        { length: 5 },
        (_value, index) => `D 12:00:${String(index + 31).padStart(2, "0")}.000 Client chooses: [TEST_001]`
      ),
      "D 12:01:00.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({ draftCount: 30, unresolvedCount: 0 });
      expect(["complete", "playing"]).toContain(service.getState().arena?.status);
      expect(service.getState().deck).toEqual([
        expect.objectContaining({ cardId: "TEST_001", count: 30 })
      ]);
    }, { timeout: 2_000, interval: 50 });
    expect(scanner.scanAndImportDecks.mock.calls.length).toBeLessThanOrEqual(3);
    await service.dispose();
  });

  it("reapplies a newer exact Decks snapshot when its event is observed before the redraft chunk", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 11:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 11:00:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 11:00:02.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");

    const exactArenaDeck = {
      id: "pre-redraft-observed-exact",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Sample Multi", count: 30, cardId: "TEST_003" }],
      rawText: "D 00:00:07.001 Decks - # Deck ID: 9466340632",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T12:00:07.001Z",
      warnings: []
    };
    let exactAvailable = false;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => exactAvailable
        ? { status: "ok" as const, decks: [exactArenaDeck], activeDeck: exactArenaDeck }
        : { status: "missing-log" as const, decks: [] })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: arenaLog });

    exactAvailable = true;
    await writeFile(decksLog, "I 00:00:07.000 Starting Arena Game With Deck\n", "utf8");
    await utimes(decksLog, new Date(2026, 6, 22, 0, 0, 8), new Date(2026, 6, 22, 0, 0, 8));
    await vi.waitFor(() => {
      expect(service.getState().arena?.deck).toEqual([
        expect.objectContaining({ cardId: "TEST_003", count: 30 })
      ]);
    }, { timeout: 3_000, interval: 50 });

    await appendFile(arenaLog, [
      "D 23:59:59.000 Arena.SetDraftMode - REDRAFTING",
      "D 23:59:59.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 23:59:59.500 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 00:00:00.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      ...Array.from(
        { length: 5 },
        (_value, index) => `D 00:00:0${index + 1}.000 Client chooses: [TEST_001]`
      ),
      "D 00:00:06.500 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await utimes(arenaLog, new Date(2026, 6, 22, 0, 0, 7), new Date(2026, 6, 22, 0, 0, 7));

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "complete",
        redraftGenerationId: "9466340633",
        draftCount: 30,
        unresolvedCount: 0
      });
      expect(service.getState().arena?.deck).toEqual([
        expect.objectContaining({ cardId: "TEST_003", count: 30 })
      ]);
    }, { timeout: 2_000, interval: 50 });
    expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2);
    await service.dispose();
  });

  it("preserves the last exact deck until the newer redraft gets its own exact snapshot", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 11:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 11:00:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 11:00:02.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    const oldArenaDeck = {
      id: "pre-redraft-old-exact",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Sample Multi", count: 30, cardId: "TEST_003" }],
      rawText: "D 23:59:59.001 Decks - # Deck ID: 9466340632",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T11:59:00.001Z",
      warnings: []
    };
    let exactAvailable = false;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => exactAvailable
        ? { status: "ok" as const, decks: [oldArenaDeck], activeDeck: oldArenaDeck }
        : { status: "missing-log" as const, decks: [] })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: arenaLog });

    exactAvailable = true;
    await writeFile(decksLog, "I 23:59:59.000 Starting Arena Game With Deck\n", "utf8");
    await utimes(decksLog, new Date(2026, 6, 22, 0, 0, 1), new Date(2026, 6, 22, 0, 0, 1));
    await vi.waitFor(() => {
      expect(service.getState().arena?.deck).toEqual([
        expect.objectContaining({ cardId: "TEST_003", count: 30 })
      ]);
    }, { timeout: 3_000, interval: 50 });

    await appendFile(arenaLog, [
      "D 00:00:10.000 Arena.SetDraftMode - REDRAFTING",
      "D 00:00:10.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 00:00:10.500 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 00:00:11.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      ...Array.from(
        { length: 5 },
        (_value, index) => `D 00:00:${index + 12}.000 Client chooses: [TEST_001]`
      ),
      "D 00:00:17.500 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await utimes(arenaLog, new Date(2026, 6, 22, 0, 0, 20), new Date(2026, 6, 22, 0, 0, 20));

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "complete",
        redraftGenerationId: "9466340633",
        draftCount: 30,
        unresolvedCount: 0,
        awaitingExactDeck: true
      });
    }, { timeout: 2_000, interval: 50 });
    expect(service.getState().arena?.deck).toEqual([
      expect.objectContaining({ cardId: "TEST_003", count: 30 })
    ]);
    expect(service.getState().arena?.pendingRedraftChoices).toHaveLength(5);
    expect(service.getState().deckName).toBe("竞技场牌库");
    expect(service.getState().deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_001", count: 29 }),
      expect.objectContaining({ name: "待确认重选牌", unresolved: true, count: 1 })
    ]));
    await service.dispose();
  });

  it("finishes startup with the exact deck when Decks.log appears during startup", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 Arena.SetDraftMode - REDRAFTING",
      "D 12:00:00.250 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 12:00:00.500 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 12:00:00.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      ...Array.from(
        { length: 5 },
        (_value, index) => `D 12:00:${String(index + 1).padStart(2, "0")}.000 Client chooses: [TEST_001]`
      ),
      "D 12:01:00.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    const exactArenaDeck = {
      id: "startup-arena-deck",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Exact Arena Card", count: 30, cardId: "TEST_EXACT" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T09:00:00.000Z",
      warnings: []
    };
    let finishInitialScan: () => void = () => undefined;
    const initialScanGate = new Promise<void>((resolve) => {
      finishInitialScan = resolve;
    });
    let scanCount = 0;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => {
        scanCount += 1;
        if (scanCount === 1) {
          await initialScanGate;
          return { status: "missing-log" as const, decks: [] };
        }
        return { status: "ok" as const, decks: [exactArenaDeck], activeDeck: exactArenaDeck };
      })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    const started = service.start({ logPath: arenaLog });
    await vi.waitFor(() => expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(1));
    await writeFile(decksLog, "I 17:00:00.000 Starting Arena Game With Deck\n", "utf8");
    finishInitialScan();

    const state = await started;
    expect(state.arena).toMatchObject({ status: "complete", draftCount: 30, unresolvedCount: 0 });
    expect(state.deck).toEqual([
      expect.objectContaining({ cardId: "TEST_EXACT", count: 30 })
    ]);
    expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2);
    await service.dispose();
  });

  it("rejects an older Decks.log snapshot until it changes after the redraft", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(decksLog, "I 16:02:00.000 Starting Arena Game With Deck\n", "utf8");
    await writeFile(arenaLog, [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:24.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      ...Array.from(
        { length: 5 },
        (_value, index) => `D 16:54:0${index + 1}.000 Client chooses: [TEST_002]`
      ),
      "D 16:54:06.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    const oldTime = new Date("2026-07-21T08:02:00.000Z");
    const redraftTime = new Date("2026-07-21T08:54:06.000Z");
    await utimes(decksLog, oldTime, oldTime);
    await utimes(arenaLog, redraftTime, redraftTime);

    const exactArenaDeck = {
      id: "arena-deck",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Exact Arena Card", count: 30, cardId: "TEST_EXACT" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T08:02:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [exactArenaDeck],
        activeDeck: exactArenaDeck
      }))
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    const initial = await service.start({ logPath: arenaLog });
    expect(initial.arena).toMatchObject({
      deckId: "9466340632",
      redraftGenerationId: "9466340633",
      draftCount: 29,
      unresolvedCount: 30,
      awaitingExactDeck: true
    });
    expect(initial.deck.some((card) => card.cardId === "TEST_EXACT")).toBe(false);

    await appendFile(decksLog, "I 17:00:00.000 Starting Arena Game With Deck\n", "utf8");
    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({ draftCount: 30, unresolvedCount: 0 });
      expect(service.getState().deck).toEqual([
        expect.objectContaining({ cardId: "TEST_EXACT", count: 30 })
      ]);
    }, { timeout: 2_000, interval: 50 });
    await service.dispose();
  });

  it("keeps the last exact deck as the previous formal deck without finalizing a newer redraft", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 16:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 16:00:00.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 16:00:01.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(decksLog, "I 16:00:02.000 Deck Contents Received:\n", "utf8");

    const oldExactDeck = {
      id: "old-exact-arena",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Old Exact Card", count: 30, cardId: "TEST_OLD_EXACT" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-21T08:00:02.000Z",
      warnings: []
    };
    let scanCount = 0;
    let resolveDelayedScan: (value: {
      status: "ok";
      decks: typeof oldExactDeck[];
      activeDeck: typeof oldExactDeck;
    }) => void = () => undefined;
    const delayedScan = new Promise<{
      status: "ok";
      decks: typeof oldExactDeck[];
      activeDeck: typeof oldExactDeck;
    }>((resolve) => {
      resolveDelayedScan = resolve;
    });
    const scanner = {
      scanAndImportDecks: vi.fn(async () => {
        scanCount += 1;
        return scanCount === 1
          ? { status: "ok" as const, decks: [oldExactDeck] }
          : delayedScan;
      })
    };
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: arenaLog });

    await appendFile(decksLog, "I 16:53:23.000 Starting Arena Game With Deck\n", "utf8");
    await vi.waitFor(() => expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2));
    await appendFile(arenaLog, [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:24.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 16:53:26.000 Client chooses: [TEST_002]"
    ].join("\n") + "\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 150));
    resolveDelayedScan({ status: "ok", decks: [oldExactDeck], activeDeck: oldExactDeck });

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "redrafting",
        redraftGenerationId: "9466340633",
        draftCount: 30,
        unresolvedCount: 0,
        awaitingExactDeck: true
      });
    }, { timeout: 2_000, interval: 50 });
    expect(service.getState().deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_001", count: 24 }),
      expect.objectContaining({ cardId: "TEST_002", count: 1 }),
      expect.objectContaining({ name: "待确认重选牌", unresolved: true, count: 5 })
    ]));
    await service.dispose();
  });

  it("rebuilds Arena state from scratch when Arena.log is truncated", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 16:53:26.000 Client chooses: [TEST_002]"
    ].join("\n") + "\n", "utf8");
    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    const initial = await service.start({ logPath: arenaLog });
    expect(initial.arena).toMatchObject({ status: "redrafting", draftCount: 25 });

    await writeFile(arenaLog, "D 17:00:00.000 Client chooses: [TEST_003]\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "inactive",
        draftCount: 0,
        unresolvedCount: 0,
        picks: []
      });
    }, { timeout: 2_000, interval: 50 });
    expect(service.getState().deckName).toBeUndefined();
    await service.dispose();
  });

  it("records each Underground Arena replacement separately until the exact deck arrives", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 19:11:23.943 Arena.SetDraftMode - REDRAFTING",
      "D 19:11:27.660 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9475577956",
      "D 19:11:27.929 DraftManager.OnChoicesAndContents - Draft Deck ID: 9475577955, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 19:11:28.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_RETAINED`
      )
    ].join("\n") + "\n", "utf8");

    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: arenaLog });

    for (let index = 1; index <= 4; index += 1) {
      await appendFile(
        arenaLog,
        `D 19:11:${String(31 + index).padStart(2, "0")}.000 Client chooses: [TEST_REPLACEMENT_${index}]\n`,
        "utf8"
      );
      await vi.waitFor(() => {
        const state = service.getState();
        expect(state.arena).toMatchObject({
          status: "redrafting",
          draftCount: 24 + index,
          unresolvedCount: 30,
          awaitingExactDeck: true
        });
        expect(state.arena?.pendingRedraftChoices).toHaveLength(index);
        expect(state.arena?.pendingRedraftChoices?.at(-1)).toMatchObject({
          cardId: `TEST_REPLACEMENT_${index}`
        });
        expect(state.deckName).toBe("竞技场牌库");
        expect(state.summary.totalCards).toBe(30);
        expect(state.deck.reduce((total, card) => total + card.count, 0)).toBe(30);
        for (let chosen = 1; chosen <= index; chosen += 1) {
          expect(state.deck).toEqual(expect.arrayContaining([
            expect.objectContaining({ cardId: `TEST_REPLACEMENT_${chosen}`, count: 1 })
          ]));
        }
        expect(state.deck).toEqual(expect.arrayContaining([
          expect.objectContaining({ cardId: `TEST_REPLACEMENT_${index}`, count: 1 }),
          expect.objectContaining({ name: "待确认重选牌", count: 6 - index, unresolved: true })
        ]));
      }, { timeout: 2_000, interval: 25 });
    }

    await appendFile(arenaLog, [
      "D 19:11:50.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9475577955, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 19:11:50.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_RETAINED`
      ),
      ...Array.from(
        { length: 4 },
        (_value, index) => `D 19:11:51.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_REPLACEMENT_${index + 1}`
      ),
      "D 19:11:52.000 Arena.SetDraftMode - REDRAFTING"
    ].join("\n") + "\n", "utf8");
    await vi.waitFor(() => {
      const state = service.getState();
      expect(state.arena).toMatchObject({
        status: "redrafting",
        draftCount: 28,
        unresolvedCount: 30,
        awaitingExactDeck: true
      });
      expect(state.arena?.pendingRedraftChoices).toHaveLength(4);
    }, { timeout: 2_000, interval: 25 });

    await appendFile(
      arenaLog,
      "D 19:11:57.000 Client chooses: [TEST_REPLACEMENT_5]\n",
      "utf8"
    );
    await vi.waitFor(() => {
      const state = service.getState();
      expect(state.arena).toMatchObject({
        status: "redrafting",
        draftCount: 29,
        unresolvedCount: 30,
        awaitingExactDeck: true
      });
      expect(state.arena?.pendingRedraftChoices?.at(-1)).toMatchObject({
        cardId: "TEST_REPLACEMENT_5"
      });
      expect(state.deckName).toBe("竞技场牌库");
      expect(state.summary.totalCards).toBe(30);
      expect(state.deck.reduce((total, card) => total + card.count, 0)).toBe(30);
      for (let chosen = 1; chosen <= 5; chosen += 1) {
        expect(state.deck).toEqual(expect.arrayContaining([
          expect.objectContaining({ cardId: `TEST_REPLACEMENT_${chosen}`, count: 1 })
        ]));
      }
      expect(state.deck).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId: "TEST_REPLACEMENT_5", count: 1 }),
        expect.objectContaining({ name: "待确认重选牌", count: 1, unresolved: true })
      ]));
    }, { timeout: 2_000, interval: 25 });

    await appendFile(arenaLog, "D 19:11:57.365 Arena.SetDraftMode - ACTIVE_DRAFT_DECK\n", "utf8");
    await vi.waitFor(() => {
      const state = service.getState();
      expect(state.arena).toMatchObject({
        status: "complete",
        draftCount: 29,
        unresolvedCount: 30,
        awaitingExactDeck: true
      });
      expect(state.deckName).toBe("竞技场牌库");
      expect(state.summary.totalCards).toBe(30);
      expect(state.deck).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId: "TEST_REPLACEMENT_5", count: 1 }),
        expect.objectContaining({ name: "待确认重选牌", count: 1, unresolved: true })
      ]));
    }, { timeout: 2_000, interval: 25 });

    await service.dispose();
  });

  it("rebuilds Arena state when a truncated log is quickly rewritten past the old offset", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const original = [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 16:53:26.000 Client chooses: [TEST_002]"
    ].join("\n") + "\n";
    await writeFile(arenaLog, original, "utf8");
    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    const initial = await service.start({ logPath: arenaLog });
    expect(initial.arena).toMatchObject({ status: "redrafting", draftCount: 25 });

    const replacement = [
      "D 17:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 17:00:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_003`
      ),
      "D 17:00:02.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK",
      ...Array.from({ length: 30 }, (_value, index) => `D 17:00:03.${String(index).padStart(3, "0")} harmless padding`)
    ].join("\n") + "\n";
    expect(Buffer.byteLength(replacement)).toBeGreaterThanOrEqual(Buffer.byteLength(original));
    await writeFile(arenaLog, replacement, "utf8");

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({ status: "complete", draftCount: 30, unresolvedCount: 0 });
      expect(service.getState().arena?.deck).toEqual([
        expect.objectContaining({ cardId: "TEST_003", count: 30 })
      ]);
    }, { timeout: 3_000, interval: 25 });
    await service.dispose();
  });

  it("shows live replacements over the retained redraft snapshot while the exact deck awaits confirmation", async () => {
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 16:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 16:00:00.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 16:00:01.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    const initial = await service.start({ logPath: arenaLog });
    expect(initial.deckName).toBe("竞技场牌库");
    expect(initial.summary.totalCards).toBe(30);

    await appendFile(arenaLog, [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:24.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 25 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      ...Array.from(
        { length: 3 },
        (_value, index) => `D 16:54:0${index + 1}.000 Client chooses: [TEST_002]`
      )
    ].join("\n") + "\n", "utf8");

    await vi.waitFor(() => {
      const state = service.getState();
      expect(state).toMatchObject({
        trackerMode: "arena",
        deckName: "竞技场牌库",
        summary: { totalCards: 30 },
        arena: {
          status: "redrafting",
          draftCount: 30,
          unresolvedCount: 0,
          awaitingExactDeck: true
        }
      });
      expect(state.arena?.deck.reduce((total, card) => total + card.count, 0)).toBe(30);
      expect(state.arena?.pendingRedraftChoices).toHaveLength(3);
      expect(state.arena?.redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(33);
      expect(state.deck).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId: "TEST_001", count: 25 }),
        expect.objectContaining({ cardId: "TEST_002", count: 3 }),
        expect.objectContaining({ name: "待确认重选牌", count: 2, unresolved: true })
      ]));
    }, { timeout: 2_000, interval: 50 });

    await appendFile(arenaLog, [
      "D 16:54:04.000 Client chooses: [TEST_002]",
      "D 16:54:05.000 Client chooses: [TEST_002]",
      "D 16:54:06.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "complete",
        draftCount: 30,
        unresolvedCount: 0,
        awaitingExactDeck: true
      });
      expect(service.getState().arena?.picks).toHaveLength(30);
      expect(service.getState().arena?.pendingRedraftChoices).toHaveLength(5);
      expect(service.getState().arena?.redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(35);
      expect(service.getState().deckName).toBe("竞技场牌库");
      expect(service.getState().summary.totalCards).toBe(30);
      expect(service.getState().deck).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId: "TEST_001", count: 25 }),
        expect.objectContaining({ cardId: "TEST_002", count: 5 })
      ]));
    }, { timeout: 2_000, interval: 50 });
    await service.dispose();
  });

  it("keeps processing an Arena game while class ratings load in the background", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Sample Singleton", cardId: "TEST_001" },
              "1002": { dbfId: 1002, name: "Sample Pair", cardId: "TEST_002" },
              "1003": { dbfId: 1003, name: "Sample Multi", cardId: "TEST_003" }
            },
            warnings: []
          };
        }
      }
    }));
    const ratingResult = {
      table: {
        source: "test ratings",
        version: 1,
        fetchedAt: "2026-07-11T00:00:00.000Z",
        ratings: {},
        firestone: {
          source: "Firestone" as const,
          version: "test",
          lastUpdated: "2026-07-11T00:00:00.000Z",
          ratings: { TEST_001: { pickRate: 42, highWinPickRate: 51 } }
        },
        firestoneClasses: {
          druid: {
            source: "Firestone" as const,
            playerClass: "druid",
            version: "test",
            lastUpdated: "2026-07-11T00:00:00.000Z",
            overallWinrate: 50,
            ratings: { TEST_001: { includedWinrate: 56.3, sampleSize: 1000, deckImpact: 6.3 } }
          }
        }
      },
      warnings: []
    };
    let releaseRatings: (result: typeof ratingResult) => void = () => undefined;
    const delayedRatings = new Promise<typeof ratingResult>((resolve) => {
      releaseRatings = resolve;
    });
    const loadRatings = vi.fn(() => delayedRatings);
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        loadRatings = loadRatings;
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      arenaLog,
        [
          "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
          ...Array.from(
            { length: 30 },
            (_value, index) => `D 17:39:59.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
          ),
          "D 17:40:02.0000000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      powerLog,
      "",
      "utf8"
    );

    const service = new TrackerService();
    let startReturned = false;
    const startPromise = service.start({ logPath: powerLog }).then((state) => {
      startReturned = true;
      return state;
    });
    await vi.waitFor(() => expect(loadRatings).toHaveBeenCalledWith("Druid"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const returnedBeforeRatings = startReturned;
    if (!returnedBeforeRatings) {
      releaseRatings(ratingResult);
    }
    const initial = await startPromise;
    expect(returnedBeforeRatings).toBe(true);
    expect(initial.arena?.status).toBe("complete");
    expect(initial.summary).toMatchObject({ totalCards: 30, remainingCards: 30 });

    await appendFile(powerLog, [
      "D 17:41:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 17:41:00.100 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
      "D 17:41:00.200 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 17:41:00.300 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 17:41:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=64 zone=DECK zonePos=1 cardId=TEST_001 player=2] tag=ZONE value=HAND"
    ].join("\n") + "\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState()).toMatchObject({
        gameActive: true,
        arena: { status: "playing" },
        summary: { totalCards: 30, remainingCards: 29, drawnCards: 1 }
      });
    }, { timeout: 2_000, interval: 25 });

    releaseRatings(ratingResult);
    await vi.waitFor(() => {
      expect(service.getState().arena?.deck[0]).toMatchObject({ pickRate: 42, deckImpact: 6.3 });
    });
    const state = service.getState();
    await service.dispose();

    expect(state.status).toBe("watching");
    expect(state.logPath).toBe(powerLog);
    expect(state.arena?.status).toBe("playing");
    expect(state.gameActive).toBe(true);
    expect(state.arena).toMatchObject({ draftCount: 30, unresolvedCount: 0 });
    expect(state.deckName).toBe("竞技场牌库");
    expect(state.summary).toMatchObject({ totalCards: 30, remainingCards: 29, drawnCards: 1 });
    expect(state.deck).toEqual([expect.objectContaining({ cardId: "TEST_001", remaining: 29 })]);
  });

  it("loads Paladin ratings for HERO_04bh and scores OCR Arena choices", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "700": { dbfId: 700, name: "候选一", cardId: "MIS_700", collectible: true },
              "918": { dbfId: 918, name: "候选二", cardId: "MIS_918", collectible: true },
              "848": { dbfId: 848, name: "候选三", cardId: "UNG_848", collectible: true }
            },
            warnings: []
          };
        }
      }
    }));
    const loadRatings = vi.fn(async (className: string) => ({
      table: {
        source: "test ratings",
        version: 1,
        fetchedAt: "2026-07-24T00:00:00.000Z",
        ratings: {
          Paladin: {
            MIS_700: 70,
            MIS_918: 80,
            UNG_848: 90
          }
        },
        firestone: {
          source: "Firestone" as const,
          version: "test",
          lastUpdated: "2026-07-24T00:00:00.000Z",
          ratings: {
            MIS_700: { pickRate: 40 },
            MIS_918: { pickRate: 50 },
            UNG_848: { pickRate: 60 }
          }
        },
        firestoneClasses: {
          paladin: {
            source: "Firestone" as const,
            playerClass: "paladin",
            version: "paladin-test",
            lastUpdated: "2026-07-24T00:00:00.000Z",
            overallWinrate: 50,
            ratings: {
              MIS_700: { includedWinrate: 51, sampleSize: 100, deckImpact: 1 },
              MIS_918: { includedWinrate: 52, sampleSize: 100, deckImpact: 2 },
              UNG_848: { includedWinrate: 53, sampleSize: 100, deckImpact: 3 }
            }
          }
        }
      },
      warnings: [],
      firestoneClassCacheStatus: "fresh" as const,
      requestedClass: className
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        loadRatings = loadRatings;
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 Arena.SetDraftMode - DRAFTING",
      "D 12:00:01.000 DraftManager.OnChosen(): hero=HERO_04bh"
    ].join("\n") + "\n", "utf8");
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "候选一", confidence: 1, x: 0.2, y: 0.6, width: 0.05, height: 0.02 },
          { text: "候选二", confidence: 1, x: 0.39, y: 0.6, width: 0.05, height: 0.02 },
          { text: "候选三", confidence: 1, x: 0.58, y: 0.6, width: 0.05, height: 0.02 }
        ]
      }))
    };
    const service = new TrackerService(undefined, recognizer);

    await service.start({ logPath: arenaLog });
    try {
      await vi.waitFor(() => {
        expect(loadRatings).toHaveBeenCalledWith("Paladin");
        expect(service.getState().arena?.currentChoices).toEqual([
          expect.objectContaining({
            cardId: "MIS_700",
            score: 70,
            rating: expect.objectContaining({ hearthArena: 70, pickRate: 40, deckImpact: 1 })
          }),
          expect.objectContaining({
            cardId: "MIS_918",
            score: 80,
            rating: expect.objectContaining({ hearthArena: 80, pickRate: 50, deckImpact: 2 })
          }),
          expect.objectContaining({
            cardId: "UNG_848",
            score: 90,
            rating: expect.objectContaining({ hearthArena: 90, pickRate: 60, deckImpact: 3 })
          })
        ]);
      });
    } finally {
      await service.dispose();
    }
  });

  it("loads the completed Arena deck before replaying a current game on cold start", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { database: { "1001": { dbfId: 1001, name: "Sample Singleton", cardId: "TEST_001" } }, warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { table: { source: "test", version: 1, fetchedAt: "2026-07-22T00:00:00.000Z", ratings: {} }, warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 1, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 12:00:00.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 12:00:01.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(powerLog, [
      "D 12:01:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 12:01:00.100 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
      "D 12:01:00.200 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 12:01:00.300 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 12:01:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=65 zone=DECK zonePos=1 cardId=TEST_001 player=2] tag=ZONE value=HAND"
    ].join("\n") + "\n", "utf8");

    const service = new TrackerService();
    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state).toMatchObject({
      gameActive: true,
      arena: { status: "playing" },
      summary: { totalCards: 30, remainingCards: 29, drawnCards: 1 }
    });
    expect(state.deck).toEqual([expect.objectContaining({ cardId: "TEST_001", remaining: 29, drawn: 1 })]);
  });

  it("shows stale class ratings but retries them on the next log update", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { database: { "1001": { dbfId: 1001, name: "Sample Singleton", cardId: "TEST_001" } }, warnings: [] };
        }
      }
    }));
    const baseTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-07-11T00:00:00.000Z",
      ratings: {},
      firestone: {
        source: "Firestone" as const,
        version: "test",
        lastUpdated: "2026-07-11T00:00:00.000Z",
        ratings: { TEST_001: { pickRate: 42, highWinPickRate: 51 } }
      }
    };
    const staleClass = {
      source: "Firestone" as const,
      playerClass: "hunter",
      version: "stale",
      lastUpdated: "2026-07-10T00:00:00.000Z",
      overallWinrate: 50,
      ratings: { TEST_001: { includedWinrate: 54, sampleSize: 100, deckImpact: 4 } }
    };
    const loadRatings = vi.fn()
      .mockResolvedValueOnce({
        table: { ...baseTable, firestoneClasses: { hunter: staleClass } },
        warnings: ["Firestone hunter 卡组影响更新失败，继续使用本地缓存"],
        firestoneClassCacheStatus: "stale"
      })
      .mockResolvedValueOnce({
        table: {
          ...baseTable,
          firestoneClasses: {
            hunter: {
              source: "Firestone" as const,
              playerClass: "hunter",
              version: "test",
              lastUpdated: "2026-07-11T00:00:00.000Z",
              overallWinrate: 50,
              ratings: { TEST_001: { includedWinrate: 55, sampleSize: 100, deckImpact: 5 } }
            }
          }
        },
        warnings: [],
        firestoneClassCacheStatus: "fresh"
      });
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService { loadRatings = loadRatings; }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 1, Hero Card = HERO_05",
      ...Array.from({ length: 30 }, (_value, index) =>
        `D 12:00:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`),
      "D 12:00:02.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    const service = new TrackerService();
    await service.start({ logPath: arenaLog });
    await vi.waitFor(() => expect(loadRatings).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(service.getState().arena?.error).toContain("继续使用本地缓存"));
    expect(service.getState().arena?.deck[0]).toMatchObject({ pickRate: 42, deckImpact: 4 });

    await appendFile(arenaLog, "D 12:00:03.000 harmless update\n", "utf8");
    await vi.waitFor(() => expect(loadRatings).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(service.getState().arena?.deck[0]).toMatchObject({ pickRate: 42, deckImpact: 5 });
    });
    await service.dispose();
  });

  it("ignores an old session rating result without clearing the new session request", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { database: { "1001": { dbfId: 1001, name: "Sample Singleton", cardId: "TEST_001" } }, warnings: [] };
        }
      }
    }));
    type RatingResult = {
      table: {
        source: string;
        version: number;
        fetchedAt: string;
        ratings: Record<string, Record<string, number>>;
        firestoneClasses: Record<string, {
          source: "Firestone";
          playerClass: string;
          version: string;
          lastUpdated: string;
          overallWinrate: number;
          ratings: Record<string, { includedWinrate: number; sampleSize: number; deckImpact: number }>;
        }>;
      };
      warnings: string[];
    };
    const resolvers = new Map<string, (result: RatingResult) => void>();
    const loadRatings = vi.fn((className: string) => new Promise<RatingResult>((resolve) => {
      resolvers.set(className, resolve);
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService { loadRatings = loadRatings; }
    }));
    const makeResult = (classSlug: string, deckImpact: number, includeDruid = false): RatingResult => ({
      table: {
        source: "test ratings",
        version: 1,
        fetchedAt: "2026-07-11T00:00:00.000Z",
        ratings: {},
        firestoneClasses: {
          [classSlug]: {
            source: "Firestone",
            playerClass: classSlug,
            version: "test",
            lastUpdated: "2026-07-11T00:00:00.000Z",
            overallWinrate: 50,
            ratings: { TEST_001: { includedWinrate: 50 + deckImpact, sampleSize: 100, deckImpact } }
          },
          ...(includeDruid ? {
            druid: {
              source: "Firestone" as const,
              playerClass: "druid",
              version: "stale",
              lastUpdated: "2026-07-11T00:00:00.000Z",
              overallWinrate: 50,
              ratings: { TEST_001: { includedWinrate: 99, sampleSize: 100, deckImpact: 99 } }
            }
          } : {})
        }
      },
      warnings: []
    });
    const { TrackerService } = await import("../src/main/trackerService.js");
    const hunterSession = await createSessionDir();
    const druidSession = await createSessionDir();
    const hunterArenaLog = join(hunterSession, "Arena.log");
    const druidArenaLog = join(druidSession, "Arena.log");
    const arenaText = (hero: string) => [
      `D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 1, Hero Card = ${hero}`,
      ...Array.from({ length: 30 }, (_value, index) =>
        `D 12:00:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`),
      "D 12:00:02.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n";
    await writeFile(hunterArenaLog, arenaText("HERO_05"), "utf8");
    await writeFile(druidArenaLog, arenaText("HERO_06"), "utf8");

    const service = new TrackerService();
    await service.start({ logPath: hunterArenaLog });
    await vi.waitFor(() => expect(loadRatings).toHaveBeenCalledWith("Hunter"));
    await service.start({ logPath: druidArenaLog });
    await vi.waitFor(() => expect(loadRatings).toHaveBeenCalledWith("Druid"));

    resolvers.get("Hunter")?.(makeResult("hunter", 10, true));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.getState().arena?.hero?.className).toBe("Druid");
    expect(service.getState().arena?.deck[0]?.deckImpact).toBeUndefined();
    await appendFile(druidArenaLog, "D 12:00:03.000 harmless update\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loadRatings).toHaveBeenCalledTimes(2);

    resolvers.get("Druid")?.(makeResult("druid", 2));
    await vi.waitFor(() => expect(service.getState().arena?.deck[0]?.deckImpact).toBe(2));
    await service.dispose();
  });

  it("does not treat an older Arena game as the match after a newer redraft", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(arenaLog, [
      "D 20:01:20.000 Arena.SetDraftMode - REDRAFTING",
      "D 20:01:21.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 20:01:21.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 20:01:45.377 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(powerLog, [
      "D 19:44:49.835 GameState.DebugPrintPower() - CREATE_GAME",
      "D 19:44:49.835 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
      "D 19:44:49.836 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 19:44:49.837 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 19:44:50.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=TEST_001 id=64 zone=DECK zonePos=1 cardId=TEST_001 player=2] tag=ZONE value=HAND"
    ].join("\n") + "\n", "utf8");
    const observedAt = new Date(2026, 6, 22, 20, 2, 0);
    await Promise.all([
      utimes(arenaLog, observedAt, observedAt),
      utimes(powerLog, observedAt, observedAt)
    ]);

    const service = new TrackerService();
    const waiting = await service.start({ logPath: powerLog });
    expect(waiting.arena?.status).toBe("complete");
    expect(waiting.gameActive).not.toBe(true);
    expect(waiting.summary).toMatchObject({ totalCards: 30, remainingCards: 30, drawnCards: 0 });

    await appendFile(powerLog, [
      "D 20:05:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 20:05:00.100 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
      "D 20:05:00.200 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 20:05:00.300 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 20:05:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=TEST_001 id=65 zone=DECK zonePos=1 cardId=TEST_001 player=2] tag=ZONE value=HAND"
    ].join("\n") + "\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState()).toMatchObject({
        gameActive: true,
        arena: { status: "playing" },
        summary: { totalCards: 30, remainingCards: 29, drawnCards: 1 }
      });
    }, { timeout: 2_000, interval: 25 });
    await service.dispose();
  });

  it("accepts a live Arena game by arrival order when its clock looks older than the current deck", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(arenaLog, [
      "D 20:01:20.000 Arena.SetDraftMode - REDRAFTING",
      "D 20:01:21.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 20:01:21.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 20:01:45.377 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(powerLog, "", "utf8");
    const observedAt = new Date(2026, 6, 22, 20, 2, 0);
    await Promise.all([
      utimes(arenaLog, observedAt, observedAt),
      utimes(powerLog, observedAt, observedAt)
    ]);

    const service = new TrackerService();
    const waiting = await service.start({ logPath: powerLog });
    expect(waiting.arena?.status).toBe("complete");
    expect(waiting.gameActive).not.toBe(true);

    // Log clock/date inference can be wrong across a long overnight session.
    // A line observed as a live append is authoritative even if its clock looks older.
    await appendFile(powerLog, [
      "D 19:59:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 19:59:00.100 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
      "D 19:59:00.200 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 19:59:00.300 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 19:59:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=TEST_001 id=65 zone=DECK zonePos=1 cardId=TEST_001 player=2] tag=ZONE value=HAND"
    ].join("\n") + "\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState()).toMatchObject({
        gameActive: true,
        arena: { status: "playing" },
        summary: { totalCards: 30, remainingCards: 29, drawnCards: 1 }
      });
    }, { timeout: 2_000, interval: 25 });
    await service.dispose();
  });

  it("enters playing when live Power.log starts before Arena redraft completion", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    vi.resetModules();
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(arenaLog, [
      "D 20:01:20.000 Arena.SetDraftMode - REDRAFTING",
      "D 20:01:21.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 20:01:21.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      )
    ].join("\n") + "\n", "utf8");
    await writeFile(powerLog, "", "utf8");

    const service = new TrackerService();
    const waiting = await service.start({ logPath: powerLog });
    expect(waiting.arena).toMatchObject({ status: "redrafting", draftCount: 0 });

    await appendFile(powerLog, [
      "D 20:01:44.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 20:01:44.100 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
      "D 20:01:44.200 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 20:01:44.300 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 20:01:44.400 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=TEST_001 id=65 zone=DECK zonePos=1 cardId=TEST_001 player=2] tag=ZONE value=HAND"
    ].join("\n") + "\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(service.getState().arena?.status).toBe("redrafting");

    await appendFile(arenaLog, "D 20:01:45.377 Arena.SetDraftMode - ACTIVE_DRAFT_DECK\n", "utf8");

    await vi.waitFor(() => {
      expect(service.getState()).toMatchObject({
        gameActive: true,
        arena: { status: "playing" },
        summary: { totalCards: 30, remainingCards: 29, drawnCards: 1 }
      });
      expect(service.getState().deck).toEqual([
        expect.objectContaining({ cardId: "TEST_001", count: 30, remaining: 29, drawn: 1 })
      ]);
    }, { timeout: 2_000, interval: 25 });
    await service.dispose();
  });

  it("冷启动回放竞技场 Power.log 时恢复星空投影球的本局法术", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "103354": { dbfId: 103354, name: "星空投影球", cardId: "TOY_378", type: "SPELL", cost: 10 },
              "1": { dbfId: 1, name: "寒冰箭", cardId: "CORE_CS2_024", type: "SPELL", cost: 2 },
              "2": { dbfId: 2, name: "死神之躯", cardId: "REV_840", type: "SPELL", cost: 6 }
            },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(
      powerLog,
      [
        "D 08:18:06.3615000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 08:18:06.3615000 GameState.DebugPrintPower() -     TAG_CHANGE Entity=GameEntity tag=GT value=7",
        "D 08:18:06.3615000 GameState.DebugPrintGame() - GameType=GT_UNDERGROUND_ARENA",
        "D 08:18:06.3615000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
        "D 08:18:06.3615000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
        "D 08:18:06.3615000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=4 zone=DECK zonePos=0 cardId= player=1] CardID=",
        "D 08:18:06.3615000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=5 zone=DECK zonePos=0 cardId= player=1] CardID=",
        "D 08:18:06.3615000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=6 zone=DECK zonePos=0 cardId= player=1] CardID=",
        "D 08:18:06.3615000 PowerTaskList.DebugPrintPower() - CREATE_GAME",
        "D 08:18:07.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=4 zone=DECK zonePos=0 cardId= player=1] tag=ZONE value=HAND",
        "D 08:18:32.0537060 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星空投影球 id=60 zone=DECK zonePos=0 cardId=TOY_378 player=2] tag=ZONE value=HAND",
        "D 08:20:53.4861770 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=7 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1",
        "D 08:20:53.4861770 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=7 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1",
        "D 08:21:39.5040300 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=死神之躯 id=85 zone=HAND zonePos=5 cardId=REV_840 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1",
        "D 08:21:39.5040300 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=死神之躯 id=85 zone=HAND zonePos=5 cardId=REV_840 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1"
      ].join("\n") + "\n",
      "utf8"
    );

    const service = new TrackerService();
    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(state.friendlyHand).toContainEqual(
      expect.objectContaining({
        cardId: "TOY_378",
        details: expect.objectContaining({
          playedSpellsThisGame: [
            expect.objectContaining({ name: "寒冰箭", cardId: "CORE_CS2_024" }),
            expect.objectContaining({ name: "死神之躯", cardId: "REV_840" })
          ]
        })
      })
    );
    expect(state.opponentDeck).toEqual([]);
    expect(state.opponentDeckCount).toBe(2);
  });

  it("replaces temporary legendary-team cards with the exact active Arena deck only after completion", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "2001": { dbfId: 2001, name: "传说核心", cardId: "JAIL_851", rarity: "LEGENDARY" },
              "2002": { dbfId: 2002, name: "传说预览", cardId: "TIME_064", rarity: "LEGENDARY" },
              "3001": { dbfId: 3001, name: "普通选牌", cardId: "TEST_NORMAL", rarity: "COMMON" },
              "4001": { dbfId: 4001, name: "精确附带甲", cardId: "TEST_BONUS_1", rarity: "COMMON" },
              "4002": { dbfId: 4002, name: "精确附带乙", cardId: "TEST_BONUS_2", rarity: "COMMON" },
              "4003": { dbfId: 4003, name: "精确附带丙", cardId: "TEST_BONUS_3", rarity: "COMMON" }
            },
            warnings: []
          };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { table: { source: "test", version: 1, fetchedAt: "2026-07-18T00:00:00.000Z", ratings: {} }, warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 SetDraftMode - DRAFTING",
      "D 12:00:01.000 DraftManager.OnChosen(): hero=HERO_04",
      "D 12:00:02.000 Client chooses: 传说核心 (JAIL_851)",
      "D 12:00:03.000 Client chooses: 传说预览 (TIME_064)",
      "D 12:00:04.000 Client chooses: 传说核心 (JAIL_851)",
      ...Array.from({ length: 26 }, (_value, index) => `D 12:01:${String(index).padStart(2, "0")}.000 Client chooses: 普通选牌 (TEST_NORMAL)`),
      "D 12:02:00.000 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n"), "utf8");
    const exactArenaDeck = {
      id: "arena-deck",
      deckId: "9463305273",
      mode: "arena",
      cards: [
        { name: "传说核心", count: 1, cardId: "JAIL_851" },
        { name: "精确附带甲", count: 1, cardId: "TEST_BONUS_1" },
        { name: "精确附带乙", count: 1, cardId: "TEST_BONUS_2" },
        { name: "精确附带丙", count: 1, cardId: "TEST_BONUS_3" },
        { name: "普通选牌", count: 26, cardId: "TEST_NORMAL" }
      ],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-18T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [exactArenaDeck], activeDeck: exactArenaDeck }))
    };

    const service = new TrackerService(scanner, { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) });
    const state = await service.start({ logPath: arenaLog });
    await service.dispose();

    expect(state.arena).toMatchObject({ status: "complete", draftCount: 30 });
    expect(state.deckName).toBe("竞技场牌库");
    expect(state.summary).toMatchObject({ totalCards: 30, remainingCards: 30 });
    expect(state.deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_BONUS_1", count: 1 }),
      expect.objectContaining({ cardId: "TEST_BONUS_2", count: 1 }),
      expect.objectContaining({ cardId: "TEST_BONUS_3", count: 1 })
    ]));
    expect(state.deck.map((card) => card.name)).not.toEqual(expect.arrayContaining(["传说团队附带牌", "日志缺失的竞技场牌"]));

    await writeFile(arenaLog, [
      "D 13:00:00.000 SetDraftMode - DRAFTING",
      "D 13:00:01.000 DraftManager.OnChosen(): hero=HERO_04",
      "D 13:00:02.000 Client chooses: 普通选牌 (TEST_NORMAL)"
    ].join("\n"), "utf8");
    const draftingService = new TrackerService(scanner, { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) });
    const draftingState = await draftingService.start({ logPath: arenaLog });
    await draftingService.dispose();

    expect(draftingState.arena).toMatchObject({ status: "drafting", draftCount: 1 });
    expect(draftingState.deckName).toBeUndefined();
  });

  it("keeps the constructed deck preview when Arena.log updates after returning to Standard deck select", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Sample Arena", cardId: "TEST_ARENA" },
              "1002": { dbfId: 1002, name: "Standard Card", cardId: "TEST_STANDARD" },
              "1003": { dbfId: 1003, name: "Wild Card", cardId: "TEST_WILD" }
            },
            warnings: []
          };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return {
            table: { source: "test ratings", version: 1, fetchedAt: "2026-07-11T00:00:00.000Z", ratings: {} },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(
      arenaLog,
      [
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 17:40:02.0000000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );
    const standardDeck = {
      id: "standard-deck",
      deckId: "9455681170",
      name: "偷取牌库",
      format: "标准",
      cards: [{ name: "Standard Card", count: 30, cardId: "TEST_STANDARD" }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [
          {
            id: "wild-deck",
            deckId: "9455227336",
            name: "偷取牌库",
            format: "狂野",
            cards: [{ name: "Wild Card", count: 30, cardId: "TEST_WILD" }],
            rawText: "",
            sourcePath: join(sessionDir, "Decks.log"),
            updatedAt: "2026-07-11T00:00:00.000Z",
            warnings: []
          },
          standardDeck
        ]
      }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
          { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
        ]
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const state = await service.start({ logPath: arenaLog });
    expect(state.deckName).toBe("偷取牌库");
    expect(state.autoMatchedDeckId).toBe("standard-deck");
    expect(recognizer.recognize).toHaveBeenCalledWith({
      requireHearthstoneFrontmost: true,
      profile: "constructed"
    });

    await appendFile(
      arenaLog,
      [
        "",
        "D 17:56:15.0000000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 17:56:15.0000000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 17:56:15.0000000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );

    await vi.waitFor(
      () => {
        expect(recognizer.recognize).toHaveBeenCalledTimes(2);
        expect(service.getState().deckName).toBe("偷取牌库");
        expect(service.getState().autoMatchedDeckId).toBe("standard-deck");
      },
      { timeout: 3_000, interval: 50 }
    );

    recognizer.recognize.mockResolvedValue({ status: "ok" as const, texts: [] });
    await appendFile(
      arenaLog,
      [
        "",
        "D 17:57:15.0000000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 17:57:15.0000000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 17:57:15.0000000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n") + "\n",
      "utf8"
    );

    await vi.waitFor(
      () => {
        expect(service.getState().constructedScreenMode).toBeUndefined();
        expect(service.getState().deckName).toBe("竞技场牌库");
        expect(service.getState().autoMatchedDeckId).toBeUndefined();
      },
      { timeout: 3_000, interval: 50 }
    );
    await service.dispose();
  });

  it("switches from a stale Arena Power.log when the Standard deck select screen is visible", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Sample Arena", cardId: "TEST_ARENA" },
              "1002": { dbfId: 1002, name: "Standard Card", cardId: "TEST_STANDARD" },
              "1003": { dbfId: 1003, name: "Wild Card", cardId: "TEST_WILD" }
            },
            warnings: []
          };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return {
            table: { source: "test ratings", version: 1, fetchedAt: "2026-07-11T00:00:00.000Z", ratings: {} },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(
      arenaLog,
      [
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 17:40:02.0000000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      powerLog,
      [
        "D 17:41:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME GameType=GT_ARENA",
        "D 17:41:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=WON"
      ].join("\n"),
      "utf8"
    );
    const standardDeck = {
      id: "standard-deck-from-stale-power",
      deckId: "9455681170",
      name: "偷取牌库",
      format: "标准",
      cards: [{ name: "Standard Card", count: 30, cardId: "TEST_STANDARD" }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [
          {
            id: "wild-deck-from-stale-power",
            deckId: "9455227336",
            name: "偷取牌库",
            format: "狂野",
            cards: [{ name: "Wild Card", count: 30, cardId: "TEST_WILD" }],
            rawText: "",
            sourcePath: join(sessionDir, "Decks.log"),
            updatedAt: "2026-07-11T00:00:00.000Z",
            warnings: []
          },
          standardDeck
        ]
      }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
          { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
        ]
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const state = await service.start({ logPath: powerLog });
    await service.dispose();

    expect(recognizer.recognize).toHaveBeenCalledWith({
      requireHearthstoneFrontmost: true,
      profile: "constructed"
    });
    expect(state.constructedScreenMode).toBe("standard");
    expect(state.deckName).toBe("偷取牌库");
    expect(state.autoMatchedDeckId).toBe("standard-deck-from-stale-power");
    expect(state.summary.totalCards).toBe(30);
  });

  it("clears an old constructed preview while a Standard deck name is ambiguous", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, "D 18:00:00.000 SetDraftMode - ACTIVE_DRAFT_DECK\n", "utf8");
    const oldDeck = {
      id: "old-preview",
      name: "重复牌组",
      format: "标准",
      cards: [{ name: "Old Card", count: 30 }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [oldDeck, { ...oldDeck, id: "duplicate-preview" }],
        activeDeck: oldDeck
      }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
          { text: "重复牌组", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
        ]
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const state = await service.start({ logPath: arenaLog });
    await service.dispose();

    expect(state.constructedScreenMode).toBe("standard");
    expect(state.deckName).toBeUndefined();
    expect(state.autoMatchedDeckId).toBeUndefined();
    expect(state.deck).toEqual([]);
    expect(state.summary.totalCards).toBe(0);
  });

  it.each(["permission-denied", "capture-failed", "window-not-found", "failed"] as const)(
    "clears a stale constructed preview when screen recognition returns %s",
    async (failureStatus) => {
      vi.resetModules();
      vi.doMock("../src/main/cardDataService.js", () => ({
        CardDataService: class CardDataService {
          async loadCardDatabase() {
            return { warnings: [] };
          }
        }
      }));
      const { TrackerService } = await import("../src/main/trackerService.js");
      const sessionDir = await createSessionDir();
      const powerLog = join(sessionDir, "Power.log");
      await writeFile(powerLog, "D 18:05:00.000 GameState.DebugPrintPower() - Waiting for deck selection\n", "utf8");
      const selectedDeck = {
        id: "screen-selected-standard",
        name: "测试标准牌组",
        format: "标准",
        cards: [{ name: "Standard Card", count: 30 }],
        rawText: "",
        sourcePath: join(sessionDir, "Decks.log"),
        updatedAt: "2026-07-11T00:00:00.000Z",
        warnings: []
      };
      const scanner = {
        scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [selectedDeck] }))
      };
      let recognitionCount = 0;
      const recognizer = {
        recognize: vi.fn(async () => {
          recognitionCount += 1;
          if (recognitionCount === 1) {
            return {
              status: "ok" as const,
              texts: [
                { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
                { text: "测试标准牌组", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
              ]
            };
          }
          return { status: failureStatus, message: `识别失败：${failureStatus}`, texts: [] };
        })
      };

      const service = new TrackerService(scanner, recognizer);
      const initialState = await service.start({ logPath: powerLog });
      expect(initialState.autoMatchedDeckId).toBe("screen-selected-standard");

      await vi.waitFor(
        () => {
          const state = service.getState();
          expect(recognizer.recognize.mock.calls.length).toBeGreaterThanOrEqual(2);
          expect(state.constructedScreenMode).toBe("standard");
          expect(state.autoMatchedDeckId).toBeUndefined();
          expect(state.deck).toEqual([]);
          expect(state.error).toContain(failureStatus);
        },
        { timeout: 2_000, interval: 50 }
      );
      await service.dispose();
    }
  );

  it("clears a completed Arena deck when screen permission cannot verify the current mode", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { table: undefined, warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(
      arenaLog,
      [
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 1, Hero Card = HERO_06",
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 17:40:02.0000000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );
    const constructedDeck = {
      id: "constructed-deck",
      name: "测试套牌",
      format: "标准",
      cards: [{ name: "Standard Card", count: 30 }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [constructedDeck] }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "permission-denied" as const,
        message: "请允许录制屏幕。",
        texts: []
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const state = await service.start({ logPath: arenaLog });
    await service.dispose();

    expect(state.arena?.status).toBe("inactive");
    expect(state.arena?.deck).toEqual([]);
    expect(state.deck).toEqual([]);
    expect(state.error).toContain("请允许录制屏幕");
  });

  it("does not let stale constructed screen text clear an active Arena draft", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, "D 18:08:00.000 SetDraftMode - DRAFTING\n", "utf8");
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [{
          id: "standard-deck",
          name: "标准套牌",
          format: "标准",
          cards: [{ name: "Standard Card", count: 30 }],
          rawText: "",
          sourcePath: join(sessionDir, "Decks.log"),
          updatedAt: "2026-07-11T00:00:00.000Z",
          warnings: []
        }]
      }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [{ text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 }]
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const state = await service.start({ logPath: arenaLog });
    await service.dispose();

    expect(state.arena?.status).toBe("drafting");
    expect(state.constructedScreenMode).toBeUndefined();
  });

  it("leaves Arena redrafting after the constructed deck screen is confirmed twice", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return { warnings: [] };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(
      arenaLog,
      [
        "D 18:08:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: arena, Hero Card = HERO_06",
        "D 18:08:00.000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 18:08:01.000 SetDraftMode - REDRAFTING"
      ].join("\n"),
      "utf8"
    );
    const constructedDeck = {
      id: "standard-deck",
      name: "标准套牌",
      format: "标准",
      cards: [{ name: "Standard Card", count: 30 }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [constructedDeck] }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [
          { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
          { text: "标准套牌", confidence: 0.9, x: 0.72, y: 0.34, width: 0.08, height: 0.02 }
        ]
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const initial = await service.start({ logPath: arenaLog });
    expect(initial.arena?.status).toBe("redrafting");

    await vi.waitFor(() => expect(service.getState().autoMatchedDeckId).toBe("standard-deck"), {
      timeout: 2_000,
      interval: 50
    });
    expect(service.getState().arena?.status).toBe("inactive");
    expect(service.getState().constructedScreenMode).toBe("standard");
    await service.dispose();
  });

  it("clears an old Arena deck as soon as a constructed mode is confirmed", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Sample Arena", cardId: "TEST_ARENA" }
            },
            warnings: []
          };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return { warnings: [] };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(
      arenaLog,
      [
        "D 18:10:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: arena, Hero Card = HERO_06",
        "D 18:10:00.000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 18:10:01.000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({
        status: "ok" as const,
        decks: [
          {
            id: "standard-deck",
            name: "标准套牌",
            format: "标准",
            cards: [{ name: "Standard Card", count: 30 }],
            rawText: "",
            sourcePath: join(sessionDir, "Decks.log"),
            updatedAt: "2026-07-11T00:00:00.000Z",
            warnings: []
          }
        ]
      }))
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: [{ text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 }]
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const state = await service.start({ logPath: arenaLog });
    await service.dispose();

    expect(state.constructedScreenMode).toBe("standard");
    expect(state.arena?.status).toBe("inactive");
    expect(state.deckName).toBeUndefined();
    expect(state.deck).toEqual([]);
    expect(state.summary.totalCards).toBe(0);
  });

  it("switches between constructed decks on the Standard deck select screen", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1002": { dbfId: 1002, name: "Old Standard Card", cardId: "TEST_OLD_STANDARD" },
              "1003": { dbfId: 1003, name: "New Standard Card", cardId: "TEST_NEW_STANDARD" }
            },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(powerLog, "D 18:20:00.000 GameState.DebugPrintPower() - Waiting for deck selection\n", "utf8");
    await writeFile(decksLog, "I 18:20:00.000 Deck Contents Received:\n", "utf8");
    const oldDeck = {
      id: "old-standard-deck",
      deckId: "old-deck-id",
      name: "旧标准牌库",
      format: "标准",
      cards: [{ name: "Old Standard Card", count: 30, cardId: "TEST_OLD_STANDARD" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const newDeck = {
      id: "new-standard-deck",
      deckId: "new-deck-id",
      name: "偷取牌库",
      format: "标准",
      cards: [{ name: "New Standard Card", count: 30, cardId: "TEST_NEW_STANDARD" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    const scanner = {
      scanAndImportDecks: vi.fn(async (options?: { logPath?: string }) => ({
        status: "ok" as const,
        decks: [oldDeck, newDeck],
        activeDeck: options?.logPath === decksLog ? oldDeck : undefined
      }))
    };
    let recognizeCount = 0;
    const recognizer = {
      recognize: vi.fn(async () => {
        recognizeCount += 1;
        return recognizeCount === 1
          ? { status: "ok" as const, texts: [] }
          : {
              status: "ok" as const,
              texts: [
                { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
                { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
              ]
            };
      })
    };

    const service = new TrackerService(scanner, recognizer);
    await service.start({ logPath: powerLog });

    await appendFile(
      decksLog,
      [
        "I 18:21:00.000 Finding Game With Deck:",
        "I 18:21:00.000 ### 旧标准牌库",
        "I 18:21:00.000 # Deck ID: old-deck-id",
        "I 18:21:00.000 AAEBAfTVBwHzsgYAAAA="
      ].join("\n"),
      "utf8"
    );

    await vi.waitFor(
      () => {
        expect(recognizer.recognize).toHaveBeenCalledTimes(2);
        expect(service.getState().deckName).toBe("偷取牌库");
        expect(service.getState().autoMatchedDeckId).toBe("new-standard-deck");
        expect(service.getState().summary.totalCards).toBe(30);
      },
      { timeout: 2_000, interval: 50 }
    );
    await service.dispose();
  });

  it("does not leave a completed Arena deck from Decks.log without constructed-screen confirmation", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: {
              "1001": { dbfId: 1001, name: "Sample Arena", cardId: "TEST_ARENA" },
              "1002": { dbfId: 1002, name: "Constructed Card", cardId: "TEST_CONSTRUCTED" }
            },
            warnings: []
          };
        }
      }
    }));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService {
        async loadRatings() {
          return {
            table: { source: "test ratings", version: 1, fetchedAt: "2026-07-11T00:00:00.000Z", ratings: {} },
            warnings: []
          };
        }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(
      arenaLog,
      [
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06",
        "D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_ARENA",
        "D 17:40:02.0000000 SetDraftMode - ACTIVE_DRAFT_DECK"
      ].join("\n"),
      "utf8"
    );
    await writeFile(decksLog, "I 17:43:00.2066660 Deck Contents Received:\n", "utf8");
    const constructedDeck = {
      id: "constructed-deck",
      deckId: "9302099347",
      name: "试验套牌",
      format: "标准",
      cards: [{ name: "Constructed Card", count: 30, cardId: "TEST_CONSTRUCTED" }],
      rawText: "",
      sourcePath: decksLog,
      updatedAt: "2026-07-11T00:00:00.000Z",
      warnings: []
    };
    let scanCount = 0;
    const scanner = {
      scanAndImportDecks: vi.fn(async () => {
        scanCount += 1;
        return {
          status: "ok" as const,
          decks: [constructedDeck],
          activeDeck: scanCount >= 2 ? constructedDeck : undefined
        };
      })
    };
    const recognizer = {
      recognize: vi.fn(async () => ({
        status: "ok" as const,
        texts: []
      }))
    };

    const service = new TrackerService(scanner, recognizer);
    const initialState = await service.start({ logPath: arenaLog });
    expect(initialState.deckName).toBe("竞技场牌库");

    await appendFile(
      decksLog,
      [
        "I 18:23:24.9696500 Finding Game With Deck:",
        "I 18:23:24.9696500 ### 试验套牌",
        "I 18:23:24.9696500 # Deck ID: 9302099347",
        "I 18:23:24.9696500 AAEBAfTVBwHzsgYAAAA="
      ].join("\n"),
      "utf8"
    );

    await vi.waitFor(
      () => {
        expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2);
      },
      { timeout: 2_000, interval: 50 }
    );
    expect(service.getState().deckName).toBe("竞技场牌库");
    expect(service.getState().autoMatchedDeckId).toBeUndefined();
    expect(service.getState().arena?.status).toBe("complete");
    await service.dispose();
  });

  it("forwards the collection preview source to TrackerEngine", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService();
    const deck = {
      id: "preview-source-deck",
      name: "来源测试套牌",
      format: "标准",
      cards: [{ name: "Source Card", count: 30 }],
      rawText: "",
      sourcePath: "/tmp/Decks.log",
      updatedAt: "2026-08-12T00:00:00.000Z",
      warnings: []
    };
    service.setCollectionDecks([deck]);
    const internal = service as unknown as {
      engine: { previewCollectionDeck(deckId: string, options: { expectedSize?: number; source?: "decks-log" | "screen" }): boolean };
      previewCollectionDeck(collectionDeck: typeof deck, source: "decks-log" | "screen"): boolean;
    };
    const preview = vi.spyOn(internal.engine, "previewCollectionDeck");

    internal.previewCollectionDeck(deck, "decks-log");
    expect(preview).toHaveBeenLastCalledWith(deck.id, { expectedSize: 30, source: "decks-log" });

    internal.previewCollectionDeck(deck, "screen");
    expect(preview).toHaveBeenLastCalledWith(deck.id, { expectedSize: 30, source: "screen" });
    await service.dispose();
  });

  it("drops delayed OCR from an older start even when the log path is unchanged", async () => {
    const sessionDir = await createSessionDir();
    const powerLog = join(sessionDir, "Power.log");
    await writeFile(powerLog, "D 18:05:00.000 GameState.DebugPrintPower() - Waiting for deck selection\n", "utf8");
    const selectedDeck = {
      id: "same-path-screen-deck",
      name: "新会话不可继承旧识别",
      format: "标准",
      cards: [{ name: "Screen Card", count: 30 }],
      rawText: "",
      sourcePath: join(sessionDir, "Decks.log"),
      updatedAt: "2026-08-12T00:00:00.000Z",
      warnings: []
    };
    let releaseOldRecognition: (result: {
      status: "ok";
      texts: Array<{ text: string; confidence: number; x: number; y: number; width: number; height: number }>;
    }) => void = () => undefined;
    const oldRecognition = new Promise<{
      status: "ok";
      texts: Array<{ text: string; confidence: number; x: number; y: number; width: number; height: number }>;
    }>((resolve) => {
      releaseOldRecognition = resolve;
    });
    const recognizer = { recognize: vi.fn(() => oldRecognition) };
    const scanner = {
      scanAndImportDecks: vi.fn(async () => ({ status: "ok" as const, decks: [selectedDeck] }))
    };
    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService(scanner, recognizer);
    const firstStart = service.start({ logPath: powerLog });
    await vi.waitFor(() => expect(recognizer.recognize).toHaveBeenCalledTimes(1));
    const firstKey = (service as unknown as { sessionContext: { key: object } }).sessionContext.key;

    await service.start({ logPath: powerLog });
    const secondKey = (service as unknown as { sessionContext: { key: object } }).sessionContext.key;
    expect(secondKey).not.toBe(firstKey);

    releaseOldRecognition({
      status: "ok",
      texts: [
        { text: "标准对战", confidence: 1, x: 0.32, y: 0.91, width: 0.08, height: 0.02 },
        { text: selectedDeck.name, confidence: 1, x: 0.72, y: 0.34, width: 0.1, height: 0.02 }
      ]
    });
    await firstStart;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.getState().autoMatchedDeckId).toBeUndefined();
    expect(service.getState().constructedScreenMode).toBeUndefined();
    await service.dispose();
  });

  it("drops an old Decks.log result and its pending exact Arena deck after a new start", async () => {
    vi.stubEnv("QA_LOCK_LOG_PATH", "1");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    const decksLog = join(sessionDir, "Decks.log");
    await writeFile(arenaLog, [
      "D 12:00:00.000 Arena.SetDraftMode - REDRAFTING",
      "D 12:00:00.250 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 12:00:00.500 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 12:00:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      )
    ].join("\n") + "\n", "utf8");
    await writeFile(decksLog, "I 12:00:00.000 Deck Contents Received:\n", "utf8");
    const exactArenaDeck = {
      id: "old-exact-arena",
      deckId: "9466340632",
      mode: "arena",
      cards: [{ name: "Sample Singleton", count: 30, cardId: "TEST_001" }],
      rawText: "I 12:00:30.000 Starting Arena Game With Deck",
      sourcePath: decksLog,
      updatedAt: "2026-08-12T00:00:00.000Z",
      warnings: []
    };
    let releaseOldDeckScan: (result: { status: "ok"; decks: typeof exactArenaDeck[]; activeDeck: typeof exactArenaDeck }) => void = () => undefined;
    const oldDeckScan = new Promise<{ status: "ok"; decks: typeof exactArenaDeck[]; activeDeck: typeof exactArenaDeck }>((resolve) => {
      releaseOldDeckScan = resolve;
    });
    let scanCount = 0;
    const scanner = {
      scanAndImportDecks: vi.fn(() => {
        scanCount += 1;
        if (scanCount === 2) {
          return oldDeckScan;
        }
        return Promise.resolve({ status: "ok" as const, decks: [] });
      })
    };
    const { TrackerService } = await import("../src/main/trackerService.js");
    const service = new TrackerService(scanner, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });
    await service.start({ logPath: arenaLog });
    await appendFile(decksLog, "I 12:00:30.000 Starting Arena Game With Deck\n", "utf8");
    await vi.waitFor(() => expect(scanner.scanAndImportDecks).toHaveBeenCalledTimes(2));

    await service.start({ logPath: arenaLog });
    releaseOldDeckScan({ status: "ok", decks: [exactArenaDeck], activeDeck: exactArenaDeck });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const internal = service as unknown as { pendingExactArenaDeck?: unknown; latestExactArenaDeckObservation?: unknown };
    expect(internal.pendingExactArenaDeck).toBeUndefined();
    expect(internal.latestExactArenaDeckObservation).toBeUndefined();
    expect(service.getState().arena).toMatchObject({ status: "redrafting", unresolvedCount: 30 });
    await service.dispose();
  });

  it("drops an old Arena rating response after restarting the same session", async () => {
    vi.resetModules();
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() {
          return {
            database: { "1001": { dbfId: 1001, name: "Sample Singleton", cardId: "TEST_001" } },
            warnings: []
          };
        }
      }
    }));
    const ratingResult = (pickRate: number) => ({
      table: {
        source: "test ratings",
        version: 1,
        fetchedAt: "2026-08-12T00:00:00.000Z",
        ratings: {},
        firestone: {
          source: "Firestone" as const,
          version: "test",
          lastUpdated: "2026-08-12T00:00:00.000Z",
          ratings: { TEST_001: { pickRate, highWinPickRate: pickRate } }
        }
      },
      warnings: []
    });
    let releaseOldRatings: (result: ReturnType<typeof ratingResult>) => void = () => undefined;
    const oldRatings = new Promise<ReturnType<typeof ratingResult>>((resolve) => {
      releaseOldRatings = resolve;
    });
    const loadRatings = vi.fn()
      .mockImplementationOnce(() => oldRatings)
      .mockImplementation(() => Promise.resolve(ratingResult(22)));
    vi.doMock("../src/main/arenaRatingService.js", () => ({
      ArenaRatingService: class ArenaRatingService { loadRatings = loadRatings; }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 17:39:59.000 DraftManager.OnChoicesAndContents - Draft Deck ID: arena, Hero Card = HERO_06",
      ...Array.from(
        { length: 30 },
        (_value, index) => `D 17:39:59.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 17:40:02.000 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    await service.start({ logPath: arenaLog });
    await service.start({ logPath: arenaLog });
    await vi.waitFor(() => expect(loadRatings).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.getState().arena?.deck[0]?.pickRate).toBe(22));

    releaseOldRatings(ratingResult(99));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.getState().arena?.deck[0]?.pickRate).toBe(22);
    await service.dispose();
  });

  it("resolves lowercase token card ids from the real Arena deck snapshot", async () => {
    vi.resetModules();
    const database = {
      "1001": { dbfId: 1001, name: "普通测试牌", cardId: "TEST_001", manaCost: 1 },
      "119918": { dbfId: 119918, name: "明日巨匠格尔宾", cardId: "TIME_009", manaCost: 8 },
      "119919": { dbfId: 119919, name: "侏儒光环", cardId: "TIME_009t1", manaCost: 4, cardType: "法术" },
      "119920": { dbfId: 119920, name: "梅卡托克的光环", cardId: "TIME_009t2", manaCost: 5, cardType: "法术" }
    };
    vi.doMock("../src/main/cardDataService.js", () => ({
      CardDataService: class CardDataService {
        async loadCardDatabase() { return { database, warnings: [] }; }
      }
    }));
    const { TrackerService } = await import("../src/main/trackerService.js");
    const sessionDir = await createSessionDir();
    const arenaLog = join(sessionDir, "Arena.log");
    await writeFile(arenaLog, [
      "D 17:28:59.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9485096686, Hero Card = HERO_04",
      ...Array.from(
        { length: 27 },
        (_value, index) => `D 17:28:59.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 17:28:59.100 DraftManager.OnChoicesAndContents - Draft deck contains card TIME_009",
      "D 17:28:59.101 DraftManager.OnChoicesAndContents - Draft deck contains card TIME_009t1",
      "D 17:28:59.102 DraftManager.OnChoicesAndContents - Draft deck contains card TIME_009t2",
      "D 17:28:59.200 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    const service = new TrackerService(undefined, {
      recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
    });

    await service.start({ logPath: arenaLog });
    const arenaDeck = service.getState().arena?.deck ?? [];
    expect(arenaDeck).toHaveLength(4);
    expect(arenaDeck.map((card) => card.name)).not.toEqual(expect.arrayContaining([
      "TIME_009t1",
      "TIME_009t2"
    ]));
    expect(arenaDeck).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardId: "TIME_009t1",
        name: "侏儒光环",
        details: expect.objectContaining({ manaCost: 4 })
      }),
      expect.objectContaining({
        cardId: "TIME_009t2",
        name: "梅卡托克的光环",
        details: expect.objectContaining({ manaCost: 5 })
      })
    ]));
    await service.dispose();
  });
});

async function createSessionDir() {
  const root = await mkdtemp(join(os.tmpdir(), "hearthstone-tracker-service-"));
  tempDirs.push(root);
  const sessionDir = join(root, "session");
  await mkdir(sessionDir);
  return sessionDir;
}
