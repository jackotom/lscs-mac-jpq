import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encode } from "deckstrings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCardDatabase, type CardDatabase } from "../src/shared/cardDatabase.js";
import type { TrackerService } from "../src/main/trackerService.js";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: class BrowserWindow {}
}));

const fixtureDir = path.resolve("fixtures/logs/arena-redraft-session");
const tempDirs: string[] = [];
const services: TrackerService[] = [];
let database: CardDatabase;

beforeEach(async () => {
  const cache = JSON.parse(await readFile(path.join(fixtureDir, "cards.qa-cache.json"), "utf8"));
  database = createCardDatabase(cache.cards);
  vi.doMock("../src/main/cardDataService.js", () => ({
    CardDataService: class CardDataService {
      async loadCardDatabase() { return { database, warnings: [] }; }
    }
  }));
  vi.doMock("../src/main/arenaRatingService.js", () => ({
    ArenaRatingService: class ArenaRatingService {
      async loadRatings() { return { warnings: [] }; }
    }
  }));
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Arena exact deck freshness through the real Decks parser", () => {
  it("keeps redraft picks through warning-only updates and accepts the new edited deck", async () => {
    const arenaText = await readFile(path.join(fixtureDir, "Arena.log"), "utf8");
    const completeLine = "D 12:00:06.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK\n";
    const harness = await createHarness(arenaText.replace(completeLine, ""));
    const { service, arenaPath, decksPath } = harness;
    const initial = await service.start({ logPath: arenaPath });
    expect(initial.arena).toMatchObject({ status: "redrafting", awaitingExactDeck: true });
    expect(initial.arena?.pendingRedraftChoices).toHaveLength(5);

    await appendWarning(harness, "12:00:05.500");
    expect(service.getState().arena?.pendingRedraftChoices).toHaveLength(5);
    expect(service.getState().arena?.awaitingExactDeck).toBe(true);

    await appendFile(arenaPath, completeLine, "utf8");
    await vi.waitFor(() => expect(service.getState().arena?.status).toBe("complete"));
    // An old deck deferred during REDRAFTING must not become final on this transition.
    expect(service.getState().arena?.awaitingExactDeck).toBe(true);
    expect(service.getState().arena?.pendingRedraftChoices).toHaveLength(5);

    await appendWarning(harness, "12:00:06.500");
    expect(service.getState().arena?.awaitingExactDeck).toBe(true);
    expect(service.getState().arena?.pendingRedraftChoices).toHaveLength(5);

    const scansBefore = harness.completedScans;
    const edited = (await readFile(path.join(fixtureDir, "Decks.after-redraft.log"), "utf8"))
      .replace("Starting Arena Game With Deck:", "Finished Editing Deck:");
    await appendFile(decksPath, edited, "utf8");
    await vi.waitFor(() => {
      expect(harness.completedScans).toBeGreaterThan(scansBefore);
      expect(service.getState().arena).toMatchObject({ awaitingExactDeck: false, pendingRedraftChoices: [] });
      expect(service.getState().arena?.deck).toEqual(expect.arrayContaining([
        expect.objectContaining({ cardId: "TEST_ARENA_30", count: 1 })
      ]));
    }, { timeout: 5_000 });
  });

  it("does not treat warning-refreshed Decks mtime as a fresh exact deck on restart", async () => {
    const arenaText = await readFile(path.join(fixtureDir, "Arena.log"), "utf8");
    const { service, arenaPath, decksPath } = await createHarness(arenaText);
    await appendFile(decksPath, warningLine("12:00:08.000"), "utf8");
    const day = new Date();
    day.setHours(12, 0, 6, 0);
    await utimes(arenaPath, day, day);
    const later = new Date(day.getTime() + 2_000);
    await utimes(decksPath, later, later);

    const state = await service.start({ logPath: arenaPath });
    expect(state.arena).toMatchObject({ status: "complete", awaitingExactDeck: true });
    expect(state.arena?.pendingRedraftChoices).toHaveLength(5);
    expect(state.arena?.redraftPool).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_ARENA_29" })
    ]));
  });

  it("retains an early exact deck across split redraft events with a reused generation", async () => {
    const arenaText = await readFile(path.join(fixtureDir, "Arena.log"), "utf8");
    const harness = await createHarness(arenaText);
    const { service, arenaPath, decksPath } = harness;
    await writeFile(decksPath, await readFile(path.join(fixtureDir, "Decks.after-redraft.log"), "utf8"));
    const initial = await service.start({ logPath: arenaPath });
    expect(initial.arena).toMatchObject({
      status: "complete", awaitingExactDeck: false, redraftGenerationId: "9000000002"
    });

    // File notifications can deliver the final Decks snapshot before Arena's earlier events.
    const nextCode = encode({ cards: [[1001, 30]], heroes: [7], format: 1 });
    const scansBefore = harness.completedScans;
    await appendFile(decksPath, [
      "I 12:01:07.000 Decks - Finished Editing Deck:",
      "I 12:01:07.001 Decks - ### 下一轮竞技场牌库",
      "I 12:01:07.002 Decks - # Deck ID: 9000000001",
      `I 12:01:07.003 Decks - ${nextCode}`,
      ""
    ].join("\n"));
    await vi.waitFor(() => {
      expect(harness.completedScans).toBeGreaterThan(scansBefore);
      expect(service.getState().arena?.deck).toEqual([
        expect.objectContaining({ cardId: "TEST_ARENA_01", count: 30 })
      ]);
    }, { timeout: 5_000 });

    await appendFile(arenaPath, "D 12:01:00.000 Arena.SetDraftMode - REDRAFTING\n");
    await vi.waitFor(() => expect(service.getState().arena?.status).toBe("redrafting"));
    const beforeBegin = service.getState().arena?.lastUpdated;
    await appendFile(arenaPath, "D 12:01:00.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9000000002\n");
    await vi.waitFor(() => expect(service.getState().arena?.lastUpdated).not.toBe(beforeBegin));
    await appendFile(arenaPath, [
      "D 12:01:01.000 Client chooses: 测试重选牌29 (TEST_ARENA_29)",
      "D 12:01:06.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK",
      ""
    ].join("\n"));

    await vi.waitFor(() => {
      expect(service.getState().arena).toMatchObject({
        status: "complete", awaitingExactDeck: false, pendingRedraftChoices: [],
        redraftGenerationId: "9000000002"
      });
      expect(service.getState().arena?.deck).toEqual([
        expect.objectContaining({ cardId: "TEST_ARENA_01", count: 30 })
      ]);
    }, { timeout: 5_000 });
  });
});

