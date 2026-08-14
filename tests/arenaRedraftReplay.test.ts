import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArenaDraftEngine } from "../src/shared/arenaDraftEngine.js";
import { createCardDatabase, type CardDatabase } from "../src/shared/cardDatabase.js";
import { selectCurrentArenaLogText } from "../src/shared/arenaLogParser.js";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: class BrowserWindow {}
}));

const fixtureDir = path.resolve("fixtures/logs/arena-redraft-session");
const tempDirs: string[] = [];
let qaCardDatabase: CardDatabase;

beforeEach(async () => {
  const cache = JSON.parse(await readFile(path.join(fixtureDir, "cards.qa-cache.json"), "utf8")) as {
    cards: readonly unknown[];
  };
  qaCardDatabase = createCardDatabase(cache.cards);
  vi.doMock("../src/main/cardDataService.js", () => ({
    CardDataService: class CardDataService {
      async loadCardDatabase() {
        return { database: qaCardDatabase, warnings: [] };
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
});

afterEach(async () => {
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("de-identified Arena redraft replay", () => {
  it("keeps a cold-start redraft pending until an exact 30-card deck is available", async () => {
    const content = await readFile(path.join(fixtureDir, "Arena.log"), "utf8");
    const cold = replayCurrentDraft(content);
    const chunked = new ArenaDraftEngine({ cardDatabase: qaCardDatabase, preferArenaLogPicks: true });

    for (const chunk of splitAtRedraftBoundaries(content)) {
      chunked.applyArenaText(chunk);
    }

    const restarted = replayCurrentDraft(content);
    for (const state of [cold, chunked.getState(), restarted]) {
      expect(state).toMatchObject({
        status: "complete",
        deckId: "9000000001",
        redraftGenerationId: "9000000002",
        draftCount: 29,
        unresolvedCount: 30,
        awaitingExactDeck: true
      });
      expect(state.picks).toHaveLength(0);
      expect(state.pendingRedraftChoices).toHaveLength(5);
      expect(state.deck).toEqual([]);
      expect(state.deck.some((card) => card.unresolved || /缺失|未解析/.test(card.name))).toBe(false);
    }
  });

  it("rejects a different deck id, then adopts a late exact Decks.log through the real parser", async () => {
    const { CollectionDeckService } = await import("../src/main/collectionDeckService.js");
    const { CollectionDeckStore } = await import("../src/main/collectionDeckStore.js");
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-redraft-replay-"));
    tempDirs.push(root);
    const sessionDir = path.join(root, "session");
    await mkdir(sessionDir);
    await copyFile(path.join(fixtureDir, "Arena.log"), path.join(sessionDir, "Arena.log"));

    const deckService = new CollectionDeckService(
      new CollectionDeckStore(path.join(root, "collection-decks.json")),
      { loadCardDatabase: async () => ({ database: qaCardDatabase, warnings: [] }) }
    );
    const scanResults: Awaited<ReturnType<typeof deckService.scanAndImportDecks>>[] = [];
    const scanAndImportDecks = vi.fn(async (options?: { logPath?: string }) => {
      const result = await deckService.scanAndImportDecks(options);
      scanResults.push(result);
      return result;
    });
    const recognizer = { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) };

    const firstService = new TrackerService({ scanAndImportDecks }, recognizer);
    const first = await firstService.start({ logPath: path.join(sessionDir, "Arena.log") });
    expect(first.arena).toMatchObject({ draftCount: 29, unresolvedCount: 30, awaitingExactDeck: true });
    await firstService.dispose();

    const restartedService = new TrackerService({ scanAndImportDecks }, recognizer);
    const restarted = await restartedService.start({ logPath: path.join(sessionDir, "Arena.log") });
    expect(restarted.arena).toMatchObject({ draftCount: 29, unresolvedCount: 30, awaitingExactDeck: true });

    await copyFile(path.join(fixtureDir, "Decks.mismatched.log"), path.join(sessionDir, "Decks.log"));
    await vi.waitFor(() => expect(scanAndImportDecks).toHaveBeenCalledTimes(3), { timeout: 5_000 });
    expect(restartedService.getState().arena).toMatchObject({ draftCount: 29, unresolvedCount: 30, awaitingExactDeck: true });

    const exactDecksLog = await readFile(path.join(fixtureDir, "Decks.after-redraft.log"), "utf8");
    await appendFile(path.join(sessionDir, "Decks.log"), `\n${exactDecksLog}`, "utf8");
    await vi.waitFor(() => expect(scanAndImportDecks).toHaveBeenCalledTimes(4), { timeout: 5_000 });
    expect(scanResults.at(-1)).toMatchObject({
      status: "ok",
      activeDeck: { deckId: "9000000001", mode: "arena", cards: expect.any(Array) }
    });
    expect(scanResults.at(-1)?.activeDeck?.cards.reduce((total, card) => total + card.count, 0)).toBe(30);
    await vi.waitFor(() => {
      expect(restartedService.getState().arena).toMatchObject({ draftCount: 30, unresolvedCount: 0 });
    }, { timeout: 5_000 });
    const exactDeck = restartedService.getState().arena?.deck ?? [];
    expect(exactDeck.reduce((total, card) => total + card.count, 0)).toBe(30);
    expect(exactDeck).toHaveLength(30);
    expect(exactDeck.every((card) => Boolean(card.cardId) && !card.unresolved)).toBe(true);
    const decoded = await deckService.scanAndImportDecks({ logPath: sessionDir });
    expect(decoded).toMatchObject({
      status: "ok",
      activeDeck: { deckId: "9000000001", mode: "arena", cards: expect.any(Array) }
    });
    await restartedService.dispose();
  }, 20_000);

  it("keeps the honest incomplete state when the real Decks parser returns an unknown card", async () => {
    const { CollectionDeckService } = await import("../src/main/collectionDeckService.js");
    const { CollectionDeckStore } = await import("../src/main/collectionDeckStore.js");
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-redraft-unknown-"));
    tempDirs.push(root);
    const sessionDir = path.join(root, "session");
    await mkdir(sessionDir);
    await copyFile(path.join(fixtureDir, "Arena.log"), path.join(sessionDir, "Arena.log"));

    const incompleteCardDatabase: CardDatabase = Object.fromEntries(
      Object.entries(qaCardDatabase).filter(([dbfId]) => dbfId !== "1030")
    );
    const deckService = new CollectionDeckService(
      new CollectionDeckStore(path.join(root, "collection-decks.json")),
      { loadCardDatabase: async () => ({ database: incompleteCardDatabase, warnings: [] }) }
    );
    const scanResults: Awaited<ReturnType<typeof deckService.scanAndImportDecks>>[] = [];
    const scanAndImportDecks = vi.fn(async (options?: { logPath?: string }) => {
      const result = await deckService.scanAndImportDecks(options);
      scanResults.push(result);
      return result;
    });
    const service = new TrackerService(
      { scanAndImportDecks },
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) }
    );

    const initial = await service.start({ logPath: path.join(sessionDir, "Arena.log") });
    expect(initial.arena).toMatchObject({ draftCount: 29, unresolvedCount: 30, awaitingExactDeck: true });

    await copyFile(path.join(fixtureDir, "Decks.after-redraft.log"), path.join(sessionDir, "Decks.log"));
    await vi.waitFor(() => {
      expect(scanResults.some((result) => result.activeDeck?.cards.some(
        (card) => card.name === "Unknown card 1030"
      ))).toBe(true);
    }, { timeout: 3_000, interval: 25 });
    const unknownCardScan = [...scanResults].reverse().find((result) => result.activeDeck?.cards.some(
      (card) => card.name === "Unknown card 1030"
    ));
    expect(unknownCardScan?.activeDeck?.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Unknown card 1030", count: 1 })
    ]));
    expect(service.getState().arena).toMatchObject({ draftCount: 29, unresolvedCount: 30, awaitingExactDeck: true });
    expect(service.getState().deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "待确认重选牌", unresolved: true, count: 1 })
    ]));
    expect(service.getState().deck.filter((card) => !card.unresolved)).toHaveLength(29);
    expect(service.getState().arena?.deck.some((card) => /^Unknown card\s+\d+$/i.test(card.name))).toBe(false);
    await service.dispose();
  });
});

function replayCurrentDraft(content: string) {
  const engine = new ArenaDraftEngine({ cardDatabase: qaCardDatabase, preferArenaLogPicks: true });
  engine.applyArenaText(selectCurrentArenaLogText(content));
  return engine.getState();
}

function splitAtRedraftBoundaries(content: string): string[] {
  const lines = content.trim().split(/\r?\n/);
  const firstPick = lines.findIndex((line) => line.includes("Client chooses:"));
  const active = lines.findIndex((line) => line.includes("ACTIVE_DRAFT_DECK"));
  return [
    lines.slice(0, 1).join("\n"),
    lines.slice(1, firstPick).join("\n"),
    ...lines.slice(firstPick, active).map((line) => `${line}\n`),
    lines.slice(active).join("\n")
  ];
}
