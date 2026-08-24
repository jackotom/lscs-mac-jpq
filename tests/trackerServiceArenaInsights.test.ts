import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: class BrowserWindow {}
}));

const roots: string[] = [];

beforeEach(() => {
  vi.doMock("../src/main/cardDataService.js", () => ({
    CardDataService: class CardDataService {
      async loadCardDatabase() {
        return {
          database: { "1001": { dbfId: 1001, name: "竞技场测试牌", cardId: "ARENA_001", type: "SPELL" } },
          warnings: []
        };
      }
    }
  }));
  vi.doMock("../src/main/arenaRatingService.js", () => ({
    ArenaRatingService: class ArenaRatingService { async loadRatings() { return { warnings: [] }; } }
  }));
});

afterEach(async () => {
  vi.resetModules();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TrackerService Arena insights integration", () => {
  it("starts from confirmed Arena state, records a real result, and completes only on explicit end", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const { ArenaInsightsService } = await import("../src/main/arenaInsightsService.js");
    const { ArenaRunStore } = await import("../src/main/arenaRunStore.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "tracker-arena-insights-"));
    roots.push(root);
    const session = path.join(root, "session");
    await mkdir(session);
    const arenaLog = path.join(session, "Arena.log");
    const powerLog = path.join(session, "Power.log");
    await writeFile(arenaLog, [
      "D 10:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 77, Hero Card = HERO_08",
      "D 10:00:00.100 DraftManager.OnChoicesAndContents - Draft deck contains card ARENA_001",
      "D 10:00:01.000 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n", "utf8");
    await writeFile(powerLog, [
      "D 10:01:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家#1234",
      "D 10:01:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 10:01:01.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_ARENA",
      "D 10:01:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=竞技场测试牌 id=10 zone=DECK cardId=ARENA_001 player=1] tag=ZONE value=HAND",
      "D 10:01:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"
    ].join("\n") + "\n", "utf8");

    const archive = new ArenaInsightsService(new ArenaRunStore(path.join(root, "arena-runs.json")));
    const matchHistory = {
      add: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => ({ status: "ok", matches: [], summary: { total: 0, wins: 0, losses: 0, ties: 0, winRate: 0 } })),
      setRetentionDays: vi.fn()
    };
    const service = new TrackerService(
      undefined,
      { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) },
      matchHistory as never,
      archive
    );

    await service.start({ logPath: powerLog });
    await vi.waitFor(async () => expect((await archive.getInsights()).runs).toEqual([
      expect.objectContaining({ id: "arena:77", wins: 0, losses: 0 })
    ]));
    expect((await archive.getInsights()).runs?.[0]).not.toHaveProperty("endedAt");

    await appendFile(powerLog, [
      "D 10:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY player=1] tag=PLAYSTATE value=WON",
      "D 10:05:00.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER"
    ].join("\n") + "\n", "utf8");
    await vi.waitFor(async () => expect((await archive.getInsights()).runs).toEqual([
      expect.objectContaining({ id: "arena:77", wins: 1, losses: 0, mulligan: [] })
    ]));
    expect((await archive.getInsights()).runs?.[0]).not.toHaveProperty("endedAt");

    await appendFile(arenaLog, "D 10:06:00.000 SetDraftMode - NO_ACTIVE_DRAFT\n", "utf8");
    await vi.waitFor(async () => expect((await archive.getInsights()).runs).toEqual([
      expect.objectContaining({ id: "arena:77", wins: 1, endedAt: expect.stringMatching(/^\d{4}-/) })
    ]));
    await service.dispose();
  });
});
