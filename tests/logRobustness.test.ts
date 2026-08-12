import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => os.tmpdir()
  },
  BrowserWindow: class BrowserWindow {}
}));

vi.mock("../src/main/cardDataService.js", () => ({
  CardDataService: class CardDataService {
    async loadCardDatabase() {
      return { warnings: [] };
    }
  }
}));

import { TrackerService } from "../src/main/trackerService";
import { TrackerEngine } from "../src/shared/trackerEngine";
import type { PublicTrackerState } from "../src/shared/types";

const REPRESENTATIVE_POWER_LOG = [
  "D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
  "D 12:00:00.100 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家#1234",
  "D 12:00:00.100 GameState.DebugPrintGame() - PlayerID=2, PlayerName=UNKNOWN HUMAN PLAYER",
  "D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND",
  "D 12:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Chillwind Yeti id=65 zone=HAND zonePos=1 cardId=CS2_182 player=2] tag=ZONE value=PLAY",
  "D 12:00:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=1"
].join("\n") + "\n";

const DECK_TEXT = "1x Fireball\n1x Frostbolt";

describe("Power.log robustness", () => {
  it("produces the same state for whole-file, line-by-line, and fixed-seed random chunks", async () => {
    const whole = await replayThroughService("whole");
    const lines = await replayThroughService("lines");
    const chunks = await replayThroughService("chunks");

    expect(lines).toEqual(whole);
    expect(chunks).toEqual(whole);
    expect(whole).toMatchObject({
      gameActive: true,
      friendlyHand: [{ name: "Fireball", count: 1, cardId: "CS2_029" }],
      opponentPlayed: [{ name: "Chillwind Yeti", played: 1, cardId: "CS2_182" }],
      summary: { totalCards: 2, remainingCards: 1, drawnCards: 1, opponentPlayedCount: 1 }
    });
  });

  it("does not restart or recount when key lines are duplicated", () => {
    const engine = new TrackerEngine({ deckText: DECK_TEXT });
    engine.setFriendlyController(1);
    engine.applyText([
      "D 12:10:00.000 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 12:10:00.100 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家#1234",
      "D 12:10:00.100 GameState.DebugPrintGame() - PlayerID=2, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 12:10:01.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId= player=1] CardID=CS2_029",
      "D 12:10:01.100 GameState.DebugPrintPower() - tag=CONTROLLER value=1",
      "D 12:10:01.200 GameState.DebugPrintPower() - tag=ZONE value=HAND",
      "D 12:10:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 12:10:01.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId= player=1] CardID=CS2_029",
      "D 12:10:01.100 PowerTaskList.DebugPrintPower() - tag=CONTROLLER value=1",
      "D 12:10:01.200 PowerTaskList.DebugPrintPower() - tag=ZONE value=HAND",
      "D 12:10:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Chillwind Yeti id=65 zone=HAND zonePos=1 cardId=CS2_182 player=2] tag=ZONE value=PLAY",
      "D 12:10:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=NUM_SPELLS_PLAYED_THIS_GAME value=4",
      "D 12:10:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=NUM_SPELLS_PLAYED_THIS_GAME value=4"
    ].join("\n"));

    const state = engine.getState();
    expect(state.events.filter((event) => event.kind === "game-start")).toHaveLength(1);
    expect(state.deck.find((card) => card.cardId === "CS2_029")).toMatchObject({
      remaining: 0,
      drawn: 1
    });
    expect(state.opponentPlayed).toEqual([
      expect.objectContaining({ name: "Chillwind Yeti", cardId: "CS2_182", played: 1 })
    ]);
    expect(state.summary).toMatchObject({ drawnCards: 1, opponentPlayedCount: 1 });
    expect(state.matchCounters).toMatchObject({ friendly: { spellsPlayed: 4 } });
  });

  it("converges when split CONTROLLER and ZONE details arrive in either valid order", () => {
    const controllerThenZone = replaySplitEntityDetails(["CONTROLLER", "ZONE"]);
    const zoneThenController = replaySplitEntityDetails(["ZONE", "CONTROLLER"]);

    expect(zoneThenController).toEqual(controllerThenZone);
    expect(controllerThenZone).toMatchObject({
      friendlyHand: [{ name: "Fireball", count: 1, cardId: "CS2_029" }],
      summary: { totalCards: 1, remainingCards: 0, drawnCards: 1 }
    });
  });

  it("keeps correct state with about ten thousand noise lines around representative events", () => {
    const engine = new TrackerEngine({ deckText: DECK_TEXT });
    engine.setFriendlyController(1);
    const noise = Array.from(
      { length: 10_000 },
      (_, index) => `D 13:00:00.${String(index % 1_000).padStart(3, "0")} Robustness.Noise() - ignored line ${index}`
    );
    const lines = [
      ...noise.slice(0, 2_500),
      "D 13:01:00.000 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      ...noise.slice(2_500, 5_000),
      "D 13:01:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Fireball id=164 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND",
      ...noise.slice(5_000, 7_500),
      "D 13:01:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Chillwind Yeti id=165 zone=HAND zonePos=1 cardId=CS2_182 player=2] tag=ZONE value=PLAY",
      ...noise.slice(7_500),
      "D 13:01:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=7"
    ];

    engine.applyText(lines.join("\n"));

    expect(engine.getState()).toMatchObject({
      gameActive: true,
      matchFlow: { globalTurn: 7 },
      friendlyHand: [{ name: "Fireball", count: 1, cardId: "CS2_029" }],
      opponentPlayed: [{ name: "Chillwind Yeti", played: 1, cardId: "CS2_182" }],
      summary: { totalCards: 2, remainingCards: 1, drawnCards: 1, opponentPlayedCount: 1 }
    });
  });
});