async function createHarness(arenaText: string) {
  const { CollectionDeckService } = await import("../src/main/collectionDeckService.js");
  const { CollectionDeckStore } = await import("../src/main/collectionDeckStore.js");
  const { TrackerService } = await import("../src/main/trackerService.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "arena-deck-freshness-"));
  tempDirs.push(root);
  const sessionDir = path.join(root, "session");
  await mkdir(sessionDir);
  const arenaPath = path.join(sessionDir, "Arena.log");
  const decksPath = path.join(sessionDir, "Decks.log");
  const oldCode = encode({ cards: [[1001, 30]], heroes: [7], format: 1 });
  await writeFile(decksPath, [
    "I 11:59:00.000 Decks - Starting Arena Game With Deck:",
    "I 11:59:00.001 Decks - ### 旧竞技场牌库",
    "I 11:59:00.002 Decks - # Deck ID: 9000000001",
    `I 11:59:00.003 Decks - ${oldCode}`,
    ""
  ].join("\n"), "utf8");
  await writeFile(arenaPath, arenaText, "utf8");
  const deckService = new CollectionDeckService(
    new CollectionDeckStore(path.join(root, "collection-decks.json")),
    { loadCardDatabase: async () => ({ database, warnings: [] }) }
  );
  let completedScans = 0;
  const scanAndImportDecks = vi.fn(async (options?: { logPath?: string }) => {
    const result = await deckService.scanAndImportDecks(options);
    completedScans += 1;
    return result;
  });
  const service = new TrackerService({ scanAndImportDecks }, {
    recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
  });
  services.push(service);
  return { service, arenaPath, decksPath, get completedScans() { return completedScans; } };
}

function warningLine(time: string) {
  return `W ${time} Decks - Your deck doesn't care about Validity\n`;
}

async function appendWarning(harness: Awaited<ReturnType<typeof createHarness>>, time: string) {
  const scanCount = harness.completedScans;
  await appendFile(harness.decksPath, warningLine(time), "utf8");
  await vi.waitFor(() => {
    expect(harness.completedScans).toBeGreaterThan(scanCount);
  }, { timeout: 5_000 });
}