async function replayThroughService(mode: "whole" | "lines" | "chunks") {
  const root = await mkdtemp(join(os.tmpdir(), "hearthstone-log-robustness-"));
  const sessionDir = join(root, "session");
  const powerLog = join(sessionDir, "Power.log");
  await mkdir(sessionDir);
  await writeFile(powerLog, mode === "whole" ? REPRESENTATIVE_POWER_LOG : "");

  const service = new TrackerService(undefined, {
    recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] }))
  });

  try {
    await service.start({ logPath: powerLog, deckText: DECK_TEXT });
    if (mode === "lines") {
      for (const line of REPRESENTATIVE_POWER_LOG.match(/.*\n/g) ?? []) {
        await appendFile(powerLog, line);
        await waitForIncrementalRead(service, powerLog);
      }
    } else if (mode === "chunks") {
      const bytes = Buffer.from(REPRESENTATIVE_POWER_LOG);
      let sawPendingFragment = false;
      for (const chunk of splitWithFixedSeed(bytes, 0x5eed_1234)) {
        await appendFile(powerLog, chunk);
        await waitForIncrementalRead(service, powerLog);
        sawPendingFragment ||= getServiceInternals(service).pendingLogBytes.has(powerLog);
      }
      expect(sawPendingFragment).toBe(true);
    }

    await service.dispose();
    return stableState(service.getState());
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

function splitWithFixedSeed(bytes: Buffer, seed: number) {
  const chunks: Buffer[] = [];
  const chineseStart = bytes.indexOf(Buffer.from("本地玩家"));
  const forcedUtf8Split = chineseStart >= 0 ? chineseStart + 1 : 0;
  let offset = forcedUtf8Split;
  if (forcedUtf8Split > 0) chunks.push(bytes.subarray(0, forcedUtf8Split));
  let state = seed >>> 0;
  while (offset < bytes.length) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const size = 1 + (state % 97);
    chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + size)));
    offset += size;
  }
  return chunks;
}

async function waitForIncrementalRead(service: TrackerService, powerLog: string) {
  const expectedSize = (await stat(powerLog)).size;
  await vi.waitFor(
    () => expect(getServiceInternals(service).offsets.get(powerLog)).toBe(expectedSize),
    { timeout: 2_000, interval: 20 }
  );
}

function getServiceInternals(service: TrackerService) {
  return service as unknown as {
    offsets: Map<string, number>;
    pendingLogBytes: Map<string, Buffer>;
  };
}

function stableState(state: PublicTrackerState) {
  const { lastUpdated: _lastUpdated, logPath: _logPath, ...stable } = state;
  return {
    ...stable,
    events: stable.events.map(({ id: _id, at: _at, ...event }) => event)
  };
}

function replaySplitEntityDetails(order: readonly ("CONTROLLER" | "ZONE")[]) {
  const engine = new TrackerEngine({ deckText: "1x Fireball" });
  const detailLines = {
    CONTROLLER: "D 12:20:01.100 PowerTaskList.DebugPrintPower() -     tag=CONTROLLER value=2",
    ZONE: "D 12:20:01.200 PowerTaskList.DebugPrintPower() -     tag=ZONE value=HAND"
  } as const;
  engine.applyText([
    "D 12:20:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME",
    "D 12:20:01.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=Fireball id=264 zone=DECK zonePos=1 cardId= player=2] CardID=CS2_029",
    ...order.map((tag) => detailLines[tag])
  ].join("\n"));

  expect(engine.getState().summary).toMatchObject({ remainingCards: 1, drawnCards: 0 });
  engine.setFriendlyController(2);
  return stableState(engine.getState());
}
